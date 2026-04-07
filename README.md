# midnight-zkir-keygen-wasm

> **Experimental** — This project is a proof of concept and has not been thoroughly tested. Use at your own risk.

WebAssembly build of Midnight's `zkir` keygen — generate ZK prover/verifier keys from ZKIR circuit descriptions in the browser or Node.js.

## Quick Start

### Pre-built Package

The `pkg/` directory contains ready-to-use WASM files:

```
pkg/
  midnight_zkir_keygen_wasm_bg.wasm   (2.4 MB)  — compiled WASM binary
  midnight_zkir_keygen_wasm.js        (28 KB)   — JS glue code
  midnight_zkir_keygen_wasm.d.ts      (6 KB)    — TypeScript definitions
  package.json
```

Install directly from the package:

```bash
npm install ./pkg
```

### Browser Usage

```js
import init, {
  keygenFromJson,
  getCircuitKFromJson,
  jsonIrToBinary,
} from 'midnight-zkir-keygen-wasm';

// Initialize the WASM module
await init();

// Read k value from a ZKIR circuit
const k = getCircuitKFromJson(zkirJson);

// Create a params provider (SRS trusted setup data)
const provider = {
  async getParams(k) {
    const resp = await fetch(`/srs/bls_midnight_2p${k}`);
    return new Uint8Array(await resp.arrayBuffer());
  }
};

// Generate prover + verifier keys
const result = await keygenFromJson(zkirJson, provider);
console.log(result.proverKey);   // Uint8Array
console.log(result.verifierKey); // Uint8Array
result.free(); // release WASM memory

// Convert JSON ZKIR to binary format (.bzkir)
const bzkir = jsonIrToBinary(zkirJson);
```

### Node.js Usage

```js
const wasm = require('./pkg-node/midnight_zkir_keygen_wasm.js');
wasm.init();

const result = await wasm.keygenFromJson(zkirJson, provider);
```

Or use the CLI wrapper:

```bash
node keygen-cli.mjs <contract-output-dir>
# Reads:  <dir>/zkir/*.zkir
# Writes: <dir>/keys/*.prover, <dir>/keys/*.verifier
```

## API

| Function | Description |
|----------|-------------|
| `init()` | Initialize panic hook (call once) |
| `keygen(zkirBytes, provider)` | Generate keys from binary `.bzkir` data |
| `keygenFromJson(json, provider)` | Generate keys from JSON `.zkir` string |
| `keygenMany(entries, provider, progress?)` | Batch keygen for multiple circuits |
| `getCircuitK(zkirBytes)` | Get circuit size parameter `k` from binary |
| `getCircuitKFromJson(json)` | Get circuit size parameter `k` from JSON |
| `jsonIrToBinary(json)` | Convert `.zkir` JSON to `.bzkir` binary |

### ParamsProvider Interface

```typescript
interface ParamsProvider {
  getParams(k: number): Promise<Uint8Array>;
}
```

The provider fetches SRS (Structured Reference String) parameters for a given `k` value. Each circuit requires the file `bls_midnight_2p{k}` from Midnight's S3 bucket:

```
https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p{k}
```

### ProgressCallback Interface (for keygenMany)

```typescript
interface ProgressCallback {
  onProgress(name: string, current: number, total: number): void;
}
```

## Building from Source

### Prerequisites

