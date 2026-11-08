#!/usr/bin/env python3
"""Run the Go/Rust investigation batch through the normal change query.

Each case file freezes the source-first answer before any candidate run. Reserved
cases are skipped unless --include-reserved is passed, so they can be replayed
after the rules stop changing.

All scoring goes through score_case(). The counterexample pass mutates the saved
query JSON and feeds the result back through the same entry, so the scorer is
exercised by the same contract it applies to real runs.
"""
import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES = HERE / "cases"
EVIDENCE = HERE / "evidence"
POOLS = ("knownReferences", "interfaceCandidates", "traitCandidates")
START_FIELDS = ("file", "line", "column")
END_FIELDS = ("endLine", "endColumn")
POSITION_FIELDS = START_FIELDS + END_FIELDS
TARGET_FIELDS = ("file", "line", "column", "name")
CONCRETE_RESOLUTIONS = {
    "go-direct-method",
    "go-direct-function",
    "rust-trait-impl",
    "rust-inherent-source-candidate",
    "rust-specialized-inherent-source-candidate",
    "rust-lifetime-inherent-source-candidate",
}
MUST_DETECT = (
    "delete-target",
    "wrong-declaration",
    "extra-call",
    "duplicate-call",
    "wrong-direct-caller",
    "promote-candidate",
)
CONTROLS = ("omit-target-file", "omit-end-position")


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
    return {key: fact.get(key) for key in POSITION_FIELDS}


def expected_position(call):
    return {key: call.get(key) for key in POSITION_FIELDS}


def position_matches(expected, actual):
    """Compare the declared call position, honouring upstream omissions.

    file/line/column identify the call and must match when asserted. End
    coordinates are optional in the upstream format: compare them only when
    both the frozen answer and the query provide them.
    """
    for key in START_FIELDS:
        if expected.get(key) is not None and actual.get(key) != expected.get(key):
            return False
    for key in END_FIELDS:
        if expected.get(key) is not None and actual.get(key) is not None:
            if actual.get(key) != expected.get(key):
                return False
    return True


def inventory_ok(call, pool_name):
    return not call.get("inventory") or call["inventory"] == pool_name


def normalize_target(fact):
    """Restore upstream target omissions to their source semantics.

    Upstream omits target.file when the target lives in the call file, so an
    absent file means "same file as the fact", not "unknown location".
    """
    target = fact.get("target")
    if not isinstance(target, dict):
        return None
    target = dict(target)
    if not target.get("file"):
        target["file"] = fact.get("file")
    return target


def score_direct_caller(call, fact):
    expected = call.get("directCaller")
    if not expected:
        return {"status": "not-required"}
    actual = fact.get("directCaller")
    if not actual:
        return {"status": "CLI 未提供", "provided": False}
    wrong = [
        field for field in ("name", "line", "kind")
        if expected.get(field) is not None and actual.get(field) != expected.get(field)
    ]
    return {"status": "wrong" if wrong else "correct", "provided": True,
            "actual": actual, "wrong": wrong}


def score_target(call, record):
    fact = record.get("fact") or {}
    expected = call.get("target") or {}
    kind = call.get("targetKind", "unknown")
    runtime = call.get("runtime", "not-determined")
    wrong = []
    if kind in ("concrete", "trait-declaration"):
        actual = normalize_target(fact)
        if not actual or actual.get("line") is None:
            wrong.append("target-missing")
        else:
            for field in TARGET_FIELDS:
                if expected.get(field) is None:
                    continue
                value = actual.get(field)
                if value is not None and value != expected.get(field):
                    wrong.append(f"target-{field}")
            if kind == "trait-declaration" and fact.get("resolution") in CONCRETE_RESOLUTIONS:
                wrong.append("candidate-promoted")
    else:
        if fact.get("target") and fact.get("resolution") != "unresolved":
            wrong.append("unknown-claimed")
    if runtime == "not-determined" and record.get("runtimeTarget") not in (None, "not-determined"):
        wrong.append("runtime-claimed")
    return wrong


def displayed_target_class(pool_name, fact):
    if not fact.get("target") or fact.get("resolution") == "unresolved":
        return "unknown"
    if pool_name in ("interfaceCandidates", "traitCandidates"):
        return "candidate"
    if fact.get("receiverInterface") or str(fact.get("resolution", "")).startswith("rust-trait"):
        return "candidate"
    return "determined"


