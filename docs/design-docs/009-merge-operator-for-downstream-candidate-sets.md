# 009: Merge Operator for Downstream Candidate Sets

Status: Proposed

## Context

In the geodash branch model, a downstream branch may receive fluid from multiple upstream branches. When that happens, the downstream branch cannot usually reuse a single upstream candidate grid unchanged. The merge creates a new reachable set in state space.

This was already explored in `piper`. The mixer design there is documented in:

- [multi_stream_mixing.md](/Users/jerell/Repos/piper/frontend/src/lib/simulation/multi_stream_mixing.md:1)
- [pipeline-simulation.md](/Users/jerell/Repos/piper/docs/pipeline-simulation.md:1)
- [mixerKernel.ts](/Users/jerell/Repos/piper/frontend/src/lib/simulation/mixerKernel.ts:520)

The `piper` approach is:

- bin upstream valid points by pressure
- collect valid points per bin per stream
- form Cartesian-product-like combinations across streams
- cap the combinations per bin
- randomly sample when the full combination count is too large
- mix the sampled parent tuples into a new output set

That was a useful prototype because it identified the real modelling issue:

- a merge produces a new downstream set
- the downstream branch should not simply inherit one upstream stream's candidate field

However, geodash is aiming for a more transparent and less combinatorial architecture.

## Decision

Treat a merge as an explicit state-space operator that maps upstream reachable sets to a downstream reachable set.

Geodash should preserve the key idea from `piper`:

- merges create new downstream candidate sets

but it should not make combinatorial parent-tuple sampling the default implementation.

Instead, the preferred framing is:

- each upstream branch exposes a reachable set or field at its outlet
- the merge block defines a physical mixing operator
- the image of the upstream reachable sets under that operator becomes the downstream candidate set

This is a better fit for geodash than making the hot path depend on sampled Cartesian products of upstream pixels.

## Why

The `piper` mixer was valuable, but its default shape has drawbacks:

- it is combinatorial by construction
- it entangles physical modelling with candidate-set bookkeeping
- it is harder to explain to users as a transparent state-space transform
- it pushes the architecture toward sampled search mechanics rather than explicit branch/block operators

Geodash should instead favour:

- explicit operators
- explicit downstream sets
- resampling/projecting reachable regions
- clear separation between modelling and approximation strategy

That aligns with the broader branch/block direction:

- branches are composed state transforms
- search is an outer layer
- the UI reveals how sets move through the network

## Conceptual Model

### Upstream state sets

Each upstream branch exposes a reachable outlet set:

```text
S1, S2, ..., Sn
```

Each set is defined over a chosen slice, for example:

- pressure-enthalpy at fixed mass flow
- pressure-temperature at fixed composition
- another 2-D projection of the full state space

### Merge operator

The merge block defines an operator:

```text
M(S1, S2, ..., Sn) -> S_out
```

This operator should account for:

- mass-flow weighted enthalpy
- mass-flow weighted composition
- any merge pressure relation or constraint
- validity flags and regime restrictions

### Downstream set

The result is a new downstream candidate set:

```text
S_out
```

This set becomes the inlet field for the downstream branch.

That is the core idea geodash should preserve.

## Recommended First Implementation

### 1. Fixed-flow merge physics

For a first version, assume that each incoming branch supplies:

- outlet state field
- total mass flow
- outlet composition

Then compute:

- mixed mass flow:  
  `m_out = Σ m_i`

- mixed composition:
  `z_out = (Σ m_i * z_i) / m_out`

- mixed enthalpy:
  `h_out = (Σ m_i * h_i) / m_out`

Pressure handling should be explicit and conservative. In phase one, this likely means:

- require incoming streams to be sufficiently close in pressure
- or define a simple merge pressure rule
- or invalidate combinations that violate pressure tolerance

This keeps the operator understandable.

### 2. New thermo authority after merge

Once composition changes, the downstream section should use a new thermodynamic authority:

- compute a canonical mixed composition
- resolve or generate the corresponding thermodynamic texture set
- bind that texture set for downstream evaluation

This matches the thermo-registry direction and the texture-backed property model.

### 3. Rasterized downstream field, not tuple inventory

The merge operator should produce a downstream field in the target slice rather than preserving an inventory of parent tuples as the primary object.

In other words:

- parent tuples may be an implementation detail
- the downstream candidate field is the modelling object

This is the key difference from the `piper` prototype.

## Implementation Strategies

There are several ways to approximate the merge operator. They are not equally desirable.

### Strategy A: Parent-tuple combinatorial sampling

This is the `piper` approach.

Process:

