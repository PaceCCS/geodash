# Thermodynamic Model Tooling

This directory is for reproducible thermodynamic model work inside `geodash`.

It is a dedicated `uv`-managed Python project for thermo-model tooling.

The intended split is:

- committed tooling and metadata live here
- large raw training datasets stay local
- small trained artifacts and validation outputs can be checked in when useful

## Layout

- `datasets/`
  Local raw datasets for training and validation. Large CSV files in this directory are ignored by Git.
- `pyproject.toml`
  `uv` project definition for thermo-model scripts and future training/export dependencies.
- `check_dataset_hashes.py`
  Verifies that local dataset files match the SHA-256 fingerprints recorded in the dataset manifest.
- `train_model.py`
  Trains one thermodynamic model or the full model family from the shared dataset manifest and emits registry-ready artifacts.
- `compare_models.py`
  Runs one trained model or the full trained model family against the reference ONNX family on the same dataset sample and compares both against truth.
- `artifacts/`
  Default output root for trained model artifacts.
- `reference-models/`
  Reference runtime configs for comparison against external model sources.

## Dataset Workflow

1. Place the dataset file under [`datasets/`](./datasets/README.md) or create a symlink there.
2. Record its expected SHA-256 in [`datasets/manifest.toml`](./datasets/manifest.toml).
3. Run:

```sh
just check-thermo-datasets
# or directly:
cd tools/thermo-models && uv run check_dataset_hashes.py
```

Future training and export scripts should read the same manifest and refuse to proceed when the local file does not match the recorded hash.

## Training the Model Family

The scripted trainer now covers the current `phase-envelope-generator` ONNX family:

- `ph_phase`
- `ph_rs`
- `ph_ro`
- `ph_s`
- `ph_t`
- `ph_vis_gas_liquid`
- `ph_vis_two_phase`

Example full command:

```sh
cd tools/thermo-models
uv run train_model.py --model ph_ro --version 0.1.0
```

To train the full family into `artifacts/<model-id>/<version>/`:

```sh
cd tools/thermo-models
uv run train_model.py --model all --version 0.1.0
```

Useful iteration command for a quick smoke test:

```sh
cd tools/thermo-models
uv run train_model.py \
  --model ph_ro \
  --version smoke \
  --limit-rows 4096 \
  --epochs 2 \
  --batch-size 256 \
  --output-root /tmp/geodash-thermo-artifacts \
  --force
```

The trainer verifies the dataset hash before loading the CSV and writes artifacts under `artifacts/<model-id>/<version>/` by default.

The emitted bundle is self-contained and currently includes a direct `model.onnx` export plus the metadata and metrics needed to use it inside Geodash.

The non-two-phase viscosity target is reproduced exactly from the dataset by selecting `VISG` for pure-gas rows and `VISHL` for pure-liquid rows after splitting the CSV on the decimal `RS` region. The current two-phase viscosity target is an explicit inferred mixing rule, recorded in each emitted manifest, until the original notebook used to create the reference `PH_VIS_TwoPhase.onnx` is copied into this repo.

## Immediate Verification Against phase-envelope-generator

If you have a trained artifact bundle and want to compare it against the current `phase-envelope-generator` reference model on the same sampled CSV rows:

```sh
cd tools/thermo-models
uv run compare_models.py \
  --model ph_ro \
  --candidate-dir /tmp/geodash-thermo-artifacts/ph_ro/smoke
```

To compare the full trained family under one version:

```sh
cd tools/thermo-models
uv run compare_models.py \
  --model all \
  --candidate-root /tmp/geodash-thermo-artifacts \
  --version smoke
```

The comparison report includes:

- candidate vs truth metrics
- reference vs truth metrics
- candidate vs reference deltas
- basic config compatibility checks
