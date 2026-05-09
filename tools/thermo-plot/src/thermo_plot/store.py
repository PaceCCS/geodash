from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import zarr

from .backend import GridRequest, GridResult


def write_grid(
    output: Path,
    request: GridRequest,
    result: GridResult,
    *,
    overwrite: bool,
) -> None:
    if output.exists():
        if not overwrite:
            raise SystemExit(f"ERROR: output exists, pass --overwrite: {output}")
        if output.is_dir():
            shutil.rmtree(output)
        else:
            output.unlink()

    root = zarr.open_group(output, mode="w")
    axes = root.create_group("axes")
    fields = root.create_group("fields")
    state_axis_name, state_axis_values, state_axis_unit = _state_axis(request)

    axes.create_array("pressure_pa", data=request.pressure_pa, chunks=(request.pressure_pa.size,))
    axes.create_array(state_axis_name, data=state_axis_values, chunks=(state_axis_values.size,))

    chunks = (
        min(max(1, request.pressure_pa.size), 128),
        min(max(1, state_axis_values.size), 128),
    )
    for name, values in result.fields.items():
        fields.create_array(name, data=values, chunks=chunks)
    fields.create_array(
        "validity_mask", data=result.validity_mask.astype(np.uint8), chunks=chunks
    )

    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "format": "thermo-plot/0.1",
        "axes": {
            "pressure_pa": {
                "unit": "Pa",
                "size": int(request.pressure_pa.size),
                "min": float(np.min(request.pressure_pa)),
                "max": float(np.max(request.pressure_pa)),
            },
            state_axis_name: {
                "unit": state_axis_unit,
                "size": int(state_axis_values.size),
                "min": float(np.min(state_axis_values)),
                "max": float(np.max(state_axis_values)),
            },
        },
        "composition": {
            "basis": request.composition.basis,
            "components": request.composition.as_dict,
        },
        "inputs": {
            "mfl_path": None if request.mfl_path is None else str(request.mfl_path),
            "databank_path": None
            if request.databank_path is None
            else str(request.databank_path),
        },
        "fields": {
            "gas_fraction": {"unit": "dimensionless"},
            "phase_code": {"unit": "class"},
            "temperature_k": {"unit": "K"},
            "enthalpy_j_per_kg": {"unit": "J/kg"},
            "enthalpy_kj_per_mol": {"unit": "kJ/mol"},
            "entropy_j_per_kg_k": {"unit": "J/(kg K)"},
            "density_kg_per_m3": {"unit": "kg/m3"},
            "viscosity_pa_s": {"unit": "Pa s"},
            "jt_coefficient_k_per_pa": {"unit": "K/Pa"},
            "validity_mask": {"unit": "bool"},
        },
        "source": result.metadata,
    }
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")


def read_metadata(store: Path) -> dict[str, Any]:
    return json.loads((store / "metadata.json").read_text())


def open_grid(store: Path) -> zarr.Group:
    return zarr.open_group(store, mode="r")


def _state_axis(request: GridRequest) -> tuple[str, np.ndarray, str]:
    if request.enthalpy_kj_per_mol is not None:
        return "enthalpy_kj_per_mol", request.enthalpy_kj_per_mol, "kJ/mol"
    if request.temperature_k is not None:
        return "temperature_k", request.temperature_k, "K"
    raise SystemExit("ERROR: either temperature_k or enthalpy_kj_per_mol axis is required")
