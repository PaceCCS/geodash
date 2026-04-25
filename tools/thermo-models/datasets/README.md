# Thermodynamic Datasets

Place large local training datasets for thermodynamic models in this directory.

These files are intentionally ignored by Git. The repo tracks only:

- this README
- `.gitignore`
- `manifest.toml`

## Expected Dataset

The first shared training dataset is:

- `GERG2008_1m.csv`

This file is used to train multiple `(P, H) -> property` models, so it should be treated as a named local dataset rather than a throwaway input.

## Recommended Setup

If you want the file physically inside the repo-local tools area:

```sh
cp /path/to/GERG2008_1m.csv tools/thermo-models/datasets/
```

If you prefer to keep the large file elsewhere on disk, a symlink here is also fine:

```sh
ln -s /path/to/GERG2008_1m.csv tools/thermo-models/datasets/GERG2008_1m.csv
```

## Hash Verification

1. Fill in the expected `sha256` value in [`manifest.toml`](./manifest.toml).
2. Run:

```sh
just check-thermo-datasets
# or directly:
cd tools/thermo-models && uv run check_dataset_hashes.py
```

If the manifest hash is blank or incorrect, the checker prints the actual SHA-256 so it can be copied into the manifest.