def classify_extra(pool_name, record, seen, scored):
    fact = record.get("fact") or {}
    position = fact_position(record)
    key = (pool_name, tuple(position.get(field) for field in POSITION_FIELDS))
    reasons = []
    if key in seen:
        reasons.append("duplicate-record")
    for index, call in scored.items():
        if inventory_ok(call, pool_name) and position_matches(expected_position(call), position):
            reasons.append("duplicate-of-scored-call")
            break
    if fact.get("resolution") == "unresolved" and fact.get("target"):
        reasons.append("unresolved-with-target")
    target = fact.get("target")
    if isinstance(target, dict) and not (target.get("file") or fact.get("file")):
        reasons.append("target-without-location")
    navigation = record.get("navigation") or {}
    if navigation.get("status") not in (None, "valid"):
        reasons.append("navigation-invalid")
    return {
        "index": None,
        "pool": pool_name,
        "position": position,
        "classification": "proven-error" if reasons else "needs-source-review",
        "reasons": reasons,
        "target": normalize_target(fact),
        "resolution": fact.get("resolution"),
    }


def score_head(case, head):
    found = {}
    scored = {}
    results = []
    extras = []
    seen = set()
    for name in POOLS:
        _, items = pool_items(head, name)
        for record in items:
            position = fact_position(record)
            key = (name, tuple(position.get(field) for field in POSITION_FIELDS))
            index = None
            for candidate_index, call in enumerate(case["expectedCalls"]):
                if candidate_index in found:
                    continue
                if not inventory_ok(call, name):
                    continue
                if position_matches(expected_position(call), position):
                    index = candidate_index
                    break
            if index is None:
                extras.append(classify_extra(name, record, seen, scored))
                seen.add(key)
                continue
            seen.add(key)
            found[index] = record
            scored[index] = case["expectedCalls"][index]
            fact = record.get("fact") or {}
            caller = score_direct_caller(case["expectedCalls"][index], fact)
            target_wrong = score_target(case["expectedCalls"][index], record)
            results.append({
                "index": index,
                "pool": name,
                "position": position,
                "status": "wrong" if caller["status"] == "wrong" or target_wrong else "correct",
                "directCaller": caller,
                "targetWrong": target_wrong,
                "runtimeTarget": record.get("runtimeTarget"),
                "targetClass": displayed_target_class(name, fact),
                "target": normalize_target(fact),
            })

    implementation_rows = []
    interface_pool = (head.get("interfaceCandidates") or {}).get("implementations") or {}
    implementation_rows += interface_pool.get("items") or []
    implementation_rows += (head.get("traitCandidates") or {}).get("implementations") or []
    implementation_names = sorted({
        ((row.get("implementation") or {}).get("method")
         or (row.get("implementation")
             if row.get("implementation") and not row["implementation"].get("method") else None)
         or row.get("method") or {}).get("qualname")
        for row in implementation_rows
        if ((row.get("implementation") or {}).get("method")
            or row.get("implementation") or row.get("method"))
    })
    missing_implementations = [
        name for name in case.get("expectedImplementations", [])
        if name not in implementation_names
    ]
    missed = [{"index": index, "call": call}
              for index, call in enumerate(case["expectedCalls"]) if index not in found]
    wrong = [row for row in results if row["status"] == "wrong"]
    proven_extras = [row for row in extras if row["classification"] == "proven-error"]
    review_extras = [row for row in extras if row["classification"] == "needs-source-review"]
    callers = [row["directCaller"]["status"] for row in results]
    displayed = {"determined": 0, "candidate": 0, "unknown": 0}
    for row in results:
        displayed[row["targetClass"]] += 1
    expected_display = {
        "determined": sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "concrete"),
        "candidate": sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "trait-declaration"),
        "unknown": sum(1 for call in case["expectedCalls"] if call.get("targetKind") == "unknown"),
    }
    if wrong or missing_implementations or proven_extras:
        status = "fail"
    elif case.get("expectedGap"):
        status = "gap"
    elif missed:
        status = "fail"
    elif review_extras:
        status = "review"
    else:
        status = "pass"
    return {
        "definitionFound": True,
        "definition": head.get("definition"),
        "expectedCalls": len(case["expectedCalls"]),
        "foundCalls": len(found),
        "correctCalls": len(results) - len(wrong),
        "wrongCalls": len(wrong),
        "missedCalls": len(missed),
        "extraCalls": len(extras),
        "extraProvenErrors": len(proven_extras),
        "extraNeedsReview": len(review_extras),
        "displayedTargets": displayed,
        "expectedTargets": expected_display,
        "determinedTargets": expected_display["determined"],
        "candidateTargets": expected_display["candidate"],
        "unknownTargets": expected_display["unknown"],
        "directCallerStatus": {status: callers.count(status) for status in sorted(set(callers))},
        "items": results,
        "missed": missed,
        "extras": extras,
        "implementations": implementation_names,
        "missingImplementations": missing_implementations,
        "consideredRecords": len(found) + len(extras),
        "expectedGap": bool(case.get("expectedGap")),
        "status": status,
    }


