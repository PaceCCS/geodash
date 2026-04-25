# 010: Zarr as Intermediate and Output Format

Status: Proposed

## Context

Geodash is accumulating several kinds of data that have the same structural shape:

- thermodynamic property grids over state space
- derived 2-D slices prepared for GPU textures
- branch evaluation outputs over candidate grids
- future transient outputs over KP × time

These are all naturally:

- multidimensional
- chunkable
- versioned
- potentially large
- useful outside the immediate GPU runtime

The current direction already points toward this:

- thermodynamic properties are represented as cached, composition-keyed textures
- branch sweeps produce dense candidate fields
- future transient work is expected to produce KP Hovmöller-style outputs

This suggests the need for a canonical intermediate/output format that is richer than “just GPU textures” and more structured than ad hoc arrays or one-off files.

## Decision

Use Zarr as a canonical chunked storage format for:

- thermodynamic datasets and derived state-space grids
- branch evaluation outputs
- future transient KP × time outputs

Zarr should not replace GPU textures at runtime. Instead:

- Zarr is the canonical scientific/storage/intermediate format
- GPU textures are the execution/rendering format

This allows geodash to:

- prepare GPU-ready slices from multiple thermo authorities
- cache and inspect branch outputs independently of the UI
- unify steady-state and transient data storage around one multidimensional format

## Why

Zarr is a strong fit because geodash data is:

- multidimensional by nature
- naturally chunked
- often accessed by slice rather than whole-volume reads
- produced by both browser/runtime code and external preparation tools

It also supports the direction you want for thermodynamic authority:

- neural-network-generated property grids
- multiflash or other direct thermodynamic sources
- future alternative authorities

All of those can produce the same Zarr-backed intermediate products even if the source computation differs.

## Role of Zarr in Geodash

Zarr should play three distinct roles.

### 1. Thermodynamic intermediate format

Thermodynamic authorities should be able to emit canonical property grids into Zarr.

Examples:

- neural-network-generated state-space grids
- multiflash-generated grids
- future surrogate or direct-EOS datasets

These grids can then be transformed into GPU-ready textures as needed.

### 2. Branch evaluation output format

Branch sweeps can write dense candidate outputs into Zarr:

- outlet state fields
- validity masks
- displacement fields
- diagnostics and flags

This keeps branch evaluation outputs inspectable and reusable outside the immediate WebGPU render loop.

### 3. Transient output format

For future transient modelling, Zarr is a particularly natural fit for:

- KP × time arrays
- Hovmöller-style diagrams
- block or branch state histories

This is a much better match than trying to force transient results into ad hoc CSVs or only-in-memory textures.

## Non-goal

Zarr is not intended to be sampled directly by WGSL.

The intended flow is:

- compute or prepare data into Zarr
- load the needed chunk or slice
- upload that slice into GPU textures or buffers
- run compute/render passes against the GPU-native representation

## Thermodynamic Dataset Sketch

Each thermodynamic dataset should live under a versioned registry identity.

Suggested top-level shape:

```text
/thermo/
  <model_id>/
    <version>/
      metadata.json
      source/
      grids/
      derived/
```

### Metadata

Metadata should include:

- model id
- version
- authority kind (`nn`, `multiflash`, `eos`, etc.)
- composition basis
- canonical component ordering
- units
- valid bounds
- source provenance
- hash(es) of model artifacts or source inputs

### Source group

This records where the thermo data came from.

Examples:

```text
/thermo/<model_id>/<version>/source/
  authority_kind = "nn"
  artifact_hash = "..."
  training_dataset_hash = "..."
```

or

```text
/thermo/<model_id>/<version>/source/
  authority_kind = "multiflash"
  eos_name = "..."
  eos_version = "..."
  input_script_hash = "..."
```

### Canonical grids group

This should hold the canonical thermodynamic fields over one chosen source domain.

For example, if the canonical source domain is `P-T`:

```text
/thermo/<model_id>/<version>/grids/pt/
  axes/
    pressure_pa
    temperature_k
  fields/
    gas_fraction
    density_kg_per_m3
    entropy_j_per_kg_k
    enthalpy_j_per_kg
    viscosity_pa_s
    validity_mask
    phase_code
```

If another authority naturally emits `P-H`, that can be represented too:

```text
/thermo/<model_id>/<version>/grids/ph/
```

The important thing is that the registry metadata states which domain is canonical for that authority.

### Derived group

Derived grids are cached transformations of the canonical data.

Examples:

```text
/thermo/<model_id>/<version>/derived/
  ph/
    fields/...
  ps/
    fields/...
  texture_ready/
    properties_rgba
    viscosity_phase_rgba
```

This is the place where geodash can store:

- axis-switched resampled grids
- displacement textures
- texture-packed arrays that are easy to upload to WebGPU

