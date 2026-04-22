# Thermodynamic Model Artifacts

This directory is the default output root for trained thermodynamic model artifacts.

Each trained model version is written under:

```text
artifacts/<model-id>/<version>/
```

The first implemented trainer writes:

- `model.onnx`
- `model_state_dict.pt`
- `runtime_config.json`
- `metrics.json`
- `manifest.json`

These artifacts are intended to be small enough to check into the repo when useful.
