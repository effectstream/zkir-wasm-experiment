#!/usr/bin/env bash
set -euo pipefail

# Required: Homebrew LLVM with WASM target support
# Install: brew install llvm
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar

echo "==> Building WASM package..."
wasm-pack build --target web --out-dir pkg

echo "==> Build complete. Output in pkg/"
ls -lh pkg/
