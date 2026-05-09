from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .backend import Composition


def parse_range(spec: str) -> np.ndarray:
    parts = spec.split(":")
    if len(parts) == 1:
        values = [float(value) for value in spec.split(",") if value]
        if not values:
            raise SystemExit("ERROR: empty axis specification")
        return np.asarray(values, dtype=np.float64)
    if len(parts) != 3:
        raise SystemExit(
            f"ERROR: invalid range '{spec}', expected start:step:stop or comma values"
        )
    start, step, stop = (float(part) for part in parts)
    if step <= 0:
        raise SystemExit("ERROR: axis step must be positive")
    values = np.arange(start, stop + step * 0.5, step, dtype=np.float64)
    if values.size == 0:
        raise SystemExit(f"ERROR: range '{spec}' produced no values")
    return values


def load_composition(path: Path | None) -> Composition:
    if path is None:
        return Composition(basis="mole_fraction", components=("CO2",), fractions=(1.0,))

    payload = json.loads(path.read_text())
    basis = str(payload.get("basis", "mole_fraction"))
    components_payload = payload.get("components")
    if not isinstance(components_payload, dict) or not components_payload:
        raise SystemExit("ERROR: composition JSON must contain a non-empty components object")

    components = tuple(str(key) for key in components_payload)
    fractions = tuple(float(components_payload[key]) for key in components)
    total = sum(fractions)
    if total <= 0:
        raise SystemExit("ERROR: composition fractions must sum to a positive value")
    normalized = tuple(value / total for value in fractions)
    return Composition(basis=basis, components=components, fractions=normalized)