That makes it possible to prepare thermo slices from:

- NN outputs
- multiflash
- or anything else

while presenting one common downstream interface.

## Branch Evaluation Output Sketch

Suggested shape:

```text
/branch-evals/
  <network_id>/
    <branch_id>/
      <eval_id>/
        metadata.json
        inputs/
        outputs/
```

### Metadata

Should include:

- branch id
- network id
- evaluation mode
- slice spec
- thermo model ids used by section
- segment counts
- block ranges
- timestamp
- software version

### Inputs

```text
/branch-evals/<network_id>/<branch_id>/<eval_id>/inputs/
  candidate_pressure_pa
  candidate_enthalpy_j_per_kg
  candidate_mass_flow_kg_per_s
  candidate_valid_seed
```

These represent the input sweep definition.

### Outputs

```text
/branch-evals/<network_id>/<branch_id>/<eval_id>/outputs/
  outlet_pressure_pa
  outlet_enthalpy_j_per_kg
  outlet_temperature_k
  outlet_density_kg_per_m3
  outlet_viscosity_pa_s
  validity_mask
  failure_flags
  displacement_dp_pa
  displacement_dh_j_per_kg
```

This makes branch results:

- inspectable in Python
- reusable for offline analysis
- cacheable independently of the browser scene

It also gives geodash a path toward exporting or comparing branch evaluations without depending on screenshots or custom blobs.

## KP Profile and Trace Sketch

Even if the first full KP profile path comes from Zig rather than WGSL, Zarr can still store it well.

Suggested shape:

```text
/branch-traces/
  <network_id>/
    <branch_id>/
      <trace_id>/
        kp_m
        pressure_pa
        enthalpy_j_per_kg
        temperature_k
        density_kg_per_m3
        viscosity_pa_s
        vapour_fraction
        flags
```

This is a natural place for:

- selected candidate traces from Zig
- comparison traces
- debug/reference traces

## Transient / Hovmöller Sketch

For transient modelling, Zarr is especially attractive.

Suggested shape:

```text
/transients/
  <network_id>/
    <branch_id>/
      <run_id>/
        metadata.json
        axes/
          kp_m
          time_s
        fields/
          pressure_pa
          temperature_k
          enthalpy_j_per_kg
          density_kg_per_m3
          mass_flow_kg_per_s
          vapour_fraction
          validity_mask
```

These arrays are naturally:

- 2-D (`kp`, `time`) for scalar fields
- chunkable in KP and time
- directly suitable for Hovmöller plots

This is probably one of the strongest reasons to adopt Zarr early.

## Chunking Strategy

Chunking should be chosen per data family.

### Thermo grids

Use chunks that are friendly to slice extraction for GPU upload.

For example:

- `pressure x temperature` tiles such as `128 x 128` or `256 x 256`

### Branch evaluations

Use chunks that reflect candidate-grid access patterns.

For example:

- `candidate_y x candidate_x` tiles such as `128 x 128`

### KP traces

These are usually 1-D and can use simple contiguous chunks.

### Transients

Use chunks that support both:

- plotting time windows
- plotting full KP slices

For example:

- moderate tiles such as `256 kp x 64 time`

Exact chunk sizes can be tuned later.

## Compression and Precision

Zarr also gives you control over:

- compression
- storage precision
- optional multiresolution copies

Likely defaults:

- `f32` for most thermo and branch fields
- integer masks/flags for validity and phase codes
- compression enabled for stored outputs and intermediates

## Relationship to Thermodynamic Registry

The thermodynamic model registry should identify the scientific authority.

Zarr should hold the derived data products associated with that authority.

In other words:

- registry = identity, provenance, bounds, semantics
- Zarr = chunked scientific data products produced under that identity

This gives a clean separation between:

- what the authority is
- what data products have been derived from it

## Relationship to GPU Runtime

The GPU runtime should consume texture- or buffer-ready data extracted from Zarr.

That means:

- Zarr is the source/cache/archive layer
- WebGPU textures and buffers are the hot runtime layer

This avoids overloading the runtime representation with storage and provenance concerns.

## Consequences

Adopting Zarr this way gives geodash:

- one canonical multidimensional storage approach across thermo, steady-state, and transient outputs
- a path to use thermo data from sources other than neural networks
- a better home for branch evaluation results than ad hoc arrays
- a natural long-term fit for KP Hovmöller diagrams

It also makes it easier to connect browser-native geodash workflows with:

- Python analysis
- offline dataset preparation
- reproducible scientific artifacts

## Near-term Recommendation

If Zarr is adopted incrementally, the best first uses are probably:

1. thermodynamic intermediate datasets
2. branch evaluation output caches
3. Zig-generated KP traces for selected states

Then later:

4. transient KP × time outputs

That ordering gives immediate value without requiring the whole transient stack to exist first.
