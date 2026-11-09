#!/usr/bin/env python3
"""Run and score the frozen bytes forwarding case with the shared scorer."""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent / "code-analysis-go-rust-investigation-batch-20261108"
sys.path.insert(0, str(HARNESS))
from run import run_query, score_case  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--case", default=str(HERE / "cases" / "bytes-try-get-int.json"))
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    case = json.loads(Path(args.case).read_text())
    out = Path(args.out)
    query, exit_code = run_query(Path(args.cli), case, Path(args.samples), out / "queries")
    report = score_case(case, query)
    report.update({"id": case["id"], "exitCode": exit_code,
                   "queryStatus": query.get("status"), "callModel": (query.get("sides") or {}).get("head", {}).get("callModel")})
    summary = {"cli": str(Path(args.cli).resolve()), "case": case, "score": report}
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: report.get(key) for key in
                      ("status", "expectedCalls", "foundCalls", "correctCalls", "wrongCalls",
                       "missedCalls", "extraCalls", "extraNeedsReview", "callModel")}, indent=2))
    return 0 if report.get("status") in ("pass", "gap", "review") and not report.get("wrongCalls") else 1


if __name__ == "__main__":
    sys.exit(main())
