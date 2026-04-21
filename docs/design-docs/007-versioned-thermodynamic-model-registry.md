# 007: Versioned Thermodynamic Model Registry

## Status

Proposed

## Context

Geodash needs one explicit authority for thermodynamic property evaluation across:

- CPU point checks
- fluid propagation through the network
- worker-driven texture generation
- GPU views of state-space slices

In practice, this authority is expected to be a set of neural-network-based thermodynamic models similar to those used in earlier property-plotting work. If those models are loaded ad hoc from different places, Geodash risks several kinds of drift:

- CPU and GPU paths using different model files or preprocessing rules
- texture caches reusing results produced by a different scientific model
- results changing silently when a model artifact is replaced
- ambiguity about component ordering, composition basis, units, or valid bounds

The shared-kernel plan in [006](./006-shared-kernel-spec-for-zig-and-wgsl.md) assumes that the evaluator and the reveal layers can trust the thermodynamic properties they consume. That trust requires the thermodynamic model itself to be named, versioned, and discoverable as a first-class artifact.

## Decision

Adopt a **versioned thermodynamic model registry** as the single source of truth for neural-network-based thermodynamic authorities used by Geodash.

Each thermodynamic model entry should be treated as an immutable scientific artifact with explicit metadata, including:

- model identity and semantic version
- supported component set and canonical ordering
- composition basis and state-variable basis
- input axes, bounds, and normalization rules
- output channels, units, and invalid-region semantics
- artifact hashes and provenance metadata

All CPU evaluation, worker texture generation, and GPU views should refer to thermodynamic models through this registry rather than by directly loading arbitrary model files.

## Design

### 1. Registry entries describe scientific artifacts

Each registry entry should name a specific thermodynamic model, not just point to a file on disk.

At minimum, an entry should describe:

- stable `model_id`
- explicit `version`
- model family or kind
- supported components and canonical component order
- composition basis such as mole fraction or mass fraction
- input variables and canonical SI units
- normalization or preprocessing rules
- output variables and canonical SI units
- valid-domain bounds
- behaviour for invalid, clipped, or extrapolated regions
- artifact hashes for model files and supporting metadata
- provenance such as training dataset, generation pipeline, and validation report identifiers

This allows a result to say not only "here are the properties" but also "these properties came from this exact thermodynamic authority."

### 2. Model selection must be explicit

Thermodynamic model choice should be an explicit part of evaluation context.

Rules:

- a constant-composition segment is evaluated against a selected thermodynamic model entry
- merges or composition changes produce a new downstream composition context
- downstream evaluation may therefore require a different registry entry or a rejected evaluation if no suitable model exists
- the system should not silently switch to "whatever model seems to fit"

This keeps composition changes and model-family boundaries visible in the analysis instead of hiding them inside texture or worker logic.

### 3. One registry, multiple consumers

The registry should be consumable by:

- the Zig network evaluator
- any service layer that performs property queries
- browser or worker code that generates thermodynamic textures
- GPU-oriented render paths that need model metadata for axes or channel interpretation

Different runtimes may use different inference backends, but they should still point at the same logical registry entry and version.

### 4. Cache keys must include thermodynamic authority

Texture reuse should be keyed by the thermodynamic model identity, not just by composition and bounds.

For example, a cache key should include values equivalent to:

- thermodynamic `model_id`
- `version`
- composition hash
- plot bounds
- resolution
- any relevant channel or slice configuration

Without this, changing the thermodynamic authority can silently poison cached visualisations.

### 5. Results should carry provenance

Any material result produced from thermodynamic evaluation should be able to report the model authority that produced it.

Examples:

- point-check diagnostics
- propagated branch state outputs
- saved texture metadata
- exported views or reports

This is important both for scientific honesty and for debugging disagreements between CPU and GPU paths.

## Non-Goals

- No assumption that a single thermodynamic model family covers every mixture or regime
- No hidden fallback selection among multiple candidate models
- No requirement that the registry solve network evaluation by itself
- No commitment yet to a specific registry storage format or serving mechanism

## Rationale

- **Single thermodynamic authority:** Geodash needs one explicit answer to "which property model are we using here?"
- **Stable provenance:** Versioned entries make scientific changes visible instead of silent.
- **Cache correctness:** Composition-only keys are not enough when the underlying property model can change.
- **Interop-friendly:** Different runtimes can share an identity-level registry even if they use different local inference implementations.
- **Fits the product direction:** A transparent evaluator and transparent reveal layers depend on transparent property authority too.

## Consequences

- Thermodynamic models must be packaged with richer metadata than a bare network artifact
- Model upgrades become explicit product changes that may invalidate caches and comparison baselines
- Evaluation contexts will need to carry thermodynamic model identity alongside composition and boundary conditions
- Some network segments may be unevaluable until an appropriate registry entry exists
- The registry will need a disciplined process for introducing new versions and deprecating old ones
