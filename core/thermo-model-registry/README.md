# thermo-model-registry

Planned core module for the versioned thermodynamic model registry.

This module is the runtime-facing home for thermodynamic model identity, manifests, and lookup metadata inside `geodash`. It exists to give the rest of the system one explicit answer to:

```text
which thermodynamic model authority are we using here?
```

This module follows the direction described in [design doc 007](../../docs/design-docs/007-versioned-thermodynamic-model-registry.md).

## Purpose

The registry module is responsible for:

- describing thermodynamic model identities and versions
- validating registry entries and artifact metadata
- exposing canonical feature order, units, output transforms, and provenance
- giving the network engine and reveal layers a stable way to refer to thermodynamic authorities

It is not responsible for training models.

## Boundary

The split between `tools/` and `core/` should be:

- [`tools/thermo-models/`](../../tools/thermo-models/README.md)
  Training, export, comparison, dataset hashing, and artifact production
- `core/thermo-model-registry/`
  Runtime registry format, validation, parsing, lookup, and provenance handling

That means:

- the large CSV dataset stays in `tools/`
- Python/`uv` training code stays in `tools/`
- registry entries and lookup logic move into `core/`

## Planned Scope

The first useful version of this module should support:

- loading a registry manifest that names available models
- loading per-model metadata bundles
- validating required fields such as:
  - `model_id`
  - `version`
  - feature order
  - output transform
  - units
  - artifact hashes
  - dataset provenance
- resolving a model by explicit `(model_id, version)`
- exposing enough metadata for:
  - CPU evaluation
  - worker texture generation
  - comparison tools
  - exported result provenance

## Planned Artifact Shape

The training tools are already emitting small per-model bundles such as:

- `model.onnx`
- `runtime_config.json`
- `metrics.json`
- `manifest.json`

The registry module should treat those as model artifacts, not just loose files.

A likely direction is:

```text
registry/
  registry.toml
  ph_ro/
    0.1.0/
      manifest.json
      runtime_config.json
      metrics.json
      model.onnx
```

The exact storage layout can still change, but the important point is that the registry owns the identity and metadata layer above individual artifacts.

## Non-Goals

- no Python training code
- no ONNX inference implementation
- no hidden fallback selection among candidate models
- no duplicate source of truth separate from emitted manifests

## First Milestones

1. Define the registry entry schema and top-level manifest format.
2. Teach the Python tooling to emit bundles that match that schema.
3. Add Zig-side parsing and validation for registry entries.
4. Thread explicit thermodynamic model identity through evaluator requests and outputs.
5. Use registry identity in cache keys, comparison tooling, and saved result provenance.
