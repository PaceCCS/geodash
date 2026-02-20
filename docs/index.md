# Documentation Index

## Architecture

- [ARCHITECTURE.md](../ARCHITECTURE.md) — System overview, module boundaries, dependency rules, data flow, build commands

## Principles

- [Core Beliefs](./core-beliefs.md) — Invariants that keep the codebase coherent (14 rules)
- [Enforcement](./enforcement.md) — How to mechanically enforce architectural rules, with starter scripts

## Quality

- [Quality Score](./QUALITY_SCORE.md) — Per-module grades, test counts, known gaps, priority issues

## Design Decisions

- [Design Docs Index](./design-docs/index.md) — Architectural decision records
  - [001 — Custom TOML parser](./design-docs/001-custom-toml-parser.md)
  - [002 — Own shapefile parser](./design-docs/002-own-shapefile-parser.md)
  - [003 — PROJ ARM64 workaround](./design-docs/003-proj-arm64-workaround.md)
  - [004 — WASM-WASI bridge](./design-docs/004-wasm-wasi-bridge.md)
  - [005 — Effect Schema validation](./design-docs/005-effect-schema-validation.md)

## Dependency References

- [Hono](./references/hono.md) — Web framework (server)
- [Effect](./references/effect.md) — Schema validation (server)
- [PROJ](./references/proj.md) — CRS transforms (Zig, C interop)
- [smol-toml](./references/smol-toml.md) — TOML parsing (server)
- [React Flow](./references/react-flow.md) — Network editor (app, planned)
- [dim](./references/dim.md) — Dimensional analysis (Zig)

## Plans

Active work items live in the repository issue tracker.
