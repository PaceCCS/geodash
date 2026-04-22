from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSpec:
    feature: str
    unit: str


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    display_name: str
    property_name: str
    property_unit: str
    dataset_id: str
    source_columns: tuple[str, ...]
    feature_order: tuple[FeatureSpec, ...]
    hidden_sizes: tuple[int, ...]
    hidden_activation: str
    output_activation: str
    learning_rate: float
    learning_rate_after_decay: float
    learning_rate_decay_epoch: int
    weight_decay: float
    default_epochs: int
    default_batch_size: int
    default_test_size: float
    output_transform: str
    task_kind: str
    subset_kind: str
    target_kind: str
    output_size: int
    reference_onnx_filename: str


DEFAULT_FEATURE_ORDER = (
    FeatureSpec("PT", "MPa"),
    FeatureSpec("H", "kJ/mol"),
    FeatureSpec("CO2", "%"),
    FeatureSpec("CO", "%"),
    FeatureSpec("H2", "%"),
    FeatureSpec("N2", "%"),
    FeatureSpec("Ar", "%"),
    FeatureSpec("P2", "MPa^(1/3)"),
)


COMMON_MODEL_KWARGS = {
    "dataset_id": "gerg2008_1m",
    "feature_order": DEFAULT_FEATURE_ORDER,
    "learning_rate": 0.001,
    "learning_rate_after_decay": 0.0005,
    "learning_rate_decay_epoch": 150,
    "weight_decay": 0.0,
    "default_epochs": 300,
    "default_batch_size": 200,
}


PH_PHASE_MODEL = ModelSpec(
    model_id="ph_phase",
    display_name="Phase",
    property_name="phase",
    property_unit="dimensionless",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "RS"),
    hidden_sizes=(5, 5),
    hidden_activation="tanh",
    output_activation="tanh",
    default_test_size=0.2,
    output_transform="none",
    task_kind="classification",
    subset_kind="all",
    target_kind="phase_class",
    output_size=3,
    reference_onnx_filename="PH_Phase.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_RS_MODEL = ModelSpec(
    model_id="ph_rs",
    display_name="Gas Fraction (RS)",
    property_name="rs",
    property_unit="dimensionless",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "RS"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="std_dev_only",
    task_kind="regression",
    subset_kind="all",
    target_kind="rs",
    output_size=1,
    reference_onnx_filename="PH_RS.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_DENSITY_MODEL = ModelSpec(
    model_id="ph_ro",
    display_name="Density",
    property_name="density",
    property_unit="kg/m³",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "RS", "ROG", "ROHL"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="std_dev_then_add",
    task_kind="regression",
    subset_kind="all",
    target_kind="density",
    output_size=1,
    reference_onnx_filename="PH_RO.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_ENTROPY_MODEL = ModelSpec(
    model_id="ph_s",
    display_name="Entropy",
    property_name="entropy",
    property_unit="J/(kg·K)",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "SE"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="std_dev_only",
    task_kind="regression",
    subset_kind="all",
    target_kind="entropy",
    output_size=1,
    reference_onnx_filename="PH_S.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_TEMPERATURE_MODEL = ModelSpec(
    model_id="ph_t",
    display_name="Temperature",
    property_name="temperature",
    property_unit="K",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "TM"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="std_dev_only",
    task_kind="regression",
    subset_kind="all",
    target_kind="temperature",
    output_size=1,
    reference_onnx_filename="PH_T.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_VISCOSITY_GAS_LIQUID_MODEL = ModelSpec(
    model_id="ph_vis_gas_liquid",
    display_name="Viscosity (Gas/Liquid)",
    property_name="viscosity_gas_liquid",
    property_unit="Pa·s",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "RS", "2phase", "VISG", "VISHL"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="viscosity",
    task_kind="regression",
    subset_kind="non_two_phase",
    target_kind="viscosity_gas_liquid",
    output_size=1,
    reference_onnx_filename="PH_VIS_GasLiquid.onnx",
    **COMMON_MODEL_KWARGS,
)


PH_VISCOSITY_TWO_PHASE_MODEL = ModelSpec(
    model_id="ph_vis_two_phase",
    display_name="Viscosity (Two-Phase)",
    property_name="viscosity_two_phase",
    property_unit="Pa·s",
    source_columns=("PT", "H", "CO2", "CO", "H2", "N2", "Ar", "RS", "2phase", "VISG", "VISHL"),
    hidden_sizes=(20, 20),
    hidden_activation="relu",
    output_activation="identity",
    default_test_size=0.3,
    output_transform="viscosity",
    task_kind="regression",
    subset_kind="two_phase",
    target_kind="viscosity_two_phase",
    output_size=1,
    reference_onnx_filename="PH_VIS_TwoPhase.onnx",
    **COMMON_MODEL_KWARGS,
)


MODEL_SPECS = {
    spec.model_id: spec
    for spec in (
        PH_PHASE_MODEL,
        PH_RS_MODEL,
        PH_DENSITY_MODEL,
        PH_ENTROPY_MODEL,
        PH_TEMPERATURE_MODEL,
        PH_VISCOSITY_GAS_LIQUID_MODEL,
        PH_VISCOSITY_TWO_PHASE_MODEL,
    )
}
