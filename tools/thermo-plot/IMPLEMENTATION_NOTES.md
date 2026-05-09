# Thermo Plot Implementation Notes

This file records the investigation and implementation plan behind
`tools/thermo-plot`.

## Recommendation

Use **Python + uv** for the client tool, using the **official KBC Multiflash
Python API** once its installed package and manual are available. Treat
`PaceCCS/multiflash-data-generator-rust` and `PaceCCS/multiflash-rust` as the
best internal reference implementation pair for the calculation sequence, not as
the target runtime.

The Rust data generator is the most complete existing example of producing
thermodynamic data from Multiflash. It already handles:

- command-line inputs
- `.mfl` stream loading
- license/security initialization through the Rust wrapper
- pressure/temperature case generation
- composition generation
- flash execution
- density, enthalpy, entropy, heat capacity, viscosity, and phase fraction output
- CSV file output
- phase envelope CSV output

The Rust wrapper repo is the strongest source for the actual Multiflash API
sequence:

1. create a security handle
2. set the Multiflash databank path
3. load the `.mfl` stream
4. create a flash, property calculator, and transport property calculator
5. run `P,T` flashes into a reusable fluid state
6. evaluate phase properties and transport properties
7. close the license when the handle drops

The new tool should not copy the Rust CLI directly. The requested client-facing
deliverable is more naturally a Python workflow because plotting, Zarr writing,
and repeated chart regeneration are simpler there.

Do **not** use the unrelated public PyPI package named `multiflash`; that package
is not KBC Multiflash. Also do not build the client tool around unofficial or
legacy wrappers such as `from multiflash import MultiflashDll` unless engineering
explicitly confirms that wrapper is the official KBC API for the target
Multiflash version.

Public KBC material confirms that recent Multiflash versions expose a Python API
and REST API, but an official Python API manual was not found in open web search.
Expect the authoritative API documentation to come from the licensed Multiflash
installation, the KBC/Yokogawa support portal, or supplied project documents.

## Local Manuals

Local manuals inspected from `/Users/jerell/Downloads/mfmanuals`:

- `mfuserman.pdf`: Multiflash for Windows User Guide, version 7.5, July 2024.
- `mfxlman.pdf`: Multiflash Excel Interface User Guide, version 7.4, July 2024.
- `modelsman.pdf`: Models and Physical Properties User Guide, version 7.5, 2024.

These manuals did not appear to document the Python API directly. They are still
useful for official terminology, property names, units, flash types, and the
thermodynamic definition of derived properties.

## Existing Repo Ranking

### 1. `PaceCCS/multiflash-data-generator-rust`

Most complete and usable for the immediate data-generation problem.

Strengths:

- recent enough to reference confidently
- has a real CLI
- supports randomized, complete, and input-file case generation
- uses typed units through `uom`
- writes outputs suitable for neural-network training style workflows
- already computes most requested properties

Limitations:

- outputs CSV, not Zarr
- fixed around `P,T` flashes and CO2 impurity grids
- no plotting path
- no Python API
- contains some rough edges such as a stray debug statement and hard-coded phase
  descriptor assumptions

### 2. `PaceCCS/multiflash-rust`

Best reusable low-level wrapper reference.

Strengths:

- wraps the Multiflash thread-safe interface
- includes explicit security/license lifecycle handling
- exposes flash, stream, property calculator, fluid state, and transport property
  calculator concepts
- includes examples for version checks and flash execution

Limitations:

- Rust library, not a finished data product
- local README appears to be stale or project-specific
- building and distributing it to a client is heavier than a Python plotting CLI

### 3. `PaceCCS/multiflash-csharp`

Useful API and domain reference, especially for fluid-state aggregation.

Strengths:

- includes P/temperature, P/enthalpy, and P/entropy fluid factory methods
- combines gas and liquid phase properties into bulk fluid properties
- shows license setup, databank setup, and `.mfl` stream use
- has tests and a solution structure

Limitations:

- depends on .NET and internal DigitalTwin/ABB package feeds
- includes large binary artifacts
- less convenient for Zarr and chart generation

### 4. `PaceCCS/multiflash-test-c`

Good minimal C/C++ smoke test.

Strengths:

- concise demonstration of license unlock, database path, stream load, flash run,
  property calculation, viscosity, and density calculation
- useful for debugging a broken Multiflash installation

Limitations:

- not a reusable tool
- hard-coded paths, composition, and `.mfl` file
- no output format or charting

### 5. `PaceCCS/MultiflashDataGenerator`

