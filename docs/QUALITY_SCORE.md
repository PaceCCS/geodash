# Quality Score

Per-module quality assessment. Updated manually when significant changes land.

Last updated: 2026-03-30

## Grading

- **A** — Well-tested, stable API, no known gaps
- **B** — Functional with tests, minor gaps or edge cases
- **C** — Works but under-tested or has known limitations
- **D** — Incomplete or missing significant functionality
- **F** — Not started

## Zig Core

### shapefile

| Module  | Grade | Tests                  | Notes                                                                                                                                                               |
| ------- | ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **shp** | B     | 2 unit + 6 integration | Read/write PointZ and PolyLineZ. Integration tests use Spirit pipeline (65k points). Missing: unit tests for edge cases (empty geometries, single-point polylines). |
| **dbf** | C     | 1 unit                 | Basic read/write works. Missing: tests for field types beyond Character/Numeric, long field values, encoding edge cases.                                            |
| **shx** | C     | 1 unit                 | Index read/write works. Minimally tested — relies on integration tests via shp.                                                                                     |
| **kp**  | A     | 4 unit                 | KP computation from point sequences. Tests verify 2D horizontal distance, cumulative behaviour, edge cases.                                                         |
| **kml** | B     | 6 unit                 | KML, KMZ, CSV import. Tests cover basic geometries and altitude. Missing: tests for deeply nested KML, namespace variations.                                        |

### network-engine

| Module      | Grade | Tests                   | Notes                                                                                                                                                     |
| ----------- | ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **toml**    | A     | 18 unit                 | Covers tables, arrays, dotted keys, inline tables, escape sequences. Only implements the TOML subset dagger uses — intentional.                           |
| **query**   | A     | 12 unit                 | Path queries, array indexing, range slicing, filter expressions, scope resolution. Well-exercised by integration tests.                                   |
| **network** | B     | 5 unit + 14 integration | Node loading, edge derivation, reference validation all tested against preset1. Missing: tests for malformed input, large networks.                       |
| **scope**   | B     | 5 unit                  | Config loading, scope level inheritance, per-block-type resolution. Missing: tests for deep override chains, edge cases in multi-level resolution.        |
| **fluid**   | B     | 4 unit                  | Topological traversal, junction blending, composition propagation. Missing: tests for cycles (should error), disconnected subgraphs.                      |
| **olga**    | B     | 5 unit                  | Parse and write OLGA `.key` format. Covers PIPE, SOURCE, SINK, COMPRESSOR keywords. Missing: tests for malformed `.key` files, unusual keyword orderings. |
| **wasm**    | C     | 0                       | No direct unit tests. Exercised indirectly via server integration. Missing: tests for memory protocol edge cases (OOM, empty input, oversized input).     |

### crs

| Module        | Grade | Tests  | Notes                                                                                                       |
| ------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------- |
| **transform** | B     | 3 unit | PROJ integration with ARM64 workaround. Tests verify coordinate transforms. Requires PROJ installed to run. |

### geotiff

| Module | Grade | Tests | Notes                          |
| ------ | ----- | ----- | ------------------------------ |
| —      | F     | 0     | Not started. Placeholder only. |

### thermo-model-registry

| Module | Grade | Tests | Notes                          |
| ------ | ----- | ----- | ------------------------------ |
| —      | F     | 0     | Planned. Placeholder only.     |

### zarr

| Module | Grade | Tests | Notes                          |
| ------ | ----- | ----- | ------------------------------ |
| —      | F     | 0     | Not started. Placeholder only. |

**Total Zig tests: 80** (all passing)

## Server

| Area                                    | Grade | Tests          | Notes                                                                                                                                                                                                                                               |
| --------------------------------------- | ----- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WASM bridge** (`services/core.ts`)    | B     | 0 direct       | Exercised indirectly via query and network route tests against real WASM + preset1. Missing: direct tests for OOM, empty input, oversized input.                                                                                                    |
| **OLGA routes** (`routes/olga.ts`)      | B     | 5 integration  | Validate, export, import endpoints tested. Covers invalid JSON, missing fields, valid preset1.                                                                                                                                                      |
| **OLGA service** (`services/olga.ts`)   | B     | 1 (via route)  | Validation tested via route integration test against preset1. Missing: direct unit tests for resolveRouteSegments.                                                                                                                                  |
| **Query route** (`routes/query.ts`)     | B     | 4 integration  | Missing params, valid query, invalid network dir.                                                                                                                                                                                                   |
| **Network route** (`routes/network.ts`) | A     | 23 integration | Missing params, valid load, invalid dir, node structure (position, parentId, width/height, data.blocks, block shape, extra properties, nested tables, data.path), edge structure (data.weight, referential integrity, no self-loops), assets route. |
| **Health / 404** (`index.ts`)           | A     | 2              | Health check and 404 handler.                                                                                                                                                                                                                       |
| **Utils** (`utils/network.ts`)          | A     | 4 unit         | resolveNetworkPath: null, empty, absolute, relative.                                                                                                                                                                                                |
| **Effect schemas** (`schemas/olga/`)    | C     | 0              | Schema definitions exist but no tests verify them against sample data.                                                                                                                                                                              |
| **Shapefile routes** (`modules/shapefiles.ts`) | A | 4 integration | List summaries, load editable data, build sidecars, schema validation. |
| **Geo inspect** (`modules/operations/geo.ts`) | A | 3 integration | Detects shapefile route with length on preset1, missing network, missing body field. |

**Total TypeScript tests: 49**

## Cross-Cutting Concerns

| Concern                | Grade | Notes                                                                                                              |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| **CI/CD**              | A     | GitHub Actions runs Zig tests, formatting, TypeScript typecheck, ESLint, and enforcement scripts on every push/PR. |
| **Linting**            | A     | `zig fmt` enforced in CI. ESLint with `no-explicit-any` and route import restrictions.                             |
| **Documentation**      | B     | Architecture and READMEs are thorough. Docs freshness check enforces QUALITY_SCORE covers all modules.             |
| **WASM contract sync** | A     | `scripts/check-wasm-contract.sh` diffs Zig exports against TypeScript types in CI.                                 |

## Priority Gaps

1. **Effect schema tests** — Schema definitions (`schemas/olga/`) have no tests verifying them against sample data.
2. **WASM edge cases** — No direct tests for OOM, empty input, or oversized input to the WASM bridge.
