import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
        clean: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './public/index.html',
            title: 'Compact Compiler + ZKIR Keygen',
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
        extensions: ['.js', '.mjs'],
    },
};