def score_case(case, query):
    """The single scoring entry used by real runs and counterexamples."""
    scope = case.get("definitionScope", "changed")
    row = find_definition(query, case["changedDefinition"], scope)
    if not row:
        return {
            "definitionFound": False,
            "expectedCalls": len(case["expectedCalls"]),
            "foundCalls": 0,
            "correctCalls": 0,
            "wrongCalls": 0,
            "missedCalls": len(case["expectedCalls"]),
            "extraCalls": 0,
            "extraProvenErrors": 0,
            "extraNeedsReview": 0,
            "displayedTargets": {"determined": 0, "candidate": 0, "unknown": 0},
            "extras": [],
            "missingImplementations": [],
            "status": "fail",
        }
    return score_head(case, row)


def locate_matches(case, query):
    """Return the head and (record, pool, expected call index) references."""
    scope = case.get("definitionScope", "changed")
    head = find_definition(query, case["changedDefinition"], scope)
    if not head:
        return None, []
    matches = []
    for name in POOLS:
        _, items = pool_items(head, name)
        for record in items:
            position = fact_position(record)
            for index, call in enumerate(case["expectedCalls"]):
                if not inventory_ok(call, name):
                    continue
                if position_matches(expected_position(call), position):
                    matches.append({"head": head, "pool": name, "record": record,
                                    "call": call, "index": index})
    return head, matches


def first_match(matches, predicate):
    for match in matches:
        if predicate(match):
            return match
    return None


def injected_query(case, query, kind):
    mutated = copy.deepcopy(query)
    head, matches = locate_matches(case, mutated)
    if not matches:
        return mutated, {"kind": kind, "available": False, "reason": "no-scored-record"}
    detail = {}
    if kind == "delete-target":
        match = first_match(matches, lambda item: item["call"].get("targetKind") == "concrete")
        if not match:
            return mutated, {"kind": kind, "available": False,
                             "reason": "no-concrete-target-record"}
        match["record"].get("fact", {}).pop("target", None)
        detail = {"index": match["index"], "pool": match["pool"]}
    elif kind == "wrong-declaration":
        match = first_match(matches, lambda item: (item["record"].get("fact") or {}).get("target"))
        if not match:
            return mutated, {"kind": kind, "available": False, "reason": "no-target-record"}
        target = match["record"]["fact"]["target"]
        target["line"] = (target.get("line") or 0) + 1
        detail = {"index": match["index"], "pool": match["pool"]}
    elif kind == "extra-call":
        match = matches[0]
        clone = copy.deepcopy(match["record"])
        clone_fact = clone.setdefault("fact", {})
        clone_fact["line"] = (clone_fact.get("line") or 0) + 10000
        if clone_fact.get("endLine") is not None:
            clone_fact["endLine"] = clone_fact["endLine"] + 10000
        clone_fact["factIndex"] = -10000
        pool, _ = pool_items(match["head"], match["pool"])
        pool.setdefault("items", []).append(clone)
        detail = {"injectedLine": clone_fact["line"], "pool": match["pool"]}
    elif kind == "duplicate-call":
        match = matches[0]
        clone = copy.deepcopy(match["record"])
        clone.setdefault("fact", {})["factIndex"] = -10001
        pool, _ = pool_items(match["head"], match["pool"])
        pool.setdefault("items", []).append(clone)
        detail = {"index": match["index"], "pool": match["pool"],
                  "position": fact_position(clone)}
    elif kind == "wrong-direct-caller":
        match = first_match(
            matches,
            lambda item: item["call"].get("directCaller")
            and (item["record"].get("fact") or {}).get("directCaller"),
        )
        if not match:
            return mutated, {"kind": kind, "available": False,
                             "reason": "no-direct-caller-record"}
        caller = match["record"]["fact"]["directCaller"]
        caller["name"] = f"{caller.get('name')}-mutated"
        caller["line"] = (caller.get("line") or 0) + 1
        detail = {"index": match["index"], "pool": match["pool"]}
    elif kind == "promote-candidate":
        match = first_match(matches, lambda item: item["call"].get("targetKind") == "trait-declaration")
        if not match:
            return mutated, {"kind": kind, "available": False,
                             "reason": "no-candidate-target-record"}
        changed = case["changedDefinition"]
        fact = match["record"].setdefault("fact", {})
        fact["resolution"] = "rust-trait-impl" if case["language"] == "rust" else "go-direct-method"
        fact["target"] = {
            "file": changed["file"],
            "line": changed["line"],
            "column": (match["call"].get("target") or {}).get("column", 1),
            "name": (match["call"].get("target") or {}).get("name")
            or changed.get("qualname", "").rsplit("::", 1)[-1],
        }
        detail = {"index": match["index"], "pool": match["pool"]}
    elif kind == "omit-target-file":
        match = first_match(
            matches,
            lambda item: (item["record"].get("fact") or {}).get("target", {}).get("file")
            == (item["record"].get("fact") or {}).get("file"),
        )
        if not match:
            return mutated, {"kind": kind, "available": False,
                             "reason": "no-same-file-target"}
        match["record"]["fact"]["target"].pop("file", None)
        detail = {"index": match["index"], "pool": match["pool"]}
    elif kind == "omit-end-position":
        match = first_match(
            matches,
            lambda item: (item["record"].get("fact") or {}).get("endLine") is not None,
        )
        if not match:
            return mutated, {"kind": kind, "available": False,
                             "reason": "no-end-position"}
        match["record"]["fact"].pop("endLine", None)
        match["record"]["fact"].pop("endColumn", None)
        detail = {"index": match["index"], "pool": match["pool"]}
    else:
        raise ValueError(kind)
    return mutated, {"kind": kind, "available": True, **detail}


