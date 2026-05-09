# Thermo Plot

`thermo-plot` generates cached thermodynamic property grids and plots from a
pluggable backend.

The current default backend is `thermo-models`, which evaluates the local
Multiflash-trained ONNX model family under `tools/thermo-models/artifacts/`.
When the official KBC Multiflash Python API is available, it should be added as
another backend without changing the Zarr or plotting workflow.

For investigation notes and the implementation plan, see
[`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md).

## Setup

```sh
cd tools/thermo-plot
uv run thermo-plot check-license --backend thermo-models
```

The command should report `authority_kind: nn_from_multiflash_data`.

## Generate a Grid

The `thermo-models` backend uses a pressure-enthalpy domain:

```sh
uv run thermo-plot generate \
  --backend thermo-models \
  --composition examples/composition.co2-rich.json \
  --pressure-pa 100000:500000:10000000 \
  --enthalpy-kj-per-mol=-18:1:6 \
  --output runs/thermo-models-smoke.zarr \
  --overwrite
```

Axis values accept either `start:step:stop` or comma-separated values.

## Inspect Metadata

```sh
uv run thermo-plot inspect runs/thermo-models-smoke.zarr
```

## Plot a Field

```sh
uv run thermo-plot plot runs/thermo-models-smoke.zarr --field temperature_k
```

Plots include property isolines and phase-boundary overlays by default when the
store contains `phase_code`.

Useful plot options:

```sh
uv run thermo-plot plot runs/thermo-models-smoke.zarr \
  --field density_kg_per_m3 \
  --isolines 16

uv run thermo-plot plot runs/thermo-models-smoke.zarr \
  --field density_kg_per_m3 \
  --isolines 0 \
  --no-phase-boundaries
```

By default, plots are written under:

```text
runs/<store>.zarr/plots/<field>.png
```

## Fields

The `thermo-models` backend currently writes:

- `gas_fraction`
- `phase_code`
- `temperature_k`
- `enthalpy_j_per_kg`
- `enthalpy_kj_per_mol`
- `entropy_j_per_kg_k`
- `density_kg_per_m3`
- `viscosity_pa_s`
- `jt_coefficient_k_per_pa`
- `validity_mask`

`jt_coefficient_k_per_pa` is present but currently `NaN` for the `thermo-models`
backend because the checked-in ONNX family does not include a Joule-Thomson
model.

## Composition Files

Composition files are JSON:

```json
{
  "basis": "mole_fraction",
  "components": {
    "CO2": 0.965,
    "N2": 0.02,
    "H2": 0.005,
    "METHANE": 0.01
  }
}
```

Fractions are normalized before evaluation.

## Backends

- `thermo-models`: default. Uses local ONNX models trained from Multiflash data.
- `kbc`: placeholder for the future official KBC Multiflash Python API.
- `synthetic`: plumbing fallback only; do not use for scientific-looking output.
