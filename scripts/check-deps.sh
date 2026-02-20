#!/bin/bash
# Check that dependency direction rules are respected.
set -euo pipefail

errors=0

# shapefile must not import anything outside std and its own files
bad_shapefile=$(grep -rn '@import' core/shapefile/src/ | grep -v '@import("std")' | grep -v '@import("builtin")' | grep -v '@import(".*\.zig")' || true)
if [ -n "$bad_shapefile" ]; then
    echo "ERROR: shapefile has external imports:"
    echo "$bad_shapefile"
    errors=1
fi

# network-engine must not import crs
bad_crs=$(grep -rn '@import' core/network-engine/src/ | grep -i 'crs' || true)
if [ -n "$bad_crs" ]; then
    echo "ERROR: network-engine imports crs:"
    echo "$bad_crs"
    errors=1
fi

if [ "$errors" -eq 0 ]; then
    echo "Dependency direction check passed."
    exit 0
else
    exit 1
fi
