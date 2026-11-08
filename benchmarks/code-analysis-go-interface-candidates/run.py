#!/usr/bin/env python3
"""Reproduce the Go change-investigation interface-candidate study.

Inputs are preserved source checkouts at the fixed commits. The baseline CLI is
#1284 (59f1a8005), which resolves direct calls and interface declarations but
does not attach interface-mediated call sites to a changed concrete method.
The candidate CLI adds that attachment. gopls is an independent oracle only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

STUDIES = [
    {
        "name": "echo",
        "repository": "labstack/echo",
        "base": "fa780cd",
        "head": "ebbb855",
        "entry": "context.go",
        "qualname": "*context.RealIP",
        "changed_type": "context",
        "interface": "Context",
        "interface_position": "context.go:46:2",
        "concrete_position": "context.go:298:19",
        "direct_expected": [
            "client_ip_security_test.go:38",
            "context_test.go:81",
            "context_test.go:1306",
        ],
        "candidate_expected": [
            "client_ip_security_test.go:37",
            "client_ip_security_test.go:51",
            "middleware/logger.go:342",
            "middleware/proxy.go:292",
            "middleware/rate_limiter.go:51",
            "middleware/request_logger.go:369",
        ],
    },
    {
        "name": "client",
        "repository": "prometheus/client_golang",
        "base": "7c438e9",
        "head": "8f7c887",
        "entry": "prometheus/registry.go",
        "qualname": "*Registry.Gather",
        "changed_type": "Registry",
        "interface": "Gatherer",
        "interface_position": "prometheus/registry.go:173:2",
        "concrete_position": "prometheus/registry.go:455:20",
        "direct_expected": None,
        "candidate_expected": [
            "prometheus/graphite/bridge.go:171",
            "prometheus/promhttp/http_test.go:81",
            "prometheus/promhttp/http_test.go:1382",
            "prometheus/registry.go:678",
            "prometheus/registry.go:843",
            "prometheus/registry.go:1194",
            "prometheus/testutil/lint.go:38",
            "prometheus/testutil/testutil.go:147",
            "prometheus/testutil/testutil.go:256",
        ],
    },
    {
        "name": "afero",
        "repository": "spf13/afero",
        "base": "effad5e",
        "head": "8d2a95c",
        "entry": "regexpfs.go",
        "qualname": "*RegexpFs.OpenFile",
        "changed_type": "RegexpFs",
        "interface": "Fs",
        "interface_position": "afero.go:74:2",
        "concrete_position": "regexpfs.go:118:20",
        "direct_expected": [],
        "candidate_expected": [
            "afero_test.go:88",
            "afero_test.go:96",
            "afero_test.go:104",
            "afero_test.go:117",
            "basepath_copy_test.go:41",
            "basepath_test.go:267",
            "basepath.go:163",
            "cacheOnReadFs.go:224",
            "cacheOnReadFs.go:228",
            "cacheOnReadFs.go:235",
            "composite_test.go:127",
            "copyOnWriteFs.go:218",
            "copyOnWriteFs.go:230",
            "copyOnWriteFs.go:238",
            "copyOnWriteFs.go:248",
            "copyOnWriteFs.go:250",
            "httpFs.go:97",
            "iofs_test.go:38",
            "iofs_test.go:66",
            "ioutil.go:127",
            "ioutil.go:196",
            "memmap_test.go:85",
            "memmap_test.go:123",
            "memmap_test.go:131",
            "memmap_test.go:151",
            "memmap_test.go:225",
            "memmap_test.go:298",
            "memmap_test.go:657",
            "memmap_test.go:684",
            "memmap_test.go:1138",
            "readonlyfs.go:79",
            "regexpfs_test.go:54",
            "regexpfs_test.go:89",
            "regexpfs_test.go:118",
            "regexpfs.go:128",
            "tarfs/tarfs_test.go:310",
            "tarfs/tarfs_test.go:324",
            "unionFile.go:330",
        ],
    },
]

GOPLS_LINE = re.compile(r"^(.*):(\d+):(\d+)(?:-\d+)?$")


def run(command: list[str], cwd: Path, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=timeout)


def run_question(cli: Path, root: Path, base: Path, entry: str, question: str, out: Path) -> dict:
    command = [
        shutil.which("node") or "node",
        str(cli),
        "--question", question,
        "--entry", entry,
        "--base-root", str(base),
        "--root", str(root),
        "--format", "json",
        "--out", str(out),
    ]
    result = run(command, cwd=root)
    if result.returncode != 0 or not out.exists():
        raise RuntimeError(f"change question failed ({result.returncode}): {result.stderr.strip()}")
    return json.loads(out.read_text())


def changed_definition(question: dict, qualname: str) -> dict:
    rows = question.get("changedDefinitions", {}).get("items", [])
    for row in rows:
        head = row.get("head") or {}
        definition = head.get("definition") or {}
        if definition.get("qualname") == qualname:
            return row
    raise RuntimeError(f"changed definition not found: {qualname}")


def positions(rows: list[dict]) -> list[str]:
    return sorted(f"{row['fact']['file']}:{row['fact']['line']}" for row in rows)


def classify(expected: set[str], actual: set[str]) -> dict:
    return {
        "expected": sorted(expected),
        "actual": sorted(actual),
        "correct": len(expected & actual),
        "wrong": sorted(actual - expected),
        "missed": sorted(expected - actual),
    }


def gopls_positions(gopls: Path, root: Path, position: str) -> list[str]:
    result = run([str(gopls), "references", position], cwd=root)
    if result.returncode != 0:
        raise RuntimeError(f"gopls references {position} failed: {result.stderr.strip()}")
    found = set()
    for line in result.stdout.splitlines():
        match = GOPLS_LINE.match(line.strip())
        if not match:
            continue
        path, line_no, _ = match.groups()
        found.add(f"{os.path.relpath(path, root)}:{line_no}")
    return sorted(found)


def gopls_implementations(gopls: Path, root: Path, position: str) -> list[str]:
    result = run([str(gopls), "implementation", position], cwd=root)
    if result.returncode != 0:
        raise RuntimeError(f"gopls implementation {position} failed: {result.stderr.strip()}")
    found = set()
    for line in result.stdout.splitlines():
        match = GOPLS_LINE.match(line.strip())
        if not match:
            continue
        path, line_no, _ = match.groups()
        found.add(f"{os.path.relpath(path, root)}:{line_no}")
    return sorted(found)


def study_one(study: dict, candidate_cli: Path, baseline_cli: Path, samples: Path, gopls: Path | None, out: Path) -> dict:
    root = samples / f"{study['name']}-head"
    base = samples / f"{study['name']}-base"
    if not root.is_dir() or not base.is_dir():
        raise RuntimeError(f"missing preserved snapshots for {study['name']}: {root} or {base}")
    question_text = (
        f"I changed {study['qualname']}. Besides direct calls, which interface-mediated "
        "positions should I inspect, and why?"
    )
    baseline = run_question(baseline_cli, root, base, study["entry"], question_text, out / f"baseline-{study['name']}.json")
    after = run_question(candidate_cli, root, base, study["entry"], question_text, out / f"after-{study['name']}.json")
    base_change = changed_definition(baseline, study["qualname"])
    after_change = changed_definition(after, study["qualname"])
    baseline_refs = base_change["head"]["knownReferences"]
    after_refs = after_change["head"]["knownReferences"]
    baseline_direct = set(positions(baseline_refs["items"]))
    direct = set(positions(after_refs["items"]))
    expected_direct = set(study["direct_expected"]) if study["direct_expected"] is not None else baseline_direct
    direct_result = classify(expected_direct, direct)
    direct_result["baseline"] = sorted(baseline_direct)
    direct_result["total"] = {
        "baseline": baseline_refs["total"],
        "after": after_refs["total"],
        "included": len(direct),
        "omitted": after_refs["total"] - len(direct),
        "preserved": after_refs["total"] == baseline_refs["total"],
    }
    direct_result["preserved"] = direct == baseline_direct and after_refs["total"] == baseline_refs["total"]

    candidates = after_change["head"].get("interfaceCandidates")
    if not candidates:
        raise RuntimeError(f"candidate output has no interfaceCandidates for {study['name']}")
    items = candidates.get("items", []) if candidates.get("coverage") == "available" else []
    actual_candidates = set(positions(items))
    expected_candidates = set(study["candidate_expected"])
    candidate_result = classify(expected_candidates, actual_candidates)
    candidate_result["coverage"] = candidates.get("coverage")
    candidate_result["unknown"] = candidates.get("unknown")
    candidate_result["baselineCoverage"] = (changed_definition(baseline, study["qualname"])["head"].get("interfaceCandidates") or {}).get("coverage", "absent")

    wrong_reasons = []
    seen_positions = set()
    implementation_methods = set()
    promoted_types = set()
    for item in items:
        position = f"{item['fact']['file']}:{item['fact']['line']}"
        if position in seen_positions:
            wrong_reasons.append(f"{position}: duplicate candidate")
        seen_positions.add(position)
        if item.get("runtimeTarget") != "not-determined":
            wrong_reasons.append(f"{position}: runtime target was presented as determined")
        if (item.get("interface") or {}).get("qualname") != study["interface"]:
            wrong_reasons.append(f"{position}: unexpected interface {(item.get('interface') or {}).get('qualname')}")
        if not item.get("reason"):
            wrong_reasons.append(f"{position}: missing reason")
        changed = item.get("changedImplementation") or {}
        if (changed.get("type") or {}).get("qualname") != study["changed_type"]:
            wrong_reasons.append(f"{position}: unexpected changed implementation type {(changed.get('type') or {}).get('qualname')}")
        implementations = item.get("implementations", {}).get("items", [])
        if not any((row.get("method") or {}).get("file") == (changed.get("method") or {}).get("file")
                   and (row.get("method") or {}).get("line") == (changed.get("method") or {}).get("line")
                   for row in implementations):
            wrong_reasons.append(f"{position}: changed method missing from implementation chain")
        for row in implementations:
            if row.get("reason") == "promoted-interface-method":
                promoted_types.add(row["type"]["qualname"])
            if row.get("method"):
                implementation_methods.add(f"{row['method']['file']}:{row['method']['line']}")

    specific = {}
    if study["name"] == "client":
        extra = sorted({(row.get("interface") or {}).get("qualname") for row in items} - {study["interface"]})
        if extra:
            wrong_reasons.append(f"unexpected interface families: {extra}")
        specific["transactionalGathererPresent"] = any("Transactional" in (row.get("interface") or {}).get("qualname", "") for row in items)
    if study["name"] == "afero":
        all_impl_types = {row["type"]["qualname"] for item in items for row in item.get("implementations", {}).get("items", [])}
        specific["httpFsPresent"] = "HttpFs" in all_impl_types
        specific["promotedTypes"] = sorted(promoted_types)
        specific["regexpFsPointerOnly"] = all(
            not row.get("valueSatisfies") and row.get("pointerSatisfies")
            for item in items
            for row in item.get("implementations", {}).get("items", [])
            if row["type"]["qualname"] == "RegexpFs"
        )
        if "HttpFs" in all_impl_types:
            wrong_reasons.append("HttpFs was listed as an Fs implementation")
        if "RegexpFs" not in all_impl_types:
            wrong_reasons.append("changed RegexpFs missing from implementation chain")
        for position in ("tarfs/tarfs_test.go:310", "tarfs/tarfs_test.go:324"):
            found = next((item for item in items if f"{item['fact']['file']}:{item['fact']['line']}" == position), None)
            if found is not None and found["fact"].get("receiverPromotion") != "embedded-interface":
                wrong_reasons.append(f"{position}: wrapper call was not marked as embedded-interface")

    gopls_result = None
    if gopls:
        concrete_refs = set(gopls_positions(gopls, root, study["concrete_position"]))
        interface_refs = set(gopls_positions(gopls, root, study["interface_position"]))
        gopls_impls = set(gopls_implementations(gopls, root, study["interface_position"]))
        counts_match = after_refs["total"] + len(items) == len(concrete_refs)
        covered = direct <= concrete_refs and actual_candidates <= concrete_refs
        our_impls = implementation_methods
        gopls_result = {
            "concreteReferences": {"count": len(concrete_refs), "positions": sorted(concrete_refs)},
            "interfaceReferences": {"count": len(interface_refs), "positions": sorted(interface_refs)},
            "countsMatch": counts_match,
            "displayedPositionsCovered": covered,
            "concreteEqualsDirectPlusCandidates": counts_match and covered,
            "omittedDirectNotCompared": after_refs["total"] - len(direct),
            "interfaceReferenceExtras": sorted(interface_refs - concrete_refs),
            "implementations": {"gopls": sorted(gopls_impls), "capturedConcrete": sorted(our_impls),
                                "promotedOnly": sorted(our_impls - gopls_impls), "goplsOnly": sorted(gopls_impls - our_impls)},
        }

    checks = {
        "directPreserved": direct_result["preserved"],
        "directWrong": direct_result["wrong"],
        "directMissed": direct_result["missed"],
        "candidateWrongReasons": wrong_reasons,
        "candidateWrong": candidate_result["wrong"],
        "candidateMissed": candidate_result["missed"],
        "goplsMatches": gopls_result["concreteEqualsDirectPlusCandidates"] if gopls_result else None,
        "specific": specific,
    }
    return {
        "name": study["name"],
        "repository": study["repository"],
        "base": study["base"],
        "head": study["head"],
        "entry": study["entry"],
        "changedDefinition": study["qualname"],
        "interface": study["interface"],
        "baseline": {"status": baseline.get("status"), "direct": {"count": len(baseline_direct), "positions": sorted(baseline_direct)},
                      "interfaceCandidates": (changed_definition(baseline, study["qualname"])["head"].get("interfaceCandidates") or {}).get("coverage", "absent")},
        "after": {"status": after.get("status"), "direct": {"count": after_refs["total"], "included": len(direct), "omitted": after_refs["total"] - len(direct), "positions": sorted(direct)},
                  "interfaceCandidates": {"count": len(items), "coverage": candidates.get("coverage"),
                                           "unknown": candidates.get("unknown"), "items": [
                                               {
                                                   "position": f"{item['fact']['file']}:{item['fact']['line']}",
                                                   "interface": item["interface"]["qualname"],
                                                   "interfaceMethod": item["interfaceMethod"]["qualname"],
                                                   "runtimeTarget": item["runtimeTarget"],
                                                   "reason": item["reason"],
                                                   "promotion": item["fact"].get("receiverPromotion"),
                                                   "changedImplementation": item.get("changedImplementation", {}).get("method", {}).get("qualname"),
                                                   "implementations": {
                                                       "total": item["implementations"]["total"],
                                                       "types": sorted({row["type"]["qualname"] for row in item["implementations"]["items"]}),
                                                   },
                                               } for item in items]}},
        "positions": {"direct": direct_result, "interfaceCandidates": candidate_result},
        "gopls": gopls_result,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-cli", required=True, help="task.mjs from the candidate tree or unpacked ZIP")
    parser.add_argument("--baseline-cli", required=True, help="task.mjs from the #1284 tree")
    parser.add_argument("--samples", required=True, help="directory containing echo-base/head, client-base/head, afero-base/head")
    parser.add_argument("--gopls", help="optional gopls executable for the independent comparison")
    parser.add_argument("--out", required=True, help="output directory")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    samples = Path(args.samples).resolve()
    gopls = Path(args.gopls).resolve() if args.gopls else None
    studies = [study_one(study, Path(args.candidate_cli).resolve(), Path(args.baseline_cli).resolve(), samples, gopls, out)
               for study in STUDIES]
    summary = {
        "note": "Generated by run.py from preserved checkouts at the fixed commits; absolute paths are normalized to repository-relative positions.",
        "scope": {
            "go": "1.27.2", "gopls": "v0.24.0" if gopls else None, "goos": "darwin", "goarch": "arm64",
            "cgo": False, "tests": True, "tags": [], "modules": "root module only",
        },
        "studies": studies,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({study["name"]: {
        "direct": study["after"]["direct"]["count"],
        "candidates": study["after"]["interfaceCandidates"]["count"],
        "wrong": study["positions"]["interfaceCandidates"]["wrong"],
        "missed": study["positions"]["interfaceCandidates"]["missed"],
        "checks": study["checks"],
    } for study in studies}, indent=2, sort_keys=True))
    return 0 if all(not study["checks"]["candidateWrongReasons"] and not study["checks"]["candidateWrong"]
                    and not study["checks"]["candidateMissed"] and study["checks"]["directPreserved"]
                    and (study["checks"]["goplsMatches"] in (True, None)) for study in studies) else 1


if __name__ == "__main__":
    raise SystemExit(main())
