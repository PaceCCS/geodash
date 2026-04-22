from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class RuntimeFeatureSpec:
    feature: str
    unit: str


@dataclass(frozen=True)
class RuntimeModelConfig:
    display_name: str
    feature_means: tuple[float, ...]
    feature_order: tuple[RuntimeFeatureSpec, ...]
    feature_std_devs: tuple[float, ...]
    model_path: str
    output_mean: float | None
    output_offset: float | None
    output_std_dev: float | None
    output_transform: str
    output_unit: str
    output_v_mean: float | None
    output_v_min: float | None
    property_name: str | None
    raw: dict[str, Any]


def runtime_config_from_payload(payload: dict[str, Any]) -> RuntimeModelConfig:
    return RuntimeModelConfig(
        display_name=payload["displayName"],
        feature_means=tuple(float(value) for value in payload["featureMeans"]),
        feature_order=tuple(
            RuntimeFeatureSpec(feature=item["feature"], unit=item["unit"])
            for item in payload["featureOrder"]
        ),
        feature_std_devs=tuple(float(value) for value in payload["featureStdDevs"]),
        model_path=payload["modelPath"],
        output_mean=(
            None if payload.get("outputMean") is None else float(payload["outputMean"])
        ),
        output_offset=(
            None
            if payload.get("outputOffset") is None
            else float(payload["outputOffset"])
        ),
        output_std_dev=(
            None
            if payload.get("outputStdDev") is None
            else float(payload["outputStdDev"])
        ),
        output_transform=payload["outputTransform"],
        output_unit=payload["outputUnit"],
        output_v_mean=(
            None
            if payload.get("outputVMean") is None
            else float(payload["outputVMean"])
        ),
        output_v_min=(
            None
            if payload.get("outputVMin") is None
            else float(payload["outputVMin"])
        ),
        property_name=payload.get("property"),
        raw=payload,
    )


def load_runtime_config(path: Path) -> RuntimeModelConfig:
    return runtime_config_from_payload(json.loads(path.read_text()))


def _feature_arrays(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    pt = frame["PT"].to_numpy(dtype=np.float64)
    return {
        "PT": pt,
        "H": frame["H"].to_numpy(dtype=np.float64),
        "CO2": frame["CO2"].to_numpy(dtype=np.float64),
        "CO": frame["CO"].to_numpy(dtype=np.float64),
        "H2": frame["H2"].to_numpy(dtype=np.float64),
        "N2": frame["N2"].to_numpy(dtype=np.float64),
        "Ar": frame["Ar"].to_numpy(dtype=np.float64),
        "P2": np.cbrt(pt),
    }


def prepare_model_inputs(frame: pd.DataFrame, config: RuntimeModelConfig) -> np.ndarray:
    features = _feature_arrays(frame)
    columns: list[np.ndarray] = []

    for index, feature in enumerate(config.feature_order):
        try:
            values = features[feature.feature]
        except KeyError as exc:
            raise SystemExit(
                f"ERROR: unsupported feature '{feature.feature}' in runtime config"
            ) from exc
        normalized = (values - config.feature_means[index]) / config.feature_std_devs[index]
        columns.append(normalized.astype(np.float32))

    return np.column_stack(columns).astype(np.float32, copy=False)


def denormalize_outputs(raw_outputs: np.ndarray, config: RuntimeModelConfig) -> np.ndarray:
    raw = raw_outputs.astype(np.float64, copy=False)
    transform = config.output_transform

    if transform == "none":
        return raw
    if transform == "std_dev_only":
        if config.output_std_dev is None:
            raise SystemExit("ERROR: outputStdDev required for std_dev_only transform")
        return raw * config.output_std_dev
    if transform == "std_dev_then_add":
        if config.output_std_dev is None or config.output_offset is None:
            raise SystemExit(
                "ERROR: outputStdDev and outputOffset required for std_dev_then_add transform"
            )
        return raw * config.output_std_dev + config.output_offset
    if transform == "viscosity":
        if (
            config.output_std_dev is None
            or config.output_v_min is None
            or config.output_v_mean is None
        ):
            raise SystemExit(
                "ERROR: outputStdDev, outputVMin, and outputVMean required for viscosity transform"
            )
        return (raw * config.output_std_dev + config.output_v_min) * config.output_v_mean
    if transform == "z_score":
        if config.output_std_dev is None or config.output_mean is None:
            raise SystemExit(
                "ERROR: outputStdDev and outputMean required for z_score transform"
            )
        return raw * config.output_std_dev + config.output_mean

    raise SystemExit(f"ERROR: unsupported output transform '{transform}'")