def result_for(report, index):
    for item in report.get("items") or []:
        if item.get("index") == index:
            return item
    return None


def evaluate_counterexample(kind, before, after, detail):
    if not detail.get("available"):
        return {"kind": kind, "detected": False, "available": False,
                "reason": detail.get("reason")}
    before_call = result_for(before, detail.get("index"))
    after_call = result_for(after, detail.get("index"))
    if kind == "delete-target":
        detected = bool(after_call) and "target-missing" in after_call.get("targetWrong", [])
    elif kind == "wrong-declaration":
        detected = bool(after_call) and any(
            reason in ("target-line", "target-file", "target-column")
            for reason in after_call.get("targetWrong", [])
        )
    elif kind == "extra-call":
        injected_line = detail.get("injectedLine")
        injected = next(
            (row for row in after.get("extras") or []
             if (row.get("position") or {}).get("line") == injected_line),
            None,
        )
        detected = bool(injected) and injected.get("classification") == "needs-source-review"
    elif kind == "duplicate-call":
        injected = next(
            (row for row in after.get("extras") or []
             if row.get("classification") == "proven-error"
             and "duplicate-record" in (row.get("reasons") or [])
             and (row.get("position") or {}).get("line")
             == (detail.get("position") or {}).get("line")),
            None,
        )
        detected = bool(injected)
    elif kind == "wrong-direct-caller":
        detected = bool(after_call) and after_call.get("directCaller", {}).get("status") == "wrong"
    elif kind == "promote-candidate":
        detected = bool(after_call) and "candidate-promoted" in after_call.get("targetWrong", [])
    elif kind == "omit-target-file":
        detected = bool(after_call) and after_call.get("status") == "correct"
    elif kind == "omit-end-position":
        detected = bool(after_call) and after_call.get("status") == "correct"
    else:
        raise ValueError(kind)
    return {
        "kind": kind,
        "available": True,
        "detected": detected,
        "callIndex": detail.get("index"),
        "pool": detail.get("pool"),
        "beforeStatus": before_call.get("status") if before_call else None,
        "afterStatus": after_call.get("status") if after_call else None,
        "beforeWrong": before_call.get("targetWrong") if before_call else None,
        "afterWrong": after_call.get("targetWrong") if after_call else None,
        "beforeExtras": len(before.get("extras") or []),
        "afterExtras": len(after.get("extras") or []),
    }


