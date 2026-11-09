#!/usr/bin/env python3
"""Compile the provenance fixture and check both changed definitions.

The helper writes `Item` in its own module; the caller module has a same-name
`Item::mark`. Changing the provider must find both closure calls (short name
and aliased generic substitution). Changing the caller's same-name method must
return zero references.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "closure-provenance"
SOURCE_SHA256 = {
    "base/src/lib.rs": "9fd20b3d35ae05ae9597fc434c0e5891f2c5157cb56e9dc3d766c1997e5c437d",
    "provider-head/src/lib.rs": "a1b8979a0b0d65d6cb2263a2936ae3d3a49ecd5e1313514edcae735c340adab1",
    "caller-head/src/lib.rs": "1a84efe1d25b0368cff34586605fbfd5a5f4ce37278aaffa0bc076485426a037",
    "base/Cargo.toml": "f6c0893fc3f66d4d5ddf8997b8b6e6bdca1c33ea84f66ad777de3cda8e07bda1",
    "provider-head/Cargo.toml": "f6c0893fc3f66d4d5ddf8997b8b6e6bdca1c33ea84f66ad777de3cda8e07bda1",
    "caller-head/Cargo.toml": "f6c0893fc3f66d4d5ddf8997b8b6e6bdca1c33ea84f66ad777de3cda8e07bda1",
}
QUESTION = "Item::mark changed its body. Which calls reference this method?"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def query(cli, head, out, label):
    path = out / f"{label}.json"
    command = [
        "node",
        cli,
        "code-analysis",
        "task",
        "--question",
        QUESTION,
        "--base-root",
        str(FIXTURE / "base"),
        "--root",
        str(FIXTURE / head),
        "--entry",
        "src/lib.rs",
        "--format",
        "json",
        "--out",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    (out / f"{label}.command.txt").write_text(" ".join(command) + "\n")
    (out / f"{label}.stderr.txt").write_text(result.stderr)
    if result.returncode:
        raise SystemExit(f"{label}: CLI exit {result.returncode}: {result.stderr[-800:]}")
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    if out.exists():
        raise SystemExit("output directory must be new")
    out.mkdir(parents=True)

    for name, expected in SOURCE_SHA256.items():
        actual = sha256(FIXTURE / name)
        if actual != expected:
            raise SystemExit(f"{name}: source drifted ({actual})")

    builds = []
    for side in ("base", "provider-head", "caller-head"):
        result = subprocess.run(
            ["cargo", "build", "--offline", "--manifest-path", str(FIXTURE / side / "Cargo.toml")],
            capture_output=True,
            text=True,
        )
        builds.append({"side": side, "exit": result.returncode, "stderr": result.stderr[-2000:]})
        if result.returncode:
            raise SystemExit(f"{side}: cargo build failed")

    cases = []
    for label, head, qualname in (
        ("provider", "provider-head", "provider::Item::mark"),
        ("caller", "caller-head", "consumer::Item::mark"),
    ):
        result = query(args.cli, head, out, label)
        definition = next(
            (
                item
                for item in result["changedDefinitions"]["items"]
                if item.get("head", {}).get("definition", {}).get("qualname") == qualname
            ),
            None,
        )
        if definition is None:
            raise SystemExit(f"{label}: {qualname} was not selected as the changed definition")
        references = definition["head"]["knownReferences"]
        facts = [item["fact"] for item in references["items"]]
        cases.append(
            {
                "label": label,
                "changedDefinition": qualname,
                "knownTotal": references["total"],
                "references": facts,
            }
        )

    provider, caller = cases
    assert provider["knownTotal"] == 2, provider
    assert caller["knownTotal"] == 0, caller
    expected_target = {"file": "src/lib.rs", "line": 5, "column": 9, "name": "mark"}
    positions = sorted((fact["line"], fact["column"]) for fact in provider["references"])
    assert positions == [(24, 36), (41, 26)], positions
    assert all(fact["target"] == expected_target for fact in provider["references"]), provider
    assert all(fact["resolution"] == "rust-inherent-source-candidate" for fact in provider["references"])
    assert sorted(fact["closure"]["column"] for fact in provider["references"]) == [19, 29]
    assert all(fact["directCaller"]["qualname"] in ("generic::run", "consumer::run") for fact in provider["references"])

    summary = {
        "fixture": str(FIXTURE),
        "sourceSHA256": SOURCE_SHA256,
        "builds": builds,
        "cases": cases,
        "expected": {
            "provider": {"knownTotal": 2, "positions": [[24, 36], [41, 26]], "target": expected_target},
            "caller": {"knownTotal": 0},
        },
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"provider": provider["knownTotal"], "caller": caller["knownTotal"], "positions": positions}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
