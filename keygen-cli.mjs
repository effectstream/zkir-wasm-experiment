#!/usr/bin/env node
/**
 * keygen-cli.mjs — Generate prover/verifier keys from compiled Compact contract output.
 *
 * Usage:
 *   node keygen-cli.mjs <contract-output-dir>
 *
 * Expects:
 *   <contract-output-dir>/zkir/*.zkir   — circuit IR files (produced by compactc --skip-zk)
 *
 * Produces:
 *   <contract-output-dir>/keys/*.prover   — prover keys
 *   <contract-output-dir>/keys/*.verifier — verifier keys
 *
 * SRS parameters are loaded from:
 *   $MIDNIGHT_PP or ~/.cache/midnight/zk-params/
 *
 * Alternatively, set MIDNIGHT_PARAM_SOURCE to a URL prefix to fetch from (e.g., S3 bucket).
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const wasm = require('./pkg-node/midnight_zkir_keygen_wasm.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// S3 base URL for SRS parameter downloads
const DEFAULT_PARAM_SOURCE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

function getParamsDir() {
    if (process.env.MIDNIGHT_PP) return process.env.MIDNIGHT_PP;
    const xdg = process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache');
    return path.join(xdg, 'midnight', 'zk-params');
}

function getParamSource() {
    return process.env.MIDNIGHT_PARAM_SOURCE || DEFAULT_PARAM_SOURCE;
}

/**
 * ParamsProvider that reads SRS parameters from local filesystem cache,
 * falling back to S3 download if not found locally.
 */
function createParamsProvider() {
    const paramsDir = getParamsDir();
    const paramSource = getParamSource();
    const cache = new Map();

    return {
        async getParams(k) {
            if (cache.has(k)) return cache.get(k);

            const filename = `bls_midnight_2p${k}`;
            const localPath = path.join(paramsDir, filename);

            let bytes;
            if (fs.existsSync(localPath)) {
                console.log(`  Loading SRS params k=${k} from ${localPath}`);
                bytes = new Uint8Array(fs.readFileSync(localPath));
            } else {
                const url = `${paramSource}/${filename}`;
                console.log(`  Downloading SRS params k=${k} from ${url}...`);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to download SRS params k=${k}: ${response.status} ${response.statusText}`);
                }
                bytes = new Uint8Array(await response.arrayBuffer());

                // Cache to disk
                fs.mkdirSync(paramsDir, { recursive: true });
                fs.writeFileSync(localPath, bytes);
                console.log(`  Cached SRS params k=${k} to ${localPath}`);
            }

            cache.set(k, bytes);
            return bytes;
        }
    };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: node keygen-cli.mjs <contract-output-dir>');
        console.error('');
        console.error('Generates prover/verifier keys from .zkir files produced by compactc --skip-zk');
        process.exit(1);
    }

    const contractDir = path.resolve(args[0]);
    const zkirDir = path.join(contractDir, 'zkir');
    const keysDir = path.join(contractDir, 'keys');

    if (!fs.existsSync(zkirDir)) {
        console.error(`Error: zkir directory not found at ${zkirDir}`);
        process.exit(1);
    }

    const zkirFiles = fs.readdirSync(zkirDir).filter(f => f.endsWith('.zkir'));
    if (zkirFiles.length === 0) {
        console.error(`Error: no .zkir files found in ${zkirDir}`);
        process.exit(1);
    }

    // Initialize WASM panic hook
    wasm.init();

    console.log(`Found ${zkirFiles.length} circuit(s) in ${zkirDir}:`);

    // Show circuit info
    const circuits = [];
    for (const file of zkirFiles) {
        const json = fs.readFileSync(path.join(zkirDir, file), 'utf8');
        const k = wasm.getCircuitKFromJson(json);
        const name = path.basename(file, '.zkir');
        console.log(`  ${name} (k=${k})`);
        circuits.push({ name, json, k });
    }

    console.log('');
    console.log('Generating keys...');

    const provider = createParamsProvider();
    fs.mkdirSync(keysDir, { recursive: true });

    const startTime = Date.now();

    for (let i = 0; i < circuits.length; i++) {
        const { name, json } = circuits[i];
        const circuitStart = Date.now();

        console.log(`  [${i + 1}/${circuits.length}] ${name}...`);

        const result = await wasm.keygenFromJson(json, provider);

        const proverPath = path.join(keysDir, `${name}.prover`);
        const verifierPath = path.join(keysDir, `${name}.verifier`);

        fs.writeFileSync(proverPath, result.proverKey);
        fs.writeFileSync(verifierPath, result.verifierKey);

        const elapsed = ((Date.now() - circuitStart) / 1000).toFixed(1);
        const proverSize = (result.proverKey.length / 1024).toFixed(1);
        const verifierSize = (result.verifierKey.length / 1024).toFixed(1);

        console.log(`    -> ${name}.prover (${proverSize} KB), ${name}.verifier (${verifierSize} KB) [${elapsed}s]`);

        result.free();
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log(`Done! Generated ${circuits.length * 2} key files in ${keysDir} [${totalElapsed}s total]`);
}

main().catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
});
