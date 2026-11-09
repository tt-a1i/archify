#!/usr/bin/env python3
"""Recompute counterexample totals from saved per-check records.

Reads <evidence>/counterexamples.json, where every check records `available`
and `passed`, and updates only the counterexample totals in
<evidence>/summary.json. It does not rerun the CLI. Checks with
`available: false` are reported as not applicable rather than as passes.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from run import CONTROLS, MUST_DETECT  # noqa: E402


def summarize(checks):
    applicable = [check for check in checks if check["available"]]
    coverage = {kind: sum(1 for check in applicable if check["kind"] == kind)
                for kind in MUST_DETECT + CONTROLS}
    return {
        "counterexamples": len(checks),
        "counterexamplesApplicable": len(applicable),
        "counterexamplesApplicablePassed": sum(
            1 for check in applicable if check["passed"]),
        "counterexamplesApplicableFailed": sum(
            1 for check in applicable if not check["passed"]),
        "counterexamplesNotApplicable": len(checks) - len(applicable),
        "counterexampleCoverage": coverage,
        "counterexamplesUncovered": [
            kind for kind, count in coverage.items() if count == 0],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", action="append", required=True,
                        help="evidence directory containing counterexamples.json")
    parser.add_argument("--check", action="store_true",
                        help="verify the saved totals without writing them")
    args = parser.parse_args()
    failed = False
    for directory in map(Path, args.evidence):
        rows = json.loads((directory / "counterexamples.json").read_text())
        checks = [check for row in rows for check in row["checks"]]
        totals = summarize(checks)
        summary_path = directory / "summary.json"
        summary = json.loads(summary_path.read_text())
        if args.check:
            saved = {key: summary["totals"].get(key) for key in totals}
            if saved != totals:
                print(f"{directory}: saved totals differ from per-check records",
                      file=sys.stderr)
                failed = True
        else:
            summary["totals"].pop("counterexamplesPassed", None)
            summary["totals"].update(totals)
            summary_path.write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps({"evidence": str(directory), **totals}, indent=2))
        if totals["counterexamplesApplicableFailed"]:
            failed = True
        if totals["counterexamplesUncovered"]:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
