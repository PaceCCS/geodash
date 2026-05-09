from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from .store import open_grid, read_metadata


def plot_field(
    store: Path,
    field: str,
    output: Path,
    *,
    isolines: int,
    phase_boundaries: bool,
) -> None:
    root = open_grid(store)
    metadata = read_metadata(store)

    pressure_pa = np.asarray(root["axes/pressure_pa"][:], dtype=np.float64)
    state_axis_name = next(name for name in root["axes"].keys() if name != "pressure_pa")
    state_axis = np.asarray(root[f"axes/{state_axis_name}"][:], dtype=np.float64)
    if field not in root["fields"]:
        available = ", ".join(sorted(root["fields"].keys()))
        raise SystemExit(f"ERROR: field '{field}' not found. Available fields: {available}")
    values = np.asarray(root[f"fields/{field}"][:], dtype=np.float64)

    pressure_mpa = pressure_pa / 1.0e6
    field_meta = metadata.get("fields", {}).get(field, {})
    unit = field_meta.get("unit", "")
    axis_meta = metadata.get("axes", {}).get(state_axis_name, {})
    axis_unit = axis_meta.get("unit", "")
    x_values = state_axis - 273.15 if state_axis_name == "temperature_k" else state_axis
    x_label = (
        "Temperature [degC]"
        if state_axis_name == "temperature_k"
        else f"{state_axis_name.replace('_', ' ')} [{axis_unit}]"
    )

    fig, ax = plt.subplots(figsize=(8, 5), constrained_layout=True)
    mesh = ax.pcolormesh(x_values, pressure_mpa, values, shading="auto")
    colorbar = fig.colorbar(mesh, ax=ax)
    colorbar.set_label(f"{field} [{unit}]" if unit else field)

    if isolines > 0:
        _add_isolines(ax, x_values, pressure_mpa, values, isolines)

    if phase_boundaries and "phase_code" in root["fields"]:
        phase_code = np.asarray(root["fields/phase_code"][:], dtype=np.float64)
        _add_phase_boundaries(ax, x_values, pressure_mpa, phase_code)

    ax.set_xlabel(x_label)
    ax.set_ylabel("Pressure [MPa]")
    ax.set_title(field.replace("_", " "))

    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=160)
    plt.close(fig)


def _add_isolines(
    ax: plt.Axes,
    x_values: np.ndarray,
    pressure_mpa: np.ndarray,
    values: np.ndarray,
    isolines: int,
) -> None:
    finite_values = values[np.isfinite(values)]
    if finite_values.size == 0:
        return
    if float(np.nanmin(finite_values)) == float(np.nanmax(finite_values)):
        return

    contours = ax.contour(
        x_values,
        pressure_mpa,
        values,
        levels=isolines,
        colors="white",
        linewidths=0.55,
        alpha=0.72,
    )
    ax.clabel(contours, inline=True, fontsize=7, fmt="%g")


def _add_phase_boundaries(
    ax: plt.Axes,
    x_values: np.ndarray,
    pressure_mpa: np.ndarray,
    phase_code: np.ndarray,
) -> None:
    finite_values = phase_code[np.isfinite(phase_code)]
    if np.unique(finite_values).size < 2:
        return

    ax.contour(
        x_values,
        pressure_mpa,
        phase_code,
        levels=[0.5, 1.5],
        colors="black",
        linewidths=1.2,
        alpha=0.9,
    )
