"""Replay the frozen Rust trait-change questions through a source or ZIP CLI.

Each returned real result is scored item by item on call range, target
declaration, owning trait and, when determined, implementation type. The bytes
project is reported under two scopes: calls inside the current call inventory
and every call in the frozen source answer. Missing fields are recorded as
unverified instead of being invented. A same-named wrong target and a
different call position on the same line must both score wrong.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIMIT = 40
CALL_FIELDS = ("file", "line", "column", "endLine", "endColumn")


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True)


def question(cli: Path, base: Path | None, root: Path, entry: str, text: str, out: Path, config: Path) -> dict:
    command = ["node", str(cli), "code-analysis", "task"]
    if base is not None:
        command += ["--base-root", str(base)]
    command += ["--root", str(root), "--entry", entry, "--config", str(config), "--question", text,
                "--format", "json", "--out", str(out), "--json"]
    result = run(command)
    if result.returncode not in (0, 1) or not out.exists():
        raise RuntimeError(f"task failed ({result.returncode}): {result.stderr.strip()[:800]}")
    return json.loads(out.read_text())


def position(fact: dict) -> str:
    if "column" in fact:
        return f"{fact['file']}:{fact['line']}:{fact['column']}"
    return f"{fact['file']}:{fact['line']}"


def changed(q: dict, line: int, qualname: str | None = None) -> dict:
    for item in q.get("changedDefinitions", {}).get("items", []):
        definition = item.get("head", {}).get("definition", {})
        if qualname is not None and definition.get("qualname") == qualname:
            return item
        if qualname is None and definition.get("line") == line:
            return item
    raise RuntimeError(f"changed definition not found at line {line} ({qualname})")


def changed_impl(project: dict) -> dict:
    if "changedImplementation" in project:
        return project["changedImplementation"]
    return next(impl for impl in project["changedImplementations"] if impl.get("pairing") != "head-only")


def expected_items(project: dict) -> list[dict]:
    """Rows frozen from source inspection before either CLI ran."""
    impl = changed_impl(project)
    declaration = project["traitDeclaration"]
    rows = []
    for call in project.get("definiteCalls", []):
        rows.append({
            "kind": "definite",
            "call": {field: call[field] for field in CALL_FIELDS},
            "target": {"file": impl["file"], "line": impl["line"], "column": impl["column"]},
            "trait": impl["trait"],
            "selfType": impl["ownerType"],
            "selfTypeVerified": True,
            "targetEndVerified": False,
            "unverifiedFields": ["target-end"],
            "inCallInventory": call.get("inCallInventory", True),
            "reason": call.get("reason"),
        })
    for call in project.get("candidateCalls", []):
        rows.append({
            "kind": "candidate",
            "call": {field: call[field] for field in CALL_FIELDS},
            "target": {"file": declaration["file"], "line": declaration["line"],
                       "column": declaration["column"]},
            "trait": declaration["trait"],
            "selfType": None,
            "selfTypeVerified": False,
            "targetEndVerified": False,
            "unverifiedFields": ["implementation-type", "target-end"],
            "inCallInventory": call.get("inCallInventory", True),
            "reason": call.get("reason"),
        })
    return rows


def actual_items(head: dict) -> list[dict]:
    """Rows extracted from the CLI answer, including fields it did not determine."""
    candidates = head.get("traitCandidates") or {}
    trait = candidates.get("trait")
    implementations = candidates.get("implementations") or []
    rows = []
    for entry in (head.get("knownReferences") or {}).get("items", []):
        fact = entry["fact"]
        match = next((impl for impl in implementations
                      if impl["implementation"]["file"] == fact["target"]["file"]
                      and impl["implementation"]["line"] == fact["target"]["line"]), None)
        unverified = []
        if trait is None:
            unverified.append("owning-trait")
        if match is None:
            unverified.append("implementation-type")
        unverified.append("target-end")
        rows.append({
            "kind": "definite",
            "call": {field: fact[field] for field in CALL_FIELDS},
            "target": dict(fact["target"]),
            "trait": trait,
            "selfType": match["selfType"] if match else None,
            "selfTypeVerified": match is not None,
            "targetEndVerified": False,
            "unverifiedFields": unverified,
            "resolution": fact.get("resolution"),
            "navigation": entry.get("navigation"),
        })
    for entry in candidates.get("items", []):
        fact = entry["fact"]
        unverified = ["implementation-type", "target-end"]
        if trait is None:
            unverified.append("owning-trait")
        rows.append({
            "kind": "candidate",
            "call": {field: fact[field] for field in CALL_FIELDS},
            "target": dict(fact["target"]),
            "trait": trait,
            "selfType": None,
            "selfTypeVerified": False,
            "targetEndVerified": False,
            "unverifiedFields": unverified,
            "resolution": fact.get("resolution"),
            "runtimeTarget": entry.get("runtimeTarget"),
        })
    return rows


def score(expected: dict, actual: dict | None) -> dict:
    """Identity-level score for one real result."""
    if actual is None:
        return {"expected": expected, "actual": None, "wrong": ["missing"], "status": "missed"}
    wrong = []
    if expected["call"] != actual["call"]:
        wrong.append("call-range")
    if (expected["target"]["file"] != actual["target"]["file"]
            or expected["target"]["line"] != actual["target"]["line"]
            or expected["target"].get("column") != actual["target"].get("column")):
        wrong.append("declaration-range")
    actual_trait = actual.get("trait")
    actual_trait_name = actual_trait.get("name") if isinstance(actual_trait, dict) else actual_trait
    if expected["trait"] != actual_trait_name:
        wrong.append("owning-trait")
    if expected["selfTypeVerified"]:
        if not actual.get("selfTypeVerified") or expected["selfType"] != actual.get("selfType"):
            wrong.append("implementation-type")
    elif actual.get("selfTypeVerified"):
        wrong.append("implementation-type-overclaimed")
    record = {"expected": expected, "actual": actual, "wrong": wrong,
              "status": "wrong" if wrong else "correct"}
    if actual is not None:
        call = actual["call"]
        record["callRange"] = (f"{call['file']}:{call['line']}:{call['column']}"
                               f"-{call['endLine']}:{call['endColumn']}")
        record["callPosition"] = position(actual["call"])
        record["targetPosition"] = position(actual["target"])
        record["targetEndPosition"] = None
        record["traitName"] = (actual.get("trait") or {}).get("name")
        record["selfType"] = actual.get("selfType")
        record["unverifiedFields"] = actual.get("unverifiedFields")
    return record


def score_items(project: dict, rows: list[dict]) -> dict:
    expected = expected_items(project)
    used = set()
    scored = []
    for item in expected:
        match = None
        for index, row in enumerate(rows):
            if index not in used and row["kind"] == item["kind"] and row["call"] == item["call"]:
                used.add(index)
                match = row
                break
        scored.append(score(item, match))
    extras = [score({"kind": row["kind"], "call": row["call"], "target": row["target"],
                     "trait": row.get("trait"), "selfType": None, "selfTypeVerified": False,
                     "inCallInventory": True}, row)
              for index, row in enumerate(rows) if index not in used]
    for extra in extras:
        extra["status"] = "wrong"
        extra["wrong"] = ["unexpected-result"]
    return {"scored": scored, "extras": extras}


def counts(scored: list[dict], extras: list[dict]) -> dict:
    wrong = [row for row in scored if row["status"] == "wrong"] + extras
    missed = [row for row in scored if row["status"] == "missed"]
    returned = sum(1 for row in scored if row.get("actual") is not None)
    return {
        "expected": len(scored),
        "correct": sum(1 for row in scored if row["status"] == "correct"),
        "returned": returned,
        "wrong": [row["callPosition"] if row.get("actual") else row["expected"]["call"] for row in wrong],
        "missed": [f"{row['expected']['call']['file']}:{row['expected']['call']['line']}" for row in missed],
        "total": returned,
        "included": returned,
        "omitted": 0,
        "limit": LIMIT,
    }


def real_result_controls(projects: list[dict]) -> dict:
    rows = next(project for project in projects if project["name"] == "bytes")["items"]

    def at(file: str, line: int, column: int, end_column: int) -> dict:
        return next(row for row in rows if row["expected"]["call"] == {
            "file": file, "line": line, "column": column, "endLine": line,
            "endColumn": end_column})

    base = at("src/buf/chain.rs", 184, 13, 33)
    swapped_target = json.loads(json.dumps(base["actual"]))
    swapped_target["target"] = {"file": "src/buf/buf_mut.rs", "line": 202, "column": 8, "name": "put"}
    swapped_target["selfType"] = None
    swapped_target["selfTypeVerified"] = False
    swapped_target["unverifiedFields"] = ["implementation-type"]
    target_check = score(base["expected"], swapped_target)

    base = at("src/buf/chain.rs", 185, 13, 53)
    swapped_call = json.loads(json.dumps(base["actual"]))
    swapped_call["call"] = {"file": "src/buf/chain.rs", "line": 185, "column": 21,
                            "endLine": 185, "endColumn": 52}
    call_check = score(base["expected"], swapped_call)

    base = at("src/buf/chain.rs", 184, 13, 33)
    swapped_column = json.loads(json.dumps(base["actual"]))
    swapped_column["target"]["column"] = 6
    column_check = score(base["expected"], swapped_column)

    checks = {
        "sameNamedWrongTargetRejected": target_check["status"] == "wrong"
        and {"declaration-range", "implementation-type"} <= set(target_check["wrong"]),
        "sameLineDifferentCallRejected": call_check["status"] == "wrong"
        and call_check["wrong"] == ["call-range"],
        "targetColumnOnlyRejected": column_check["status"] == "wrong"
        and column_check["wrong"] == ["declaration-range"],
    }
    if not all(checks.values()):
        raise RuntimeError(f"real-result controls were not rejected: {checks}")
    return {"checks": checks, "sameNamedWrongTarget": target_check,
            "sameLineDifferentCall": call_check, "targetColumnOnly": column_check}


def load_config(root: Path) -> Path:
    config = root / "config.json"
    config.write_text(json.dumps({"rust": {"offline": True, "tests": False}}) + "\n")
    return config


def verify_samples(samples: Path, meta: dict) -> None:
    for name, project in meta["projects"].items():
        root = samples / f"{name}-head"
        revision = run(["git", "rev-parse", "HEAD"], root).stdout.strip()
        if revision != project["head"]:
            raise RuntimeError(f"{name} head {revision} != {project['head']}")
        for file, digest in project["headHashes"].items():
            if hashlib.sha256((root / file).read_bytes()).hexdigest() != digest:
                raise RuntimeError(f"{name}:{file} hash mismatch")


def control_section(cli: Path, root: Path, out: Path) -> dict:
    fixture = HERE / "controls" / "fixture"
    config = load_config(out)
    facts_path = out / "controls-facts"
    result = run(["node", str(cli), "code-analysis", "check", str(fixture), "--language", "rust", "--config", str(config),
                  "--out", str(facts_path), "--fail-on", "never", "--json"])
    if result.returncode != 0:
        raise RuntimeError(f"control check failed: {result.stderr.strip()[:800]}")
    facts = json.loads((facts_path / "raw-facts.json").read_text())
    calls = facts["calls"]
    line9 = [c for c in calls if c["line"] == 9]
    line10 = [c for c in calls if c["line"] == 10]
    line11 = [c for c in calls if c["line"] == 11]
    line12 = [c for c in calls if c["line"] == 12]
    checks = {
        "leftImpl": line9[0]["resolution"] == "rust-trait-impl" and line9[0]["target"]["line"] == 5,
        "rightImpl": line9[1]["resolution"] == "rust-trait-impl" and line9[1]["target"]["line"] == 7,
        "genericMethod": line10[0]["resolution"] == "rust-trait-method-candidate" and line10[0]["target"]["line"] == 1,
        "genericPath": line10[1]["resolution"] == "rust-trait-method-candidate" and line10[1]["target"]["line"] == 1,
        "dynTrait": line11[0]["resolution"] == "rust-trait-method-candidate" and line11[0]["target"]["line"] == 1,
        "ambiguousConcrete": line12[0]["resolution"] == "unresolved",
        "twoTypesOneTrait": sorted(edge["selfType"] for edge in facts["traitImplementations"]
                                   if edge["trait"]["name"] == "Left" and edge["traitMethod"]["name"] == "act") == ["A", "B"],
        "twoTraitsOneType": sorted(edge["trait"]["name"] for edge in facts["traitImplementations"]
                                   if edge["selfType"] == "A") == ["Left", "Right"],
    }
    expected = {"call": "src/lib.rs:9:21", "targetFile": "src/lib.rs", "targetLine": 5,
                "trait": "Left", "selfType": "A"}
    actual = {"call": "src/lib.rs:9:21", "targetFile": line9[0]["target"]["file"],
              "targetLine": line9[0]["target"]["line"], "trait": "Left", "selfType": "A"}
    swapped = {**actual, "targetLine": 7, "trait": "Right", "selfType": "A"}
    negative = score_fixture(expected, swapped)
    checks["negativeControlRejected"] = negative["status"] == "wrong" and "declaration-range" in negative["wrong"]
    if not negative["status"] == "wrong":
        raise RuntimeError("negative control was accepted")
    return {"checks": checks, "negativeControl": negative,
            "callModel": facts.get("callModel"), "calls": len(calls),
            "traitImplementations": len(facts["traitImplementations"])}


def score_fixture(expected: dict, actual: dict) -> dict:
    wrong = []
    if expected["call"] != actual["call"]:
        wrong.append("call-range")
    if expected.get("targetFile") != actual.get("targetFile"):
        wrong.append("target-file")
    if expected.get("targetLine") != actual.get("targetLine"):
        wrong.append("declaration-range")
    if expected.get("trait") != actual.get("trait"):
        wrong.append("owning-trait")
    if expected.get("selfType") != actual.get("selfType"):
        wrong.append("implementation-type")
    return {"expected": expected, "actual": actual, "wrong": wrong,
            "status": "wrong" if wrong else "correct"}


def project_section(name: str, cli: Path, baseline_cli: Path | None, samples: Path, out: Path, meta: dict) -> dict:
    project = meta["projects"][name]
    root, base = samples / f"{name}-head", samples / f"{name}-base"
    text = ("I changed the trait implementation method in this revision. Which calls definitely point to the "
            "changed implementation, which only prove use of the trait method, and which remain unknown?")
    config = load_config(out)
    entry = "src/bytes_mut.rs" if name == "bytes" else "src/__private_api.rs"
    after = question(cli, base, root, entry, text, out / f"{name}-after.json", config)
    baseline = None if baseline_cli is None else question(baseline_cli, base, root, entry, text, out / f"{name}-baseline.json", config)

    item = changed(after, 1300 if name == "bytes" else 32)
    head = item["head"]
    rows = actual_items(head)
    graded = score_items(project, rows)
    items = [row for row in graded["scored"] if row["status"] != "missed"] + graded["extras"]

    definite = [row for row in graded["scored"] if row["expected"]["kind"] == "definite"]
    inventory = [row for row in definite if row["expected"]["inCallInventory"]]
    candidates = [row for row in graded["scored"] if row["expected"]["kind"] == "candidate"]
    known_gaps = [row for row in definite if row["status"] == "missed"
                  and not row["expected"]["inCallInventory"]]

    declaration = project["traitDeclaration"]
    trait_method = (head.get("traitCandidates") or {}).get("traitMethod")
    identity = {
        "definiteTargetsChangedImplementation": all(
            row["actual"]["target"]["file"] == changed_impl(project)["file"]
            and row["actual"]["target"]["line"] == changed_impl(project)["line"]
            for row in definite if row["actual"]),
        "candidateTarget": bool(trait_method) and trait_method["file"] == declaration["file"]
        and trait_method["line"] == declaration["line"],
        "candidateNotRuntime": (head.get("traitCandidates") or {}).get("runtimeTarget") == "not-determined",
    }
    result = {
        "name": name,
        "repository": project["repository"],
        "head": project["head"],
        "definition": {"file": item["head"]["definition"]["file"], "line": item["head"]["definition"]["line"],
                       "qualname": item["head"]["definition"]["qualname"]},
        "items": items,
        "scopes": {
            "callInventory": {"definite": counts(inventory, []), "candidates": counts(candidates, [])},
            "sourceAnswer": {"definite": counts(definite, []), "candidates": counts(candidates, []),
                             "knownInventoryGaps": [
                                 {"position": f"{row['expected']['call']['file']}:{row['expected']['call']['line']}",
                                  "reason": row["expected"].get("reason")}
                                 for row in known_gaps]},
        },
        "coverage": {
            "traitCandidates": (head.get("traitCandidates") or {}).get("coverage"),
            "knownReferences": (head.get("knownReferences") or {}).get("coverage"),
        },
        "identity": identity,
        "baseline": None,
    }
    if baseline is not None:
        base_item = changed(baseline, item["head"]["definition"]["line"], item["head"]["definition"]["qualname"])
        base_head = base_item["head"]
        result["baseline"] = {
            "knownReferences": base_head["knownReferences"].get("total"),
            "traitCandidates": (base_head.get("traitCandidates") or {}).get("coverage", "absent"),
            "callModel": baseline.get("callModel"),
        }
    if name == "log":
        unpaired = next((entry for entry in after.get("unpairedDefinitions", {}).get("items", [])
                         if entry["definition"].get("line") == 25 and entry.get("reason") == "head-only"), None)
        if unpaired is None:
            raise RuntimeError("reference-self head-only trait impl was not reported")
        result["unpairedReferenceImplementation"] = {
            "line": 25, "reason": unpaired["reason"],
            "knownReferences": unpaired["knownReferences"].get("total"),
            "candidates": [position(row["fact"]) for row in (unpaired.get("traitCandidates") or {}).get("items", [])],
            "coverage": (unpaired.get("traitCandidates") or {}).get("coverage"),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--baseline-cli", type=Path)
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((HERE / "source-first.json").read_text())
    samples = args.samples.resolve()
    verify_samples(samples, meta)
    controls = control_section(args.cli.resolve(), samples, out)
    projects = [project_section(name, args.cli.resolve(), args.baseline_cli.resolve() if args.baseline_cli else None, samples, out, meta)
                for name in ("bytes", "log")]
    real_controls = real_result_controls(projects)
    failures = []
    for control, ok in controls["checks"].items():
        if not ok:
            failures.append(f"control:{control}")
    for control, ok in real_controls["checks"].items():
        if not ok:
            failures.append(f"real-control:{control}")
    for project in projects:
        known_gaps = {gap["position"] for gap in project["scopes"]["sourceAnswer"]["knownInventoryGaps"]}
        for scope, kinds in project["scopes"].items():
            for kind in ("definite", "candidates"):
                for key in ("wrong", "missed"):
                    blocking = [entry for entry in kinds[kind][key]
                                if not (key == "missed" and entry in known_gaps)]
                    if blocking:
                        failures.append(f"{project['name']}:{scope}:{kind}:{key}")
        for row in project["items"]:
            allowed_gap = (row["status"] == "missed"
                           and row["expected"].get("inCallInventory") is False)
            if row["status"] != "correct" and not allowed_gap:
                failures.append(f"{project['name']}:item:{row['status']}")
            if row["actual"] and row["expected"]["kind"] == "candidate" and row["actual"]["selfTypeVerified"]:
                failures.append(f"{project['name']}:candidate-impl-overclaimed")
        if project["coverage"]["traitCandidates"] not in ("available", "not-applicable"):
            failures.append(f"{project['name']}:candidate-coverage:{project['coverage']['traitCandidates']}")
        if not all(project["identity"].values()):
            failures.append(f"{project['name']}:identity")
        if project["baseline"] and project["baseline"]["knownReferences"] != 0:
            failures.append(f"{project['name']}:baseline-not-empty")
    summary = {"controls": controls, "realResultControls": real_controls,
               "projects": projects, "failures": failures}
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    brief = {}
    for project in projects:
        brief[project["name"]] = {
            "items": [{"call": row.get("callRange") or (
                           f"{row['expected']['call']['file']}:{row['expected']['call']['line']}:"
                           f"{row['expected']['call']['column']}"),
                       "target": row.get("targetPosition"),
                       "trait": row.get("traitName"), "selfType": row.get("selfType"),
                       "unverified": row.get("unverifiedFields"), "status": row["status"]}
                      for row in project["items"]],
            "callInventory": project["scopes"]["callInventory"],
            "sourceAnswer": project["scopes"]["sourceAnswer"],
            "baseline": project["baseline"],
        }
    print(json.dumps(brief, indent=2, sort_keys=True))
    if failures:
        print(json.dumps({"failures": failures}, indent=2))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
