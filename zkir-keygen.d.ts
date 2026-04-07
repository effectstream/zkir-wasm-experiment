/**
 * WASM keygen for zkir circuits.
 *
 * Provides browser-compatible key generation equivalent to the native
 * `zkir compile-many` command. The JS side must supply SRS parameters
 * via a ParamsProvider implementation.
 */

/** SRS parameter provider that JS must implement */
export interface ParamsProvider {
    /**
     * Fetch structured reference string parameters for the given k value.
     * Parameters are the `bls_midnight_2p{k}` files from the Midnight S3 bucket.
     * @param k - circuit size parameter (0-25)
     * @returns serialized SRS parameters as raw bytes
     */
    getParams(k: number): Promise<Uint8Array>;
}

/** Optional progress callback for batch keygen */
export interface ProgressCallback {
    /**
     * Called after each circuit's keys are generated.
     * @param name - circuit name from the input entry
     * @param current - 1-indexed count of completed circuits
     * @param total - total number of circuits
     */
    onProgress(name: string, current: number, total: number): void;
}

/** Input entry for batch keygen */
export interface CircuitEntry {
    /** Circuit name (used as key in the result map) */
    name: string;
    /** Serialized .zkir circuit data (binary format from jsonIrToBinary) */
    zkir: Uint8Array;
}

/** Result of key generation */
export class KeygenResult {
    /** Serialized prover key (tagged binary format) */
    readonly proverKey: Uint8Array;
    /** Serialized verifier key (tagged binary format) */
    readonly verifierKey: Uint8Array;
    free(): void;
}

/** Initialize panic hook for better error messages in the browser console. Call once at startup. */
export function init(): void;

/**
 * Generate prover and verifier keys for a single circuit from serialized binary .zkir data.
 * @param zkirBytes - serialized IrSource (binary format, as produced by `jsonIrToBinary`)
 * @param provider - SRS parameter provider
 */
export function keygen(
    zkirBytes: Uint8Array,
    provider: ParamsProvider,
): Promise<KeygenResult>;

/**
 * Generate prover and verifier keys for a single circuit from JSON .zkir data.
 * @param json - JSON string of the .zkir circuit definition
 * @param provider - SRS parameter provider
 */
export function keygenFromJson(
    json: string,
    provider: ParamsProvider,
): Promise<KeygenResult>;

/**
 * Batch key generation for multiple circuits (equivalent to `zkir compile-many`).
 * @param entries - array of circuit entries to generate keys for
 * @param provider - SRS parameter provider
 * @param progress - optional progress callback
 * @returns Map from circuit name to KeygenResult
 */
export function keygenMany(
    entries: CircuitEntry[],
    provider: ParamsProvider,
    progress?: ProgressCallback,
): Promise<Map<string, KeygenResult>>;

/**
 * Get the k value (circuit size parameter) from serialized binary .zkir data.
 * @param zkirBytes - serialized IrSource (binary format)
 */
export function getCircuitK(zkirBytes: Uint8Array): number;

/**
 * Get the k value from JSON .zkir data.
 * @param json - JSON string of the .zkir circuit definition
 */
export function getCircuitKFromJson(json: string): number;

/**
 * Convert JSON .zkir to serialized binary format.
 * @param json - JSON string of the .zkir circuit definition
 * @returns serialized binary representation
 */
export function jsonIrToBinary(json: string): Uint8Array;
