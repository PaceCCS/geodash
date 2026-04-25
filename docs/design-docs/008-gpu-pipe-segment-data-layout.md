# 008: GPU Pipe Segment Data Layout for Route-Backed Pipe Blocks

Status: Proposed

## Context

In geodash, a `Pipe` block can point to a route asset rather than directly storing a small hand-authored list of segments. The example network already does this via `route = "assets/spirit"` in [workingfiles/example/branch-1.toml](/Users/jerell/Repos/geodash/workingfiles/example/branch-1.toml:24).

This matches the intended modelling style: a user defines a pipe block using a real route, and the system derives many small geometric segments from that route.

This is also similar to the current `mor05` snapshot path:

- the BFF snapshot adapter parses an elevation-profile CSV into many small segments in [request-adapter.ts](/Users/jerell/Repos/Pace/mor05/bff/src/services/snapshot/request-adapter.ts:1324)
- one pipe block is expanded into many `PipeSeg` components in [request-adapter.ts](/Users/jerell/Repos/Pace/mor05/bff/src/services/snapshot/request-adapter.ts:1355)
- the measurement layer preserves a long per-pipe `segments[]` list with `offsetMeters` and `lengthMeters` in [measure.ts](/Users/jerell/Repos/Pace/mor05/bff/src/services/measure.ts:564) and [types.ts](/Users/jerell/Repos/Pace/mor05/frontend/src/lib/operations/types.ts:122)

For MOR05-sized route CSVs, the current segment counts are already large enough to matter:

- small examples: about `149`-`150` segments
- medium examples: about `325`-`326` segments
- large examples: about `517`-`645` segments

These counts come directly from the current MOR05 route CSV assets under `bff/networks/*/assets/*segments.csv`.

The question is how this should map onto WebGPU compute.

## Decision

Treat pipe segments as data, not as shaders.

We should not generate one compute shader or one compute pipeline per route-derived pipe segment. Instead:

- define one shared pipe-segment kernel
- store route-derived segments in a flat GPU buffer
- let each thread evaluate one candidate fluid state
- let the thread loop over the segment range for the pipe block or branch

The number of physical segments may be large, but the number of GPU programs should stay very small.

## Why

One shader per segment would create the wrong scaling behaviour:

- too many pipeline objects
- too much dispatch overhead
- harder CPU/GPU synchronization
- unnecessary shader compilation and bind-group churn

A data-driven layout is a much better fit:

- the same segment-step physics runs for every segment
- only the segment parameters differ
- the segment list is naturally ordered by KP
- Zig CPU evaluation and WGSL GPU evaluation can share the same local kernel shape

## Proposed GPU Model

### 1. Shared local kernel

The CPU/GPU shared kernel is the smallest local transform:

```text
pipe_segment_step(
  inlet_state,
  segment_params,
  pipe_block_params,
  thermo_authority
) -> outlet_state + flags
```

This is the function that should stay synchronized between generated Zig and WGSL.

### 2. Flat segment buffer

Route-derived segments should be stored in one flat array.

```text
segments: [PipeSegmentParams]
```

Each `Pipe` block then stores a range into that array:

```text
pipe_block_range = { start_index, count }
```

This lets many pipe blocks share one buffer layout without requiring separate shaders.

### 3. One thread per candidate state

For parameter-space exploration, each invocation owns one candidate inlet state:

```text
candidate_state[i]
```

That thread then walks the ordered segment range:

```text
state = candidate_state[i]
for seg in pipe_block_range:
  state = pipe_segment_step(state, segments[seg], block_params, thermo)
output_state[i] = state
```

### 4. Two evaluation modes

There should be at least two GPU evaluation modes.

#### Fast mode

For design-space exploration and envelope finding:

- each thread walks the segment list
- only final outlet state and aggregate flags are written

This is the default exploration path.

#### Profile mode

For KP visualisation and operating-trajectory inspection, the preferred first implementation is not a GPU write-heavy mode but the Zig evaluator.

That means:

- the GPU sweep finds interesting inlet states or valid regions
- the user selects one candidate state
- the Zig evaluator runs the same segment-stepping logic on CPU
- the CPU returns the full KP profile for display

