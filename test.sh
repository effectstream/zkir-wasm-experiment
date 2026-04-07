#!/usr/bin/env bash
set -euo pipefail

# Required: Homebrew LLVM + Node.js (via nvm or similar)
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar

# Add Node.js to PATH if using nvm
if [ -d "$HOME/.nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

echo "==> Running WASM tests via Node.js..."
wasm-pack test --node

echo "==> All tests passed!"