- Rust (stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- Homebrew LLVM (macOS) — required because the `blst` crate compiles C/assembly for BLS12-381, and Apple's clang cannot target `wasm32-unknown-unknown`
- Midnight ledger crates (path dependencies in `Cargo.toml`)

```bash
brew install llvm
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Why Homebrew LLVM?

The `zkir` crate depends on `blst` (BLS12-381 cryptography), which compiles C and assembly code. Apple's bundled `clang` does not support the `wasm32-unknown-unknown` target. Homebrew LLVM ships with full WASM target support.

You **must** set these environment variables before building:

```bash
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar
```

### Build

```bash
./build.sh
```

Or manually:

```bash
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar

# Browser target (ES module, manual init)
wasm-pack build --target web --out-dir pkg

# Node.js target (CommonJS, auto-init)
wasm-pack build --target nodejs --out-dir pkg-node
```

### Test

```bash
./test.sh
```

Or manually:

```bash
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar
wasm-pack test --node
```

## Crate Configuration

### Cargo.toml — Key Points

```toml
[lib]
crate-type = ["cdylib", "rlib"]
```

- `cdylib` — required for wasm-pack to produce a `.wasm` binary

```toml
wasm-bindgen = "=0.2.104"
```

- **Must be pinned exactly** to match the installed `wasm-bindgen-cli` version. A mismatch causes build failures.

```toml
getrandom = { version = "^0.2.8", features = ["js"] }
```

- Without the `"js"` feature, any randomness call panics in WASM — there's no `/dev/urandom` in browsers. This feature wires `getrandom` to `crypto.getRandomValues()`.

### .cargo/config.toml

```toml
[target.wasm32-unknown-unknown]
rustflags = ["-C", "target-feature=+reference-types"]
```

Enables WASM reference types for better wasm-opt optimization and smaller binaries.

### Dependencies

The crate depends on four Midnight ledger crates via local path:

| Crate | Package | What It Provides |
|-------|---------|-----------------|
| `zkir` | `midnight-zkir` | `IrSource`, `keygen()`, circuit parsing |
| `serialize` | `midnight-serialize` | `tagged_serialize` / `tagged_deserialize` |
| `transient-crypto` | `midnight-transient-crypto` | `ParamsProverProvider` trait, SRS types |
| `base-crypto` | `midnight-base-crypto` | BLS12-381 primitives (via `blst`) |

To build from source, you need the `midnight-ledger` repository checked out at the path specified in `Cargo.toml`.

## Architecture

### What Was Ported

The native `zkir` CLI does:

```
read .zkir file -> deserialize IrSource -> ir.keygen(&params_provider) -> serialize keys
```

The WASM version does the same, but crosses the JS/WASM boundary:

```
JS Uint8Array/string -> deserialize IrSource -> ir.keygen(&JsParamsProvider) -> Uint8Array back to JS
```

### JS-Rust Async Bridge (provider.rs)

The core challenge: `ir.keygen()` expects a Rust trait (`ParamsProverProvider`) returning `impl Future`, but the SRS parameters come from JavaScript (fetched via `fetch()`).

`JsParamsProvider` bridges this by wrapping a JS object and converting Promises to Rust Futures:

```rust
pub struct JsParamsProvider {
    inner: JsValue,  // JS object with getParams(k): Promise<Uint8Array>
}

impl ParamsProverProvider for JsParamsProvider {
    fn get_params(&self, k: u8) -> impl Future<Output = Result<impl AsRef<[u8]>, ...>> {
        async move {
            let func = Reflect::get(&self.inner, &"getParams".into())?;
            let promise = func.call1(&self.inner, &JsValue::from(k))?;
            let result = JsFuture::from(promise).await?;
            let array: Uint8Array = result.dyn_into()?;
            Ok(array.to_vec())
        }
    }
}
```

## SRS Parameters

Keygen requires Structured Reference String (SRS) parameters — precomputed trusted setup data. Each circuit has a `k` value (size parameter) determining which file is needed: `bls_midnight_2p{k}`.

| Source | Location |
|--------|----------|
| Environment variable | `$MIDNIGHT_PP` directory |
| Local cache | `~/.cache/midnight/zk-params/` |
| S3 (remote) | `https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p{k}` |

In browsers, S3 doesn't serve CORS headers, so you need a proxy (the webapp uses a dev server proxy or Cloudflare Pages Function).

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `error: linker cc failed` on wasm32 | Apple clang can't target WASM | `export CC=/opt/homebrew/opt/llvm/bin/clang` |
| `unreachable` panic in WASM | Missing getrandom `"js"` feature | Add `getrandom = { features = ["js"] }` to Cargo.toml |
| `wasm-bindgen` version mismatch | CLI and crate versions differ | Pin `wasm-bindgen = "=0.2.104"` exactly |
| `Failed to fetch` SRS params in browser | CORS blocks cross-origin S3 | Proxy requests through your server |

## File Structure

```
zkir-wasm/
├── Cargo.toml                # Rust crate config
├── build.sh                  # WASM build script
├── test.sh                   # Test runner
├── src/
│   ├── lib.rs                # WASM exports (keygen, getCircuitK, etc.)
│   └── provider.rs           # JS<->Rust async bridge for SRS params
├── tests/
│   ├── web.rs                # wasm-bindgen-test suite
│   └── fixtures/basic.zkir   # Test circuit
├── pkg/                      # wasm-pack output (web target) — distributable
├── pkg-node/                 # wasm-pack output (node target)
├── keygen-cli.mjs            # Node.js CLI for keygen
├── zkir-keygen.d.ts          # TypeScript definitions
└── webapp/                   # Demo app (Compact compiler + keygen)
    ├── webpack.config.js
    ├── src/
    │   ├── index.js          # UI + orchestration
    │   ├── compiler.js       # Compact compiler WASM wrapper
    │   └── keygen.js         # Keygen WASM wrapper
    └── functions/srs/        # Cloudflare Pages S3 proxy
```
