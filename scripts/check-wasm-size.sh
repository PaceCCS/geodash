#!/bin/bash
# Check that the WASM binary does not exceed the size budget.
set -euo pipefail

WASM_FILE="server/wasm/geodash.wasm"
BUDGET_KB=320

if [ ! -f "$WASM_FILE" ]; then
    echo "WASM file not found: $WASM_FILE (skipping size check)"
    exit 0
fi

size=$(wc -c < "$WASM_FILE" | tr -d ' ')
size_kb=$((size / 1024))

echo "WASM size: ${size_kb}KB (budget: ${BUDGET_KB}KB)"

if [ "$size_kb" -gt "$BUDGET_KB" ]; then
    echo "ERROR: WASM binary exceeds size budget (${size_kb}KB > ${BUDGET_KB}KB)"
    exit 1
fi

echo "WASM size check passed."
