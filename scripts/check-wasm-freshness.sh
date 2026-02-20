#!/bin/bash
# Verify that the committed server/wasm/geodash.wasm matches a fresh build.
# Run after zig build wasm to catch stale binaries.
set -euo pipefail

COMMITTED="server/wasm/geodash.wasm"
BUILT="core/network-engine/zig-out/bin/geodash.wasm"

if [ ! -f "$COMMITTED" ]; then
    echo "ERROR: $COMMITTED not found — run 'just build-wasm'"
    exit 1
fi

cd core/network-engine && zig build wasm
cd ../..

if ! cmp -s "$BUILT" "$COMMITTED"; then
    echo "ERROR: $COMMITTED is stale — run 'just build-wasm' and commit the result"
    exit 1
fi

echo "WASM freshness check passed."
