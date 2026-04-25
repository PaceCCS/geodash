#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.optim as optim
from sklearn.model_selection import train_test_split

from dataset_manifest import DEFAULT_MANIFEST, compute_sha256, get_dataset_entry, verify_dataset_entry
from model_specs import MODEL_SPECS, ModelSpec
from networks import FeedForwardNetwork

TWO_PHASE_VISCOSITY_WEIGHT_EXPONENT = 1.5759


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train thermodynamic property models from the shared dataset manifest."
    )
    parser.add_argument(
        "--model",
        choices=["all", *sorted(MODEL_SPECS.keys())],
        required=True,
        help="Model identifier to train, or 'all' to train the full model family.",
    )
    parser.add_argument(
        "--version",
        required=True,
        help="Artifact version written under the output root.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Path to dataset manifest (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("artifacts"),
        help="Root directory for emitted model artifacts.",
    )
    parser.add_argument(
        "--limit-rows",
        type=int,
        default=None,
        help="Optional row limit for smoke tests or iteration.",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=None,
        help="Number of training epochs (defaults to the model spec).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Mini-batch size (defaults to the model spec).",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=None,
        help="Fraction of rows assigned to the test split (defaults to the model spec).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for train/test split and torch initialization.",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=None,
        help="Initial Adam learning rate.",
    )
    parser.add_argument(
        "--learning-rate-after-decay",
        type=float,
        default=None,
        help="Learning rate used after the decay threshold.",
    )
    parser.add_argument(
        "--learning-rate-decay-epoch",
        type=int,
        default=None,
        help="Epoch after which the prototype notebooks reset the Adam optimizer.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        help="Torch device (default: cpu).",
    )
    parser.add_argument(
        "--skip-onnx-export",
        action="store_true",
        help="Skip ONNX export and only emit the PyTorch state dict plus metadata.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an existing output directory.",
    )
    return parser.parse_args()


def load_training_frame(spec: ModelSpec, csv_path: Path, limit_rows: int | None) -> pd.DataFrame:
    frame = pd.read_csv(
        csv_path,
        encoding="utf-8",
        nrows=limit_rows,
        usecols=list(spec.source_columns),
    )

    if frame.isna().any().any():
        counts = frame.isna().sum()
        missing = {column: int(count) for column, count in counts.items() if count > 0}
        raise SystemExit(f"ERROR: dataset contains NaN values in required columns: {missing}")

    if "ROG" in frame.columns and "ROHL" in frame.columns and "RS" in frame.columns:
        rs = frame["RS"].to_numpy(dtype=np.float64)
        rog = frame["ROG"].to_numpy(dtype=np.float64)
        rohl = frame["ROHL"].to_numpy(dtype=np.float64)

        density = np.empty(len(frame), dtype=np.float64)
        gas_mask = rs >= 1.0
        liquid_mask = rs <= 0.0
        mixed_mask = ~(gas_mask | liquid_mask)

        density[gas_mask] = rog[gas_mask]
        density[liquid_mask] = rohl[liquid_mask]
        density[mixed_mask] = 1.0 / (
            rs[mixed_mask] / rog[mixed_mask]
            + (1.0 - rs[mixed_mask]) / rohl[mixed_mask]
        )
        frame["RO"] = density

    return frame


def apply_subset_filter(spec: ModelSpec, frame: pd.DataFrame) -> pd.DataFrame:
    if spec.subset_kind == "all":
        filtered = frame.copy()
    elif spec.subset_kind == "non_two_phase":
        filtered = frame.loc[frame["2phase"] == 0].copy()
    elif spec.subset_kind == "two_phase":
        filtered = frame.loc[frame["2phase"] == 1].copy()
    else:
        raise SystemExit(f"ERROR: unsupported subset kind '{spec.subset_kind}'")

    if filtered.empty:
        raise SystemExit(f"ERROR: no rows remain after applying subset '{spec.subset_kind}'")
    return filtered


def build_feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    features = frame.loc[:, ["PT", "H", "CO2", "CO", "H2", "N2", "Ar"]].copy()
    features["P2"] = np.cbrt(features["PT"].to_numpy(dtype=np.float64))
    return features


