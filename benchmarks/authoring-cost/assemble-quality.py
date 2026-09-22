#!/usr/bin/env python3
"""Assemble reviewed holdout receipts; never infer semantic or visual success."""
import argparse
import json
from pathlib import Path
from typing import Any, Mapping


def read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def read_review(directory: Path) -> tuple[Mapping[str, Any], str | None]:
    """Prefer a valid adjudicated receipt while retaining the original fallback."""
    for relative in (
        Path("independent-review/adjudicated-review.json"),
        Path("independent-review/review.json"),
        Path("review.json"),
    ):
        path = directory / relative
        if not path.exists():
            continue
        value = read(path)
        if isinstance(value, Mapping):
            return value, relative.as_posix()
    return {}, None


def _checks(machine: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    checks = machine.get("checks", [])
    return [check for check in checks if isinstance(check, Mapping)] if isinstance(checks, list) else []


def _hash_matches(expected: Any, actual: Any) -> bool | None:
    if not isinstance(expected, str) or not isinstance(actual, str):
        return None
    return expected == actual


def native_status(machine: Mapping[str, Any], workspace: Path, hashes: Mapping[str, Any], legacy: bool) -> str:
    """Return passed/failed/unknown without treating missing native evidence as failure."""
    if legacy:
        identity = machine.get("external_identity")
        native = read(workspace / "diagram.visual-check.json")
        if not isinstance(identity, Mapping) or not native:
            return "unknown"
        identity_status = identity.get("status")
        if identity_status != "passed":
            return "failed" if identity_status == "failed" else "unknown"
        expected = hashes.get("diagram.html")
        identity_hash = identity.get("artifact_sha256")
        native_hash = native.get("artifact", {}).get("sha256") if isinstance(native.get("artifact"), Mapping) else None
        for match in (_hash_matches(expected, identity_hash), _hash_matches(expected, native_hash), _hash_matches(identity_hash, native_hash)):
            if match is False:
                return "failed"
            if match is None:
                return "unknown"
        native_ok = native.get("ok")
        return "passed" if native_ok is True else "failed" if native_ok is False else "unknown"

    native = read(workspace / "diagram.finalize.json")
    if not native:
        return "unknown"
    if native.get("ok") is False:
        return "failed"
    expected_candidate = hashes.get("candidate.json")
    expected_artifact = hashes.get("diagram.html")
    specification = native.get("specification") if isinstance(native.get("specification"), Mapping) else {}
    artifact = native.get("artifact") if isinstance(native.get("artifact"), Mapping) else {}
    matches = (
        _hash_matches(expected_candidate, specification.get("sha256")),
        _hash_matches(expected_artifact, artifact.get("sha256")),
    )
    if any(match is False for match in matches):
        return "failed"
    if any(match is None for match in matches):
        return "unknown"
    native_ok = native.get("ok")
    return "passed" if native_ok is True else "failed" if native_ok is False else "unknown"


def common_status(machine: Mapping[str, Any], legacy: bool) -> str:
    checks = _checks(machine)
    final = [check for check in checks if isinstance(check.get("name"), str) and check["name"].startswith("common-final")]
    required = {"common-final-check", "common-final-browser", "common-final-captures", "common-final-1920"}
    if not legacy:
        required.add("common-final-validate")
    present = {check.get("name") for check in final}
    if any(check.get("name") in required and check.get("exit_code") not in (0, None) for check in final):
        return "failed"
    if any(check.get("name") in required and check.get("exit_code") is None for check in final):
        return "unknown"
    if not required <= present or machine.get("author_bytes_unchanged") is not True:
        return "unknown" if machine.get("author_bytes_unchanged") is not False else "failed"
    return "passed"


def review_status(review: Mapping[str, Any]) -> tuple[str, str, str]:
    semantic = review.get("semantic") if isinstance(review.get("semantic"), Mapping) else {}
    visual = review.get("visual") if isinstance(review.get("visual"), Mapping) else {}
    semantic_status = semantic.get("status", "unknown")
    visual_status = visual.get("status", "unknown")
    if semantic_status == "passed" and visual_status == "passed":
        independent = "passed"
    elif semantic_status == "failed" or visual_status == "failed":
        independent = "failed"
    else:
        independent = "unknown"
    return semantic_status, visual_status, independent


def _duration_sum(checks: list[Mapping[str, Any]]) -> float | None:
    values = [check.get("duration_ms") for check in checks if isinstance(check.get("duration_ms"), (int, float)) and not isinstance(check.get("duration_ms"), bool)]
    return sum(values) if values and len(values) == len(checks) else None


def assemble_run(directory: Path, sessions: Path) -> dict[str, Any] | None:
    review, review_path = read_review(directory)
    machine = read(directory / "machine-review/report.json")
    summary = read(directory / "summary.json")
    if not all(isinstance(value, Mapping) and value for value in (review, machine, summary)):
        return None
    workspace = sessions / directory.name
    hashes = machine.get("frozen_hashes") if isinstance(machine.get("frozen_hashes"), Mapping) else {}
    legacy = machine.get("legacy_A") is True
    native = native_status(machine, workspace, hashes, legacy)
    common = common_status(machine, legacy)
    checks = _checks(machine)
    final = [check for check in checks if isinstance(check.get("name"), str) and check["name"].startswith("common-final")]
    first = [check for check in checks if isinstance(check.get("name"), str) and check["name"].startswith("common-first")]
    complete_snapshots = summary.get("candidate_snapshots")
    repairs = max(0, sum(item.get("complete") is True for item in complete_snapshots) - 1) if isinstance(complete_snapshots, list) else None
    first_status = review.get("first_candidate_status", {"status": "unknown"})
    if isinstance(first_status, str):
        first_status = {"status": first_status}
    if not isinstance(first_status, Mapping):
        first_status = {"status": "unknown"}
    if not legacy and any(check.get("exit_code") not in (0, None) for check in first):
        first_status = {"status": "failed", "reason": "First complete snapshot failed a common machine gate."}
    previous = read(directory / "quality.json")
    if not isinstance(previous, Mapping):
        previous = {}
    if first_status.get("status") == "unknown" and isinstance(previous.get("first_candidate"), Mapping) and previous["first_candidate"].get("status") == "failed":
        first_status = previous["first_candidate"]
    semantic_status, visual_status, independent = review_status(review)
    accepted = native == "passed" and common == "passed" and independent == "passed" and repairs is not None and repairs <= 3 and summary.get("timed_out") is not True
    protocol = "passed" if repairs is not None and repairs <= 3 else "failed" if repairs is not None else "unknown"
    explicit_failure = (
        native == "failed"
        or common == "failed"
        or independent == "failed"
        or protocol == "failed"
        or summary.get("timed_out") is True
    )
    quality = dict(previous)
    quality.update(
        # Missing evidence leaves the final result unknown; only an explicit
        # hard-gate failure (or timeout/repair limit) makes it failed. Neither
        # state can be mistaken for a successful accepted artifact.
        status="failed" if explicit_failure else "passed" if accepted else "unknown",
        native_acceptance=native,
        common_acceptance=common,
        semantic=review.get("semantic", {"status": semantic_status}),
        visual=review.get("visual", {"status": visual_status}),
        independent_review_status=independent,
        first_candidate=dict(first_status),
        repair_edits=repairs,
        protocol_acceptance=protocol,
        review_duration_ms=review.get("duration_ms"),
        final_machine_duration_ms=_duration_sum(final),
        first_snapshot_audit_ms=_duration_sum(first),
        independent_review_path=review_path,
    )
    (directory / "quality.json").write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"run_id": directory.name, "status": quality["status"], "native": native, "common": common, "repairs": repairs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--sessions', type=Path, required=True)
    args = parser.parse_args()
    for directory in sorted(args.evidence.glob('holdout-*-r*-*')):
        result = assemble_run(directory, args.sessions)
        if result is not None:
            print(json.dumps(result))


if __name__ == '__main__':
    main()