- bin upstream points
- sample parent tuples
- mix sampled tuples
- emit downstream points

Advantages:

- physically grounded
- straightforward to prototype
- preserves explicit ancestry of downstream points

Disadvantages:

- combinatorial by construction
- requires caps and random sampling
- harder to make deterministic and smooth
- awkward as the default modelling story

Conclusion:

- acceptable as a fallback or debugging/reference implementation
- not preferred as the main geodash path

### Strategy B: Field transport plus resampling

This is the preferred geodash direction.

Process:

- treat each upstream outlet as a field/set over the chosen slice
- apply the merge operator to generate downstream samples
- rasterize or resample the result into a canonical downstream grid

Advantages:

- matches geodash’s state-space framing
- produces a clean downstream field
- easier to compose with downstream branch evaluation
- avoids exposing combinatorial bookkeeping as the main abstraction

Disadvantages:

- needs careful resampling design
- loses exact explicit parent ancestry unless tracked separately

Conclusion:

- preferred default

### Strategy C: Analytic envelope propagation

Instead of representing the full downstream field as sampled points, compute a reduced representation of the reachable region.

Advantages:

- compact
- potentially very fast

Disadvantages:

- harder to generalize
- may hide internal structure
- not ideal for the “wind map” and trajectory-oriented UX

Conclusion:

- maybe useful later for optimization
- not the primary first implementation

## Practical Geodash Shape

### Branch boundary contract

At a merge boundary, each upstream branch should expose a compact outlet package:

```text
BranchOutletField {
  candidate_texture
  validity_mask
  branch_mass_flow
  composition_id
  slice_spec
}
```

### Merge result

The merge block should then produce:

```text
MergedOutletField {
  candidate_texture
  validity_mask
  mixed_mass_flow
  mixed_composition_id
  slice_spec
}
```

The downstream branch consumes this merged field just like a source field.

## Recommended Approximation Scheme

For phase one, use a deterministic rasterized merge.

Suggested shape:

1. Choose a canonical downstream grid for the active slice.
2. For each valid upstream sample cell, contribute to downstream bins under the merge operator.
3. Accumulate weighted contributions in the downstream grid.
4. Mark bins valid when they receive enough physically acceptable support.

This is essentially a scatter-then-resample approach.

The exact accumulation rule will depend on the chosen slice and pressure policy, but the important thing is that the output is a downstream field, not a list of sampled tuple outcomes.

## Parent Tracking

Parent ancestry may still be useful, but it should be secondary.

It can be recorded for:

- debugging
- explanation UI
- hover inspection
- validation against a reference mixer

But it should not be the primary object that downstream blocks consume.

## Pressure Handling

Pressure is the trickiest part of merge modelling.

For a first implementation, geodash should be conservative and explicit:

- require parent outlet pressures to agree within a tolerance
- or bin/align parents by pressure before mixing
- or invalidate mixed states that do not satisfy the merge pressure rule

This is one area where the `piper` pressure-binning idea remains useful. Pressure alignment is a good approximation tool even if the full combinatorial mixer is not adopted as the main architecture.

So the recommendation is:

- keep pressure-binning as an implementation aid
- do not let tuple-sampling become the conceptual model

## Composition Handling

The `piper` composition mixing utilities in [composition-mixing.ts](/Users/jerell/Repos/piper/frontend/src/lib/composition-mixing.ts:1) are conceptually in the right direction:

- total mass flow aggregation
- component-wise mixing
- canonical mixed composition output

Geodash should preserve that logic at the branch boundary, but make the resulting composition identity part of the thermodynamic-model-registry flow rather than a UI-only metadata object.

## Relationship to GPU/CPU Split

This design fits the intended geodash split well:

- GPU:
  - many-candidate branch sweeps
  - merge operator over outlet fields
  - downstream field generation

- Zig CPU:
  - full KP profile for selected candidate states
  - debug/reference implementations
  - validation of merge behaviour at a point or small batch

## Consequences

This decision means:

- geodash accepts that merges create new downstream candidate sets
- branch boundaries remain first-class state-space checkpoints
- merge modelling stays explicit
- downstream branches consume fields, not parent tuple inventories

It also means the `piper` mixer remains useful as:

- a proof that merges need new candidate sets
- a reference implementation
- a debugging/comparison tool

But the main geodash architecture should move toward deterministic field transport and resampling rather than combinatorial sampled parent tuples.

## Non-goals

This decision does not yet define:

- the exact merge pressure law
- the exact raster accumulation kernel
- the exact visualization of merge ancestry
- split-ratio solving or control logic

Those should be documented separately once the first merge operator implementation is chosen.
