#!/usr/bin/env python3
"""Run the Go/Rust investigation batch through the normal change query.

Each case file freezes the source-first answer before any candidate run. Reserved
cases are skipped unless --include-reserved is passed, so they can be replayed
after the rules stop changing.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES = HERE / "cases"
EVIDENCE = HERE / "evidence"
POOLS = ("knownReferences", "interfaceCandidates", "traitCandidates")


def load_cases(include_reserved, only):
    cases = []
    for path in sorted(CASES.glob("*.json")):
        case = json.loads(path.read_text())
        if only and case["id"] not in only:
            continue
        if case.get("reserved") and not include_reserved:
            continue
        cases.append(case)
    return cases


def run_query(cli, case, samples, out_dir):
    base_root = samples / f"{case['id']}-base"
    head_root = samples / f"{case['id']}-head"
    if not base_root.is_dir() or not head_root.is_dir():
        raise SystemExit(f"{case['id']}: missing sample roots under {samples}")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{case['id']}.json"
    command = [
        "node", str(cli), "code-analysis", "task",
        "--question", case["question"],
        "--base-root", str(base_root), "--root", str(head_root),
        "--entry", case["entry"], "--format", "json", "--out", str(out),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    (out_dir / f"{case['id']}.command.txt").write_text(" ".join(command) + "\n")
    (out_dir / f"{case['id']}.stderr.txt").write_text(result.stderr)
    if result.returncode not in (0, 1):
        raise SystemExit(f"{case['id']}: CLI exit {result.returncode}: {result.stderr[-800:]}")
    return json.loads(out.read_text()), result.returncode


def pool_items(side, name):
    pool = side.get(name)
    if not isinstance(pool, dict):
        return None, []
    return pool, pool.get("items") or []


def find_definition(query, expected, scope="changed"):
    if scope == "unpaired":
        items = (query.get("unpairedDefinitions") or {}).get("items") or []
    else:
        items = (query.get("changedDefinitions") or {}).get("items") or []
    for row in items:
        head = row if scope == "unpaired" else row.get("head") or {}
        definition = head.get("definition") or {}
        if definition.get("file") != expected["file"]:
            continue
        if definition.get("line") != expected["line"]:
            continue
        if expected.get("qualname") and definition.get("qualname") != expected["qualname"]:
            continue
        return head
    return None


def fact_position(record):
    fact = record.get("fact") or {}
    return {key: fact.get(key) for key in ("file", "line", "column", "endLine", "endColumn")}


def expected_position(call):
    return {key: call.get(key) for key in ("file", "line", "column", "endLine", "endColumn")}


def score_direct_caller(call, fact):
    expected = call.get("directCaller")
    if not expected:
        return {"status": "not-required"}
    actual = fact.get("directCaller")
    if not actual:
        return {"status": "CLI 未提供", "provided": False}
    wrong = []
    for field in ("name", "line"):
        if actual.get(field) != expected.get(field):
            wrong.append(field)
    if actual.get("kind") != expected.get("kind"):
        wrong.append("kind")
    return {"status": "wrong" if wrong else "correct", "provided": True,
            "actual": actual, "wrong": wrong}


def score_target(call, record):
    fact = record.get("fact") or {}
    expected = call.get("target")
    kind = call.get("targetKind", "unknown")
    runtime = call.get("runtime", "not-determined")
    wrong = []
    if kind == "concrete":
        actual = fact.get("target") or {}
        if not expected:
            wrong.append("missing-expected-target")
        else:
            for field in ("file", "line", "column", "name"):
                value = actual.get("file") if field == "file" and fact.get("resolution") != "go-interface-method" else actual.get(field)
                if field == "file" and fact.get("resolution") == "go-interface-method":
                    value = actual.get("file") or fact.get("file")
                if value not in (None, expected.get(field)):
                    wrong.append(f"target-{field}")
        if record.get("runtimeTarget") not in (None, "not-determined"):
            wrong.append("runtime-clained")
    elif kind == "trait-declaration":
        actual = fact.get("target") or {}
        actual_file = actual.get("file") or fact.get("file")
        if expected and actual_file != expected.get("file"):
            wrong.append("target-file")
        if expected:
            for field in ("line", "column", "name"):
                if actual.get(field) not in (None, expected.get(field)):
                    wrong.append(f"target-{field}")
    else:
        if fact.get("target") and fact.get("resolution") not in ("unresolved",):
            wrong.append("unknown-claimed")
    if runtime == "not-determined" and record.get("runtimeTarget") not in (None, "not-determined"):
        wrong.append("runtime-claimed")
    return wrong


def score_side(case, head):
    expected_definition = case["changedDefinition"]
    results = []
    found_ids = set()
    considered = 0
    for name in POOLS:
        pool, items = pool_items(head, name)
        for record in items:
            considered += 1
            position = fact_position(record)
            for index, call in enumerate(case["expectedCalls"]):
                if index in found_ids or position != expected_position(call):
                    continue
                if call.get("inventory") and call["inventory"] != name:
                    continue
                found_ids.add(index)
                fact = record.get("fact") or {}
                caller = score_direct_caller(call, fact)
                target_wrong = score_target(call, record)
                if target_wrong and "missing-expected-target" in target_wrong:
                    target_wrong = [item for item in target_wrong if item != "missing-expected-target"]
                    if name == "knownReferences" and call.get("targetKind") == "concrete":
                        target_wrong.append("missing-target")
                status = "correct"
                if caller["status"] == "wrong" or target_wrong:
                    status = "wrong"
                results.append({"index": index, "pool": name, "position": position,
                                "status": status, "directCaller": caller,
                                "targetWrong": target_wrong, "runtimeTarget": record.get("runtimeTarget")})
                break
    implementation_rows = []
    interface_pool = (head.get("interfaceCandidates") or {}).get("implementations") or {}
    implementation_rows += interface_pool.get("items") or []
    implementation_rows += (head.get("traitCandidates") or {}).get("implementations") or []
    implementation_names = sorted({((row.get("implementation") or {}).get("method") or (row.get("implementation") if row.get("implementation") and not row["implementation"].get("method") else None) or row.get("method") or {}).get("qualname") for row in implementation_rows if ((row.get("implementation") or {}).get("method") or row.get("implementation") or row.get("method"))})
    missing_implementations = [name for name in case.get("expectedImplementations", []) if name not in implementation_names]
    missed = [{"index": index, "call": call} for index, call in enumerate(case["expectedCalls"]) if index not in found_ids]
    wrong = [row for row in results if row["status"] == "wrong"]
    callers = [row["directCaller"]["status"] for row in results]
    determined = sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "concrete")
    candidates = sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "trait-declaration")
    unknown = sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "unknown")
    return {
        "definitionFound": True,
        "definition": head.get("definition"),
        "expectedCalls": len(case["expectedCalls"]),
        "foundCalls": len(found_ids),
        "correctCalls": len(results) - len(wrong),
        "wrongCalls": len(wrong),
        "missedCalls": len(missed),
        "determinedTargets": determined,
        "candidateTargets": candidates,
        "unknownTargets": unknown,
        "directCallerStatus": {status: callers.count(status) for status in sorted(set(callers))},
        "items": results,
        "missed": missed,
        "implementations": implementation_names,
        "missingImplementations": missing_implementations,
        "consideredRecords": considered,
        "expectedGap": bool(case.get("expectedGap")),
        "status": ("pass" if not missed and not wrong and not missing_implementations else
                   "gap" if case.get("expectedGap") and not wrong else "fail"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--out", default=str(EVIDENCE))
    parser.add_argument("--case", action="append")
    parser.add_argument("--include-reserved", action="store_true")
    args = parser.parse_args()
    out_dir = Path(args.out)
    samples = Path(args.samples)
    summary = {"cli": str(Path(args.cli).resolve()), "cases": [], "totals": {}}
    for case in load_cases(args.include_reserved, args.case):
        query, exit_code = run_query(Path(args.cli), case, samples, out_dir / "queries")
        scope = case.get("definitionScope", "changed")
        row = find_definition(query, case["changedDefinition"], scope)
        if not row:
            report = {"definitionFound": False, "expectedCalls": len(case["expectedCalls"]),
                      "foundCalls": 0, "correctCalls": 0, "wrongCalls": 0,
                      "missedCalls": len(case["expectedCalls"]), "status": "fail"}
        else:
            report = score_side(case, row)
        report.update({"id": case["id"], "language": case["language"], "repo": case["repo"],
                       "base": case["base"], "head": case["head"], "reserved": bool(case.get("reserved")),
                       "regression": bool(case.get("regression")), "definitionScope": scope,
                       "exitCode": exit_code, "queryStatus": query.get("status")})
        summary["cases"].append(report)
        print(f"{case['id']}: {report['status']} found={report.get('foundCalls')}/"
              f"{report['expectedCalls']} wrong={report['wrongCalls']} missed={report['missedCalls']} "
              f"query={query.get('status')} callers={report.get('directCallerStatus')}")
    keys = ("expectedCalls", "foundCalls", "correctCalls", "wrongCalls", "missedCalls", "missingImplementations",
            "determinedTargets", "candidateTargets", "unknownTargets")
    summary["totals"] = {key: (sum(len(row.get(key, [])) if isinstance(row.get(key), list) else (row.get(key) or 0) for row in summary["cases"])) for key in keys}
    summary["totals"]["definitionsFound"] = sum(1 for row in summary["cases"] if row.get("definitionFound"))
    summary["totals"]["cases"] = len(summary["cases"])
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary["totals"], indent=2))
    return 0 if all(row["status"] in ("pass", "gap") for row in summary["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
