import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import webpack from 'webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve the actual file path of process/browser so ESM strict resolution works
const processBrowserPath = require.resolve('process/browser');

export default {
    entry: {
        main: './src/index.js',
        zswap: './src/zswap.js',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].bundle.js',
        clean: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './public/index.html',
            filename: 'index.html',
            chunks: ['main'],
            title: 'Compact Compiler + ZKIR Keygen',
        }),
        new HtmlWebpackPlugin({
            template: './public/zswap.html',
            filename: 'zswap.html',
            chunks: ['zswap'],
            title: 'ZSwap',
        }),
        new CopyWebpackPlugin({
            patterns: [
                // Compiler WASM assets — served as static files
                { from: 'assets/scheme.wasm', to: 'scheme.wasm' },
                { from: 'assets/scheme.js', to: 'scheme.js' },
                { from: 'assets/scheme.data', to: 'scheme.data' },
                { from: 'assets/standard-library.compact', to: 'standard-library.compact' },
                // Keygen WASM assets
                { from: '../pkg/midnight_zkir_keygen_wasm_bg.wasm', to: 'keygen.wasm' },
                { from: 'assets/midnight_zkir_keygen_wasm.js', to: 'midnight_zkir_keygen_wasm.js' },
            ],
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: processBrowserPath,
        }),
        // Shim for isomorphic-ws: in the browser, just use native WebSocket
        new webpack.NormalModuleReplacementPlugin(
            /isomorphic-ws/,
            path.resolve(__dirname, 'src/ws-shim.js')
        ),
    ],
    devServer: {
        static: {
            directory: path.resolve(__dirname, 'dist'),
        },
        port: 8080,
        proxy: [
            {
                context: ['/srs'],
                target: 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com',
                pathRewrite: { '^/srs': '' },
                changeOrigin: true,
            },
        ],
    },
    experiments: {
        asyncWebAssembly: true,
    },
    resolve: {
        extensions: ['.js', '.mjs', '.ts'],
        alias: {
            // Fix "process/browser" fully-specified resolution in ESM modules (e.g. effect)
            'process/browser': processBrowserPath,
        },
        fallback: {
            assert: 'assert',
            buffer: 'buffer',
            stream: 'stream-browserify',
            crypto: path.resolve(__dirname, 'src/crypto-shim.js'),
            util: 'util',
            path: 'path-browserify',
            os: 'os-browserify/browser',
            process: processBrowserPath,
            fs: false,
            net: false,
            tls: false,
            child_process: false,
            vm: false,
        },
    },
};
