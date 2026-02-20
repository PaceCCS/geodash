#!/bin/bash
# Check that WASM exports in Zig match the CoreExports type in TypeScript.
set -euo pipefail

ZIG_FILE="core/network-engine/src/wasm.zig"
TS_FILE="server/src/services/core.ts"

zig_exports=$(grep -o 'export fn geodash_[a-z_]*' "$ZIG_FILE" | sed 's/export fn //' | sort)
ts_exports=$(grep -o 'geodash_[a-z_]*' "$TS_FILE" | sort -u)

if [ "$zig_exports" = "$ts_exports" ]; then
    echo "WASM contract check passed."
    exit 0
else
    echo "WASM contract mismatch!"
    echo ""
    echo "Zig exports:"
    echo "$zig_exports"
    echo ""
    echo "TS exports:"
    echo "$ts_exports"
    echo ""
    diff <(echo "$zig_exports") <(echo "$ts_exports") || true
    exit 1
fi
