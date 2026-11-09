#!/usr/bin/env python3
"""Run and score the frozen bytes forwarding case with the shared scorer."""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent / "code-analysis-go-rust-investigation-batch-20261108"
sys.path.insert(0, str(HARNESS))
from run import run_query, score_case, find_definition, pool_items, fact_position, position_matches, POOLS  # noqa: E402


def score_templates(case, query):
    head = find_definition(query, case["changedDefinition"], case.get("definitionScope", "changed")) or {}
    checks = []
    for call in case["expectedCalls"]:
        expected = call.get("macroTemplate")
        if not expected:
            continue
        records = [record for pool in POOLS for record in pool_items(head, pool)[1]
                   if position_matches(call, fact_position(record))]
        fact = (records[0].get("fact") or {}) if len(records) == 1 else {}
        actual = fact.get("macroTemplate") or {}
        normalize = lambda origin: {key: "".join(value.split()) if key in ("selfType", "trait") else value
                                    for key, value in origin.items()}
        origins = sorted((normalize(origin) for origin in actual.get("expansions", [])), key=lambda origin: json.dumps(origin, sort_keys=True))
        wanted = sorted((normalize(origin) for origin in expected["expansions"]), key=lambda origin: json.dumps(origin, sort_keys=True))
        caller = fact.get("directCaller") or {}
        checks.append({"line": call["line"], "definition": actual.get("definition") == expected["definition"],
                       "expansions": origins == wanted,
                       "templateCaller": caller.get("qualname", "").endswith("::" + expected["definition"]["name"] + "!::" + call["directCaller"]["name"]),
                       "actual": actual, "directCaller": caller})
    return {"checks": checks, "passed": all(row["definition"] and row["expansions"] and row["templateCaller"] for row in checks)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--case", default=str(HERE / "cases" / "bytes-try-get-int.json"))
    parser.add_argument("--out", required=True)
    parser.add_argument("--require-templates", action="store_true")
    args = parser.parse_args()
    case = json.loads(Path(args.case).read_text())
    out = Path(args.out)
    query, exit_code = run_query(Path(args.cli), case, Path(args.samples), out / "queries")
    report = score_case(case, query)
    report.update({"id": case["id"], "exitCode": exit_code,
                   "queryStatus": query.get("status"), "callModel": (query.get("sides") or {}).get("head", {}).get("callModel")})
    templates = score_templates(case, query)
    summary = {"cli": str(Path(args.cli).resolve()), "case": case, "score": report, "macroTemplates": templates}
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: report.get(key) for key in
                      ("status", "expectedCalls", "foundCalls", "correctCalls", "wrongCalls",
                       "missedCalls", "extraCalls", "extraNeedsReview", "callModel")}, indent=2))
    print(json.dumps({"macroTemplates": templates}, indent=2))
    return 0 if report.get("status") in ("pass", "gap", "review") and not report.get("wrongCalls") and (not args.require_templates or bool(templates["checks"]) and templates["passed"]) else 1


if __name__ == "__main__":
    sys.exit(main())