This is a better first split because KP profiles are:

- sequential
- explanation-oriented
- low candidate count
- high output volume

Those characteristics fit CPU evaluation much better than a broad GPU sweep.

If we later add a GPU profile mode, it should still be treated as a separate write mode rather than as the default exploration path.

## Proposed Data Layout

### Fluid state buffer

This should be plain canonical-SI scalars on the GPU.

```text
struct FluidState {
  pressure_pa: f32
  enthalpy_j_per_kg: f32
  temperature_k: f32
  density_kg_per_m3: f32
  viscosity_pa_s: f32
  mass_flow_kg_per_s: f32
  vapour_fraction: f32
  flags: u32
}
```

Not every field needs to be the primary state variable. Some may be cached derived values for convenience and debugging.

### Pipe segment buffer

Per-segment geometry and local environment:

```text
struct PipeSegmentParams {
  length_m: f32
  elevation_in_m: f32
  elevation_out_m: f32
  diameter_m: f32
  roughness_m: f32
  u_value_w_per_m2_k: f32
  ambient_temperature_k: f32
  ambient_medium_code: u32
}
```

If the route data is uniform for some properties, those can live at the block level instead and be omitted here.

### Pipe block range buffer

```text
struct PipeBlockRange {
  segment_start: u32
  segment_count: u32
  profile_write_start: u32
  reserved: u32
}
```

### Candidate input buffer

```text
struct CandidateInput {
  inlet_pressure_pa: f32
  inlet_enthalpy_j_per_kg: f32
  mass_flow_kg_per_s: f32
  composition_texture_id: u32
}
```

### Candidate output buffer

```text
struct CandidateOutput {
  outlet_state: FluidState
  validity_flags: u32
  failure_segment_index: u32
  reserved: u32
}
```

### Optional KP profile buffer

Not required for the first GPU implementation.

The first version should assume that full KP profiles come from the Zig evaluator for a selected candidate state.

If a later GPU profile mode is added, a write buffer like the following would make sense:

```text
struct ProfileSample {
  candidate_index: u32
  segment_index: u32
  kp_m: f32
  state: FluidState
}
```

In practice this would likely be split across several tightly packed arrays to reduce alignment overhead.

## Thermodynamic Texture Integration

The thermodynamic authority remains texture-backed.

This should follow the same high-level pattern already used in `phase-envelope-generator`, where:

- features are prepared in a compute step in [prepare-features.wgsl](/Users/jerell/Repos/phase-envelope-generator/frontend/src/workers/shaders/prepare-features.wgsl:1)
- model outputs are packed into storage textures in [write-textures.wgsl](/Users/jerell/Repos/phase-envelope-generator/frontend/src/workers/shaders/write-textures.wgsl:1)
- textures are generated and cached by composition in [texture-worker.ts](/Users/jerell/Repos/phase-envelope-generator/frontend/src/workers/texture-worker.ts:1)

For geodash, the intended use is slightly different:

- thermodynamic property textures are generated once per constant-composition segment family
- the pipe kernel samples those textures during segment stepping
- the pipe route geometry remains buffer data

That suggests a clean separation:

- **storage buffers** for route-derived segment geometry
- **storage or sampled textures** for thermodynamic state-space properties

This avoids trying to encode the physical route itself as a texture.

## Composition and Branch Structure

This layout works best when a branch or a branch section has constant composition.

If composition changes:

- at a merge
- at an injection point
- or at any other composition-altering block

then the branch should be split at that point for evaluation purposes.

Each constant-composition section can then:

- reference one thermodynamic model registry entry
- reference one property-texture set
- reference one contiguous segment buffer slice

## Expected Performance

The right way to think about performance here is:

```text
cost ≈ candidate_count × segment_count × per_segment_work
```

For MOR05-like routes, `segment_count` is not extreme. A representative range is about `150` to `650` segments per pipe block, with some simple examples around `645` rows including header in the source CSV.

### Rough order-of-magnitude examples

If a single pipe block has:

- `200` segments

and we explore:

- `512 × 512 = 262,144` candidate inlet states

then the kernel performs about:

- `52 million` segment-step evaluations

