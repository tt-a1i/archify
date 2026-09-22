#!/usr/bin/env python3
"""Measure local observer-wrapper overhead with a deterministic producer.

This diagnostic runs the same small JSONL-producing child directly and through
observe.py. It checks that the producer writes byte-identical candidate and
HTML files in both modes, then reports paired monotonic process-wall deltas.
It does not invoke a model, a browser, a renderer, or a network service.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time
from typing import Any


OBSERVER = Path(__file__).resolve().with_name("observe.py")
PRODUCER = r"""
import json
from pathlib import Path

candidate = b'{"components":[{"id":"fixed"}],"connections":[],"meta":{"title":"fixed"}}' + bytes([10])
html = b'<!doctype html><meta charset="utf-8"><title>fixed</title><main>fixed</main>' + bytes([10])
events = []
for index in range(16):
    command = "python producer-step.py --index %d" % index
    events.append({"type": "item.started", "item": {
        "id": "cmd-%02d" % index, "type": "command_execution",
        "command": command, "cwd": "."
    }})
    events.append({"type": "item.completed", "item": {
        "id": "cmd-%02d" % index, "type": "command_execution",
        "command": command, "aggregated_output": "ok",
        "exit_code": 0, "status": "completed"
    }})
lines = b"".join(
    json.dumps(event, separators=(",", ":")).encode("utf-8") + bytes([10])
    for event in events
)
Path("candidate.json").write_bytes(candidate)
Path("diagram.html").write_bytes(html)
Path("producer.jsonl").write_bytes(lines)
print(lines.decode("utf-8"), end="", flush=True)
"""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_child(mode: str, root: Path, timeout_seconds: float) -> dict[str, Any]:
    command = [sys.executable, "-c", PRODUCER]
    run_dir = root / "observer-run"
    metadata_path = root / "metadata.json"
    if mode == "observed":
        command = [
            sys.executable,
            str(OBSERVER),
            "--run-dir",
            str(run_dir),
            "--workspace",
            str(root),
            "--metadata",
            str(metadata_path),
            "--timeout-seconds",
            str(timeout_seconds),
            "--",
            *command,
        ]
    started = time.perf_counter_ns()
    result = subprocess.run(
        command,
        cwd=root,
        env={**os.environ, "PYTHONHASHSEED": "0"},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds + 5,
        check=False,
    )
    elapsed_ns = time.perf_counter_ns() - started
    if result.returncode != 0:
        raise RuntimeError(
            f"{mode} producer failed ({result.returncode}): "
            f"{result.stderr.decode('utf-8', 'replace')[-500:]}"
        )
    outputs = {
        name: sha256(root / name)
        for name in ("candidate.json", "diagram.html", "producer.jsonl")
    }
    details: dict[str, Any] = {"mode": mode, "elapsed_ns": elapsed_ns, "outputs": outputs}
    if mode == "observed":
        summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
        details["observer"] = {
            "status": summary.get("status"),
            "event_count": summary.get("event_count"),
            "candidate_count": summary.get("candidate_count"),
        }
    return details


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=5, help="paired measurements (default: 5)")
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, help="optional JSON receipt path")
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error("--repeats must be positive")

    pairs: list[dict[str, Any]] = []
    expected_outputs: dict[str, str] | None = None
    with tempfile.TemporaryDirectory(prefix="archify-observer-overhead-") as temp:
        temp_root = Path(temp)
        metadata = {
            "run_id": "observer-overhead",
            "case_id": "observer-overhead",
            "cohort": "diagnostic",
            "variant_sha": "fixed",
            "target_repo_sha": "fixed",
            "config_hash": "fixed",
            "attempt": 1,
        }
        for pair_number in range(1, args.repeats + 1):
            order = ("direct", "observed") if pair_number % 2 else ("observed", "direct")
            measured: dict[str, dict[str, Any]] = {}
            for mode in order:
                root = temp_root / f"pair-{pair_number}-{mode}"
                root.mkdir(parents=True)
                (root / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
                measured[mode] = run_child(mode, root, args.timeout_seconds)
                outputs = measured[mode]["outputs"]
                if expected_outputs is None:
                    expected_outputs = outputs
                elif outputs != expected_outputs:
                    raise RuntimeError(f"non-deterministic output hashes in pair {pair_number}: {outputs}")
            if measured["direct"]["outputs"] != measured["observed"]["outputs"]:
                raise RuntimeError(f"direct/observed output mismatch in pair {pair_number}")
            pairs.append(
                {
                    "pair": pair_number,
                    "order": list(order),
                    "direct_ns": measured["direct"]["elapsed_ns"],
                    "observed_ns": measured["observed"]["elapsed_ns"],
                    "observer_overhead_ns": (
                        measured["observed"]["elapsed_ns"] - measured["direct"]["elapsed_ns"]
                    ),
                    "observer": measured["observed"].get("observer", {}),
                }
            )

    overheads = [pair["observer_overhead_ns"] for pair in pairs]
    receipt = {
        "schema_version": 1,
        "measurement": "observer-wrapper-overhead",
        "claim": "local observer wrapper wall-time delta for one deterministic producer; not author or model cost",
        "clock": "time.perf_counter_ns monotonic process wall time",
        "repeats": args.repeats,
        "output_sha256": expected_outputs,
        "pairs": pairs,
        "observer_overhead_ns": {
            "median": statistics.median(overheads),
            "min": min(overheads),
            "max": max(overheads),
        },
        "limitations": [
            "Includes Python startup, observer polling/parsing, and evidence writes.",
            "Excludes model, browser, renderer, network, and concurrent author contention.",
            "Diagnostic wrapper cost is not a product performance estimate or authoring-cost result.",
        ],
    }
    payload = json.dumps(receipt, indent=2, sort_keys=True) + chr(10)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
