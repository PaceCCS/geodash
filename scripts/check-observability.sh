#!/bin/bash
# Check that observability patterns are wired up correctly.
set -euo pipefail

errors=0

# server.ts must use both opentelemetry and server-timing plugins
server_file="server/src/core/server.ts"
if ! grep -q 'opentelemetry(' "$server_file"; then
    echo "ERROR: $server_file is missing the opentelemetry plugin"
    errors=1
fi
if ! grep -q 'serverTiming()' "$server_file"; then
    echo "ERROR: $server_file is missing the server-timing plugin"
    errors=1
fi

# Every service file must import and use record from @elysiajs/opentelemetry
for f in server/src/services/*.ts; do
    # Skip test files
    [[ "$f" == *.test.ts ]] && continue

    if ! grep -q "from ['\"]@elysiajs/opentelemetry['\"]" "$f"; then
        echo "ERROR: $f does not import from @elysiajs/opentelemetry (missing record instrumentation)"
        errors=1
    elif ! grep -q 'record(' "$f"; then
        echo "ERROR: $f imports opentelemetry but never calls record() — instrument exported functions"
        errors=1
    fi
done

if [ "$errors" -eq 0 ]; then
    echo "Observability check passed."
    exit 0
else
    exit 1
fi
