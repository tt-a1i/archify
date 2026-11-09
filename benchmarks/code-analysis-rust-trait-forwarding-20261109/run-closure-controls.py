#!/usr/bin/env python3
"""Compile the closure fixture and validate v13 through the normal CLI.

The fixture covers a helper-typed closure (resolved through a generic Fn bound),
a concrete `impl FnOnce` helper, and three closure forms outside the bounded
rule: dyn receiver, method-callee helper and iterator adapter.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "closure-calls"
SOURCE_SHA256 = {
    "base/src/lib.rs": "2b21b03bf13efe1bcd706e9014ae19e3258bf70f95fb3a07465973afcb133b9a",
    "head/src/lib.rs": "645b06d975cd8a38a58960fa187d4dbcc261f9debc73ae4bbcc4bf18bc9871b2",
    "base/Cargo.toml": "cb1254531ea3231a870b71b19ed39176f1b905c083108cbdf6030ab1037ab0cc",
    "head/Cargo.toml": "cb1254531ea3231a870b71b19ed39176f1b905c083108cbdf6030ab1037ab0cc",
}
QUESTION = "Gate::check changed its default body. Which calls reference this trait method, and which closure calls remain unknown?"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    for side in ("base", "head"):
        result = subprocess.run(["cargo", "build", "--offline", "--manifest-path", str(FIXTURE / side / "Cargo.toml")], capture_output=True, text=True)
        builds.append({"side": side, "exit": result.returncode, "stderr": result.stderr[-2000:]})
        if result.returncode:
            raise SystemExit(f"{side}: cargo build failed")

    query_path = out / "query.json"
    command = ["node", args.cli, "code-analysis", "task", "--question", QUESTION,
               "--base-root", str(FIXTURE / "base"), "--root", str(FIXTURE / "head"),
               "--entry", "src/lib.rs", "--format", "json", "--out", str(query_path)]
    result = subprocess.run(command, capture_output=True, text=True)
    (out / "query.command.txt").write_text(" ".join(command) + "\n")
    (out / "query.stderr.txt").write_text(result.stderr)
    if result.returncode:
        raise SystemExit(f"CLI exit {result.returncode}: {result.stderr[-800:]}")
    query = json.loads(query_path.read_text())

    definition = next((item for item in query["changedDefinitions"]["items"]
                       if item.get("head", {}).get("definition", {}).get("qualname") == "Gate::check"), None)
    if definition is None:
        raise SystemExit("Gate::check was not selected as the changed definition")
    checks = []
    for side in ("base", "head"):
        references = definition[side]["knownReferences"]
        records = [record["fact"] for record in references["items"]]
        closed = [fact for fact in records if fact.get("closure", {}).get("line") == 13]
        other = [fact for fact in records if fact.get("line") in (26, 34, 46, 50)]
        target = closed[0].get("target") if len(closed) == 1 else None
        caller = (closed[0].get("directCaller") or {}) if len(closed) == 1 else {}
        checks.append({
            "side": side,
            "knownTotal": references["total"],
            "helperClosureCalls": len(closed),
            "outOfScopeKnownCalls": len(other),
            "target": target,
            "resolution": closed[0].get("resolution") if len(closed) == 1 else None,
            "closure": closed[0].get("closure") if len(closed) == 1 else None,
            "directCaller": caller,
            "callModel": query["sides"][side].get("callModel"),
        })
    expected_target = {"file": "src/lib.rs", "line": 2, "column": 8, "name": "check"}
    for row in checks:
        assert row["callModel"] == "rust-source-direct-v13", row
        assert row["knownTotal"] == 1, row
        assert row["helperClosureCalls"] == 1, row
        assert row["outOfScopeKnownCalls"] == 0, row
        assert row["target"] == expected_target, row
        assert row["resolution"] == "rust-trait-method-candidate", row
        assert row["closure"] == {"file": "src/lib.rs", "line": 13, "column": 21}, row
        assert row["directCaller"].get("kind") == "method", row
        assert row["directCaller"].get("qualname", "").endswith("W < R >::generic"), row
    summary = {"fixture": str(FIXTURE), "sourceSHA256": SOURCE_SHA256, "builds": builds,
               "queryStatus": query.get("status"), "checks": checks}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"status": query.get("status"), "checks": checks}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
