# Design Decisions

Architectural decision records for geodash. Each documents a non-obvious choice, the alternatives considered, and why we chose what we did.

| ID                                                           | Decision                                            | Status   |
| ------------------------------------------------------------ | --------------------------------------------------- | -------- |
| [001](./001-custom-toml-parser.md)                           | Write our own TOML parser                           | Accepted |
| [002](./002-own-shapefile-parser.md)                         | Write our own shapefile parser                      | Accepted |
| [003](./003-proj-arm64-workaround.md)                        | Use `proj_trans_generic` instead of `proj_trans`    | Accepted |
| [004](./004-wasm-wasi-bridge.md)                             | JSON-in/JSON-out WASM bridge with WASI stub         | Accepted |
| [005](./005-effect-schema-validation.md)                     | Use Effect Schema for server-side validation        | Accepted |
| [006](./006-shared-kernel-spec-for-zig-and-wgsl.md)          | Shared kernel spec for Zig and WGSL                 | Proposed |
| [007](./007-versioned-thermodynamic-model-registry.md)       | Versioned thermodynamic model registry              | Proposed |
| [008](./008-gpu-pipe-segment-data-layout.md)                 | GPU pipe segment data layout for route-backed pipes | Proposed |
| [009](./009-merge-operator-for-downstream-candidate-sets.md) | Merge operator for downstream candidate sets        | Proposed |
| [010](./010-zarr-as-intermediate-and-output-format.md)       | Zarr as intermediate and output format              | Proposed |
