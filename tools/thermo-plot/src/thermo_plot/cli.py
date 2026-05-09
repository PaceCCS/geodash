from __future__ import annotations

import argparse
import json
from pathlib import Path

from .backend import GridRequest, backend_by_name
from .config import load_composition, parse_range
from .plotting import plot_field
from .store import read_metadata, write_grid


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="thermo-plot",
        description="Generate and plot cached thermodynamic grids.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check-license", help="Check backend/license status.")
    check.add_argument(
        "--backend", choices=["synthetic", "thermo-models", "kbc"], default="thermo-models"
    )

    generate = subparsers.add_parser("generate", help="Generate a thermodynamic Zarr grid.")
    generate.add_argument(
        "--backend", choices=["synthetic", "thermo-models", "kbc"], default="thermo-models"
    )
    generate.add_argument("--mfl", type=Path, default=None)
    generate.add_argument("--databank-path", type=Path, default=None)
    generate.add_argument("--composition", type=Path, default=None)
    generate.add_argument("--pressure-pa", required=True, help="start:step:stop or comma values")
    state_axis = generate.add_mutually_exclusive_group(required=True)
    state_axis.add_argument("--temperature-k", help="start:step:stop or comma values")
    state_axis.add_argument("--enthalpy-kj-per-mol", help="start:step:stop or comma values")
    generate.add_argument("--output", type=Path, required=True)
    generate.add_argument("--overwrite", action="store_true")

    plot = subparsers.add_parser("plot", help="Plot one field from a generated Zarr grid.")
    plot.add_argument("store", type=Path)
    plot.add_argument("--field", default="density_kg_per_m3")
    plot.add_argument("--output", type=Path, default=None)
    plot.add_argument(
        "--isolines",
        type=int,
        default=10,
        help="Number of property isolines to overlay. Use 0 to disable.",
    )
    plot.add_argument(
        "--no-phase-boundaries",
        action="store_true",
        help="Disable phase boundary overlays from phase_code.",
    )

    inspect = subparsers.add_parser("inspect", help="Print Zarr grid metadata.")
    inspect.add_argument("store", type=Path)

    return parser


def command_check_license(args: argparse.Namespace) -> None:
    info = backend_by_name(args.backend).check_license()
    print(json.dumps(info.__dict__, indent=2, sort_keys=True))


def command_generate(args: argparse.Namespace) -> None:
    backend = backend_by_name(args.backend)
    request = GridRequest(
        pressure_pa=parse_range(args.pressure_pa),
        temperature_k=None if args.temperature_k is None else parse_range(args.temperature_k),
        enthalpy_kj_per_mol=(
            None
            if args.enthalpy_kj_per_mol is None
            else parse_range(args.enthalpy_kj_per_mol)
        ),
        composition=load_composition(args.composition),
        mfl_path=args.mfl,
        databank_path=args.databank_path,
    )
    result = backend.evaluate_grid(request)
    write_grid(args.output, request, result, overwrite=args.overwrite)
    print(f"Wrote {args.output}")


def command_plot(args: argparse.Namespace) -> None:
    output = args.output
    if output is None:
        output = args.store / "plots" / f"{args.field}.png"
    plot_field(
        args.store,
        args.field,
        output,
        isolines=args.isolines,
        phase_boundaries=not args.no_phase_boundaries,
    )
    print(f"Wrote {output}")


def command_inspect(args: argparse.Namespace) -> None:
    print(json.dumps(read_metadata(args.store), indent=2, sort_keys=True))


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "check-license":
        command_check_license(args)
    elif args.command == "generate":
        command_generate(args)
    elif args.command == "plot":
        command_plot(args)
    elif args.command == "inspect":
        command_inspect(args)
    else:
        parser.error(f"unknown command {args.command}")


if __name__ == "__main__":
    main()
