from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np


PROPERTY_NAMES = (
    "gas_fraction",
    "phase_code",
    "temperature_k",
    "enthalpy_j_per_kg",
    "enthalpy_kj_per_mol",
    "entropy_j_per_kg_k",
    "density_kg_per_m3",
    "viscosity_pa_s",
    "jt_coefficient_k_per_pa",
)


@dataclass(frozen=True)
class Composition:
    basis: str
    components: tuple[str, ...]
    fractions: tuple[float, ...]

    @property
    def as_dict(self) -> dict[str, float]:
        return dict(zip(self.components, self.fractions, strict=True))


@dataclass(frozen=True)
class GridRequest:
    pressure_pa: np.ndarray
    temperature_k: np.ndarray | None
    enthalpy_kj_per_mol: np.ndarray | None
    composition: Composition
    mfl_path: Path | None
    databank_path: Path | None


@dataclass(frozen=True)
class BackendInfo:
    backend: str
    authority_kind: str
    version: str
    notes: str


@dataclass(frozen=True)
class GridResult:
    fields: dict[str, np.ndarray]
    validity_mask: np.ndarray
    metadata: dict[str, object]


class ThermoBackend(Protocol):
    def check_license(self) -> BackendInfo:
        """Return backend/license status."""

    def evaluate_grid(self, request: GridRequest) -> GridResult:
        """Evaluate all requested properties on a pressure-temperature grid."""


class SyntheticBackend:
    """Deterministic stand-in for the official KBC Multiflash Python API.

    The formulas are intentionally simple. They preserve expected array shapes,
    units, masks, and plotting behavior without pretending to be physical truth.
    """

    def check_license(self) -> BackendInfo:
        return BackendInfo(
            backend="synthetic",
            authority_kind="placeholder",
            version="0.1.0",
            notes="No Multiflash license required; deterministic placeholder values.",
        )

    def evaluate_grid(self, request: GridRequest) -> GridResult:
        if request.temperature_k is None:
            raise SystemExit("ERROR: synthetic backend requires --temperature-k")
        pressure, temperature = np.meshgrid(
            request.pressure_pa.astype(np.float64),
            request.temperature_k.astype(np.float64),
            indexing="ij",
        )
        composition = request.composition.as_dict
        co2_fraction = composition.get("CO2", 0.0)
        impurity_fraction = max(0.0, 1.0 - co2_fraction)

        pressure_mpa = pressure / 1.0e6
        temperature_c = temperature - 273.15

        gas_fraction = np.clip(
            1.0
            - (pressure_mpa - 1.0) / 12.0
            + (temperature_c - 20.0) / 140.0
            - impurity_fraction * 0.2,
            0.0,
            1.0,
        )

        gas_density = pressure / (188.9 * temperature)
        liquid_density = (
            980.0
            + 7.5 * pressure_mpa
            - 0.85 * (temperature - 273.15)
            + 40.0 * impurity_fraction
        )
        density = gas_fraction * gas_density + (1.0 - gas_fraction) * liquid_density

        enthalpy = (
            850.0 * (temperature - 273.15)
            - 12_000.0 * pressure_mpa
            + 25_000.0 * gas_fraction
            - 5_000.0 * impurity_fraction
        )
        entropy = (
            1_900.0
            + 6.5 * (temperature - 273.15)
            - 42.0 * np.log1p(pressure_mpa)
            + 85.0 * gas_fraction
        )
        gas_viscosity = 1.4e-5 + 2.5e-8 * (temperature - 273.15)
        liquid_viscosity = 8.0e-5 * np.exp(
            np.clip((310.0 - temperature) / 70.0, -4.0, 4.0)
        ) * (1.0 + 0.015 * pressure_mpa)
        viscosity = gas_fraction * gas_viscosity + (1.0 - gas_fraction) * liquid_viscosity

        alpha = 1.0 / np.clip(temperature, 1.0, None)
        cp = 1_500.0 + 1_000.0 * gas_fraction
        specific_volume = 1.0 / np.clip(density, 1.0e-12, None)
        jt = specific_volume / cp * (alpha * temperature - 1.0)

        fields = {
            "gas_fraction": gas_fraction.astype(np.float32),
            "phase_code": np.where(gas_fraction > 0.999, 0, np.where(gas_fraction < 0.001, 1, 2)).astype(np.float32),
            "temperature_k": temperature.astype(np.float32),
            "enthalpy_j_per_kg": enthalpy.astype(np.float32),
            "enthalpy_kj_per_mol": (enthalpy * 0.04401 / 1000.0).astype(np.float32),
            "entropy_j_per_kg_k": entropy.astype(np.float32),
            "density_kg_per_m3": density.astype(np.float32),
            "viscosity_pa_s": viscosity.astype(np.float32),
            "jt_coefficient_k_per_pa": jt.astype(np.float32),
        }
        validity_mask = np.isfinite(density) & np.isfinite(enthalpy) & (density > 0.0)

        return GridResult(
            fields=fields,
            validity_mask=validity_mask,
            metadata={
                "backend": "synthetic",
                "authority_kind": "placeholder",
                "property_basis": "bulk mixture placeholder",
                "warning": (
                    "Synthetic values are only for CLI/Zarr/plot development. "
                    "Replace with official KBC Multiflash Python API results."
                ),
            },
        )


