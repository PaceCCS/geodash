#!/bin/bash
# Verify that QUALITY_SCORE.md test counts match actual test counts.
# Requires: bun (server tests), WASM built at server/wasm/geodash.wasm
set -euo pipefail

QUALITY_SCORE="docs/QUALITY_SCORE.md"

if [ ! -f "$QUALITY_SCORE" ]; then
    echo "ERROR: $QUALITY_SCORE not found"
    exit 1
fi

errors=0

# --- Server (TypeScript) tests ---

claimed_ts=$(sed -n 's/.*Total TypeScript tests: \([0-9]*\).*/\1/p' "$QUALITY_SCORE")
if [ -z "$claimed_ts" ]; then
    echo "ERROR: Could not find 'Total TypeScript tests: <N>' in $QUALITY_SCORE"
    errors=1
else
    actual_ts=$(cd server && bun test 2>&1 | sed -n 's/.*Ran \([0-9]*\) tests.*/\1/p')
    actual_ts=${actual_ts:-0}
    if [ "$actual_ts" -lt "$claimed_ts" ]; then
        echo "ERROR: QUALITY_SCORE claims $claimed_ts TypeScript tests but only $actual_ts found"
        errors=1
    elif [ "$actual_ts" -gt "$claimed_ts" ]; then
        echo "WARNING: QUALITY_SCORE claims $claimed_ts TypeScript tests but $actual_ts exist — update the doc"
        errors=1
    else
        echo "TypeScript test count OK: $actual_ts"
    fi
fi

if [ "$errors" -eq 0 ]; then
    echo "Test count check passed."
    exit 0
else
    exit 1
fi
