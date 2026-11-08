#!/usr/bin/env python3
"""Reproduce the Go change-investigation interface-candidate study.

Inputs are preserved source checkouts at the fixed commits. The baseline CLI is
#1284 (59f1a8005), which resolves direct calls and interface declarations but
does not attach interface-mediated call sites to a changed concrete method.
The candidate CLI adds that attachment. gopls is an independent oracle only.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

STUDIES = [
    {
        "name": "echo",
        "repository": "labstack/echo",
        "base": "fa780cd",
        "head": "ebbb855",
        "base_commit": "fa780cdfb02db0c263e3b4212ea8d6afa31e976c",
        "head_commit": "ebbb855f5827b76fb206e267dd91d020000baf66",
        "entry": "context.go",
        "qualname": "*context.RealIP",
        "changed_type": "context",
        "owner": "context",
        "interface": "Context",
        "interface_position": "context.go:46:2",
        "concrete_position": "context.go:298:19",
        "direct_declaration": {"file": "context.go", "line": 298, "column": 1, "name": "RealIP"},
        "interface_declaration": {"file": "context.go", "line": 46, "column": 2, "name": "RealIP"},
        "interface_type_declaration": {"file": "context.go", "line": 20, "column": 6, "name": "Context"},
        "source_markers": [
            {"file": "context.go", "line": 20, "text": "type Context interface"},
            {"file": "context.go", "line": 46, "text": "RealIP() string"},
            {"file": "context.go", "line": 298, "text": "func (c *context) RealIP"},
        ],
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
        "base_commit": "7c438e9a9bf011d011836bc6431bf824b82f17c2",
        "head_commit": "8f7c8876630bc7308740fea042ddc10b9963af54",
        "entry": "prometheus/registry.go",
        "qualname": "*Registry.Gather",
        "changed_type": "Registry",
        "owner": "Registry",
        "interface": "Gatherer",
        "interface_position": "prometheus/registry.go:173:2",
        "concrete_position": "prometheus/registry.go:455:20",
        "direct_declaration": {"file": "prometheus/registry.go", "line": 455, "column": 1, "name": "Gather"},
        "interface_declaration": {"file": "prometheus/registry.go", "line": 173, "column": 2, "name": "Gather"},
        "interface_type_declaration": {"file": "prometheus/registry.go", "line": 153, "column": 6, "name": "Gatherer"},
        "source_markers": [
            {"file": "prometheus/registry.go", "line": 153, "text": "type Gatherer interface"},
            {"file": "prometheus/registry.go", "line": 173, "text": "Gather() ([]*dto.MetricFamily, error)"},
            {"file": "prometheus/registry.go", "line": 455, "text": "func (r *Registry) Gather"},
        ],
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
        "same_name_interface": {
            "qualname": "TransactionalGatherer",
            "interface": {"file": "prometheus/registry.go", "line": 1158, "column": 6, "name": "TransactionalGatherer"},
            "method": {"file": "prometheus/registry.go", "line": 1180, "column": 2, "name": "Gather"},
        },
    },
    {
        "name": "afero",
        "repository": "spf13/afero",
        "base": "effad5e",
        "head": "8d2a95c",
        "base_commit": "effad5ec7dbd98364d26fd13f32761f56d9d7857",
        "head_commit": "8d2a95c25179002d8b1a94a2a613c71ae698332c",
        "entry": "regexpfs.go",
        "qualname": "*RegexpFs.OpenFile",
        "changed_type": "RegexpFs",
        "owner": "RegexpFs",
        "interface": "Fs",
        "interface_position": "afero.go:74:2",
        "concrete_position": "regexpfs.go:118:20",
        "direct_declaration": {"file": "regexpfs.go", "line": 118, "column": 1, "name": "OpenFile"},
        "interface_declaration": {"file": "afero.go", "line": 74, "column": 2, "name": "OpenFile"},
        "interface_type_declaration": {"file": "afero.go", "line": 57, "column": 6, "name": "Fs"},
        "source_markers": [
            {"file": "afero.go", "line": 57, "text": "type Fs interface"},
            {"file": "afero.go", "line": 74, "text": "OpenFile(name string, flag int, perm os.FileMode) (File, error)"},
            {"file": "regexpfs.go", "line": 118, "text": "func (r *RegexpFs) OpenFile"},
        ],
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
IDENTITY_FIELDS = (
    "repositoryVersion",
    "targetFile",
    "declaration",
    "ownerType",
    "ownerDeclaration",
    "method",
    "qualname",
)


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


def ref_position(ref: dict | None) -> str | None:
    if not ref or ref.get("file") is None or ref.get("line") is None or ref.get("column") is None:
        return None
    return f"{ref['file']}:{ref['line']}:{ref['column']}"


def owner_from_qualname(qualname: str | None) -> str | None:
    if not qualname or "." not in qualname:
        return None
    owner = qualname.rsplit(".", 1)[0]
    return owner.lstrip("*")


def expected_identity(study: dict, kind: str) -> dict:
    if kind == "direct":
        declaration = study["direct_declaration"]
        return {
            "repositoryVersion": study["head_commit"],
            "targetFile": declaration["file"],
            "declaration": ref_position(declaration),
            "ownerType": study["owner"],
            "ownerDeclaration": None,
            "method": declaration["name"],
            "qualname": study["qualname"],
        }
    declaration = study["interface_declaration"]
    return {
        "repositoryVersion": study["head_commit"],
        "targetFile": declaration["file"],
        "declaration": ref_position(declaration),
        "ownerType": study["interface"],
        "ownerDeclaration": ref_position(study["interface_type_declaration"]),
        "method": declaration["name"],
        "qualname": f"{study['interface']}.{declaration['name']}",
    }


def actual_identity(kind: str, item: dict, repository_version: str | None, changed_definition_row: dict | None = None) -> dict:
    fact = item.get("fact") or {}
    target = fact.get("target") or {}
    target_file = target.get("file") or fact.get("file")
    target_position = f"{target_file}:{target.get('line')}:{target.get('column')}" if target_file and target.get("line") is not None and target.get("column") is not None else None
    if kind == "direct":
        definition = ((changed_definition_row or {}).get("head") or {}).get("definition") or {}
        qualname = definition.get("qualname")
        return {
            "repositoryVersion": repository_version,
            "targetFile": target_file,
            "declaration": target_position,
            "ownerType": owner_from_qualname(qualname),
            "ownerDeclaration": None,
            "method": target.get("name"),
            "qualname": qualname,
        }
    interface = item.get("interface") or {}
    method = item.get("interfaceMethod") or {}
    return {
        "repositoryVersion": repository_version,
        "targetFile": target_file,
        "declaration": target_position,
        "ownerType": interface.get("qualname"),
        "ownerDeclaration": ref_position(interface),
        "method": target.get("name"),
        "qualname": method.get("qualname"),
    }


def identity_mismatches(study: dict, kind: str, item: dict, repository_version: str | None,
                        changed_definition_row: dict | None = None) -> tuple[dict, dict]:
    expected = expected_identity(study, kind)
    actual = actual_identity(kind, item, repository_version, changed_definition_row)
    mismatches = {
        field: {"expected": expected.get(field), "actual": actual.get(field)}
        for field in IDENTITY_FIELDS
        if actual.get(field) != expected.get(field)
    }
    return actual, mismatches


def source_revision(root: Path) -> str | None:
    result = run(["git", "-C", str(root), "rev-parse", "HEAD"], cwd=root)
    if result.returncode == 0:
        return result.stdout.strip()
    marker = root / ".source-commit"
    if marker.exists():
        return marker.read_text().strip()
    return None


def source_clean(root: Path) -> bool | None:
    result = run(["git", "-C", str(root), "status", "--porcelain"], cwd=root)
    if result.returncode != 0:
        return None
    return not result.stdout.strip()


def snapshot_revision(side: dict | None) -> str | None:
    snapshot = (side or {}).get("snapshot") or {}
    return snapshot.get("baseRevision") or snapshot.get("revision")


def verify_source_identity(study: dict, root: Path, base: Path, question: dict) -> dict:
    sides = question.get("sides") or {}
    head_git = source_revision(root)
    base_git = source_revision(base)
    head_clean = source_clean(root)
    base_clean = source_clean(base)
    head_snapshot = snapshot_revision(sides.get("head"))
    base_snapshot = snapshot_revision(sides.get("base"))
    identity = {
        "head": {
            "expected": study["head_commit"],
            "checkout": head_git,
            "snapshot": head_snapshot,
            "clean": head_clean,
            "valid": head_git == study["head_commit"] and head_snapshot == study["head_commit"] and head_clean is not False,
        },
        "base": {
            "expected": study["base_commit"],
            "checkout": base_git,
            "snapshot": base_snapshot,
            "clean": base_clean,
            "valid": base_git == study["base_commit"] and base_snapshot == study["base_commit"] and base_clean is not False,
        },
        "declarations": [],
    }
    for marker in study["source_markers"]:
        path = root / marker["file"]
        try:
            text = path.read_text().splitlines()[marker["line"] - 1]
        except (OSError, IndexError):
            text = None
        identity["declarations"].append({
            "file": marker["file"],
            "line": marker["line"],
            "expectedText": marker["text"],
            "actualText": text,
            "valid": text is not None and marker["text"] in text,
        })
    identity["valid"] = (
        identity["head"]["valid"]
        and identity["base"]["valid"]
        and all(row["valid"] for row in identity["declarations"])
    )
    return identity


def relative_position(path: str, root: Path) -> str:
    return os.path.relpath(os.path.realpath(path), os.path.realpath(root))


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
        found.add(f"{relative_position(path, root)}:{line_no}")
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
        found.add(f"{relative_position(path, root)}:{line_no}")
    return sorted(found)


def counterexample_evidence(study: dict, items: list[dict], after_change: dict, head_revision: str | None) -> dict | None:
    if study["name"] != "client" or not items:
        return None
    source = items[0]
    same_name = study["same_name_interface"]

    def detect(item: dict, version: str | None = head_revision) -> dict:
        _, mismatches = identity_mismatches(study, "candidate", item, version, after_change)
        return mismatches

    swapped = copy.deepcopy(source)
    swapped["fact"]["target"] = {
        "file": same_name["method"]["file"],
        "line": same_name["method"]["line"],
        "column": same_name["method"]["column"],
        "name": same_name["method"]["name"],
    }
    swapped["interface"] = {
        "file": same_name["interface"]["file"],
        "line": same_name["interface"]["line"],
        "column": same_name["interface"]["column"],
        "package": (source.get("interface") or {}).get("package"),
        "qualname": same_name["qualname"],
    }
    swapped["interfaceMethod"] = {
        "file": same_name["method"]["file"],
        "line": same_name["method"]["line"],
        "column": same_name["method"]["column"],
        "name": same_name["method"]["name"],
        "qualname": f"{same_name['qualname']}.{same_name['method']['name']}",
    }
    swap_mismatches = detect(swapped)

    file_control = copy.deepcopy(source)
    file_control["fact"]["target"]["file"] = "prometheus/registry_test.go"
    declaration_control = copy.deepcopy(source)
    declaration_control["fact"]["target"]["line"] = study["interface_declaration"]["line"] + 1
    owner_control = copy.deepcopy(source)
    owner_control["interface"]["qualname"] = same_name["qualname"]
    version_control = detect(source, study["base_commit"])

    controls = {
        "targetFile": {"mismatches": detect(file_control), "expectedField": "targetFile"},
        "declaration": {"mismatches": detect(declaration_control), "expectedField": "declaration"},
        "ownerType": {"mismatches": detect(owner_control), "expectedField": "ownerType"},
        "repositoryVersion": {"mismatches": version_control, "expectedField": "repositoryVersion"},
    }
    for control in controls.values():
        control["detected"] = control["expectedField"] in control["mismatches"]

    return {
        "sameNamedInterfaceSwap": {
            "position": f"{source['fact']['file']}:{source['fact']['line']}",
            "from": expected_identity(study, "candidate"),
            "to": {
                "repositoryVersion": head_revision,
                "targetFile": same_name["method"]["file"],
                "declaration": ref_position(same_name["method"]),
                "ownerType": same_name["qualname"],
                "ownerDeclaration": ref_position(same_name["interface"]),
                "method": same_name["method"]["name"],
                "qualname": f"{same_name['qualname']}.{same_name['method']['name']}",
            },
            "detected": bool(swap_mismatches),
            "mismatches": swap_mismatches,
        },
        "fieldControls": controls,
        "passed": bool(swap_mismatches) and all(control["detected"] for control in controls.values()),
    }


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
    head_revision = snapshot_revision((after.get("sides") or {}).get("head"))
    source_identity = verify_source_identity(study, root, base, after)
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

    direct_identity = []
    direct_identity_wrong = []
    for row in sorted(after_refs["items"], key=lambda item: (item["fact"]["file"], item["fact"]["line"])):
        actual, mismatches = identity_mismatches(study, "direct", row, head_revision, after_change)
        record = {
            "position": f"{row['fact']['file']}:{row['fact']['line']}",
            "category": "direct",
            **actual,
            "status": "ok" if not mismatches else "wrong",
            "mismatches": mismatches,
        }
        direct_identity.append(record)
        if mismatches:
            direct_identity_wrong.append(record["position"])
    direct_result["identity"] = {
        "items": direct_identity,
        "wrong": direct_identity_wrong,
        "omitted": after_refs["total"] - len(direct),
        "valid": not direct_identity_wrong,
    }

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
    candidate_identity = []
    candidate_identity_wrong = []
    implementation_methods = set()
    promoted_types = set()
    for item in items:
        position = f"{item['fact']['file']}:{item['fact']['line']}"
        if position in seen_positions:
            wrong_reasons.append(f"{position}: duplicate candidate")
        seen_positions.add(position)
        actual, mismatches = identity_mismatches(study, "candidate", item, head_revision, after_change)
        identity_record = {
            "position": position,
            "category": "interface-candidate",
            **actual,
            "status": "ok" if not mismatches else "wrong",
            "mismatches": mismatches,
        }
        candidate_identity.append(identity_record)
        if mismatches:
            candidate_identity_wrong.append(position)
            wrong_reasons.append(f"{position}: identity mismatch {sorted(mismatches)}")
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

    counterexample = counterexample_evidence(study, items, after_change, head_revision)
    if counterexample is not None and not counterexample["passed"]:
        wrong_reasons.append("negative control was not detected")

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
        "directIdentityWrong": direct_identity_wrong,
        "candidateWrongReasons": wrong_reasons,
        "candidateWrong": candidate_result["wrong"],
        "candidateMissed": candidate_result["missed"],
        "candidateIdentityWrong": candidate_identity_wrong,
        "sourceIdentityValid": source_identity["valid"],
        "counterexamplePassed": counterexample["passed"] if counterexample else None,
        "goplsMatches": gopls_result["concreteEqualsDirectPlusCandidates"] if gopls_result else None,
        "specific": specific,
    }
    return {
        "name": study["name"],
        "repository": study["repository"],
        "base": study["base"],
        "head": study["head"],
        "baseCommit": study["base_commit"],
        "headCommit": study["head_commit"],
        "sourceIdentity": source_identity,
        "entry": study["entry"],
        "changedDefinition": study["qualname"],
        "interface": study["interface"],
        "baseline": {"status": baseline.get("status"), "direct": {"count": len(baseline_direct), "positions": sorted(baseline_direct)},
                      "interfaceCandidates": (changed_definition(baseline, study["qualname"])["head"].get("interfaceCandidates") or {}).get("coverage", "absent")},
        "after": {"status": after.get("status"),
                  "direct": {"count": after_refs["total"], "included": len(direct), "omitted": after_refs["total"] - len(direct),
                             "positions": sorted(direct), "identity": direct_result["identity"]},
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
                                                   "identity": next(row for row in candidate_identity if row["position"] == f"{item['fact']['file']}:{item['fact']['line']}"),
                                               } for item in items]}},
        "positions": {"direct": direct_result, "interfaceCandidates": candidate_result},
        "counterexample": counterexample,
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
    counts = {
        "direct": {
            study["name"]: {
                "total": study["after"]["direct"]["count"],
                "displayed": study["after"]["direct"]["included"],
                "omitted": study["after"]["direct"]["omitted"],
            } for study in studies
        },
        "interfaceCandidates": {
            study["name"]: study["after"]["interfaceCandidates"]["count"] for study in studies
        },
    }
    focus_items = []
    for study in studies:
        if study["name"] in ("echo", "client"):
            for item in study["after"]["interfaceCandidates"]["items"]:
                focus_items.append({"study": study["name"], **item})
    focus = {
        "description": "The 15 interface candidates added in the previous round (Echo 6 + client_golang 9), rescored by source identity.",
        "total": len(focus_items),
        "direct": {name: counts["direct"][name] for name in ("echo", "client")},
        "interfaceCandidates": {name: counts["interfaceCandidates"][name] for name in ("echo", "client")},
        "items": focus_items,
    }
    summary = {
        "note": "Generated by run.py from preserved checkouts at the fixed commits; positions are repository-relative. Source identity is checked before position classification, and a same-named interface-method swap is required to be rejected.",
        "scope": {
            "go": "1.27.2", "gopls": "v0.24.0" if gopls else None, "goos": "darwin", "goarch": "arm64",
            "cgo": False, "tests": True, "tags": [], "modules": "root module only",
        },
        "counts": counts,
        "focus": focus,
        "studies": studies,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({study["name"]: {
        "direct": study["after"]["direct"]["count"],
        "candidates": study["after"]["interfaceCandidates"]["count"],
        "sourceIdentityValid": study["checks"]["sourceIdentityValid"],
        "counterexamplePassed": study["checks"]["counterexamplePassed"],
        "directIdentityWrong": study["checks"]["directIdentityWrong"],
        "candidateIdentityWrong": study["checks"]["candidateIdentityWrong"],
        "wrong": study["positions"]["interfaceCandidates"]["wrong"],
        "missed": study["positions"]["interfaceCandidates"]["missed"],
        "checks": study["checks"],
    } for study in studies}, indent=2, sort_keys=True))
    valid = all(
        study["checks"]["sourceIdentityValid"]
        and not study["checks"]["directIdentityWrong"]
        and not study["checks"]["candidateIdentityWrong"]
        and not study["checks"]["candidateWrongReasons"]
        and not study["checks"]["candidateWrong"]
        and not study["checks"]["candidateMissed"]
        and study["checks"]["directPreserved"]
        and study["checks"]["counterexamplePassed"] in (True, None)
        and study["checks"]["goplsMatches"] in (True, None)
        for study in studies
    )
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