def phase_labels(frame: pd.DataFrame) -> np.ndarray:
    rs = frame["RS"].to_numpy(dtype=np.float64)
    return np.where(rs >= 1.0, 1, np.where(rs <= 0.0, 0, 2)).astype(np.int64)


def gas_liquid_viscosity_target(frame: pd.DataFrame) -> np.ndarray:
    rs = frame["RS"].to_numpy(dtype=np.float64)
    visg = frame["VISG"].to_numpy(dtype=np.float64)
    vishl = frame["VISHL"].to_numpy(dtype=np.float64)
    return np.where(rs >= 1.0, visg, vishl)


def two_phase_viscosity_target(frame: pd.DataFrame) -> np.ndarray:
    rs = frame["RS"].to_numpy(dtype=np.float64)
    visg = frame["VISG"].to_numpy(dtype=np.float64)
    vishl = frame["VISHL"].to_numpy(dtype=np.float64)
    # This mixing rule is inferred from the reference ONNX family so the scripted
    # tooling can train the same model shape end-to-end before the original notebook
    # is copied into the repo.
    weight = 1.0 - np.power(1.0 - rs, TWO_PHASE_VISCOSITY_WEIGHT_EXPONENT)
    return weight * visg + (1.0 - weight) * vishl


def regression_truth(spec: ModelSpec, frame: pd.DataFrame) -> np.ndarray:
    if spec.target_kind == "rs":
        return frame["RS"].to_numpy(dtype=np.float64)
    if spec.target_kind == "density":
        if "RO" not in frame.columns:
            raise SystemExit("ERROR: density target requires computed RO column")
        return frame["RO"].to_numpy(dtype=np.float64)
    if spec.target_kind == "entropy":
        return frame["SE"].to_numpy(dtype=np.float64)
    if spec.target_kind == "temperature":
        return frame["TM"].to_numpy(dtype=np.float64) + 273.15
    if spec.target_kind == "viscosity_gas_liquid":
        return gas_liquid_viscosity_target(frame)
    if spec.target_kind == "viscosity_two_phase":
        return two_phase_viscosity_target(frame)
    raise SystemExit(f"ERROR: unsupported regression target kind '{spec.target_kind}'")


