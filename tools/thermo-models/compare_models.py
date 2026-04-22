#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import onnx
from onnx.reference import ReferenceEvaluator

from dataset_manifest import DEFAULT_MANIFEST, get_dataset_entry, verify_dataset_entry
from model_specs import MODEL_SPECS, ModelSpec
from reference_registry import REFERENCE_RUNTIME_CONFIGS
from runtime_model import denormalize_outputs, prepare_model_inputs, runtime_config_from_payload
from train_model import (
    apply_subset_filter,
    classification_metrics,
    load_training_frame,
    phase_labels,
    physical_density_metrics,
    regression_metrics,
    regression_truth,
)

DEFAULT_REFERENCE_ONNX_ROOT = (
    Path(__file__).resolve().parents[3] / "phase-envelope-generator" / "frontend" / "public" / "nn"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare trained thermo models against the reference ONNX family on the shared dataset."
    )
    parser.add_argument(
        "--model",
        choices=["all", *sorted(MODEL_SPECS.keys())],
        required=True,
        help="Model identifier to compare, or 'all' for the full model family.",
    )
    parser.add_argument(
        "--candidate-dir",
        type=Path,
        default=None,
        help="Directory containing model.onnx and runtime_config.json for a single trained candidate.",
    )
    parser.add_argument(
        "--candidate-root",
        type=Path,
        default=Path("artifacts"),
        help="Root directory containing artifacts/<model-id>/<version>/ for family comparisons.",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="Artifact version used under the candidate root. Required for --model all.",
    )
    parser.add_argument(
        "--reference-root",
        type=Path,
        default=DEFAULT_REFERENCE_ONNX_ROOT,
        help=f"Directory containing the reference ONNX family (default: {DEFAULT_REFERENCE_ONNX_ROOT})",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Path to dataset manifest (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--sample-count",
        type=int,
        default=2048,
        help="Number of rows to sample after preprocessing.",
    )
    parser.add_argument(
        "--limit-rows",
        type=int,
        default=None,
        help="Optional row limit loaded from the CSV before sampling. Defaults to max(sample_count, 4096).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for row sampling.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=None,
        help="Optional output path for the comparison summary JSON.",
    )
    return parser.parse_args()


def run_onnx_model(onnx_path: Path, inputs: np.ndarray) -> np.ndarray:
    model = onnx.load(onnx_path)
    evaluator = ReferenceEvaluator(model)
    input_name = model.graph.input[0].name
    outputs = evaluator.run(None, {input_name: inputs})
    return np.asarray(outputs[0], dtype=np.float64)


def softmax_rows(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values, axis=1, keepdims=True)
    exponentiated = np.exp(shifted)
    return exponentiated / np.sum(exponentiated, axis=1, keepdims=True)


def sample_frame_rows(row_count: int, sample_count: int, seed: int) -> np.ndarray:
    if sample_count <= 0:
        raise SystemExit("ERROR: --sample-count must be positive")
    if sample_count >= row_count:
        return np.arange(row_count)
    rng = np.random.RandomState(seed)
    return np.sort(rng.choice(row_count, size=sample_count, replace=False))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def candidate_dir_for_model(args: argparse.Namespace, spec: ModelSpec) -> Path:
    if args.candidate_dir is not None:
        return args.candidate_dir.resolve()
    if args.version is None:
        raise SystemExit(
            "ERROR: provide --candidate-dir for a single model comparison or --version for candidate-root lookups"
        )
    return (args.candidate_root / spec.model_id / args.version).resolve()


def compare_single_model(args: argparse.Namespace, spec: ModelSpec) -> dict[str, Any]:
    dataset_entry = get_dataset_entry(args.manifest.resolve(), spec.dataset_id)
    dataset_sha256 = verify_dataset_entry(dataset_entry)

    candidate_dir = candidate_dir_for_model(args, spec)
    candidate_config = runtime_config_from_payload(
        json.loads((candidate_dir / "runtime_config.json").read_text())
    )
    candidate_model_path = candidate_dir / "model.onnx"

    reference_config = runtime_config_from_payload(REFERENCE_RUNTIME_CONFIGS[spec.model_id])
    reference_model_path = args.reference_root.resolve() / spec.reference_onnx_filename

    limit_rows = args.limit_rows if args.limit_rows is not None else max(args.sample_count, 4096)
    frame = load_training_frame(spec, dataset_entry.path, limit_rows=limit_rows)
    frame = apply_subset_filter(spec, frame)
    sampled_indices = sample_frame_rows(len(frame), args.sample_count, args.seed)
    sample = frame.iloc[sampled_indices].copy()

    candidate_inputs = prepare_model_inputs(sample, candidate_config)
    reference_inputs = prepare_model_inputs(sample, reference_config)

    candidate_raw = run_onnx_model(candidate_model_path, candidate_inputs)
    reference_raw = run_onnx_model(reference_model_path, reference_inputs)

    comparison: dict[str, Any] = {
        "model": spec.model_id,
        "dataset": {
            "datasetId": dataset_entry.dataset_id,
            "rowsLoaded": int(len(frame)),
            "rowsCompared": int(len(sample)),
            "seed": args.seed,
            "sha256": dataset_sha256,
            "subsetKind": spec.subset_kind,
        },
        "candidate": {
            "dir": str(candidate_dir),
            "runtimeConfig": str(candidate_dir / "runtime_config.json"),
        },
        "reference": {
            "onnx": str(reference_model_path),
        },
    }

    if spec.task_kind == "classification":
        truth = phase_labels(sample)
        candidate_scores = candidate_raw
        reference_scores = reference_raw
        candidate_probabilities = softmax_rows(candidate_scores)
        reference_probabilities = softmax_rows(reference_scores)
        comparison["candidate"]["metricsVsTruth"] = classification_metrics(
            truth, candidate_probabilities
        )
        comparison["reference"]["metricsVsTruth"] = classification_metrics(
            truth, reference_probabilities
        )
        comparison["candidateVsReference"] = {
            "labelAgreement": float(
                np.mean(
                    np.argmax(candidate_scores, axis=1)
                    == np.argmax(reference_scores, axis=1)
                )
            ),
            "probabilityRmse": float(
                np.sqrt(np.mean(np.square(candidate_probabilities - reference_probabilities)))
            ),
        }
    else:
        truth = regression_truth(spec, sample)
        candidate_values = denormalize_outputs(candidate_raw.reshape(-1), candidate_config)
        reference_values = denormalize_outputs(reference_raw.reshape(-1), reference_config)
        comparison["candidate"]["metricsVsTruth"] = physical_density_metrics(truth, candidate_values)
        comparison["reference"]["metricsVsTruth"] = physical_density_metrics(truth, reference_values)
        comparison["candidateVsReference"] = {
            "valueDelta": regression_metrics(reference_values, candidate_values),
            "mean_absolute_relative_difference_vs_reference": float(
                np.mean(
                    np.abs(candidate_values - reference_values)
                    / np.clip(np.abs(reference_values), 1e-12, None)
                )
            ),
            "max_absolute_relative_difference_vs_reference": float(
                np.max(
                    np.abs(candidate_values - reference_values)
                    / np.clip(np.abs(reference_values), 1e-12, None)
                )
            ),
        }

    comparison["configChecks"] = {
        "featureOrderMatches": [
            feature.feature for feature in candidate_config.feature_order
        ]
        == [feature.feature for feature in reference_config.feature_order],
        "outputTransformMatches": candidate_config.output_transform
        == reference_config.output_transform,
        "outputUnitMatches": candidate_config.output_unit == reference_config.output_unit,
    }

    return comparison


def main() -> int:
    args = parse_args()
    if args.model == "all" and args.version is None:
        raise SystemExit("ERROR: --version is required when comparing the full model family")

    model_ids = sorted(MODEL_SPECS.keys()) if args.model == "all" else [args.model]
    comparisons = [compare_single_model(args, MODEL_SPECS[model_id]) for model_id in model_ids]

    payload: dict[str, Any]
    if len(comparisons) == 1:
        payload = comparisons[0]
    else:
        payload = {"comparisons": comparisons}

    if args.output_json is not None:
        write_json(args.output_json.resolve(), payload)

    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
