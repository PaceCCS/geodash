#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dataset_manifest import DEFAULT_MANIFEST, PLACEHOLDER_HASHES, compute_sha256, parse_manifest


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check local thermodynamic dataset files against recorded SHA-256 hashes."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Path to dataset manifest (default: {DEFAULT_MANIFEST})",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    entries = parse_manifest(args.manifest)

    all_ok = True
    for entry in entries.values():
        if not entry.path.exists():
            print(f"ERROR: {entry.dataset_id}: missing file at {entry.path}")
            all_ok = False
            continue

        if not entry.path.is_file():
            print(f"ERROR: {entry.dataset_id}: path is not a regular file: {entry.path}")
            all_ok = False
            continue

        actual_sha256 = compute_sha256(entry.path)

        if entry.sha256 in PLACEHOLDER_HASHES:
            print(
                f"ERROR: {entry.dataset_id}: manifest does not yet record an expected sha256"
            )
            print(f"  file:   {entry.path}")
            print(f"  actual: {actual_sha256}")
            all_ok = False
            continue

        if actual_sha256 != entry.sha256:
            print(f"ERROR: {entry.dataset_id}: sha256 mismatch")
            print(f"  file:     {entry.path}")
            print(f"  expected: {entry.sha256}")
            print(f"  actual:   {actual_sha256}")
            all_ok = False
            continue

        print(f"OK: {entry.dataset_id}: {entry.path} sha256 matches manifest")

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