def run_counterexamples(case, query):
    report = {"id": case["id"], "checks": []}
    _, matches = locate_matches(case, query)
    if not matches:
        report["skipped"] = "no-scored-record"
        report["passed"] = True
        return report
    base = score_case(case, query)
    for kind in MUST_DETECT + CONTROLS:
        mutated, detail = injected_query(case, query, kind)
        after = score_case(case, mutated)
        check = evaluate_counterexample(kind, base, after, detail)
        check["expectation"] = "preserve" if kind in CONTROLS else "detect"
        check["passed"] = check["detected"] if check["available"] else True
        report["checks"].append(check)
    report["passed"] = all(check["passed"] for check in report["checks"])
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--out", default=str(EVIDENCE))
    parser.add_argument("--case", action="append")
    parser.add_argument("--include-reserved", action="store_true")
    parser.add_argument("--skip-counterexamples", action="store_true")
    parser.add_argument("--saved", action="store_true",
                        help="rescore queries already saved under <out>/queries")
    args = parser.parse_args()
    out_dir = Path(args.out)
    samples = Path(args.samples)
    summary = {"cli": str(Path(args.cli).resolve()), "cases": [], "counterexamples": [], "totals": {}}
    for case in load_cases(args.include_reserved, args.case):
        if args.saved:
            saved_query = json.loads((out_dir / "queries" / f"{case['id']}.json").read_text())
            exit_code = None
        else:
            _, exit_code = run_query(Path(args.cli), case, samples, out_dir / "queries")
            saved_query = json.loads((out_dir / "queries" / f"{case['id']}.json").read_text())
        report = score_case(case, saved_query)
        report.update({"id": case["id"], "language": case["language"], "repo": case["repo"],
                       "base": case["base"], "head": case["head"], "reserved": bool(case.get("reserved")),
                       "regression": bool(case.get("regression")),
                       "definitionScope": case.get("definitionScope", "changed"),
                       "exitCode": exit_code, "queryStatus": saved_query.get("status")})
        summary["cases"].append(report)
        if not args.skip_counterexamples:
            summary["counterexamples"].append(run_counterexamples(case, saved_query))
        print(f"{case['id']}: {report['status']} found={report.get('foundCalls')}/"
              f"{report['expectedCalls']} wrong={report['wrongCalls']} missed={report['missedCalls']} "
              f"extras={report.get('extraCalls')} query={saved_query.get('status')} "
              f"callers={report.get('directCallerStatus')}")
    keys = ("expectedCalls", "foundCalls", "correctCalls", "wrongCalls", "missedCalls",
            "extraCalls", "extraProvenErrors", "extraNeedsReview", "missingImplementations",
            "determinedTargets", "candidateTargets", "unknownTargets")
    summary["totals"] = {
        key: sum(len(row.get(key, [])) if isinstance(row.get(key), list) else (row.get(key) or 0)
                 for row in summary["cases"])
        for key in keys
    }
    displayed = {"determined": 0, "candidate": 0, "unknown": 0}
    for row in summary["cases"]:
        for name, value in (row.get("displayedTargets") or {}).items():
            displayed[name] += value
    summary["totals"]["displayedDeterminedTargets"] = displayed["determined"]
    summary["totals"]["displayedCandidateTargets"] = displayed["candidate"]
    summary["totals"]["displayedUnknownTargets"] = displayed["unknown"]
    summary["totals"]["definitionsFound"] = sum(
        1 for row in summary["cases"] if row.get("definitionFound"))
    summary["totals"]["cases"] = len(summary["cases"])
    counter_checks = [check for row in summary["counterexamples"] for check in row["checks"]]
    coverage = {kind: sum(1 for check in counter_checks
                          if check["kind"] == kind and check["available"])
                for kind in MUST_DETECT + CONTROLS}
    uncovered = [kind for kind in MUST_DETECT + CONTROLS if coverage[kind] == 0]
    summary["totals"]["counterexamples"] = len(counter_checks)
    summary["totals"]["counterexamplesPassed"] = sum(1 for check in counter_checks if check["passed"])
    summary["totals"]["counterexampleCoverage"] = coverage
    summary["totals"]["counterexamplesUncovered"] = uncovered
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (out_dir / "counterexamples.json").write_text(
        json.dumps(summary["counterexamples"], indent=2) + "\n")
    print(json.dumps(summary["totals"], indent=2))
    cases_ok = all(row["status"] in ("pass", "gap", "review") for row in summary["cases"])
    counters_ok = (
        all(row["passed"] for row in summary["counterexamples"])
        and (bool(args.case) or not uncovered)
    ) if summary["counterexamples"] else True
    return 0 if cases_ok and counters_ok else 1


if __name__ == "__main__":
    sys.exit(main())
