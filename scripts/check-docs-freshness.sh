#!/bin/bash
# Check that QUALITY_SCORE.md references all modules in core/.
set -euo pipefail

QUALITY_SCORE="docs/QUALITY_SCORE.md"

if [ ! -f "$QUALITY_SCORE" ]; then
    echo "ERROR: $QUALITY_SCORE not found"
    exit 1
fi

errors=0

for dir in core/*/; do
    module=$(basename "$dir")
    if [ "$module" = "README.md" ]; then
        continue
    fi
    if ! grep -q "$module" "$QUALITY_SCORE"; then
        echo "ERROR: module '$module' not referenced in $QUALITY_SCORE"
        errors=1
    fi
done

if [ "$errors" -eq 0 ]; then
    echo "Docs freshness check passed."
    exit 0
else
    exit 1
fi