def make_split_indices(sample_count: int, test_size: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    if sample_count < 2:
        raise SystemExit("ERROR: at least two rows are required to create a train/test split")
    if not (0.0 < test_size < 1.0):
        raise SystemExit("ERROR: --test-size must be between 0 and 1")

    indices = np.arange(sample_count)
    train_indices, test_indices = train_test_split(
        indices,
        test_size=test_size,
        random_state=seed,
        shuffle=True,
    )
    return np.asarray(train_indices), np.asarray(test_indices)


def to_float_array(frame: pd.DataFrame) -> np.ndarray:
    return frame.to_numpy(dtype=np.float32, copy=True)


def scale_features(
    features: pd.DataFrame, train_indices: np.ndarray
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    train_features = features.iloc[train_indices]
    feature_means = train_features.mean()
    feature_std_devs = train_features.std(ddof=1)

    if (feature_std_devs == 0.0).any():
        zero_columns = feature_std_devs[feature_std_devs == 0.0].index.tolist()
        raise SystemExit(
            f"ERROR: feature standard deviation is zero for columns: {zero_columns}"
        )

    scaled = (features - feature_means) / feature_std_devs
    return scaled, feature_means, feature_std_devs


def scale_regression_target(
    spec: ModelSpec, truth: np.ndarray
) -> tuple[np.ndarray, dict[str, float]]:
    if spec.output_transform == "std_dev_only":
        output_std_dev = float(truth.std(ddof=1))
        if output_std_dev == 0.0:
            raise SystemExit("ERROR: target standard deviation is zero; cannot scale target")
        return truth / output_std_dev, {
            "outputStdDev": output_std_dev,
        }

    if spec.output_transform == "std_dev_then_add":
        output_offset = float(truth.min())
        shifted = truth - output_offset
        output_std_dev = float(shifted.std(ddof=1))
        if output_std_dev == 0.0:
            raise SystemExit("ERROR: shifted target standard deviation is zero; cannot scale target")
        return shifted / output_std_dev, {
            "outputOffset": output_offset,
            "outputStdDev": output_std_dev,
        }

    if spec.output_transform == "viscosity":
        output_v_mean = float(truth.mean())
        if output_v_mean == 0.0:
            raise SystemExit("ERROR: viscosity mean is zero; cannot scale target")
        scaled_to_mean = truth / output_v_mean
        output_v_min = float(scaled_to_mean.min())
        shifted = scaled_to_mean - output_v_min
        output_std_dev = float(shifted.std(ddof=1))
        if output_std_dev == 0.0:
            raise SystemExit("ERROR: viscosity shifted standard deviation is zero; cannot scale target")
        return shifted / output_std_dev, {
            "outputStdDev": output_std_dev,
            "outputVMean": output_v_mean,
            "outputVMin": output_v_min,
        }

    raise SystemExit(f"ERROR: unsupported regression output transform '{spec.output_transform}'")


def set_reproducible_seeds(seed: int) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)


def create_model(spec: ModelSpec) -> FeedForwardNetwork:
    return FeedForwardNetwork(
        input_size=len(spec.feature_order),
        hidden_sizes=spec.hidden_sizes,
        output_size=spec.output_size,
        hidden_activation=spec.hidden_activation,
        output_activation=spec.output_activation,
    )


def build_optimizer(model: torch.nn.Module, learning_rate: float, weight_decay: float) -> optim.Adam:
    return optim.Adam(model.parameters(), lr=learning_rate, weight_decay=weight_decay)


def train(
    spec: ModelSpec,
    model: FeedForwardNetwork,
    train_inputs: torch.Tensor,
    train_targets: torch.Tensor,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    learning_rate_after_decay: float,
    learning_rate_decay_epoch: int,
    weight_decay: float,
    device: torch.device,
) -> list[float]:
    model.to(device)
    train_inputs = train_inputs.to(device)
    train_targets = train_targets.to(device)

    if spec.task_kind == "regression":
        loss_fn: torch.nn.Module = torch.nn.MSELoss()
    elif spec.task_kind == "classification":
        loss_fn = torch.nn.CrossEntropyLoss()
    else:
        raise SystemExit(f"ERROR: unsupported task kind '{spec.task_kind}'")

    optimizer = build_optimizer(model, learning_rate, weight_decay)
    losses: list[float] = []

    # Determine logging interval: every 10% of epochs, minimum 1
    log_interval = max(1, epochs // 10)
    total_batches = (train_inputs.shape[0] + batch_size - 1) // batch_size

    for epoch in range(epochs):
        if epoch > learning_rate_decay_epoch:
            optimizer = build_optimizer(model, learning_rate_after_decay, weight_decay)

        model.train()
        epoch_loss = 0.0
        epoch_batches = 0

        for start in range(0, train_inputs.shape[0], batch_size):
            stop = start + batch_size
            input_batch = train_inputs[start:stop]
            target_batch = train_targets[start:stop]

            prediction_batch = model(input_batch)
            if spec.task_kind == "regression":
                loss = loss_fn(prediction_batch, target_batch)
            else:
                loss = loss_fn(prediction_batch, target_batch)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            epoch_loss += float(loss.item())
            epoch_batches += 1

        losses.append(epoch_loss / max(epoch_batches, 1))

        # Progress logging
        if epoch % log_interval == 0 or epoch == epochs - 1:
            pct = (epoch + 1) * 100 // epochs
            print(
                f"[{spec.model_id}] epoch {epoch + 1}/{epochs} ({pct}%) "
                f"avg_loss={losses[-1]:.6e} batch_size={batch_size} batches={total_batches}"
            )

    model.to("cpu")
    return losses


def predict_regression(model: FeedForwardNetwork, inputs: torch.Tensor) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return model(inputs).squeeze(1).cpu().numpy()


def predict_class_probabilities(model: FeedForwardNetwork, inputs: torch.Tensor) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        logits = model(inputs)
        return torch.softmax(logits, dim=1).cpu().numpy()


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    residual = predicted - actual
    mse = float(np.mean(np.square(residual)))
    mae = float(np.mean(np.abs(residual)))
    rmse = float(np.sqrt(mse))

    total_variance = float(np.sum(np.square(actual - np.mean(actual))))
    if total_variance == 0.0:
        r2 = 1.0
    else:
        r2 = float(1.0 - np.sum(np.square(residual)) / total_variance)

    return {
        "mse": mse,
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
    }


def physical_density_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    metrics = regression_metrics(actual, predicted)
    relative_error = np.abs(predicted - actual) / np.clip(np.abs(actual), 1e-12, None)
    metrics["mean_absolute_relative_error"] = float(relative_error.mean())
    metrics["max_absolute_relative_error"] = float(relative_error.max())
    return metrics


def classification_metrics(actual: np.ndarray, probabilities: np.ndarray) -> dict[str, Any]:
    predicted = np.argmax(probabilities, axis=1)
    clipped = np.clip(probabilities, 1e-12, 1.0)
    cross_entropy = float(-np.mean(np.log(clipped[np.arange(len(actual)), actual])))
    confusion = np.zeros((3, 3), dtype=np.int64)
    for truth, pred in zip(actual, predicted):
        confusion[int(truth), int(pred)] += 1
    return {
        "accuracy": float(np.mean(predicted == actual)),
        "crossEntropy": cross_entropy,
        "confusionMatrix": confusion.tolist(),
    }


def ensure_output_dir(path: Path, force: bool) -> None:
    if path.exists():
        if not force:
            raise SystemExit(
                f"ERROR: output directory already exists: {path}. Use --force to overwrite it."
            )
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def export_onnx(
    spec: ModelSpec,
    model: FeedForwardNetwork,
    output_path: Path,
    input_size: int,
) -> None:
    dummy_input = torch.zeros(1, input_size, dtype=torch.float32)
    export_model: torch.nn.Module = model
    export_model.eval()
    torch.onnx.export(
        export_model,
        dummy_input,
        output_path,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
        opset_version=18,
    )


def runtime_config_payload(
    spec: ModelSpec,
    feature_means: pd.Series,
    feature_std_devs: pd.Series,
    output_scaling: dict[str, float],
) -> dict[str, Any]:
    payload = {
        "displayName": spec.display_name,
        "featureMeans": [float(feature_means[feature.feature]) for feature in spec.feature_order],
        "featureOrder": [asdict(feature) for feature in spec.feature_order],
        "featureStdDevs": [
            float(feature_std_devs[feature.feature]) for feature in spec.feature_order
        ],
        "modelPath": "model.onnx",
        "outputTransform": spec.output_transform,
        "outputUnit": spec.property_unit,
        "property": spec.property_name,
    }
    payload.update(output_scaling)
    return payload


def train_single_model(
    spec: ModelSpec,
    args: argparse.Namespace,
    dataset_sha256: str,
    dataset_path: Path,
) -> dict[str, Any]:
    epochs = args.epochs if args.epochs is not None else spec.default_epochs
    batch_size = args.batch_size if args.batch_size is not None else spec.default_batch_size
    test_size = args.test_size if args.test_size is not None else spec.default_test_size
    learning_rate = args.learning_rate if args.learning_rate is not None else spec.learning_rate
    learning_rate_after_decay = (
        args.learning_rate_after_decay
        if args.learning_rate_after_decay is not None
        else spec.learning_rate_after_decay
    )
    learning_rate_decay_epoch = (
        args.learning_rate_decay_epoch
        if args.learning_rate_decay_epoch is not None
        else spec.learning_rate_decay_epoch
    )

    output_dir = (args.output_root / spec.model_id / args.version).resolve()
    ensure_output_dir(output_dir, force=args.force)

    started_at = datetime.now(timezone.utc)

    frame = load_training_frame(spec, dataset_path, args.limit_rows)
    frame = apply_subset_filter(spec, frame)
    features = build_feature_frame(frame)

    train_indices, test_indices = make_split_indices(len(features), test_size, args.seed)
    scaled_features, feature_means, feature_std_devs = scale_features(features, train_indices)

    if spec.task_kind == "classification":
        truth = phase_labels(frame)
        train_inputs = torch.tensor(to_float_array(scaled_features.iloc[train_indices]), dtype=torch.float32)
        test_inputs = torch.tensor(to_float_array(scaled_features.iloc[test_indices]), dtype=torch.float32)
        train_targets = torch.tensor(truth[train_indices].astype(np.int64), dtype=torch.long)
        test_targets = torch.tensor(truth[test_indices].astype(np.int64), dtype=torch.long)
        output_scaling: dict[str, float] = {}
    else:
        truth = regression_truth(spec, frame)
        scaled_target, output_scaling = scale_regression_target(spec, truth)
        train_inputs = torch.tensor(to_float_array(scaled_features.iloc[train_indices]), dtype=torch.float32)
        test_inputs = torch.tensor(to_float_array(scaled_features.iloc[test_indices]), dtype=torch.float32)
        train_targets = torch.tensor(
            scaled_target[train_indices].astype(np.float32).reshape(-1, 1),
            dtype=torch.float32,
        )
        test_targets = torch.tensor(
            scaled_target[test_indices].astype(np.float32).reshape(-1, 1),
            dtype=torch.float32,
        )

    set_reproducible_seeds(args.seed)
    device = torch.device(args.device)
    model = create_model(spec)

    loss_curve = train(
        spec=spec,
        model=model,
        train_inputs=train_inputs,
        train_targets=train_targets,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        learning_rate_after_decay=learning_rate_after_decay,
        learning_rate_decay_epoch=learning_rate_decay_epoch,
        weight_decay=spec.weight_decay,
        device=device,
    )

    if spec.task_kind == "classification":
        train_probabilities = predict_class_probabilities(model, train_inputs)
        test_probabilities = predict_class_probabilities(model, test_inputs)
        metrics_payload = {
            "train": classification_metrics(train_targets.cpu().numpy(), train_probabilities),
            "test": classification_metrics(test_targets.cpu().numpy(), test_probabilities),
        }
    else:
        train_pred_scaled = predict_regression(model, train_inputs)
        test_pred_scaled = predict_regression(model, test_inputs)
        runtime_config = runtime_config_payload(
            spec, feature_means, feature_std_devs, output_scaling
        )
        train_actual = regression_truth(spec, frame.iloc[train_indices].copy())
        test_actual = regression_truth(spec, frame.iloc[test_indices].copy())
        train_pred = denormalize_for_spec(train_pred_scaled, runtime_config)
        test_pred = denormalize_for_spec(test_pred_scaled, runtime_config)
        metrics_payload = {
            "train": {
                "normalized_target": regression_metrics(
                    train_targets.squeeze(1).cpu().numpy(), train_pred_scaled
                ),
                "physical_value": physical_density_metrics(train_actual, train_pred),
            },
            "test": {
                "normalized_target": regression_metrics(
                    test_targets.squeeze(1).cpu().numpy(), test_pred_scaled
                ),
                "physical_value": physical_density_metrics(test_actual, test_pred),
            },
        }

    state_dict_path = output_dir / "model_state_dict.pt"
    torch.save(model.state_dict(), state_dict_path)

    onnx_sha256: str | None = None
    if not args.skip_onnx_export:
        onnx_path = output_dir / "model.onnx"
        export_onnx(spec, model, onnx_path, len(spec.feature_order))
        onnx_sha256 = compute_sha256(onnx_path)

    completed_at = datetime.now(timezone.utc)

    runtime_config = runtime_config_payload(
        spec, feature_means, feature_std_devs, output_scaling
    )
    write_json(output_dir / "runtime_config.json", runtime_config)
    write_json(output_dir / "metrics.json", metrics_payload)

    manifest_payload: dict[str, Any] = {
        "schemaVersion": 1,
        "model": {
            "displayName": spec.display_name,
            "featureOrder": [asdict(feature) for feature in spec.feature_order],
            "hiddenActivation": spec.hidden_activation,
            "hiddenSizes": list(spec.hidden_sizes),
            "modelId": spec.model_id,
            "outputActivation": spec.output_activation,
            "outputTransform": spec.output_transform,
            "property": spec.property_name,
            "propertyUnit": spec.property_unit,
            "taskKind": spec.task_kind,
            "version": args.version,
        },
        "dataset": {
            "datasetId": spec.dataset_id,
            "path": str(dataset_path),
            "rowsLoaded": int(len(frame)),
            "sha256": dataset_sha256,
            "subsetKind": spec.subset_kind,
        },
        "artifacts": {
            "runtimeConfig": {
                "path": "runtime_config.json",
                "sha256": compute_sha256(output_dir / "runtime_config.json"),
            },
            "metrics": {
                "path": "metrics.json",
                "sha256": compute_sha256(output_dir / "metrics.json"),
            },
            "stateDict": {
                "path": "model_state_dict.pt",
                "sha256": compute_sha256(state_dict_path),
            },
        },
        "training": {
            "batchSize": batch_size,
            "device": str(device),
            "epochs": epochs,
            "learningRate": learning_rate,
            "learningRateAfterDecay": learning_rate_after_decay,
            "learningRateDecayEpoch": learning_rate_decay_epoch,
            "limitRows": args.limit_rows,
            "lossCurve": loss_curve,
            "seed": args.seed,
            "startedAtUtc": started_at.isoformat(),
            "completedAtUtc": completed_at.isoformat(),
            "testSize": test_size,
            "testSizeSource": "cli" if args.test_size is not None else "model_spec",
            "weightDecay": spec.weight_decay,
        },
        "scaling": runtime_config,
        "metrics": metrics_payload,
    }

    if spec.target_kind == "viscosity_two_phase":
        manifest_payload["training"]["twoPhaseTargetFormula"] = {
            "kind": "inferred_arithmetic_mix",
            "weight": f"1 - (1 - RS)^{TWO_PHASE_VISCOSITY_WEIGHT_EXPONENT}",
        }

    if onnx_sha256 is not None:
        manifest_payload["artifacts"]["onnx"] = {
            "path": "model.onnx",
            "sha256": onnx_sha256,
        }

    write_json(output_dir / "manifest.json", manifest_payload)

    print(f"Wrote artifacts for {spec.model_id} to {output_dir}")
    return {
        "modelId": spec.model_id,
        "outputDir": str(output_dir),
        "metrics": metrics_payload,
    }


def denormalize_for_spec(raw_outputs: np.ndarray, runtime_config: dict[str, Any]) -> np.ndarray:
    transform = runtime_config["outputTransform"]
    raw = raw_outputs.astype(np.float64, copy=False)
    if transform == "std_dev_only":
        return raw * float(runtime_config["outputStdDev"])
    if transform == "std_dev_then_add":
        return raw * float(runtime_config["outputStdDev"]) + float(runtime_config["outputOffset"])
    if transform == "viscosity":
        return (
            raw * float(runtime_config["outputStdDev"]) + float(runtime_config["outputVMin"])
        ) * float(runtime_config["outputVMean"])
    raise SystemExit(f"ERROR: unsupported denormalization transform '{transform}'")


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.resolve()

    model_ids = sorted(MODEL_SPECS.keys()) if args.model == "all" else [args.model]
    summaries: list[dict[str, Any]] = []

    for model_id in model_ids:
        spec = MODEL_SPECS[model_id]
        dataset_entry = get_dataset_entry(manifest_path, spec.dataset_id)
        dataset_sha256 = verify_dataset_entry(dataset_entry)
        summaries.append(
            train_single_model(
                spec=spec,
                args=args,
                dataset_sha256=dataset_sha256,
                dataset_path=dataset_entry.path,
            )
        )

    if len(summaries) > 1:
        print(json.dumps({"trainedModels": summaries}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