class ThermoModelsBackend:
    """Evaluate the local Multiflash-trained ONNX thermo-model family.

    These models use a pressure-enthalpy basis and are a much closer placeholder
    for the future Multiflash calls than synthetic formulas.
    """

    MODEL_IDS = (
        "ph_phase",
        "ph_rs",
        "ph_t",
        "ph_ro",
        "ph_s",
        "ph_vis_gas_liquid",
        "ph_vis_two_phase",
    )

    MOLECULAR_WEIGHTS_G_PER_MOL = {
        "CO2": 44.0095,
        "CO": 28.0101,
        "H2": 2.01588,
        "N2": 28.0134,
        "AR": 39.948,
        "Ar": 39.948,
        "METHANE": 16.0425,
        "CH4": 16.0425,
    }

    def __init__(self, artifact_version: str = "notebook-parity") -> None:
        self.artifact_root = (
            Path(__file__).resolve().parents[3]
            / "thermo-models"
            / "artifacts"
        )
        self.artifact_version = artifact_version
        self._models: dict[str, tuple[object, dict[str, object], str]] = {}

    def check_license(self) -> BackendInfo:
        missing = [
            model_id
            for model_id in self.MODEL_IDS
            if not (self.artifact_root / model_id / self.artifact_version / "model.onnx").exists()
        ]
        if missing:
            raise SystemExit(
                "ERROR: missing thermo model artifacts: " + ", ".join(missing)
            )
        return BackendInfo(
            backend="thermo-models",
            authority_kind="nn_from_multiflash_data",
            version=self.artifact_version,
            notes="No Multiflash license required; uses local ONNX models trained from Multiflash data.",
        )

    def evaluate_grid(self, request: GridRequest) -> GridResult:
        if request.enthalpy_kj_per_mol is None:
            raise SystemExit("ERROR: thermo-models backend requires --enthalpy-kj-per-mol")

        pressure_pa, enthalpy_kj_per_mol = np.meshgrid(
            request.pressure_pa.astype(np.float64),
            request.enthalpy_kj_per_mol.astype(np.float64),
            indexing="ij",
        )
        row_count = pressure_pa.size
        features = self._build_features(
            pressure_pa.reshape(row_count),
            enthalpy_kj_per_mol.reshape(row_count),
            request.composition,
        )

        phase_scores = self._run_model("ph_phase", features)
        phase_code = np.argmax(_softmax_rows(phase_scores), axis=1)
        gas_fraction = np.clip(self._run_model("ph_rs", features).reshape(row_count), 0.0, 1.0)
        temperature = self._run_model("ph_t", features).reshape(row_count)
        density = self._run_model("ph_ro", features).reshape(row_count)
        entropy = self._run_model("ph_s", features).reshape(row_count)
        viscosity_gas_liquid = self._run_model("ph_vis_gas_liquid", features).reshape(row_count)
        viscosity_two_phase = self._run_model("ph_vis_two_phase", features).reshape(row_count)
        two_phase = (gas_fraction > 1.0e-4) & (gas_fraction < 1.0 - 1.0e-4)
        viscosity = np.where(two_phase, viscosity_two_phase, viscosity_gas_liquid)

        molecular_weight_kg_per_mol = self._molecular_weight_kg_per_mol(request.composition)
        enthalpy_j_per_kg = enthalpy_kj_per_mol.reshape(row_count) * 1000.0 / molecular_weight_kg_per_mol

        shape = pressure_pa.shape
        fields = {
            "gas_fraction": gas_fraction.reshape(shape).astype(np.float32),
            "phase_code": phase_code.reshape(shape).astype(np.float32),
            "temperature_k": temperature.reshape(shape).astype(np.float32),
            "enthalpy_j_per_kg": enthalpy_j_per_kg.reshape(shape).astype(np.float32),
            "enthalpy_kj_per_mol": enthalpy_kj_per_mol.astype(np.float32),
            "entropy_j_per_kg_k": entropy.reshape(shape).astype(np.float32),
            "density_kg_per_m3": density.reshape(shape).astype(np.float32),
            "viscosity_pa_s": viscosity.reshape(shape).astype(np.float32),
            "jt_coefficient_k_per_pa": np.full(shape, np.nan, dtype=np.float32),
        }
        validity_mask = (
            np.isfinite(fields["temperature_k"])
            & np.isfinite(fields["density_kg_per_m3"])
            & np.isfinite(fields["entropy_j_per_kg_k"])
            & np.isfinite(fields["viscosity_pa_s"])
            & (fields["density_kg_per_m3"] > 0.0)
        )

        return GridResult(
            fields=fields,
            validity_mask=validity_mask,
            metadata={
                "backend": "thermo-models",
                "authority_kind": "nn_from_multiflash_data",
                "artifact_root": str(self.artifact_root),
                "artifact_version": self.artifact_version,
                "canonical_domain": "pressure_enthalpy",
                "property_basis": "local ONNX model family trained from Multiflash data",
                "warning": (
                    "Placeholder uses neural-network approximations, not direct KBC Multiflash calls. "
                    "JT coefficient is unavailable from the current ONNX family."
                ),
            },
        )

    def _load_model(self, model_id: str) -> tuple[object, dict[str, object], str]:
        if model_id not in self._models:
            import onnx
            from onnx.reference import ReferenceEvaluator

            model_dir = self.artifact_root / model_id / self.artifact_version
            model = onnx.load(model_dir / "model.onnx")
            config = json.loads((model_dir / "runtime_config.json").read_text())
            input_name = model.graph.input[0].name
            self._models[model_id] = (ReferenceEvaluator(model), config, input_name)
        return self._models[model_id]

    def _run_model(self, model_id: str, feature_values: dict[str, np.ndarray]) -> np.ndarray:
        evaluator, config, input_name = self._load_model(model_id)
        inputs = self._prepare_inputs(feature_values, config)
        raw = np.asarray(evaluator.run(None, {input_name: inputs})[0], dtype=np.float64)
        return self._denormalize(raw, config)

    def _prepare_inputs(
        self, feature_values: dict[str, np.ndarray], config: dict[str, object]
    ) -> np.ndarray:
        columns: list[np.ndarray] = []
        feature_order = config["featureOrder"]
        means = config["featureMeans"]
        std_devs = config["featureStdDevs"]
        assert isinstance(feature_order, list)
        assert isinstance(means, list)
        assert isinstance(std_devs, list)
        for index, item in enumerate(feature_order):
            feature = item["feature"]
            values = feature_values[str(feature)]
            normalized = (values - float(means[index])) / float(std_devs[index])
            columns.append(normalized.astype(np.float32))
        return np.column_stack(columns).astype(np.float32, copy=False)

    def _denormalize(self, raw_outputs: np.ndarray, config: dict[str, object]) -> np.ndarray:
        raw = raw_outputs.astype(np.float64, copy=False)
        transform = str(config["outputTransform"])
        if transform == "none":
            return raw
        if transform == "std_dev_only":
            return raw * float(config["outputStdDev"])
        if transform == "std_dev_then_add":
            return raw * float(config["outputStdDev"]) + float(config["outputOffset"])
        if transform == "viscosity":
            return (
                raw * float(config["outputStdDev"]) + float(config["outputVMin"])
            ) * float(config["outputVMean"])
        if transform == "z_score":
            return raw * float(config["outputStdDev"]) + float(config["outputMean"])
        raise SystemExit(f"ERROR: unsupported output transform '{transform}'")

    def _build_features(
        self,
        pressure_pa: np.ndarray,
        enthalpy_kj_per_mol: np.ndarray,
        composition: Composition,
    ) -> dict[str, np.ndarray]:
        pressure_mpa = pressure_pa / 1.0e6
        values = {
            "PT": pressure_mpa,
            "H": enthalpy_kj_per_mol,
            "P2": np.cbrt(pressure_mpa),
        }
        comp = {name.upper(): fraction for name, fraction in composition.as_dict.items()}
        for name in ("CO2", "CO", "H2", "N2", "AR"):
            values["Ar" if name == "AR" else name] = np.full(
                pressure_pa.shape, comp.get(name, 0.0) * 100.0, dtype=np.float64
            )
        return values

    def _molecular_weight_kg_per_mol(self, composition: Composition) -> float:
        total = 0.0
        for name, fraction in composition.as_dict.items():
            total += fraction * self.MOLECULAR_WEIGHTS_G_PER_MOL.get(name.upper(), 44.0095)
        return total / 1000.0


class KbcMultiflashBackend:
    """Future official KBC Multiflash Python API integration point."""

    def check_license(self) -> BackendInfo:
        raise NotImplementedError(
            "Official KBC Multiflash Python API integration is pending documentation."
        )

    def evaluate_grid(self, request: GridRequest) -> GridResult:
        raise NotImplementedError(
            "Official KBC Multiflash Python API integration is pending documentation."
        )


def backend_by_name(name: str) -> ThermoBackend:
    if name == "synthetic":
        return SyntheticBackend()
    if name == "thermo-models":
        return ThermoModelsBackend()
    if name == "kbc":
        return KbcMultiflashBackend()
    raise SystemExit(f"ERROR: unsupported backend '{name}'")


def _softmax_rows(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values, axis=1, keepdims=True)
    exponentiated = np.exp(shifted)
    return exponentiated / np.sum(exponentiated, axis=1, keepdims=True)
