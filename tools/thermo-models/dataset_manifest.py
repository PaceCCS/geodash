from __future__ import annotations

import hashlib
import tomllib
from dataclasses import dataclass
from pathlib import Path

PLACEHOLDER_HASHES = {"", "todo", "replace_me", "replace-me", "<sha256>"}
DEFAULT_MANIFEST = Path(__file__).with_name("datasets") / "manifest.toml"


@dataclass(frozen=True)
class DatasetEntry:
    dataset_id: str
    path: Path
    sha256: str
    rows: int | None
    description: str | None
    columns: tuple[str, ...]
    shared_by: tuple[str, ...]


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_manifest(manifest_path: Path) -> dict[str, DatasetEntry]:
    try:
        manifest = tomllib.loads(manifest_path.read_text())
    except FileNotFoundError:
        raise SystemExit(f"ERROR: dataset manifest not found: {manifest_path}")

    if manifest.get("format_version") != 1:
        raise SystemExit(
            f"ERROR: unsupported manifest format_version in {manifest_path}"
        )

    datasets = manifest.get("datasets")
    if not isinstance(datasets, dict) or not datasets:
        raise SystemExit(f"ERROR: no datasets defined in {manifest_path}")

    entries: dict[str, DatasetEntry] = {}
    manifest_dir = manifest_path.parent

    for dataset_id, raw in datasets.items():
        if not isinstance(raw, dict):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} is not a table"
            )

        path_value = raw.get("path")
        if not isinstance(path_value, str) or not path_value:
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} is missing 'path'"
            )

        dataset_path = Path(path_value)
        if not dataset_path.is_absolute():
            dataset_path = manifest_dir / dataset_path

        sha256_value = raw.get("sha256", "")
        if not isinstance(sha256_value, str):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} has a non-string 'sha256'"
            )

        rows_value = raw.get("rows")
        if rows_value is not None and not isinstance(rows_value, int):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} has a non-integer 'rows'"
            )

        description_value = raw.get("description")
        if description_value is not None and not isinstance(description_value, str):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} has a non-string 'description'"
            )

        columns_value = raw.get("columns", [])
        if not isinstance(columns_value, list) or not all(
            isinstance(column, str) for column in columns_value
        ):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} has invalid 'columns'"
            )

        shared_by_value = raw.get("shared_by", [])
        if not isinstance(shared_by_value, list) or not all(
            isinstance(item, str) for item in shared_by_value
        ):
            raise SystemExit(
                f"ERROR: dataset '{dataset_id}' in {manifest_path} has invalid 'shared_by'"
            )

        entries[dataset_id] = DatasetEntry(
            dataset_id=dataset_id,
            path=dataset_path,
            sha256=sha256_value.strip().lower(),
            rows=rows_value,
            description=description_value,
            columns=tuple(columns_value),
            shared_by=tuple(shared_by_value),
        )

    return entries


def get_dataset_entry(manifest_path: Path, dataset_id: str) -> DatasetEntry:
    entries = parse_manifest(manifest_path)
    try:
        return entries[dataset_id]
    except KeyError as exc:
        known_ids = ", ".join(sorted(entries))
        raise SystemExit(
            f"ERROR: dataset '{dataset_id}' not found in {manifest_path}. Known datasets: {known_ids}"
        ) from exc


def verify_dataset_entry(entry: DatasetEntry) -> str:
    if not entry.path.exists():
        raise SystemExit(f"ERROR: {entry.dataset_id}: missing file at {entry.path}")

    if not entry.path.is_file():
        raise SystemExit(
            f"ERROR: {entry.dataset_id}: path is not a regular file: {entry.path}"
        )

    actual_sha256 = compute_sha256(entry.path)

    if entry.sha256 in PLACEHOLDER_HASHES:
        raise SystemExit(
            "\n".join(
                [
                    f"ERROR: {entry.dataset_id}: manifest does not yet record an expected sha256",
                    f"  file:   {entry.path}",
                    f"  actual: {actual_sha256}",
                ]
            )
        )

    if actual_sha256 != entry.sha256:
        raise SystemExit(
            "\n".join(
                [
                    f"ERROR: {entry.dataset_id}: sha256 mismatch",
                    f"  file:     {entry.path}",
                    f"  expected: {entry.sha256}",
                    f"  actual:   {actual_sha256}",
                ]
            )
        )

    return actual_sha256
