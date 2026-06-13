# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

WASM build of Midnight's `zkir` keygen — a thin wrapper crate that imports unmodified upstream `midnight-ledger` crates (via path deps to `../midnight-ref-ai/midnight-ledger/`) and re-exports their functionality through `#[wasm_bindgen]`. No upstream Rust code is modified.

## Build & Test Commands

**Prerequisites (macOS):** `brew install llvm`, `rustup target add wasm32-unknown-unknown`, `cargo install wasm-pack`

```bash
# Build WASM (web target → pkg/)
./build.sh

# Build Node.js target → pkg-node/
CC=/opt/homebrew/opt/llvm/bin/clang AR=/opt/homebrew/opt/llvm/bin/llvm-ar wasm-pack build --target nodejs --out-dir pkg-node

# Run tests (Node.js)
./test.sh

# Browser tests
wasm-pack test --headless --chrome
```

Both `build.sh` and `test.sh` set `CC` and `AR` to Homebrew LLVM — Apple clang cannot compile `blst` (BLS12-381 C/assembly) to WASM.

**Webapp (in `webapp/`):**
```bash
npm install && npm run dev    # Dev server on :8080
npm run build                 # Production build → webapp/dist/
npm run pages:deploy          # Build + deploy to production (compact-wasm.pages.dev)
```

Deploy target is pinned in `webapp/wrangler.jsonc` (project `compact-wasm` → https://compact-wasm.pages.dev). The Cloudflare account comes from the local `wrangler login` session — no account ID or API token is committed. First-time setup: `npx wrangler login`.

The Pages project has two branches: `production` serves the canonical `compact-wasm.pages.dev`, while any other branch (e.g. `main`) produces a preview URL. `pages:deploy` passes `--branch=production` so it always publishes to the live site.

## Architecture

**Data flow:**
```
JS: JSON/binary ZKIR → WASM: IrSource → ir.keygen(JsParamsProvider) → serialized prover/verifier keys → JS: Uint8Array
```

The async bridge (`src/provider.rs`) is the key design challenge: Rust's `ParamsProverProvider` trait expects a Rust Future, but SRS parameters come from JavaScript Promises. `JsParamsProvider` wraps a JS object with `getParams(k): Promise<Uint8Array>` and converts via `wasm_bindgen_futures::JsFuture`.

**`src/lib.rs`** — 8 `#[wasm_bindgen]` exports: `init`, `keygen` (binary), `keygenFromJson` (JSON), `keygenMany` (batch), `getCircuitK`/`getCircuitKFromJson`, `jsonIrToBinary`. All keygen functions are async and require a `ParamsProvider` JS object.

**`src/provider.rs`** — `JsParamsProvider` (implements `ParamsProverProvider` trait) and `JsProgressCallback` (optional batch progress reporting).

**`keygen-cli.mjs`** — Node.js CLI for batch keygen: `node keygen-cli.mjs <contract-output-dir>`. Reads `zkir/*.zkir`, writes `keys/*.prover` and `keys/*.verifier`.

**Webapp (`webapp/`)** — Webpack 5 app combining the Compact compiler (Emscripten Chez Scheme WASM) with this keygen WASM. `src/compiler.js` wraps the compiler, `src/keygen.js` wraps keygen, `src/index.js` orchestrates the UI. Cloudflare Pages Function in `functions/` proxies S3 for CORS. Deployed to Cloudflare Pages as `compact-wasm` (config in `webapp/wrangler.jsonc`).

## Critical Version Constraints

- `wasm-bindgen` crate version **must exactly match** the `wasm-pack` CLI version (currently pinned to `=0.2.104`). Mismatches cause build failures.
- `getrandom` must have `features = ["js"]` — without it, any RNG call panics in WASM (no `/dev/urandom` in browser).
- `.cargo/config.toml` enables `+reference-types` WASM feature for smaller binaries.

## SRS Parameters

ZK keygen requires Structured Reference String (SRS) files (`bls_midnight_2p{k}`). Resolution order:
1. `$MIDNIGHT_PP` env var (directory path)
2. `~/.cache/midnight/zk-params/` (local cache)
3. S3: `https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p{k}` (overridable via `$MIDNIGHT_PARAM_SOURCE`)
