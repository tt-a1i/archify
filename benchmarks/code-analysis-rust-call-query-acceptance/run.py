#!/usr/bin/env python3
"""Acceptance replay for a changed Rust definition called from a trait default body.

Runs the normal change query in the v5 baseline and v6 candidate against the
same base64 revisions. The real query and the direct-caller controls all pass
through the same scorer. Missing directCaller fields are recorded as
"CLI 未提供"; injected fields are checked against the source caller name and
position.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


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


def position(fact_or_expected: dict) -> str:
    return f"{fact_or_expected['file']}:{fact_or_expected['line']}:{fact_or_expected['column']}"


def score_direct_caller(expected: dict, fact: dict) -> dict:
    """Check a directCaller field when present; otherwise record CLI absence."""
    if "directCaller" not in fact or fact.get("directCaller") is None:
        return {"status": "CLI 未提供", "provided": False}
    actual = fact["directCaller"]
    caller = expected["directCaller"]
    wrong = []
    for field in ("file", "line", "name"):
        if actual.get(field) != caller[field]:
            wrong.append(f"direct-caller-{field}")
    if (actual.get("name") == expected["defaultMethod"]["name"]
            and actual.get("line") == expected["defaultMethod"]["line"]):
        wrong.append("outer-default-method-misreported")
    return {
        "status": "wrong" if wrong else "correct",
        "provided": True,
        "actual": actual,
        "expected": caller,
        "wrong": wrong,
    }


def score_call(expected: dict, item: dict | None) -> dict:
    record = {"expected": expected, "actual": item, "captured": item is not None,
              "targetVerified": False, "wrong": [], "status": "missed"}
    if item is None:
        record["directCallerStatus"] = "CLI 未提供"
        return record
    fact = item.get("fact") or {}
    identity_wrong = []
    if call_key(fact) != call_key(expected):
        identity_wrong.append("call-range")
    if fact.get("defaultMethod") != expected["defaultMethod"]:
        identity_wrong.append("outer-default-method")
    target = fact.get("target") or {}
    if any(target.get(field) != expected["target"][field] for field in ("file", "line", "column", "name")):
        identity_wrong.append("target")
    if fact.get("resolution") != "rust-trait-method-candidate":
        identity_wrong.append("resolution")
    if item.get("runtimeTarget") != "not-determined":
        identity_wrong.append("runtime-target")
    record["targetVerified"] = not identity_wrong
    record["wrong"] = list(identity_wrong)
    direct = score_direct_caller(expected, fact)
    record["directCaller"] = direct
    record["directCallerStatus"] = direct["status"]
    if direct["status"] == "wrong":
        record["wrong"].append("direct-caller")
        record["wrong"].extend(direct["wrong"])
    record["status"] = "correct" if not record["wrong"] else "wrong"
    return record


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


def score_side(name: str, query: dict, meta: dict, facts: dict) -> dict:
    evidence = call_evidence(query, meta)
    items = evidence["traitCandidates"].get("items") or []
    by_key = {call_key(item.get("fact") or {}): item for item in items}
    rows = [score_call(expected, by_key.get(call_key(expected))) for expected in meta["expectedCallers"]]
    expected_keys = {call_key(expected) for expected in meta["expectedCallers"]}
    extras = [item for item in items if call_key(item.get("fact") or {}) not in expected_keys]
    raw_internal = [
        call for call in facts.get("calls", [])
        if (call.get("target") or {}).get("name") == "internal_decode"
        and (call.get("defaultMethod") or {}).get("name") in
        ("decode", "decode_vec", "decode_slice", "decode_slice_unchecked")
    ]
    direct_failures = [
        {"call": position(row["expected"]), "wrong": row["directCaller"]["wrong"],
         "actual": row["directCaller"].get("actual"),
         "expected": row["directCaller"].get("expected")}
        for row in rows if row["directCallerStatus"] == "wrong"
    ]
    provided = [row for row in rows if row["directCallerStatus"] != "CLI 未提供"]
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
            "status": "CLI 未提供" if not provided else "provided-and-checked",
            "provided": bool(provided),
            "checked": len(provided),
            "sourceDirectCaller": "inner (nested local function in each default body)",
            "outerDefaultMethodField": "defaultMethod",
        },
        "directCallerFailures": direct_failures,
        "correct": sum(row["status"] == "correct" for row in rows),
        "wrong": [position(row["expected"]) for row in rows if row["status"] == "wrong"]
                 + [f"{call_key(item.get('fact') or {})}" for item in extras],
        "missed": [position(row["expected"]) for row in rows if row["status"] == "missed"],
        "targetVerified": sum(row["targetVerified"] for row in rows),
    }
    return result


def acceptance_failures(side: dict, expected_count: int) -> list[str]:
    failures = []
    if side["correct"] != expected_count:
        failures.append("calls:not-all-correct")
    if side["wrong"]:
        failures.append("calls:wrong")
    if side["missed"]:
        failures.append("calls:missed")
    if side["rawFactsVsQuery"] != "equal":
        failures.append("calls:raw-facts-query-mismatch")
    if side["targetVerified"] != expected_count:
        failures.append("target:not-verified")
    if side["traitCandidates"]["runtimeTarget"] != "not-determined":
        failures.append("runtime-target:overclaimed")
    if not any(impl.get("selfType") == "GeneralPurpose" for impl in side["implementations"]):
        failures.append("implementation-candidate:missing")
    if side["directCallerFailures"]:
        failures.append("direct-caller:wrong")
    return failures


def inject_first_direct_caller(query: dict, meta: dict, direct: dict) -> dict:
    mutated = copy.deepcopy(query)
    item = find_changed(mutated, meta)
    candidates = item["head"]["traitCandidates"]["items"]
    candidates[0]["fact"]["directCaller"] = dict(direct)
    return mutated


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
    baseline_facts = check(args.baseline_cli.resolve(), samples, config, baseline_dir)
    candidate_facts = check(args.candidate_cli.resolve(), samples, config, candidate_dir)
    (out / "candidate-query.json").write_text(json.dumps(candidate_query, indent=2, sort_keys=True) + "\n")
    saved_candidate = json.loads((out / "candidate-query.json").read_text())
    baseline_side = score_side("baseline", baseline_query, meta, baseline_facts)
    candidate_side = score_side("candidate", saved_candidate, meta, candidate_facts)

    if baseline_side["changedDefinition"] is None or candidate_side["changedDefinition"] is None:
        raise RuntimeError("changed definition missing")
    if candidate_side["callModel"] != "rust-source-direct-v6":
        raise RuntimeError(f"candidate model {candidate_side['callModel']}")
    if baseline_side["callModel"] != "rust-source-direct-v5":
        raise RuntimeError(f"baseline model {baseline_side['callModel']}")

    expected = meta["expectedCallers"][0]
    wrong_outer = {
        "file": expected["defaultMethod"]["file"],
        "line": expected["defaultMethod"]["line"],
        "name": expected["defaultMethod"]["name"],
    }
    negative_query = inject_first_direct_caller(saved_candidate, meta, wrong_outer)
    positive_query = inject_first_direct_caller(saved_candidate, meta, expected["directCaller"])
    negative_side = score_side("negative-control", negative_query, meta, candidate_facts)
    positive_side = score_side("positive-control", positive_query, meta, candidate_facts)

    real_failures = acceptance_failures(candidate_side, len(meta["expectedCallers"]))
    negative_failures = acceptance_failures(negative_side, len(meta["expectedCallers"]))
    positive_failures = acceptance_failures(positive_side, len(meta["expectedCallers"]))
    offending = negative_side["directCallerFailures"][0]["call"] if negative_side["directCallerFailures"] else None
    checks = {
        "realQueryAccepted": not real_failures,
        "wrongOuterRejected": bool(negative_failures) and offending == position(expected),
        "correctInnerAccepted": not positive_failures
        and positive_side["correct"] == len(meta["expectedCallers"])
        and positive_side["rows"][0]["directCallerStatus"] == "correct",
    }
    if not all(checks.values()):
        raise RuntimeError(f"scoring controls failed: {checks}, failures={negative_failures}")

    failures = list(real_failures)
    if baseline_side["queryShowsInternalDecodeCalls"] != 0:
        failures.append("baseline:unexpected-callers")
    if not checks["wrongOuterRejected"]:
        failures.append("control:wrong-outer-not-rejected")
    if not checks["correctInnerAccepted"]:
        failures.append("control:correct-inner-rejected")

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
            "newlyVisibleCalls": len(baseline_side["missed"]),
            "candidateCorrect": candidate_side["correct"],
            "candidateWrong": len(candidate_side["wrong"]),
            "candidateMissed": len(candidate_side["missed"]),
            "baselineVisible": baseline_side["queryShowsInternalDecodeCalls"],
            "targetDeclarationVerified": candidate_side["targetVerified"],
            "runtimeTarget": candidate_side["traitCandidates"]["runtimeTarget"],
            "directCallerCapability": candidate_side["directCallerCapability"],
        },
        "controls": {
            "sameScoringPath": True,
            "realQuery": {
                "accepted": not real_failures,
                "failures": real_failures,
                "correct": candidate_side["correct"],
                "directCallerStatus": candidate_side["directCallerCapability"]["status"],
            },
            "negative": {
                "accepted": not negative_failures,
                "failures": negative_failures,
                "offendingCall": offending,
                "directCallerStatus": negative_side["directCallerCapability"]["status"],
            },
            "positive": {
                "accepted": not positive_failures,
                "failures": positive_failures,
                "correct": positive_side["correct"],
                "directCallerStatus": positive_side["directCallerCapability"]["status"],
            },
            "checks": checks,
        },
        "counterexample": {
            "originalQuery": {
                "query": "original candidate query with no directCaller field",
                "accepted": not real_failures,
                "correct": candidate_side["correct"],
                "directCallerStatus": candidate_side["directCallerCapability"]["status"],
            },
            "injectedWrongOuter": {
                "query": "copy of the saved candidate query with the first item's directCaller replaced by the outer default method",
                "accepted": not negative_failures,
                "failures": negative_failures,
                "offendingCall": offending,
                "wrongDirectCaller": wrong_outer,
            },
            "injectedCorrectInner": {
                "query": "copy of the saved candidate query with the first item's directCaller set to the source inner caller",
                "accepted": not positive_failures,
                "correct": positive_side["correct"],
            },
        },
        "failures": failures,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    (out / "baseline-query.json").write_text(json.dumps(baseline_query, indent=2, sort_keys=True) + "\n")
    (out / "candidate-query.json").write_text(json.dumps(candidate_query, indent=2, sort_keys=True) + "\n")
    (out / "negative-control-query.json").write_text(json.dumps(negative_query, indent=2, sort_keys=True) + "\n")
    (out / "positive-control-query.json").write_text(json.dumps(positive_query, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "baseline": {key: baseline_side[key] for key in
                     ("callModel", "knownReferences", "queryShowsInternalDecodeCalls", "correct", "missed")},
        "candidate": {key: candidate_side[key] for key in
                      ("callModel", "knownReferences", "queryShowsInternalDecodeCalls", "correct", "wrong", "missed", "targetVerified")},
        "runtimeTarget": candidate_side["traitCandidates"]["runtimeTarget"],
        "directCaller": candidate_side["directCallerCapability"],
        "comparison": summary["comparison"],
        "counterexample": summary["counterexample"],
        "controls": summary["controls"],
        "failures": failures,
    }, indent=2, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
