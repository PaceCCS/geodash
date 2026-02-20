# Quality Score

Per-module quality assessment. Updated manually when significant changes land.

Last updated: 2026-02-20

## Grading

- **A** — Well-tested, stable API, no known gaps
- **B** — Functional with tests, minor gaps or edge cases
- **C** — Works but under-tested or has known limitations
- **D** — Incomplete or missing significant functionality
- **F** — Not started

## Zig Core

### shapefile

| Module | Grade | Tests | Notes |
|---|---|---|---|
| **shp** | B | 2 unit + 6 integration | Read/write PointZ and PolyLineZ. Integration tests use Spirit pipeline (65k points). Missing: unit tests for edge cases (empty geometries, single-point polylines). |
| **dbf** | C | 1 unit | Basic read/write works. Missing: tests for field types beyond Character/Numeric, long field values, encoding edge cases. |
| **shx** | C | 1 unit | Index read/write works. Minimally tested — relies on integration tests via shp. |
| **kp** | A | 4 unit | KP computation from point sequences. Tests verify 2D horizontal distance, cumulative behaviour, edge cases. |
| **kml** | B | 6 unit | KML, KMZ, CSV import. Tests cover basic geometries and altitude. Missing: tests for deeply nested KML, namespace variations. |

### network-engine

| Module | Grade | Tests | Notes |
|---|---|---|---|
| **toml** | A | 18 unit | Covers tables, arrays, dotted keys, inline tables, escape sequences. Only implements the TOML subset dagger uses — intentional. |
| **query** | A | 12 unit | Path queries, array indexing, range slicing, filter expressions, scope resolution. Well-exercised by integration tests. |
| **network** | B | 5 unit + 14 integration | Node loading, edge derivation, reference validation all tested against preset1. Missing: tests for malformed input, large networks. |
| **scope** | B | 5 unit | Config loading, scope level inheritance, per-block-type resolution. Missing: tests for deep override chains, edge cases in multi-level resolution. |
| **fluid** | B | 4 unit | Topological traversal, junction blending, composition propagation. Missing: tests for cycles (should error), disconnected subgraphs. |
| **olga** | B | 5 unit | Parse and write OLGA `.key` format. Covers PIPE, SOURCE, SINK, COMPRESSOR keywords. Missing: tests for malformed `.key` files, unusual keyword orderings. |
| **wasm** | C | 0 | No direct unit tests. Exercised indirectly via server integration. Missing: tests for memory protocol edge cases (OOM, empty input, oversized input). |

### crs

| Module | Grade | Tests | Notes |
|---|---|---|---|
| **transform** | B | 3 unit | PROJ integration with ARM64 workaround. Tests verify coordinate transforms. Requires PROJ installed to run. |

### geotiff

| Module | Grade | Tests | Notes |
|---|---|---|---|
| — | F | 0 | Not started. Placeholder only. |

### zarr

| Module | Grade | Tests | Notes |
|---|---|---|---|
| — | F | 0 | Not started. Placeholder only. |

**Total Zig tests: 80** (all passing)

## Server

| Area | Grade | Tests | Notes |
|---|---|---|---|
| **WASM bridge** (`services/core.ts`) | C | 0 | Works in practice but no automated tests. Memory management and JSON protocol are manually verified. |
| **OLGA routes** (`routes/olga.ts`) | C | 0 | No endpoint tests. Validated manually via curl. |
| **OLGA service** (`services/olga.ts`) | C | 0 | Route segment computation, network validation. No tests. |
| **Query route** (`routes/query.ts`) | C | 0 | Works but no tests. |
| **Network route** (`routes/network.ts`) | C | 0 | Works but no tests. |
| **Effect schemas** (`schemas/olga/`) | C | 0 | Schema definitions exist but no tests verify them against sample data. |

**Total TypeScript tests: 0**

## Cross-Cutting Concerns

| Concern | Grade | Notes |
|---|---|---|
| **CI/CD** | A | GitHub Actions runs Zig tests, formatting, TypeScript typecheck, ESLint, and enforcement scripts on every push/PR. |
| **Linting** | B | `zig fmt` enforced in CI. ESLint with `no-explicit-any` and route import restrictions. Missing: server tests. |
| **Documentation** | B | Architecture and READMEs are thorough. Docs freshness check enforces QUALITY_SCORE covers all modules. |
| **WASM contract sync** | A | `scripts/check-wasm-contract.sh` diffs Zig exports against TypeScript types in CI. |

## Priority Gaps

1. **Zero server tests** — The entire TypeScript layer is untested. At minimum, the WASM bridge and OLGA endpoints need integration tests.
