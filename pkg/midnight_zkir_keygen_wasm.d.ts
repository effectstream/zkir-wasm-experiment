/* tslint:disable */
/* eslint-disable */
/**
 * Generate prover and verifier keys for a single circuit from serialized binary .zkir data.
 *
 * `zkir_bytes` - serialized IrSource (binary format, as produced by `tagged_serialize`)
 * `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
 */
export function keygen(zkir_bytes: Uint8Array, provider: any): Promise<KeygenResult>;
/**
 * Batch key generation for multiple circuits (equivalent to `zkir compile-many`).
 *
 * `entries` - JS Array of `{ name: string, zkir: Uint8Array }` objects
 * `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
 * `progress` - Optional JS object implementing `{ onProgress(name: string, current: number, total: number): void }`
 *
 * Returns a JS `Map<string, KeygenResult>`.
 */
export function keygenMany(entries: any, provider: any, progress: any): Promise<Map<any, any>>;
/**
 * Convert JSON .zkir to serialized binary format.
 */
export function jsonIrToBinary(json: string): Uint8Array;
/**
 * Generate prover and verifier keys for a single circuit from JSON .zkir data.
 *
 * `json` - JSON string of the .zkir circuit definition
 * `provider` - JS object implementing `{ getParams(k: number): Promise<Uint8Array> }`
 */
export function keygenFromJson(json: string, provider: any): Promise<KeygenResult>;
/**
 * Get the k value (circuit size parameter) from serialized binary .zkir data.
 */
export function getCircuitK(zkir_bytes: Uint8Array): number;
/**
 * Initialize panic hook for better error messages in the browser console.
 */
export function init(): void;
/**
 * Get the k value from JSON .zkir data.
 */
export function getCircuitKFromJson(json: string): number;
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */
type ReadableStreamType = "bytes";
export class IntoUnderlyingByteSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  pull(controller: ReadableByteStreamController): Promise<any>;
  start(controller: ReadableByteStreamController): void;
  cancel(): void;
  readonly autoAllocateChunkSize: number;
  readonly type: ReadableStreamType;
}
export class IntoUnderlyingSink {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  abort(reason: any): Promise<any>;
  close(): Promise<any>;
  write(chunk: any): Promise<any>;
}
export class IntoUnderlyingSource {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  pull(controller: ReadableStreamDefaultController): Promise<any>;
  cancel(): void;
}
/**
 * Result of key generation containing serialized prover and verifier keys.
 */
export class KeygenResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly proverKey: Uint8Array;
  readonly verifierKey: Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_keygenresult_free: (a: number, b: number) => void;
  readonly getCircuitK: (a: any) => [number, number, number];
  readonly getCircuitKFromJson: (a: number, b: number) => [number, number, number];
  readonly jsonIrToBinary: (a: number, b: number) => [number, number, number];
  readonly keygen: (a: any, b: any) => any;
  readonly keygenFromJson: (a: number, b: number, c: any) => any;
  readonly keygenMany: (a: any, b: any, c: any) => any;
  readonly keygenresult_proverKey: (a: number) => any;
  readonly keygenresult_verifierKey: (a: number) => any;
  readonly init: () => void;
  readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
  readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
  readonly intounderlyingbytesource_cancel: (a: number) => void;
  readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
  readonly intounderlyingbytesource_start: (a: number, b: any) => void;
  readonly intounderlyingbytesource_type: (a: number) => number;
  readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
  readonly intounderlyingsink_abort: (a: number, b: any) => any;
  readonly intounderlyingsink_close: (a: number) => any;
  readonly intounderlyingsink_write: (a: number, b: any) => any;
  readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
  readonly intounderlyingsource_cancel: (a: number) => void;
  readonly intounderlyingsource_pull: (a: number, b: any) => any;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_1: WebAssembly.Table;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_6: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly closure802_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure866_externref_shim: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