Older C++ predecessor to the Rust data generator.

Strengths:

- confirms the original direct-Multiflash data-generation approach
- has CMake/tests and a wrapper layer

Limitations:

- last updated in 2022
- Windows/CLion-oriented setup
- less complete and less maintainable than the Rust rewrite

## Current Tool Shape

`tools/thermo-plot` is a `uv` project with one CLI:

```sh
cd tools/thermo-plot

uv run thermo-plot \
  generate \
  --mfl path/to/fluid.mfl \
  --databank-path "C:/Program Files/KBC/Multiflash 7.4" \
  --composition composition.toml \
  --pressure-pa 100000:100000:20000000 \
  --temperature-k 223.15:1:323.15 \
  --output runs/example.zarr

uv run thermo-plot plot runs/example.zarr --field density_kg_per_m3
```

Core commands:

- `check-license`: initialize the backend and print version/license status.
- `generate`: call a backend and write canonical Zarr arrays.
- `plot`: read Zarr and produce charts without calling the backend.
- `inspect`: print metadata, axes, fields, units, and provenance from a Zarr store.

Plots should show:

- filled property grids
- property isolines
- phase boundaries overlaid from `phase_code` when present, regardless of which
  property is being plotted

Until a machine with Multiflash and the official Python package is available,
most of this can be built against the local `tools/thermo-models` ONNX artifacts.
Those models were trained from Multiflash data, so they are a better placeholder
than synthetic equations for the data flow, field names, charting, and cache
format.

Keep the Multiflash-specific integration behind a small adapter so the
thermo-model backend can be replaced with the official KBC API later.

## Official Vocabulary

The Excel manual gives a useful official vocabulary to mirror in the adapter:

- `MF_VERS`: version check.
- `MF_PTF`: pressure-temperature flash.
- `MF_PHF`: pressure-enthalpy flash.
- `MF_PSF`: pressure-entropy flash.
- `MF_PHASE_PROPS`: single-phase properties without flashing.
- `MF_PHENV`: phase envelope.
- `MF_HPHENV`: fixed-enthalpy phase-envelope line.
- `MF_SPHENV`: fixed-entropy phase-envelope line.

Relevant property labels include `TEMPERATURE`, `PRESSURE`, `ENTHALPY`,
`ENTROPY`, `VOLUME`/`DENSITY`, `VISCOSITY`, `THCOND`, `CP`, `CV`,
`COMPRESSIBILITY`, `EXPANSIVITY`, `JTCOEFF`, `SSOUND`, `ZFACTOR`, `PHASE`, and
`STATUS`.

## Suggested Zarr Layout

For the first client tool, keep it flat and practical:

```text
metadata.json
axes/
  pressure_pa
  temperature_k
fields/
  gas_fraction
  temperature_k
  enthalpy_j_per_kg
  entropy_j_per_kg_k
  density_kg_per_m3
  viscosity_pa_s
  jt_coefficient_k_per_pa
  validity_mask
```

Metadata should include:

- authority kind
- Multiflash version or thermo-model artifact version
- `.mfl` path or source hash
- databank path or databank identity
- component order
- composition basis
- units
- requested axes and resolution
- property aggregation rules
- generation timestamp

## Engineering Notes

- Confirm the exact "J/T coefficient" with engineering. It likely means
  Joule-Thomson coefficient. The Excel manual exposes it as `JTCOEFF`, described
  as the Joule-Thompson coefficient.
- The Multiflash 7.5 Models and Physical Properties manual defines the
  Joule-Thomson coefficient as:

  ```text
  mu_JT = (dT/dP)|H = (V / Cp) * (alpha * T - 1)
  ```

  where `alpha = (1 / V) * (dV/dT)|P`, `V` is volume, and `Cp` is heat capacity
  at constant pressure. This is equivalent to:

  ```text
  mu_JT = (T * dV/dT|P - V) / Cp
  ```

  If the official Python API exposes `JTCOEFF` directly, prefer that value and
  record the units returned by the API. If the tool stores SI data, prefer
  `K/Pa` for the canonical Zarr field.
- Prefer storing canonical SI units in Zarr even if CLI input accepts convenient
  units.
- Keep phase properties and bulk properties separate if there is any ambiguity.
- Include the thermodynamic authority identity in any cache key to avoid
  reusing arrays from a different `.mfl` file, databank, or model artifact.
- Make plotting consume only Zarr. That keeps Multiflash licensing out of chart
  regeneration and makes neural-network output plottable through the same path.
