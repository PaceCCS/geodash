#!/usr/bin/env bash
# Checks that every API route handler in server/src/modules/ has OpenAPI annotations.
# Counts route definitions (.get/.post/.put/.patch/.delete) and detail: blocks per file.
# If a file has more routes than detail blocks, it fails.
set -euo pipefail

MODULES_DIR="server/src/modules"
errors=0

for file in $(find "$MODULES_DIR" -name '*.ts' -type f); do
  route_count=$(grep -cE '\.(get|post|put|patch|delete)\(' "$file" 2>/dev/null || true)
  detail_count=$(grep -cE 'detail:' "$file" 2>/dev/null || true)
  summary_count=$(grep -cE 'summary:' "$file" 2>/dev/null || true)

  route_count=${route_count:-0}
  detail_count=${detail_count:-0}
  summary_count=${summary_count:-0}

  if [ "$route_count" -eq 0 ]; then
    continue
  fi

  if [ "$detail_count" -lt "$route_count" ]; then
    echo "FAIL: $file has $route_count route(s) but only $detail_count detail block(s)"
    errors=$((errors + 1))
  fi

  if [ "$summary_count" -lt "$route_count" ]; then
    echo "FAIL: $file has $route_count route(s) but only $summary_count summary field(s)"
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "ERROR: $errors file(s) with missing OpenAPI annotations."
  echo "Every route handler must include { detail: { summary: '...' } }."
  exit 1
fi

echo "All route handlers have OpenAPI annotations."
