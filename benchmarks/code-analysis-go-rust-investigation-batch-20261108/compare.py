#!/usr/bin/env python3
"""Compare two complete batch runs case by case.

Both runs must use the same case files and the same sample roots. The report
keeps hits, wrong targets, misses, extras, displayed target classes and the
extractor identity separate so a version change cannot hide behind totals.
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES = HERE / "cases"
SCOPES = ("new", "regression", "reserved-go", "reserved-rust")


def load_run(directory):
    directory = Path(directory)
    summary = json.loads((directory / "summary.json").read_text())
    rows = {row["id"]: row for row in summary["cases"]}
    identities = {}
    for case_id in rows:
        query_path = directory / "queries" / f"{case_id}.json"
        if not query_path.exists():
            continue
        query = json.loads(query_path.read_text())
        side = (query.get("sides") or {}).get("head") or {}
        identities[case_id] = {
            "producer": side.get("producer"),
            "callModel": side.get("callModel"),
            "snapshotId": (side.get("snapshot") or {}).get("snapshotId"),
        }
    return summary, rows, identities


def case_scope(case):
    if case.get("regression"):
        return "regression"
    if case.get("reserved"):
        return "reserved-go" if case["language"] == "go" else "reserved-rust"
    return "new"


def compact(row):
    displayed = row.get("displayedTargets") or {}
    return {
        "status": row.get("status"),
        "expected": row.get("expectedCalls"),
        "found": row.get("foundCalls"),
        "correct": row.get("correctCalls"),
        "wrong": row.get("wrongCalls"),
        "missed": row.get("missedCalls"),
        "extras": row.get("extraCalls"),
        "extraProvenErrors": row.get("extraProvenErrors"),
        "extraNeedsReview": row.get("extraNeedsReview"),
        "displayed": {
            "determined": displayed.get("determined", 0),
            "candidate": displayed.get("candidate", 0),
            "unknown": displayed.get("unknown", 0),
        },
        "directCallerStatus": row.get("directCallerStatus"),
    }


def groups(cases):
    grouped = {}
    for case in cases:
        if case.get("regression"):
            continue
        key = (case["base"], case["head"])
        grouped.setdefault(key, []).append(case["id"])
    return grouped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-dir", default=str(HERE / "evidence" / "stage-baseline"))
    parser.add_argument("--candidate-dir", default=str(HERE / "evidence" / "final"))
    parser.add_argument("--out", default=str(HERE / "evidence" / "comparison"))
    args = parser.parse_args()
    baseline, baseline_rows, baseline_ids = load_run(args.baseline_dir)
    candidate, candidate_rows, candidate_ids = load_run(args.candidate_dir)
    cases = {case["id"]: case for case in
             (json.loads(path.read_text()) for path in sorted(CASES.glob("*.json")))}
    rows = []
    for case_id, case in cases.items():
        base_row = baseline_rows.get(case_id)
        cand_row = candidate_rows.get(case_id)
        rows.append({
            "id": case_id,
            "language": case["language"],
            "repo": case["repo"],
            "base": case["base"],
            "head": case["head"],
            "scope": case_scope(case),
            "baseline": compact(base_row) if base_row else None,
            "candidate": compact(cand_row) if cand_row else None,
            "baselineIdentity": baseline_ids.get(case_id),
            "candidateIdentity": candidate_ids.get(case_id),
        })
    scopes = {}
    for scope in SCOPES:
        selected = [row for row in rows if row["scope"] == scope]
        scopes[scope] = {
            "cases": [row["id"] for row in selected],
            "baselineFound": sum(row["baseline"]["found"] for row in selected if row["baseline"]),
            "candidateFound": sum(row["candidate"]["found"] for row in selected if row["candidate"]),
            "baselineWrong": sum(row["baseline"]["wrong"] for row in selected if row["baseline"]),
            "candidateWrong": sum(row["candidate"]["wrong"] for row in selected if row["candidate"]),
            "baselineMissed": sum(row["baseline"]["missed"] for row in selected if row["baseline"]),
            "candidateMissed": sum(row["candidate"]["missed"] for row in selected if row["candidate"]),
            "baselineExtras": sum(row["baseline"]["extras"] for row in selected if row["baseline"]),
            "candidateExtras": sum(row["candidate"]["extras"] for row in selected if row["candidate"]),
        }
    change_groups = {
        f"{base[:8]}->{head[:8]}": ids
        for (base, head), ids in sorted(groups(cases.values()).items())
    }
    report = {
        "baseline": str(Path(args.baseline_dir).resolve()),
        "candidate": str(Path(args.candidate_dir).resolve()),
        "caseCount": len(rows),
        "changeGroups": change_groups,
        "changeGroupCount": len(change_groups),
        "scopes": scopes,
        "rows": rows,
        "totals": {
            "baseline": baseline.get("totals"),
            "candidate": candidate.get("totals"),
        },
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [
        "# Baseline vs candidate",
        "",
        f"- baseline: `{report['baseline']}`",
        f"- candidate: `{report['candidate']}`",
        f"- cases: {report['caseCount']}",
        f"- new change groups: {report['changeGroupCount']}",
        "",
        "| Case | Scope | Lang | Expected | Baseline found/wrong/missed/extras | Candidate found/wrong/missed/extras | Baseline displayed d/c/u | Candidate displayed d/c/u |",
        "| --- | --- | --- | ---: | --- | --- | --- | --- |",
    ]
    for row in rows:
        base = row["baseline"] or {}
        cand = row["candidate"] or {}
        bd = base.get("displayed") or {}
        cd = cand.get("displayed") or {}
        lines.append(
            f"| {row['id']} | {row['scope']} | {row['language']} | {base.get('expected', '?')} | "
            f"{base.get('found')}/{base.get('wrong')}/{base.get('missed')}/{base.get('extras')} | "
            f"{cand.get('found')}/{cand.get('wrong')}/{cand.get('missed')}/{cand.get('extras')} | "
            f"{bd.get('determined', 0)}/{bd.get('candidate', 0)}/{bd.get('unknown', 0)} | "
            f"{cd.get('determined', 0)}/{cd.get('candidate', 0)}/{cd.get('unknown', 0)} |"
        )
    lines += ["", "## Scopes", ""]
    for scope, data in scopes.items():
        lines.append(
            f"- {scope}: baseline {data['baselineFound']} found, {data['baselineWrong']} wrong, "
            f"{data['baselineMissed']} missed, {data['baselineExtras']} extras; "
            f"candidate {data['candidateFound']} found, {data['candidateWrong']} wrong, "
            f"{data['candidateMissed']} missed, {data['candidateExtras']} extras"
        )
    lines += ["", "## New change groups", ""]
    for key, ids in change_groups.items():
        lines.append(f"- `{key}`: {', '.join(ids)}")
    (out / "comparison.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
