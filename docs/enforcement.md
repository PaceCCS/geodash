# Architectural Enforcement

Rules from [core-beliefs.md](./core-beliefs.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) that are enforced mechanically. All rules run in CI (`.github/workflows/ci.yml`) and locally via `just check`.

## Active rules

### Zig tests

Tests must pass on every push. CI runs `zig build test` for shapefile and network-engine. CRS is skipped (requires PROJ C library).

### Zig formatting

`zig fmt --check` on `core/shapefile/src/` and `core/network-engine/src/`.

### Server TypeScript typecheck and lint

`tsc --noEmit` and ESLint in `server/`. ESLint enforces `no-explicit-any` and restricts route file imports — routes may only import from `services/` and `schemas/`, not from each other.

### App JSX branching lint

ESLint in `app/` enforces `no-nested-ternary` across `app/src/**/*.{ts,tsx}`. This keeps UI state branches explicit instead of burying them in chained render expressions.

### WASM contract check

`scripts/check-wasm-contract.sh` — extracts export function names from `wasm.zig` and the `CoreExports` type in `core.ts`, diffs them. Catches additions/removals on either side.

### Dependency direction check

`scripts/check-deps.sh` — verifies shapefile has no external `@import`s, and network-engine doesn't import crs.

### WASM build size check

`scripts/check-wasm-size.sh` — checks that `server/wasm/geodash.wasm` stays under the 320KB budget. Skipped gracefully if the WASM file is not present.

### Docs freshness check

`scripts/check-docs-freshness.sh` — verifies every directory in `core/` is referenced in `QUALITY_SCORE.md`. Catches new modules that haven't been documented.

### Test coverage per module

`scripts/check-test-coverage.sh` — checks that every Zig source file with logic has at least one `test` block. Excludes `root.zig`, `main.zig`, `wasm.zig`, `types.zig`, and `integration_test.zig`.

### Observability check

`scripts/check-observability.sh` — verifies that `server.ts` wires up both `opentelemetry` and `serverTiming` plugins, and that every service file in `server/src/services/` imports and calls `record()` from `@elysiajs/opentelemetry`.

## Philosophy

> "Enforce boundaries centrally, allow autonomy locally."

The rules enforce **boundaries** (what can depend on what, what the WASM contract looks like, do tests pass). Within those boundaries, implementation details are free to vary. We don't lint code style beyond `zig fmt` — the formatter handles that. We don't prescribe how services are structured internally — just that they don't leak into routes.
