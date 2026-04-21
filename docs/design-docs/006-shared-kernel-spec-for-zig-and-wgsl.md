# 006: Shared Kernel Spec for Zig and WGSL

## Status

Proposed

## Context

Geodash is moving toward a steady-state evaluator that answers explicit input-to-output questions about a network and then reveals the network's behaviour through multiple views. The important parts of that direction are:

- A **simple core evaluator** for branch/block networks
- **Transparent reveal layers** on top of the evaluator (trajectory views, displacement or "wind" maps, validity masks, diagnostic slices)
- A **GPU exploration path** where compute shaders evaluate many candidate states in parallel

The compute shaders must stay in sync with the Zig model closely enough that:

1. A point check in Zig and the equivalent shader calculation are the same model
2. Host-side data layout and shader-side uniform layout do not drift
3. The user can trust GPU views as projections of the same evaluator rather than a separate reimplementation

The first phase of this work should not attempt to solve every steady-state analysis problem at once. It should focus on a small, explicit evaluator that can be composed, inspected, and tested. More advanced ideas such as region contracts and backward analysis remain important, but they are not required for the first implementation.

## Decision

Adopt a **shared kernel specification** authored in Zig and used by the build system to generate:

- Zig evaluator code for the CPU path
- WGSL helper code for the GPU path
- Matching host/shader layout definitions where practical

The shared spec is not a general Zig-to-WGSL transpiler. It is a deliberately small representation of the math and data layout for kernels that need CPU/GPU parity.

## Design

### 1. Core evaluator first

The first implementation should treat a branch as a composition of local state transforms.

For a constant-composition segment, each block should expose a deterministic mapping:

```text
inlet state + block parameters + thermodynamic properties -> outlet state
```

The evaluator should support:

- evaluating one block at a point
- evaluating a branch at a point
- recording intermediate states per block
- reporting validity/diagnostic flags instead of hiding failures inside a search

This keeps the model centred on "what does this network do?" rather than "does some hidden solve succeed?"

### 2. Shared kernel spec

The source of truth for CPU/GPU-synchronised kernels should be a small Zig data structure, not arbitrary Zig AST and not handwritten duplicated code.

The spec should be expressive enough to define:

- input and output structs
- scalar locals and helper expressions
- named constants
- uniform/storage layout information

Typical kernels include:

- pipe pressure and heat-transfer step
- valve pressure-drop step
- compressor/heater/cooler translation step
- branch composition of multiple local steps

### 3. Build-driven code generation

`build.zig` should own generation of the synchronised kernel artifacts.

Planned outputs:

- generated Zig evaluator code under `core/network-engine/src/generated/`
- generated WGSL under a shader-oriented generated directory
- optional generated metadata for host-side packing and field offsets

The generated code should lower all quantities to canonical SI scalars before emission. `dim` remains important in authoring and validation, but the emitted WGSL-facing layer should use plain scalar values.

### 4. CPU/GPU parity tests

Each synchronised kernel should have golden-vector tests.

At minimum:

- fixed inputs should produce matching Zig and WGSL results within tolerance
- layout assertions should fail loudly when field order, size, or alignment drifts
- generated code should be treated as a build artifact, not handwritten source

### 5. Thermodynamic texture integration

Fluid propagation and thermodynamic texture generation should meet at composition boundaries.

Planned rule:

- a thermodynamic texture set is valid only for a constant-composition segment
- fluid propagation produces the composition for each such segment
- the UI/worker layer requests or reuses textures keyed by composition hash and bounds

This allows branch evaluation and state-space rendering to share the same propagated network context.

### 6. Reveal layers on top of the evaluator

Once the evaluator exists, the first reveal layers should be derived from evaluation results rather than special-purpose solver logic.

Planned first reveal layers:

- outlet state textures for a 2D slice of state space
- displacement textures (`F(x) - x`) for branch behaviour
- validity masks and diagnostic flags
- hovered point trajectories through branch blocks
- per-block contribution views

## Non-Goals

- No generic Zig-to-WGSL transpilation
- No requirement that every block type be GPU-ready on day one
- No embedding of search logic into the core evaluator
- No first-phase commitment to backward-region or contract analysis

Those ideas may become important later, but they should not distort the first implementation.

## Rationale

- **Single model, multiple views:** The GPU should reveal the same evaluator, not a separate approximation maintained by hand.
- **Build-time sync fits Zig well:** Zig's `comptime`, reflection, and build system make small code generators straightforward.
- **Interop-friendly:** Explicit layouts and scalar lowering fit Geodash's WASM and multi-language integration plans.
- **Works with `dim`:** Quantities can be authored and checked in Zig with unit awareness, then lowered cleanly to canonical SI for generation.
- **Keeps the product honest:** A simple evaluator plus reveal layers is a better fit for transparent network behaviour than a deeply embedded search-first model.

## Consequences

- A small kernel-spec layer must be designed and maintained
- Some expressions may need to be written in a restricted form to remain codegen-friendly
- Generated WGSL and Zig must be treated as artifacts derived from a shared source of truth
- Precision differences between Zig and WGSL will require tolerance-based tests and careful handling of `f32` vs `f64`
- The first useful result should be a narrow vertical slice, not a full replacement steady-state platform
