#!/usr/bin/env bash
export PATH="$HOME/.nvm/versions/node/v24.9.0/bin:$PATH"
cd "$(dirname "$0")"
exec npx webpack serve --mode development
