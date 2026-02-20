#!/bin/bash
# Check that every Zig source file with logic has at least one test block.
# Excludes root.zig (re-exports only) and integration_test.zig (is tests).
set -euo pipefail

errors=0

for file in core/*/src/*.zig; do
    base=$(basename "$file")

    # Skip files that are just re-exports or are themselves test files
    case "$base" in
        root.zig|main.zig|integration_test.zig|wasm.zig|types.zig)
            continue
            ;;
    esac

    if ! grep -q 'test "' "$file"; then
        echo "WARNING: $file has no test blocks"
        errors=1
    fi
done

if [ "$errors" -eq 0 ]; then
    echo "Test coverage check passed."
    exit 0
else
    echo ""
    echo "Files listed above have no test blocks. Add at least one test per file."
    exit 1
fi
