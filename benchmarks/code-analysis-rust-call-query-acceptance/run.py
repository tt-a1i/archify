#!/usr/bin/env python3
"""Acceptance replay for a changed Rust definition called from a trait default body.

Runs the normal change query in the v5 baseline and v6 candidate against the
same base64 revisions. The candidate must expose all four call sites as trait
candidates, retain the runtime target as unknown, and identify the concrete
implementation only as a source candidate. The query has no directCaller
field, so direct-caller attribution is scored by actual capability.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIT = "engine::Engine::internal_decode"


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_samples(samples: Path, meta: dict) -> None:
    for name, revision in (("base64-9e-base", meta["base"]), ("base64-9e-head", meta["head"])):
        root = samples / name
        got = run(["git", "rev-parse", "HEAD"], root).stdout.strip()
        if got != revision:
            raise RuntimeError(f"{name} {got} != {revision}")
    for file, digest in meta["headHashes"].items():
        if sha256(samples / "base64-9e-head" / file) != digest:
            raise RuntimeError(f"head hash mismatch: {file}")


def load_config(out: Path) -> Path:
    config = out / "config.json"
    config.write_text(json.dumps({"rust": {"offline": True, "tests": False}}) + "\n")
    return config


def task(cli: Path, samples: Path, config: Path, out: Path) -> tuple[dict, list[str]]:
    query = out / "query.json"
    command = [
        "node", str(cli), "code-analysis", "task",
        "--base-root", str(samples / "base64-9e-base"),
        "--root", str(samples / "base64-9e-head"),
        "--entry", "src/engine/general_purpose/mod.rs",
        "--config", str(config),
        "--question", "I changed GeneralPurpose::internal_decode in this revision. Which calls point to it, and is there a call inside a trait default method body?",
        "--format", "json", "--out", str(query), "--json",
    ]
    result = run(command)
    if result.returncode not in (0, 1) or not query.exists():
        raise RuntimeError(f"task failed ({result.returncode}): {result.stderr.strip()[:800]}")
    return json.loads(query.read_text()), command


def check(cli: Path, samples: Path, config: Path, out: Path) -> dict:
    facts = out / "facts"
    result = run([
        "node", str(cli), "code-analysis", "check", str(samples / "base64-9e-head"),
        "--language", "rust", "--config", str(config),
        "--out", str(facts), "--fail-on", "never", "--json",
    ])
    if result.returncode != 0:
        raise RuntimeError(f"check failed ({result.returncode}): {result.stderr.strip()[:800]}")
    return json.loads((facts / "raw-facts.json").read_text())


def find_changed(query: dict, meta: dict) -> dict:
    for item in query.get("changedDefinitions", {}).get("items", []):
        definition = (item.get("head") or {}).get("definition") or {}
        if definition.get("qualname") == meta["changedDefinition"]["qualname"]:
            return item
    raise RuntimeError("changed definition was not reported")


def call_key(item: dict) -> tuple:
    return tuple(item[field] for field in ("file", "line", "column", "endLine", "endColumn"))


def score_call(expected: dict, item: dict | None) -> dict:
    record = {"expected": expected, "actual": item, "captured": item is not None,
              "targetVerified": False, "wrong": [], "status": "missed"}
    if item is None:
        return record
    fact = item.get("fact") or {}
    if call_key(fact) != call_key(expected):
        record["wrong"].append("call-range")
    if fact.get("defaultMethod") != expected["defaultMethod"]:
        record["wrong"].append("outer-default-method")
    target = fact.get("target") or {}
    if any(target.get(field) != expected["target"][field] for field in ("file", "line", "column", "name")):
        record["wrong"].append("target")
    if fact.get("resolution") != "rust-trait-method-candidate":
        record["wrong"].append("resolution")
    if item.get("runtimeTarget") != "not-determined":
        record["wrong"].append("runtime-target")
    record["targetVerified"] = not record["wrong"]
    record["directCallerField"] = "directCaller" in fact
    record["status"] = "correct" if not record["wrong"] else "wrong"
    return record


def score_direct_caller(expected: dict, actual: dict | None) -> dict:
    wrong = []
    if actual is None:
        return {"expected": expected, "actual": None, "wrong": ["missing"], "status": "missed"}
    caller = expected["directCaller"]
    if actual.get("file") != caller["file"] or actual.get("line") != caller["line"]:
        wrong.append("direct-caller")
    if actual.get("name") == expected["defaultMethod"]["name"] and actual.get("line") == expected["defaultMethod"]["line"]:
        wrong.append("outer-default-method-misreported")
    return {"expected": expected, "actual": actual, "wrong": wrong,
            "status": "correct" if not wrong else "wrong"}


def call_evidence(query: dict, meta: dict) -> dict:
    item = find_changed(query, meta)
    head = item["head"]
    candidates = head.get("traitCandidates") or {}
    return {
        "changedDefinition": head.get("definition"),
        "knownReferences": head.get("knownReferences"),
        "traitCandidates": candidates,
        "implementations": candidates.get("implementations") or [],
        "changedCount": query.get("changedDefinitions", {}).get("total"),
    }


def score_side(name: str, query: dict, meta: dict, facts: dict, out: Path) -> dict:
    evidence = call_evidence(query, meta)
    items = evidence["traitCandidates"].get("items") or []
    by_key = {call_key(item.get("fact") or {}): item for item in items}
    rows = [score_call(expected, by_key.get(call_key(expected))) for expected in meta["expectedCallers"]]
    used = {call_key(item.get("fact") or {}) for item in items}
    expected_keys = {call_key(expected) for expected in meta["expectedCallers"]}
    extras = [item for item in items if call_key(item.get("fact") or {}) not in expected_keys]
    raw_internal = [
        call for call in facts.get("calls", [])
        if (call.get("target") or {}).get("name") == "internal_decode"
        and (call.get("defaultMethod") or {}).get("name") in
        ("decode", "decode_vec", "decode_slice", "decode_slice_unchecked")
    ]
    direct_caller_available = any("directCaller" in (row.get("actual") or {}).get("fact", {}) for row in rows)
    result = {
        "side": name,
        "callModel": facts.get("callModel"),
        "changedDefinition": evidence["changedDefinition"],
        "changedDefinitionsTotal": evidence["changedCount"],
        "knownReferences": (evidence["knownReferences"] or {}).get("total"),
        "traitCandidates": {
            "coverage": evidence["traitCandidates"].get("coverage"),
            "runtimeTarget": evidence["traitCandidates"].get("runtimeTarget"),
            "total": evidence["traitCandidates"].get("total"),
            "items": len(items),
        },
        "implementations": evidence["implementations"],
        "rawFactsInternalDecodeCalls": len(raw_internal),
        "queryShowsInternalDecodeCalls": len(items),
        "rawFactsVsQuery": "equal" if len(raw_internal) == len(items) else "different",
        "rows": rows,
        "extras": extras,
        "directCallerCapability": {
            "available": direct_caller_available,
            "sourceDirectCaller": "inner (nested local function in each default body)",
            "outerDefaultMethodField": "defaultMethod",
        },
        "correct": sum(row["status"] == "correct" for row in rows),
        "wrong": [f"{row['expected']['file']}:{row['expected']['line']}:{row['expected']['column']}"
                  for row in rows if row["status"] == "wrong"] + [
                  f"{call_key(item.get('fact') or {})}" for item in extras],
        "missed": [f"{row['expected']['file']}:{row['expected']['line']}:{row['expected']['column']}"
                   for row in rows if row["status"] == "missed"],
        "targetVerified": sum(row["targetVerified"] for row in rows),
    }
    return result


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

    baseline_dir, candidate_dir = out / "baseline", out / "candidate"
    baseline_dir.mkdir(exist_ok=True)
    candidate_dir.mkdir(exist_ok=True)
    baseline_query, baseline_cmd = task(args.baseline_cli.resolve(), samples, config, baseline_dir)
    candidate_query, candidate_cmd = task(args.candidate_cli.resolve(), samples, config, candidate_dir)
    baseline_side = score_side("baseline", baseline_query, meta, check(args.baseline_cli.resolve(), samples, config, baseline_dir), baseline_dir)
    candidate_side = score_side("candidate", candidate_query, meta, check(args.candidate_cli.resolve(), samples, config, candidate_dir), candidate_dir)

    if baseline_side["changedDefinition"] is None or candidate_side["changedDefinition"] is None:
        raise RuntimeError("changed definition missing")
    if candidate_side["callModel"] != "rust-source-direct-v6":
        raise RuntimeError(f"candidate model {candidate_side['callModel']}")
    if baseline_side["callModel"] != "rust-source-direct-v5":
        raise RuntimeError(f"baseline model {baseline_side['callModel']}")

    # The scorer must distinguish the outer default method from the direct caller.
    expected = meta["expectedCallers"][0]
    control_bad = score_direct_caller(expected, {
        "file": expected["defaultMethod"]["file"],
        "line": expected["defaultMethod"]["line"],
        "name": expected["defaultMethod"]["name"],
    })
    control_good = score_direct_caller(expected, expected["directCaller"])
    controls = {
        "outerDefaultMethodRejected": control_bad["status"] == "wrong"
        and "outer-default-method-misreported" in control_bad["wrong"],
        "nestedDirectCallerAccepted": control_good["status"] == "correct",
        "bad": control_bad,
        "good": control_good,
    }
    if not all(controls[key] for key in ("outerDefaultMethodRejected", "nestedDirectCallerAccepted")):
        raise RuntimeError(f"direct-caller controls failed: {controls}")

    failures = []
    if candidate_side["correct"] != len(meta["expectedCallers"]):
        failures.append("candidate:not-all-calls-correct")
    if candidate_side["wrong"]:
        failures.append("candidate:wrong")
    if candidate_side["missed"]:
        failures.append("candidate:missed")
    if candidate_side["rawFactsVsQuery"] != "equal":
        failures.append("candidate:raw-facts-query-mismatch")
    if candidate_side["targetVerified"] != len(meta["expectedCallers"]):
        failures.append("candidate:target-not-verified")
    if candidate_side["traitCandidates"]["runtimeTarget"] != "not-determined":
        failures.append("candidate:runtime-target-overclaimed")
    if not any(impl.get("selfType") == "GeneralPurpose" for impl in candidate_side["implementations"]):
        failures.append("candidate:implementation-candidate-missing")
    if baseline_side["queryShowsInternalDecodeCalls"] != 0:
        failures.append("baseline:unexpected-callers")

    summary = {
        "case": meta["case"],
        "repository": meta["repository"],
        "base": meta["base"],
        "head": meta["head"],
        "changedDefinition": meta["changedDefinition"],
        "profile": meta["profile"],
        "commands": {
            "baseline": " ".join(baseline_cmd),
            "candidate": " ".join(candidate_cmd),
        },
        "baseline": baseline_side,
        "candidate": candidate_side,
        "comparison": {
            "newlyVisibleCalls": baseline_side["missed"].__len__(),
            "candidateCorrect": candidate_side["correct"],
            "candidateWrong": len(candidate_side["wrong"]),
            "candidateMissed": len(candidate_side["missed"]),
            "baselineVisible": baseline_side["queryShowsInternalDecodeCalls"],
            "targetDeclarationVerified": candidate_side["targetVerified"],
            "runtimeTarget": candidate_side["traitCandidates"]["runtimeTarget"],
            "directCallerCapability": candidate_side["directCallerCapability"],
        },
        "controls": controls,
        "failures": failures,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    (out / "baseline-query.json").write_text(json.dumps(baseline_query, indent=2, sort_keys=True) + "\n")
    (out / "candidate-query.json").write_text(json.dumps(candidate_query, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "baseline": {key: baseline_side[key] for key in
                     ("callModel", "knownReferences", "queryShowsInternalDecodeCalls", "correct", "missed")},
        "candidate": {key: candidate_side[key] for key in
                      ("callModel", "knownReferences", "queryShowsInternalDecodeCalls", "correct", "wrong", "missed", "targetVerified")},
        "runtimeTarget": candidate_side["traitCandidates"]["runtimeTarget"],
        "directCaller": candidate_side["directCallerCapability"],
        "comparison": summary["comparison"],
        "failures": failures,
    }, indent=2, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
