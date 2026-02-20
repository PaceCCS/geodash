# Architectural Enforcement

Rules from [core-beliefs.md](./core-beliefs.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) that should be enforced mechanically. This document lists the rules, how to check them, and a suggested implementation order.

## Starting point

The lowest-effort, highest-value enforcement steps — things you can set up in an afternoon:

### 1. CI that runs existing tests

**Rule:** Tests must pass on every push.

**Implementation:** GitHub Actions workflow.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  zig-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mlugg/setup-zig@v2
        with:
          version: 0.15.2
      - run: cd core/shapefile && zig build test
      - run: cd core/network-engine && zig build test

  zig-fmt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mlugg/setup-zig@v2
        with:
          version: 0.15.2
      - run: zig fmt --check core/shapefile/src/
      - run: zig fmt --check core/network-engine/src/

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: cd server && bun install && bun run tsc --noEmit
```

**Why first:** You already have 80 passing tests. CI makes them useful — a broken push is caught before merge. `zig fmt` is free (built into the compiler) and prevents style drift.

### 2. WASM contract check

**Rule:** TypeScript types in `server/src/services/core.ts` must match Zig exports in `core/network-engine/src/wasm.zig`.

**Implementation:** A script that extracts export names from both files and diffs them.

```bash
#!/bin/bash
# scripts/check-wasm-contract.sh

# Extract Zig exports
zig_exports=$(grep -oP '(?<=export fn )\w+' core/network-engine/src/wasm.zig | sort)

# Extract TypeScript references
ts_exports=$(grep -oP '(?<=rt\.)\w+(?=\()' server/src/services/core.ts | sort -u)

diff <(echo "$zig_exports") <(echo "$ts_exports")
if [ $? -ne 0 ]; then
  echo "WASM contract mismatch: Zig exports and TypeScript references differ"
  exit 1
fi
```

**Why second:** This is the most likely source of silent breakage. Adding a new Zig export without updating TypeScript (or vice versa) causes runtime failures that are hard to debug.

### 3. Dependency direction check

**Rule:** shapefile has no external dependencies. CRS is never imported by network-engine.

**Implementation:** A script that checks `@import` statements.

```bash
#!/bin/bash
# scripts/check-deps.sh

# shapefile must not import anything outside its own module
external_imports=$(grep -rn '@import' core/shapefile/src/ | grep -v '"std"' | grep -v '"shapefile' | grep -v '"root' | grep -v '"types' | grep -v '"shp' | grep -v '"shx' | grep -v '"dbf' | grep -v '"kp' | grep -v '"kml')
if [ -n "$external_imports" ]; then
  echo "shapefile has external imports:"
  echo "$external_imports"
  exit 1
fi

# network-engine must not import crs
crs_imports=$(grep -rn 'crs' core/network-engine/src/ | grep '@import')
if [ -n "$crs_imports" ]; then
  echo "network-engine imports crs (forbidden):"
  echo "$crs_imports"
  exit 1
fi
```

**Why third:** These are the dependency boundaries that matter most. Violating them breaks the WASM build or the "no C in WASM" constraint.

## Next steps (when you need them)

### 4. Server route structure lint

**Rule:** Route files import from `services/` and `schemas/`, not from each other. No business logic in route handlers.

**How:** A custom script or ESLint rule that checks imports in `server/src/routes/`.

### 5. WASM build size check

**Rule:** The WASM binary should not grow unexpectedly. Set a size budget (e.g. current size + 20%).

**How:** `wc -c server/wasm/geodash.wasm` in CI, compare against a recorded baseline.

### 6. Docs freshness check

**Rule:** `QUALITY_SCORE.md` and `design-docs/index.md` should reference all modules that exist.

**How:** A script that lists directories in `core/` and checks they appear in `QUALITY_SCORE.md`.

### 7. Test coverage per module

**Rule:** Each Zig source file with logic (not `root.zig`) should have at least one `test` block.

**How:** List `.zig` files, check for `test "` declarations, flag files with zero tests.

## Philosophy

From the OpenAI article:

> "Enforce boundaries centrally, allow autonomy locally."

The rules above enforce **boundaries** (what can depend on what, what the WASM contract looks like, do tests pass). Within those boundaries, implementation details are free to vary. We don't lint code style beyond `zig fmt` — the formatter handles that. We don't prescribe how services are structured internally — just that they don't leak into routes.

Start with rules 1-3. They cover the most dangerous failure modes (broken tests, contract drift, dependency violations) with minimal setup cost. Add rules 4-7 as the codebase grows and you find specific patterns drifting.
