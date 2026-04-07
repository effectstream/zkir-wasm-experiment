/**
 * keygen.js — Browser wrapper for the zkir-keygen WASM module
 */

let wasmModule = null;

// Use dev server proxy to avoid CORS issues with S3
const DEFAULT_PARAM_SOURCE = '/srs';

/**
 * Initialize the keygen WASM module.
 */
async function initKeygen() {
    if (wasmModule) return wasmModule;

    // Load the WASM module (web target build)
    const wasm = await import(/* webpackIgnore: true */ './midnight_zkir_keygen_wasm.js');
    await wasm.default('keygen.wasm');
    wasm.init();
    wasmModule = wasm;
    return wasm;
}

/**
 * Create a ParamsProvider that fetches SRS parameters from S3.
 *
 * @param {string} [baseUrl] - Base URL for SRS parameter files
 * @param {function} [onProgress] - Callback for download progress
 * @returns {object} ParamsProvider
 */
export function createS3ParamsProvider(baseUrl, onProgress) {
    const url = baseUrl || DEFAULT_PARAM_SOURCE;
    const cache = new Map();

    return {
        async getParams(k) {
            if (cache.has(k)) return cache.get(k);

            const filename = `bls_midnight_2p${k}`;
            if (onProgress) onProgress(`Downloading SRS params k=${k}...`);

            const response = await fetch(`${url}/${filename}`);
            if (!response.ok) {
                throw new Error(`Failed to download SRS params k=${k}: ${response.status}`);
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            cache.set(k, bytes);

            if (onProgress) onProgress(`SRS params k=${k} loaded (${(bytes.length / 1024).toFixed(0)} KB)`);
            return bytes;
        }
    };
}

/**
 * Generate prover/verifier keys for all circuits from ZKIR JSON.
 *
 * @param {Map<string, string>} zkirMap - Map of circuit name → ZKIR JSON string
 * @param {object} paramsProvider - Provider with getParams(k) method
 * @param {function} [onProgress] - Progress callback(name, current, total)
 * @returns {Promise<Map<string, {proverKey: Uint8Array, verifierKey: Uint8Array}>>}
 */
export async function generateKeys(zkirMap, paramsProvider, onProgress) {
    const wasm = await initKeygen();
    const results = new Map();

    const entries = [...zkirMap.entries()];
    const total = entries.length;

    for (let i = 0; i < total; i++) {
        const [name, zkirJson] = entries[i];

        if (onProgress) onProgress(name, i + 1, total);

        const result = await wasm.keygenFromJson(zkirJson, paramsProvider);

        results.set(name, {
            proverKey: result.proverKey,
            verifierKey: result.verifierKey,
        });

        result.free();
    }

    return results;
}

/**
 * Get the k value for a circuit from its ZKIR JSON.
 */
export async function getCircuitK(zkirJson) {
    const wasm = await initKeygen();
    return wasm.getCircuitKFromJson(zkirJson);
}

/**
 * Convert ZKIR JSON to binary format (.bzkir).
 */
export async function jsonIrToBinary(zkirJson) {
    const wasm = await initKeygen();
    return wasm.jsonIrToBinary(zkirJson);
}
