"""Replay the frozen Rust trait-change questions through a source or ZIP CLI.

The scorer checks call range, target file and declaration range, owning trait and
implementation type. A deliberately swapped same-named declaration must score
wrong; this script fails if that probe passes.
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
    return f"{fact['file']}:{fact['line']}"


def changed(q: dict, line: int, qualname: str | None = None) -> dict:
    for item in q.get("changedDefinitions", {}).get("items", []):
        definition = item.get("head", {}).get("definition", {})
        if qualname is not None and definition.get("qualname") == qualname:
            return item
        if qualname is None and definition.get("line") == line:
            return item
    raise RuntimeError(f"changed definition not found at line {line} ({qualname})")


def refs(side: dict, declared: int) -> dict:
    known = side.get("knownReferences") or {}
    candidates = side.get("traitCandidates") or {}
    direct = sorted(position(row["fact"]) for row in known.get("items", []))
    candidate = sorted(position(row["fact"]) for row in candidates.get("items", []))
    return {
        "knownReferences": {**known, "positions": direct},
        "traitCandidates": candidates,
        "candidatePositions": candidate,
    }


def score(expected: dict, actual: dict) -> dict:
    """Identity-level scoring: call range plus target declaration identity."""
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
    return {"expected": expected, "actual": actual, "wrong": wrong, "status": "wrong" if wrong else "correct"}


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
    negative = score(expected, swapped)
    checks["negativeControlRejected"] = negative["status"] == "wrong" and "declaration-range" in negative["wrong"]
    if not negative["status"] == "wrong":
        raise RuntimeError("negative control was accepted")
    return {"checks": checks, "negativeControl": negative,
            "callModel": facts.get("callModel"), "calls": len(calls),
            "traitImplementations": len(facts["traitImplementations"])}


def project_section(name: str, cli: Path, baseline_cli: Path | None, samples: Path, out: Path, meta: dict) -> dict:
    project = meta["projects"][name]
    root, base = samples / f"{name}-head", samples / f"{name}-base"
    text = ("I changed the trait implementation method in this revision. Which calls definitely point to the "
            "changed implementation, which only prove use of the trait method, and which remain unknown?")
    config = load_config(out)
    after = question(cli, base, root, "src/bytes_mut.rs" if name == "bytes" else "src/__private_api.rs", text, out / f"{name}-after.json", config)
    baseline = None if baseline_cli is None else question(baseline_cli, base, root, "src/bytes_mut.rs" if name == "bytes" else "src/__private_api.rs", text, out / f"{name}-baseline.json", config)

    if name == "bytes":
        item = changed(after, 1300)
        expected_direct = {f"{c['file']}:{c['line']}" for c in project["definiteCalls"] if c.get("inCallInventory", True)}
        expected_candidates = {f"{c['file']}:{c['line']}" for c in project["candidateCalls"]}
    else:
        item = changed(after, 32)
        expected_direct = {f"{c['file']}:{c['line']}" for c in project["definiteCalls"]}
        expected_candidates = {f"{c['file']}:{c['line']}" for c in project["candidateCalls"]}

    head = item["head"]
    observed = refs(head, 1300)
    trait_method = head["traitCandidates"].get("traitMethod") if head.get("traitCandidates") else None
    declaration = project["traitDeclaration"]
    identity = {
        "definite": all(row["fact"]["target"]["file"] == item["head"]["definition"]["file"]
                        and row["fact"]["target"]["line"] == item["head"]["definition"]["line"]
                        for row in head["knownReferences"].get("items", [])),
        "candidateTarget": bool(trait_method) and trait_method["file"] == declaration["file"] and trait_method["line"] == declaration["line"],
        "candidateNotRuntime": (head.get("traitCandidates") or {}).get("runtimeTarget") == "not-determined",
    }
    direct = set(observed["knownReferences"]["positions"])
    candidates = set(observed["candidatePositions"])
    result = {
        "name": name,
        "repository": project["repository"],
        "head": project["head"],
        "definition": {"file": item["head"]["definition"]["file"], "line": item["head"]["definition"]["line"],
                       "qualname": item["head"]["definition"]["qualname"]},
        "definite": {"expected": sorted(expected_direct), "actual": sorted(direct),
                     "correct": len(expected_direct & direct), "wrong": sorted(direct - expected_direct),
                     "missed": sorted(expected_direct - direct),
                     "total": head["knownReferences"].get("total"), "included": head["knownReferences"].get("included"),
                     "omitted": head["knownReferences"].get("omitted"), "limit": head["knownReferences"].get("limit")},
        "candidates": {"expected": sorted(expected_candidates), "actual": sorted(candidates),
                       "correct": len(expected_candidates & candidates), "wrong": sorted(candidates - expected_candidates),
                       "missed": sorted(expected_candidates - candidates),
                       "coverage": (head.get("traitCandidates") or {}).get("coverage"),
                       "total": (head.get("traitCandidates") or {}).get("total"),
                       "included": (head.get("traitCandidates") or {}).get("included"),
                       "omitted": (head.get("traitCandidates") or {}).get("omitted")},
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
    failures = []
    for control, ok in controls["checks"].items():
        if not ok:
            failures.append(f"control:{control}")
    for project in projects:
        for kind in ("definite", "candidates"):
            for key in ("wrong", "missed"):
                if project[kind][key]:
                    failures.append(f"{project['name']}:{kind}:{key}")
        if project["candidates"].get("coverage") not in ("available", "not-applicable"):
            failures.append(f"{project['name']}:candidate-coverage:{project['candidates'].get('coverage')}")
        if not all(project["identity"].values()):
            failures.append(f"{project['name']}:identity")
        if project["baseline"] and project["baseline"]["knownReferences"] != 0:
            failures.append(f"{project['name']}:baseline-not-empty")
    summary = {"controls": controls, "projects": projects, "failures": failures}
    (out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({p["name"]: {"definite": p["definite"]["correct"], "candidates": p["candidates"]["correct"],
                                  "wrong": p["definite"]["wrong"] + p["candidates"]["wrong"],
                                  "missed": p["definite"]["missed"] + p["candidates"]["missed"],
                                  "baseline": p["baseline"]} for p in projects}, indent=2, sort_keys=True))
    if failures:
        print(json.dumps({"failures": failures}, indent=2))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