If a larger route has:

- `650` segments

at the same candidate resolution, that becomes about:

- `170 million` segment-step evaluations

Those numbers sound large, but they are in the normal range for GPU data-parallel work, especially if:

- the kernel is mostly arithmetic plus a few texture reads
- each thread walks the same segment list
- we avoid dispatching once per segment

### Expected latency ranges

These are intentionally rough estimates for a single route-backed pipe block with MOR05-like segment counts, assuming:

- one thread per candidate
- one shared segment-step kernel
- storage/sampled texture thermo lookup rather than direct NN inference in the inner loop
- final outlet state writes only
- a decent desktop GPU

Very approximate expectations:


| Candidate grid | Segment count | Expected range     |
| -------------- | ------------- | ------------------ |
| `256 x 256`    | `150`         | about `5-20 ms`    |
| `256 x 256`    | `500-650`     | about `15-60 ms`   |
| `512 x 512`    | `150`         | about `15-50 ms`   |
| `512 x 512`    | `500-650`     | about `40-150+ ms` |


These are not promises. They are a planning-level estimate of the right order of magnitude.

They are also still dramatically smaller than the current `mor05` snapshot times of roughly `20-25 s`, because this is a different class of computation:

- no scenario-service round trip
- no solver-style iterative network reconciliation
- no one-component-per-segment object construction in the hot path
- no heavy direct thermodynamic solve in the inner loop

### What will actually dominate

The likely bottlenecks are not the loop counter itself, but:

- thermodynamic texture sampling frequency
- divergence from invalid/two-phase/choke logic
- memory bandwidth if we write too much output
- dispatch overhead if we split the work into too many passes

### Practical expectation

For MOR05-like pipe routes:

- fast mode should be very plausible on a single dispatch per block or branch
- full KP profile output should come from Zig first, not WGSL
- GPU profile output, if ever added, should be treated as a special mode

The route-derived segment count is large enough that we should design for it explicitly, but not so large that it forces a fundamentally different GPU strategy.

## Resolution Strategy

Candidate resolution should not be treated as a sacred fixed number.

The correct resolution depends on:

- GPU capacity
- segment count
- network/block complexity
- current interaction mode
- how thin or curved the visible valid region is

Recommended tiers:

- `128 x 128` for very fast scouting
- `256 x 256` as the likely default interactive sweep
- `512 x 512` as a refinement tier when timings permit
- `1024 x 1024` only for explicit refine/export/tiled modes

The default should be chosen from a time budget rather than a hardcoded preference.

For example:

- during interaction: prefer the resolution that stays within roughly `30-100 ms`
- after interaction settles: refine if a higher tier is still acceptable

In other words, `512 x 512` is a useful refinement size, but `256 x 256` is likely the better default for live branch exploration.

## Recommended Evaluation Strategy

### Phase 1

Implement:

- one shared `pipe_segment_step`
- one flat `PipeSegmentParams` buffer
- one `PipeBlockRange` indirection
- one fast-mode pipe-block kernel
- Zig evaluator as the source of full KP profiles for selected states

This is the minimum useful route-backed GPU evaluation path.

### Phase 2

Add:

- profile mode for KP visualisation
- decimated or sampled intermediate-state writes
- branch-level kernels that fuse multiple blocks into one dispatch where useful

### Phase 3

Investigate:

- partial fusion of adjacent pipe blocks with identical thermo authority
- adaptive profile write density
- reduced-order segment merging for visually smooth route sections

This last point is optional and should be treated as an optimization, not as a required part of the core model.

## Non-goals

This design does not imply:

- one compute shader per segment
- one compute pipeline per route asset
- storing route geometry in textures
- forcing KP-profile output on every exploration pass

## Consequences

This decision keeps the GPU program count small while allowing route-backed pipes to retain fine spatial detail.

It also aligns well with the broader geodash architecture:

- branch/block structure remains the modelling abstraction
- route segmentation remains data preparation
- thermodynamic authority remains versioned and composition-keyed
- Zig and WGSL can share the same local kernel shape

That should let geodash support MOR05-sized route detail without inheriting MOR05’s component-explosion problem at the shader layer.