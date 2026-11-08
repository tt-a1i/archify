#!/usr/bin/env python3
"""Reproduce the Go interface-anchor comparison at the fixed commits."""
import argparse
import json
import os
import shutil
import subprocess
import sys


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(command)}")
    return result.stdout


def capture(cli, root, out):
    if os.path.exists(out):
        shutil.rmtree(out)
    run(["node", cli, root, "--language", "go", "--out", out, "--fail-on", "never", "--json"])
    with open(os.path.join(out, "raw-facts.json"), encoding="utf-8") as source:
        return json.load(source)


def references(gopls, root, position):
    output = run([os.path.abspath(gopls), "references", position], cwd=root)
    rows = []
    for line in output.strip().splitlines():
        path, line_number, columns = line.rsplit(":", 2)
        start = int(columns.split("-")[0])
        rows.append({"file": os.path.relpath(path, root), "line": int(line_number), "column": start})
    return rows


def compare(facts, refs, target_name):
    by_line = {}
    for call in facts["calls"]:
        by_line.setdefault((call["file"], call["line"]), []).append(call)
    stats = {"references": len(refs), "correct": 0, "wrong": 0, "missed": 0, "unknown": 0,
             "wrongTargets": [], "missedAt": []}
    for ref in refs:
        calls = by_line.get((ref["file"], ref["line"]), [])
        inside = [call for call in calls if call["column"] <= ref["column"] <= call["endColumn"]]
        call = min(inside, key=lambda item: item["endColumn"] - item["column"], default=None)
        if call is None:
            stats["unknown"] += 1
            continue
        target = call.get("target")
        if target and target["name"] == target_name:
            stats["correct"] += 1
        elif target:
            stats["wrong"] += 1
            stats["wrongTargets"].append({"at": f"{ref['file']}:{ref['line']}", "target": target})
        else:
            stats["missed"] += 1
            stats["missedAt"].append(f"{ref['file']}:{ref['line']} {call.get('reason', '')}")
    return stats


def study(name, baseline_cli, baseline_root, fixed_cli, head_root, gopls, position, target, out):
    baseline = capture(baseline_cli, head_root, os.path.join(out, name, "baseline"))
    fixed = capture(fixed_cli, head_root, os.path.join(out, name, "fixed"))
    refs = references(gopls, head_root, position)
    baseline_stats = compare(baseline, refs, target)
    fixed_stats = compare(fixed, refs, target)
    interface_calls = [call for call in fixed["calls"] if call["resolution"] == "go-interface-method"]
    starts = {
        (record["file"], record["line"], record["sourceRange"]["column"], record["name"])
        for record in fixed["functions"]
        if (record.get("definition") or {}).get("kind") == "InterfaceMethod"
    }
    reached = {
        ((call.get("target") or {}).get("file") or call["file"],
         (call.get("target") or {}).get("line"),
         (call.get("target") or {}).get("name"))
        for call in interface_calls
    }
    unmatched = [call for call in interface_calls
                 if ((call.get("target") or {}).get("file") or call["file"],
                     (call.get("target") or {}).get("line"),
                     (call.get("target") or {}).get("column"),
                     (call.get("target") or {}).get("name")) not in starts]
    summary = {
        "repository": name,
        "base_head": head_root,
        "referencePosition": position,
        "target": target,
        "before": baseline_stats,
        "after": fixed_stats,
        "interfaceCalls": len(interface_calls),
        "interfaceDeclarations": len(starts),
        "interfaceDeclarationsReached": len(reached),
        "unmatchedInterfaceTargets": len(unmatched),
        "calls": {"before": len(baseline["calls"]), "after": len(fixed["calls"])},
    }
    with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8") as sink:
        json.dump(summary, sink, indent=2, sort_keys=True)
        sink.write("\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-cli", required=True, help="candidate check.mjs at 0c81af0ea")
    parser.add_argument("--fixed-cli", required=True, help="check.mjs from this branch")
    parser.add_argument("--echo-head", required=True)
    parser.add_argument("--client-head", required=True)
    parser.add_argument("--gopls", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    studies = [
        study("echo", args.baseline_cli, args.echo_head, args.fixed_cli, args.echo_head,
              args.gopls, "context.go:46:2", "RealIP", args.out),
        study("client_golang", args.baseline_cli, args.client_head, args.fixed_cli, args.client_head,
              args.gopls, "prometheus/registry.go:455:20", "Gather", args.out),
    ]
    with open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8") as sink:
        json.dump({"studies": studies}, sink, indent=2, sort_keys=True)
        sink.write("\n")
    print(json.dumps(studies, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
