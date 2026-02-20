# Core Beliefs

Opinionated rules that keep the codebase coherent. These are not guidelines — they are invariants. When in doubt, enforce them mechanically rather than relying on review.

## Zig Core

1. **Own the format parsers.** We write our own parsers for TOML, shapefile, and any binary format we consume. This gives us full control over memory layout, error messages, and WASM compatibility. We do not pull in C libraries for file format parsing.

2. **Arena allocators where possible.** Prefer `ArenaAllocator` for request-scoped work (parsing a file, handling a query). It simplifies cleanup and avoids individual `free` calls. Reserve `wasm_allocator` / `GeneralPurposeAllocator` for buffers that cross the WASM boundary or outlive a single operation.

3. **No C dependencies in WASM.** The WASM module must have minimal imports (currently one WASI stub: `fd_filestat_get`). Any module that links a C library (like CRS/PROJ) is excluded from the WASM build and runs only as a standalone CLI tool.

4. **Shapefile is dependency-free.** The shapefile module has zero external dependencies — no dim, no network-engine, no C libraries. It compiles on its own and is consumed as a dependency by network-engine.

5. **In-memory I/O for WASM.** File-based APIs (`readShp`, `writeShp`) are for CLI tools and tests. WASM paths use byte-buffer variants (`readFromBytes`, `buildSHPBytes`, `buildBytes`). Both must stay in sync.

6. **`const` by default.** Zig 0.15 enforces this: if a local variable is never mutated, it must be `const`. Do not use `var` for values that don't change.

## Server

7. **Validate at the boundary, trust internally.** Incoming HTTP request bodies are validated with Effect Schema. Once data passes validation, internal service functions trust typed interfaces — no redundant runtime checks.

8. **WASM is the only path to Zig.** The server never shells out to Zig executables or links Zig code natively. All Zig core access goes through the JSON-in/JSON-out WASM protocol in `services/core.ts`.

9. **Routes are thin.** Route handlers parse input, call a service function, and return the result. Business logic lives in `services/`, not in route files.

## Architecture

10. **One WASM compilation unit.** Only `core/network-engine/` compiles to WASM. Other Zig modules are either dependencies of network-engine (shapefile, dim) or standalone tools (crs). Do not create additional WASM entry points.

11. **CRS is quarantined.** The CRS module links PROJ (a C system library). It must never be imported by network-engine or any module that compiles to WASM. It runs as a standalone CLI tool only.

12. **Knowledge lives in the repo.** Architectural decisions, domain context, format specifications, and engineering constraints must be documented in version-controlled files. If an agent or new contributor can't find it in the repo, it doesn't exist.

## Domain

13. **KP is the primary spatial index.** Positions along a pipeline are expressed as KP (kilometer post) — cumulative 2D horizontal distance from the route start. All simulation results, property profiles, and block positions are KP-indexed.

14. **SI internally, display units at the edge.** The network engine stores all quantities in SI base units. Unit conversion happens at display time (via dim) or at import/export boundaries (e.g. OLGA uses specific unit conventions). Do not store converted values internally.
