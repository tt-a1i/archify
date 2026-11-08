#!/usr/bin/env python3
"""Compare Rust default-body call inventory between the v5 baseline and v6 candidate.

The baseline is scored with its own source-range flow because v5 has no
`defaultMethod` field. The candidate is scored through its `defaultMethod`
context and exact call ranges. Expected calls and targets were frozen in
`source-first.json` before the scored runs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CALL_FIELDS = ("file", "line", "column", "endLine", "endColumn")


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_samples(samples: Path, meta: dict) -> None:
    root = samples / "base64-head"
    revision = run(["git", "rev-parse", "HEAD"], root).stdout.strip()
    if revision != meta["head"]:
        raise RuntimeError(f"head {revision} != {meta['head']}")
    for file, digest in meta["headHashes"].items():
        if sha256(root / file) != digest:
            raise RuntimeError(f"head hash mismatch: {file}")
    base = samples / "base64-base"
    revision = run(["git", "rev-parse", "HEAD"], base).stdout.strip()
    if revision != meta["base"]:
        raise RuntimeError(f"base {revision} != {meta['base']}")


def load_config(root: Path) -> Path:
    config = root / "config.json"
    config.write_text(json.dumps({"rust": {"offline": True, "tests": False}}) + "\n")
    return config


def check_facts(cli: Path, root: Path, out: Path, config: Path) -> dict:
    facts_path = out / "facts"
    result = run([
        "node", str(cli), "code-analysis", "check", str(root),
        "--language", "rust", "--config", str(config),
        "--out", str(facts_path), "--fail-on", "never", "--json",
    ])
    if result.returncode != 0:
        raise RuntimeError(f"check failed ({result.returncode}): {result.stderr.strip()[:800]}")
    return json.loads((facts_path / "raw-facts.json").read_text())


def key(call: dict) -> tuple:
    return tuple(call[field] for field in CALL_FIELDS)


def in_method_range(call: dict, method: dict) -> bool:
    span = method["sourceRange"]
    return (call["file"] == method["file"]
            and call["line"] >= span["line"]
            and call["endLine"] <= span["endLine"])


def select_calls(facts: dict, meta: dict, side: str) -> list[dict]:
    method = meta["method"]
    if side == "baseline":
        return [call for call in facts["calls"] if in_method_range(call, method)]
    selected = []
    for call in facts["calls"]:
        context = call.get("defaultMethod") or {}
        if (context.get("file") == method["file"]
                and context.get("name") == method["name"]
                and context.get("qualname") == method["qualname"]
                and context.get("trait") == method["trait"]
                and call["file"] == method["file"]
                and in_method_range(call, method)):
            selected.append(call)
    return selected


def score_item(expected: dict, actuals: list[dict]) -> dict:
    matches = [actual for actual in actuals if key(actual) == key(expected)]
    record = {
        "expected": expected,
        "actual": matches[0] if len(matches) == 1 else None,
        "matches": len(matches),
        "captured": bool(matches),
        "targetVerified": False,
        "wrong": [],
        "status": "missed",
    }
    if not matches:
        return record
    if len(matches) > 1:
        record["wrong"].append("duplicate-call")
        record["status"] = "wrong"
        return record
    actual = matches[0]
    if expected.get("resolution") == "unresolved":
        if actual.get("resolution") != "unresolved":
            record["wrong"].append("target-overclaimed")
        if actual.get("target"):
            record["wrong"].append("unexpected-target")
        if expected.get("reason") and actual.get("reason") != expected["reason"]:
            record["wrong"].append("reason")
    else:
        if actual.get("resolution") != expected["resolution"]:
            record["wrong"].append("resolution")
        target = expected["target"]
        got = actual.get("target") or {}
        if any(got.get(field) != target[field] for field in ("file", "line", "column", "name")):
            record["wrong"].append("target")
    record["targetVerified"] = bool(expected.get("targetVerified")) and not record["wrong"]
    record["status"] = "wrong" if record["wrong"] else "correct"
    return record


def side_result(name: str, facts: dict, meta: dict) -> dict:
    expected_items = meta["expectedCalls"]
    calls = select_calls(facts, meta, name)
    rows = [score_item(item, calls) for item in expected_items]
    used = {id(row["actual"]) for row in rows if row["actual"] is not None}
    extras = [
        {"actual": call, "status": "wrong", "wrong": ["unexpected-call"]}
        for call in calls if id(call) not in used
    ]
    correct = [row for row in rows if row["status"] == "correct"]
    missed = [row for row in rows if row["status"] == "missed"]
    wrong = [row for row in rows if row["status"] == "wrong"] + extras
    target_verified = [row for row in rows if row["targetVerified"]]
    unknown_retained = [
        row for row in rows
        if row["status"] == "correct" and row["expected"].get("target") is None
    ]
    return {
        "callModel": facts.get("callModel"),
        "recordedCalls": len(facts["calls"]),
        "methodCalls": len(calls),
        "expected": len(rows),
        "correct": len(correct),
        "captured": sum(row["captured"] for row in rows),
        "targetVerified": len(target_verified),
        "unknownRetained": len(unknown_retained),
        "missed": [f"{row['expected']['file']}:{row['expected']['line']}:{row['expected']['column']}" for row in missed],
        "wrong": [f"{row['expected']['file']}:{row['expected']['line']}:{row['expected']['column']}" for row in wrong],
        "items": rows + extras,
    }


def negative_controls(candidate: dict) -> dict:
    rows = [row for row in candidate["items"] if row.get("actual") is not None]
    known = next(row for row in rows if (row["expected"].get("target") or {}).get("name") == "internal_decoded_len_estimate")
    unknown = next(row for row in rows if row["expected"].get("line") == 263 and row["expected"].get("column") == 21)
    range_row = next(row for row in rows if (row["expected"].get("target") or {}).get("name") == "internal_decode")

    swapped = json.loads(json.dumps(known))
    swapped["actual"]["target"] = dict(swapped["actual"]["target"])
    swapped["actual"]["target"]["line"] = 91
    target_check = score_item(swapped["expected"], [swapped["actual"]])

    overclaimed = json.loads(json.dumps(unknown))
    overclaimed["actual"]["resolution"] = "rust-trait-method-candidate"
    overclaimed["actual"]["target"] = {"file": "src/engine/mod.rs", "line": 91, "column": 8, "name": "internal_decode"}
    overclaim = score_item(overclaimed["expected"], [overclaimed["actual"]])

    shifted = json.loads(json.dumps(range_row))
    shifted["actual"]["endColumn"] -= 1
    range_check = score_item(shifted["expected"], [shifted["actual"]])

    checks = {
        "sameTraitWrongTargetRejected": target_check["status"] == "wrong" and "target" in target_check["wrong"],
        "overclaimedUnknownRejected": overclaim["status"] == "wrong" and "target-overclaimed" in overclaim["wrong"],
        "shortCallRangeRejected": range_check["status"] == "missed",
    }
    if not all(checks.values()):
        raise RuntimeError(f"scorer negative controls were not rejected: {checks}")
    return {"checks": checks, "sameTraitWrongTarget": target_check,
            "overclaimedUnknown": overclaim, "shortCallRange": range_check}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-cli", type=Path, required=True)
    parser.add_argument("--candidate-cli", type=Path, required=True)
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    samples = args.samples.resolve()
    meta = json.loads((HERE / "source-first.json").read_text())
    verify_samples(samples, meta)
    config = load_config(out)

    baseline_facts = check_facts(args.baseline_cli.resolve(), samples / "base64-head", out / "baseline", config)
    candidate_facts = check_facts(args.candidate_cli.resolve(), samples / "base64-head", out / "candidate", config)
    if not str(baseline_facts.get("callModel", "")).startswith("rust-source-direct-v5"):
        raise RuntimeError(f"baseline model is {baseline_facts.get('callModel')}, expected v5")
    if candidate_facts.get("callModel") != "rust-source-direct-v6":
        raise RuntimeError(f"candidate model is {candidate_facts.get('callModel')}, expected v6")
    if any("defaultMethod" in call for call in baseline_facts["calls"]):
        raise RuntimeError("v5 baseline unexpectedly emitted defaultMethod")

    baseline = side_result("baseline", baseline_facts, meta)
    candidate = side_result("candidate", candidate_facts, meta)
    controls = negative_controls(candidate)

    baseline_by_key = {key(row["expected"]): row for row in baseline["items"] if "expected" in row}
    newly_correct = [
        row for row in candidate["items"]
        if "expected" in row and row["status"] == "correct"
        and baseline_by_key.get(key(row["expected"]), {}).get("status") != "correct"
    ]
    previously_correct = [row for row in baseline["items"] if row.get("status") == "correct"]
    wrong_target = [
        row for row in candidate["items"]
        if row.get("status") == "wrong"
        and any(kind in row.get("wrong", []) for kind in ("target", "target-overclaimed", "unexpected-target", "resolution"))
    ]
    missed = [row for row in candidate["items"] if row.get("status") == "missed"]
    known_inventory_gaps = [
        {"position": f"{row['expected']['file']}:{row['expected']['line']}:{row['expected']['column']}",
         "expression": row["expected"].get("expression")}
        for row in baseline["items"] if row.get("status") == "missed"
    ]

    failures = []
    for control, ok in controls["checks"].items():
        if not ok:
            failures.append(f"control:{control}")
    if candidate["missed"]:
        failures.append("candidate:missed")
    if candidate["wrong"]:
        failures.append("candidate:wrong")
    if candidate["targetVerified"] != 2:
        failures.append("candidate:target-verification-count")
    if baseline["methodCalls"] != 0:
        failures.append("baseline:unexpected-default-body-calls")

    summary = {
        "case": "base64 Engine::decode default body",
        "repository": meta["repository"],
        "base": meta["base"],
        "head": meta["head"],
        "method": meta["method"],
        "profile": meta["profile"],
        "baseline": baseline,
        "candidate": candidate,
        "comparison": {
            "previouslyCorrect": len(previously_correct),
            "newlyCorrect": len(newly_correct),
            "wrongTarget": len(wrong_target),
            "missed": len(missed),
            "callCapture": {"baseline": baseline["captured"], "candidate": candidate["captured"]},
            "targetIdentityVerified": {"baseline": baseline["targetVerified"], "candidate": candidate["targetVerified"]},
            "unknownRetained": {"baseline": baseline["unknownRetained"], "candidate": candidate["unknownRetained"]},
            "knownInventoryGapsInBaseline": known_inventory_gaps,
        },
        "controls": controls,
        "failures": failures,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    brief = {
        "baseline": {field: baseline[field] for field in
                     ("callModel", "recordedCalls", "methodCalls", "expected", "correct", "captured", "targetVerified", "unknownRetained")},
        "candidate": {field: candidate[field] for field in
                      ("callModel", "recordedCalls", "methodCalls", "expected", "correct", "captured", "targetVerified", "unknownRetained")},
        "comparison": summary["comparison"],
        "failures": failures,
    }
    (out / "brief.json").write_text(json.dumps(brief, indent=2, sort_keys=True) + "\n")
    print(json.dumps(brief, indent=2, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
