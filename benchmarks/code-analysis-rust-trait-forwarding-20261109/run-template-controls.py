#!/usr/bin/env python3
"""Compile frozen controls and exercise only the normal code-analysis CLI.

--mode baseline requires the pinned clean product and succeeds only if both
review defects reproduce. --mode candidate requires every acceptance assertion.
The source oracle is independent of product output and uses the finalized v12
macro-template contract, with no per-origin caller objects. Archive candidates
record source hashes without discovering Git repositories above the CLI root.
Build/check artifacts live in a TemporaryDirectory, not in either fixture root.
Paired task queries test change references; saved file-wide task queries retain
unknown calls outside the changed definition's source range. --replay rescoring
reuses a pinned baseline's saved queries and builds without executing any tools.
"""
import argparse
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE / "answers" / "template-controls.json"
SIDES = ("base", "head")
POOLS = ("knownReferences", "traitCandidates", "interfaceCandidates")
PRODUCT_SOURCES = tuple("archify/modules/code-analysis/" + name for name in (
    "extract/rust/src/main.rs", "extract/rust/index.mjs", "extract/shared/semantics.mjs",
    "lib/question-calls.mjs", "schemas/raw-facts.schema.json"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def product_identity(product, mode, oracle):
    identity = {"revision": None, "productStatus": None,
                "productContext": {"kind": "archive", "root": str(product),
                                   "reason": "No .git at the CLI root; ancestor discovery disabled."}}
    # The normal CLI is <root>/archify/bin/archify.mjs. Only this exact root
    # may supply revision identity, including a .git file for a linked worktree.
    if (product / ".git").exists():
        git_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        git_env["GIT_CEILING_DIRECTORIES"] = str(product.parent)

        def git(*args):
            return subprocess.check_output(["git", "-C", str(product), *args],
                                           env=git_env, text=True, stderr=subprocess.PIPE)

        try:
            root = Path(git("rev-parse", "--show-toplevel").strip()).resolve()
            require(root == product, "Git root does not match the actual CLI root")
            revision = git("rev-parse", "HEAD").strip()
            status = git("status", "--short", "--untracked-files=normal", "--", "archify")
            identity.update(revision=revision, productStatus=status,
                            productContext={"kind": "git", "root": str(product)})
        except (OSError, subprocess.SubprocessError) as error:
            identity["productContext"]["reason"] = f"Git unavailable at CLI root: {error}"
    if mode == "baseline":
        require(identity["revision"] == oracle["baselineRevision"] and
                identity["productStatus"] == "",
                "baseline mode requires the pinned, clean product worktree")
    identity["productSourceSha256"] = {name: sha256(product / name) for name in PRODUCT_SOURCES}
    return identity


def fixture_root(fixture, side):
    return HERE / "fixtures" / fixture["id"] / side


def verify_inputs(oracle):
    inputs = {}
    for fixture in oracle["fixtures"]:
        texts = {}
        for side in SIDES:
            root = fixture_root(fixture, side)
            source = root / oracle["entry"]
            require(sha256(source) == fixture["sourceSha256"][side], f"source drift: {source}")
            texts[side] = source.read_text().splitlines()
            for name in ("Cargo.toml", "Cargo.lock", oracle["entry"]):
                path = root / name
                inputs[str(path.relative_to(HERE))] = sha256(path)
        change = fixture["bodyChange"]
        changed = [i + 1 for i, (a, b) in enumerate(zip(texts["base"], texts["head"])) if a != b]
        require(len(texts["base"]) == len(texts["head"]) and changed == [change["line"]],
                f"{fixture['id']}: only the target body may change")
        for side in SIDES:
            require(texts[side][change["line"] - 1] == change[side], "unexpected target body")
        for name in ("Cargo.toml", "Cargo.lock"):
            require((fixture_root(fixture, "base") / name).read_bytes() ==
                    (fixture_root(fixture, "head") / name).read_bytes(), f"paired {name} drift")
        for profile, settings in oracle["profiles"].items():
            config = HERE / "fixtures" / fixture["id"] / f"{profile}.config.json"
            expected = {"rust": {"tests": False, "defaultFeatures": False,
                                 "features": {fixture["id"]: settings["features"]},
                                 "cfg": [], "offline": True}}
            require(json.loads(config.read_text()) == expected, f"profile drift: {config}")
            inputs[str(config.relative_to(HERE))] = sha256(config)
    return inputs


def run(command, stem, env, cwd, commands, allowed=(0,)):
    command = [str(arg) for arg in command]
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=180)
    stem.with_suffix(".command.txt").write_text(shlex.join(command) + "\n")
    stem.with_suffix(".stdout.txt").write_text(result.stdout)
    stem.with_suffix(".stderr.txt").write_text(result.stderr)
    commands.append({"argv": command, "cwd": str(cwd), "exitCode": result.returncode,
                     "log": str(stem)})
    require(result.returncode in allowed,
            f"command exited {result.returncode}: {shlex.join(command)}; see {stem}.stderr.txt")
    return result


def normalized_field(key, value):
    if isinstance(value, str):
        if key == "qualname":
            # A leading :: denotes the crate root, not another source identity.
            return value.removeprefix("::")
        if key in ("selfType", "trait"):
            # quote's printable token stream may insert whitespace around tokens.
            return "".join(value.split())
    return value


def subset(actual, expected):
    return isinstance(actual, dict) and all(
        normalized_field(k, actual.get(k)) == normalized_field(k, v)
        for k, v in expected.items())


def position(fact):
    return fact.get("file"), fact.get("line"), fact.get("column")


def call_position(control):
    return "src/lib.rs", control["callLine"], control["callColumn"]


def matches_call(fact, control):
    file, line, column = position(fact)
    return file == "src/lib.rs" and column == control["callColumn"] and line in (
        control["callLine"], control.get("ownedStartLine", control["callLine"]))


def check(report, name, ok, **detail):
    report["checks"] += 1
    if not ok:
        report["failures"].append({"check": name, **detail})


def score_fact(report, label, fact, fixture, control, wanted, qualname_format):
    check(report, label + ":call-range", matches_call(fact, control) and subset(fact, {
        "endLine": control["callLine"], "endColumn": control["callEndColumn"]}))
    caller = {"file": "src/lib.rs", "name": "run", "kind": "macro-generated-method",
              "line": control["callerLine"], "column": 9,
              "qualname": qualname_format.format(macro=control["macro"], method="run")}
    check(report, label + ":template-caller", subset(fact.get("directCaller"), caller),
          expected=caller, actual=fact.get("directCaller"))
    if wanted == "known":
        target = dict(fact.get("target") or {})
        target.setdefault("file", fact.get("file"))
        check(report, label + ":target", subset(target, fixture["target"]) and
              fact.get("resolution") == fixture["resolution"], actual=target)
    else:
        check(report, label + ":unknown", fact.get("resolution") == "unresolved" and
              not fact.get("target") and bool(fact.get("reason")),
              resolution=fact.get("resolution"), target=fact.get("target"))
    template = fact.get("macroTemplate") or {}
    check(report, label + ":template-definition", subset(template.get("definition"), {
        "file": "src/lib.rs", "name": control["macro"], "line": control["definitionLine"], "column": 14}))
    expansions = template.get("expansions") or []
    expected = control.get("expansions", [control])
    check(report, label + ":expansion-count", len(expansions) == len(expected),
          expected=len(expected), actual=len(expansions))
    for origin in expected:
        matches = [item for item in expansions if subset(item, {
            "file": "src/lib.rs", "line": origin["invocationLine"], "column": 5,
            "implLine": origin["implLine"], "implColumn": 1,
            "selfType": origin["selfType"], "trait": origin.get("trait")})]
        check(report, label + ":expansion-source:" + origin["selfType"], len(matches) == 1,
              expected=origin, actual=expansions)


def score(fixture, profile, pair, singles, qualname_format):
    report = {"fixture": fixture["id"], "profile": profile, "checks": 0, "failures": [],
              "observations": [], "pairStatus": pair.get("status")}
    check(report, "pair-ready", pair.get("status") == "ready")
    changed = (pair.get("changedDefinitions") or {}).get("items", [])
    check(report, "one-changed-definition", len(changed) == 1 and
          pair.get("changedDefinitions", {}).get("omitted") == 0)
    expected_known = sorted(call_position(c) for c in fixture["controls"] if c[profile] == "known")
    for side in SIDES:
        metadata = pair.get("sides", {}).get(side, {})
        check(report, side + ":parse-errors", metadata.get("parseErrors") == 0)
        check(report, side + ":source-identity", metadata.get("sourceIdentity") == "valid")
        scope = metadata.get("languageScope", {})
        crates = [c for c in scope.get("crates", []) if c.get("package") == fixture["id"]]
        check(report, side + ":selected-feature-profile", len(crates) == 1 and
              ("chosen" in crates[0].get("features", [])) == (profile == "on") and
              scope.get("build", {}).get("customCfg") == [])
        known = []
        if len(changed) == 1:
            definition = changed[0].get(side, {})
            check(report, side + ":changed-definition", subset(definition.get("definition"), fixture["changedDefinition"]))
            for pool in POOLS:
                if pool not in definition:
                    continue
                check(report, side + ":uncapped:" + pool, definition[pool].get("omitted") == 0)
                known.extend(item["fact"] for item in definition[pool].get("items", []))
        canonical_known = [next((call_position(c) for c in fixture["controls"] if matches_call(f, c)),
                                position(f)) for f in known]
        check(report, side + ":known-reference-set", sorted(canonical_known) == expected_known,
              expected=expected_known, actual=[position(f) for f in known])
        calls = singles[side].get("calls", {})
        entry = singles[side].get("entry", {})
        check(report, side + ":file-query-valid", singles[side].get("factsAvailable") is True and
              entry.get("factsStatus") == "valid" and entry.get("currentStatus") == "ok" and
              entry.get("parseErrors") == [])
        check(report, side + ":full-call-inventory", calls.get("coverage") == "available" and calls.get("omitted") == 0)
        facts = [item["fact"] for item in calls.get("records", [])]
        for control in fixture["controls"]:
            label = side + ":" + control["id"]
            wanted = control[profile]
            matches = [f for f in facts if matches_call(f, control)]
            references = [f for f in known if matches_call(f, control)]
            report["observations"].append({"side": side, "control": control["id"], "expected": wanted,
                                            "knownReferenceCount": len(references), "facts": matches})
            check(report, label + ":fact-count", len(matches) == (0 if wanted == "absent" else 1),
                  expected=0 if wanted == "absent" else 1, actual=len(matches))
            if wanted != "absent":
                for fact in matches:
                    score_fact(report, label, fact, fixture, control, wanted, qualname_format)
            if wanted == "known":
                for fact in references:
                    score_fact(report, label + ":paired", fact, fixture, control, wanted, qualname_format)
    report["passed"] = report["checks"] - len(report["failures"])
    return report


def summarize_scores(summary, oracle):
    results = summary["results"]
    summary["acceptancePassed"] = all(not row["failures"] for row in results)
    observations = [(row, observation) for row in results for observation in row["observations"]]
    cfg_leaks = [o for row, o in observations if row["fixture"] == "cfg-template" and row["profile"] == "off"
                 and o["control"] == "invocation-cfg" and o["knownReferenceCount"] > 0]
    divergent = [o for row, o in observations if row["fixture"] == "divergent-template"]
    first_owner = oracle["fixtures"][1]["controls"][0]["expansions"][0]["selfType"]
    lost_sources = [o for o in divergent if len(o["facts"]) == 1 and
                    subset(o["facts"][0].get("directCaller"), {"qualname": first_owner + "::run"}) and
                    not o["facts"][0].get("macroTemplate")]
    summary["baselineDefects"] = {"disabledInvocationLeaksOnBothSides": len(cfg_leaks) == 2,
                                   "divergentFirstCallerLosesSourcesInBothProfilesAndSides": len(lost_sources) == 4}
    summary["divergentTargetRemainsUnknown"] = len(divergent) == 4 and all(
        o["knownReferenceCount"] == 0 and len(o["facts"]) == 1 and
        o["facts"][0].get("resolution") == "unresolved" and not o["facts"][0].get("target")
        for o in divergent)
    infrastructure = ("pair-ready", "one-changed-definition", "parse-errors", "source-identity",
                      "selected-feature-profile", "changed-definition", "uncapped:",
                      "file-query-valid", "full-call-inventory")
    summary["captureChecksPassed"] = not any(
        any(key in failure["check"] for key in infrastructure)
        for row in results for failure in row["failures"])
    summary["runPassed"] = (summary["captureChecksPassed"] and all(summary["baselineDefects"].values())
                            if summary["mode"] == "baseline" else summary["acceptancePassed"])
    summary["findings"] = [
        "Disabled invocation and unknown custom cfg must never become known references.",
        "Baseline divergent target is already conservative; its first-expansion caller and missing source provenance are the defect, not a proven wrong target.",
        "Candidate assertions require one unknown divergent fact, no known reference, template caller identity and both expansion sources. Candidate was not run by baseline mode."
    ] if summary["mode"] == "baseline" else []


def write_summary(out, summary):
    summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
    save(out / "commands.json", summary.pop("commands"))
    save(out / "assertions.json", summary["results"])
    summary["results"] = [{key: row[key] for key in ("fixture", "profile", "checks", "passed")}
                          | {"failed": len(row["failures"])} for row in summary["results"]]
    save(out / "summary.json", summary)
    print(json.dumps({"summary": str(out / "summary.json"), "mode": summary["mode"],
                      "executionKind": summary["executionKind"],
                      "runPassed": summary["runPassed"], "acceptancePassed": summary.get("acceptancePassed"),
                      "compiles": len(summary["compiles"]), "baselineDefects": summary.get("baselineDefects"),
                      "error": summary.get("error")}, indent=2))
    return 0 if summary["runPassed"] else 1


def replay_baseline(origin, out, oracle, inputs):
    require(not out.is_relative_to(origin), "replay output must be outside original evidence")
    original = json.loads((origin / "summary.json").read_text())
    require(original.get("mode") == "baseline" and original.get("revision") == oracle["baselineRevision"]
            and original.get("productStatus") == "" and original.get("runPassed") is True,
            "replay requires successful evidence from the pinned, clean baseline")
    require(original["inputSha256"] == inputs, "replay fixture inputs differ from original run")
    old_oracle = json.loads((origin / "source-answer.json").read_text())
    require({k: v for k, v in old_oracle.items() if k != "callerContract"} ==
            {k: v for k, v in oracle.items() if k != "callerContract"},
            "replay may change only the caller serialization contract, not frozen expectations")
    sources = json.loads((origin / "fixture-sources.json").read_text())
    require(sources == {f["id"]: {s: (fixture_root(f, s) / oracle["entry"]).read_text()
                                for s in SIDES} for f in oracle["fixtures"]},
            "saved fixture sources differ from current inputs")
    builds = {(c["fixture"], c["profile"], c["side"]): c["exitCode"] for c in original["compiles"]}
    require(builds == {(f["id"], p, s): 0 for f in oracle["fixtures"]
                       for p in oracle["profiles"] for s in SIDES}, "original builds are incomplete")
    origin_hashes = {str(p.relative_to(origin)): sha256(p)
                     for p in sorted(origin.rglob("*")) if p.is_file()}
    summary = {"mode": "baseline", "executionKind": "replay", "contract": "finalized-v12",
               "revision": original["revision"], "productStatus": original["productStatus"],
               "cli": original["cli"], "startedAt": datetime.now(timezone.utc).isoformat(),
               "oracle": str(ORACLE), "oracleSha256": sha256(ORACLE), "inputSha256": inputs,
               "harnessSha256": sha256(Path(__file__)),
               "callerQualnameFormat": oracle["callerContract"]["defaultQualnameFormat"],
               "commands": [], "compiles": [], "results": [],
               "reusedEvidence": {"origin": str(origin), "contract": "original-contract run (unmodified)",
                                  "revision": original["revision"], "startedAt": original["startedAt"],
                                  "finishedAt": original["finishedAt"],
                                  "oracleSha256": original["oracleSha256"],
                                  "inputSha256": original["inputSha256"], "artifactSha256": origin_hashes,
                                  "compiles": original["compiles"], "environment": original["environment"]},
               "artifacts": "Scoring-only replay: no Git, CLI, build, or tool-version commands executed. Raw queries and build logs reused at the hashed origin; original evidence remains an original-contract run."}
    for fixture in oracle["fixtures"]:
        for profile in oracle["profiles"]:
            name = f"{fixture['id']}-{profile}"
            pair = json.loads((origin / "queries" / f"{name}-pair.json").read_text())
            singles = {side: json.loads((origin / "queries" / f"{name}-{side}.json").read_text())
                       for side in SIDES}
            summary["results"].append(score(fixture, profile, pair, singles, summary["callerQualnameFormat"]))
    summarize_scores(summary, oracle)
    require(inputs == verify_inputs(oracle) and summary["oracleSha256"] == sha256(ORACLE),
            "replay inputs changed during scoring")
    require(origin_hashes == {str(p.relative_to(origin)): sha256(p)
                             for p in sorted(origin.rglob("*")) if p.is_file()},
            "original evidence changed during replay")
    out.mkdir(parents=True)
    save(out / "source-answer.json", oracle)
    return write_summary(out, summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cli", type=Path, help="normal CLI, including a freshly extracted ZIP")
    source.add_argument("--replay", type=Path, help="original baseline evidence; no CLI/build rerun")
    parser.add_argument("--out", required=True, type=Path, help="new evidence directory; never overwritten")
    parser.add_argument("--mode", required=True, choices=("baseline", "candidate"))
    args = parser.parse_args()
    oracle = json.loads(ORACLE.read_text())
    inputs = verify_inputs(oracle)
    out = args.out.resolve()
    require(not out.exists(), f"evidence already exists: {out}")
    for fixture in oracle["fixtures"]:
        for side in SIDES:
            require(not out.is_relative_to(fixture_root(fixture, side)), "output must be outside fixtures")
    if args.replay:
        require(args.mode == "baseline", "only saved baseline evidence may be replayed")
        return replay_baseline(args.replay.resolve(strict=True), out, oracle, inputs)
    cli = args.cli.resolve(strict=True)
    require(cli.parts[-3:] == ("archify", "bin", "archify.mjs"), "use the normal Archify CLI")
    product = cli.parents[2]
    identity = product_identity(product, args.mode, oracle)
    qualname_format = oracle["callerContract"]["defaultQualnameFormat"]
    out.mkdir(parents=True)
    for child in ("queries", "compile", "checks"):
        (out / child).mkdir()
    env = os.environ.copy()
    removed = {name: env.pop(name) for name in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS",
               "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER") if name in env}
    for name, executable in (("ARCHIFY_CARGO", "cargo"), ("ARCHIFY_RUSTC", "rustc"), ("RUSTC", "rustc")):
        env[name] = shutil.which(executable) or executable
    summary = {"mode": args.mode, "executionKind": "capture", "contract": "finalized-v12", **identity,
               "cli": str(cli), "startedAt": datetime.now(timezone.utc).isoformat(),
               "oracle": str(ORACLE), "oracleSha256": sha256(ORACLE), "inputSha256": inputs,
               "harnessSha256": sha256(Path(__file__)),
               "callerQualnameFormat": qualname_format, "commands": [], "compiles": [], "results": [],
               "environment": {"cwd": str(product), "overrides": {k: env[k] for k in ("ARCHIFY_CARGO", "ARCHIFY_RUSTC", "RUSTC")},
                               "removedVariableNames": sorted(removed)}}
    save(out / "source-answer.json", oracle)
    save(out / "fixture-sources.json", {fixture["id"]: {
        side: (fixture_root(fixture, side) / oracle["entry"]).read_text() for side in SIDES
    } for fixture in oracle["fixtures"]})
    try:
        for tool in ("node", "cargo", "rustc"):
            summary["environment"][tool] = subprocess.check_output([tool, "--version"], env=env, text=True).strip()
        cfg = subprocess.check_output([env["RUSTC"], "--print", "cfg"], env=env, text=True).splitlines()
        require(oracle["customCfg"]["name"] not in cfg, "custom cfg must be unset for rustc")
        summary["environment"]["rustcCfg"] = cfg
        with tempfile.TemporaryDirectory(prefix="archify-template-controls-") as scratch_name:
            scratch = Path(scratch_name).resolve()
            # Complete all eight real builds before running any analyzer query.
            for fixture in oracle["fixtures"]:
                for profile, settings in oracle["profiles"].items():
                    for side in SIDES:
                        name = f"{fixture['id']}-{profile}-{side}"
                        command = [env["ARCHIFY_CARGO"], "build", "--offline", "--locked", "--no-default-features",
                                   "--manifest-path", fixture_root(fixture, side) / "Cargo.toml",
                                   "--target-dir", scratch / "cargo" / name]
                        if settings["features"]:
                            command += ["--features", ",".join(settings["features"])]
                        run(command, out / "compile" / name, env, product, summary["commands"])
                        summary["compiles"].append({"fixture": fixture["id"], "profile": profile, "side": side, "exitCode": 0})
            for fixture in oracle["fixtures"]:
                for profile in oracle["profiles"]:
                    name = f"{fixture['id']}-{profile}"
                    config = HERE / "fixtures" / fixture["id"] / f"{profile}.config.json"
                    pair_path = out / "queries" / f"{name}-pair.json"
                    command = ["node", cli, "code-analysis", "task", "--question", fixture["question"],
                               "--base-root", fixture_root(fixture, "base"), "--root", fixture_root(fixture, "head"),
                               "--entry", oracle["entry"], "--config", config, "--format", "json", "--out", pair_path, "--json"]
                    run(command, pair_path.with_suffix(""), env, product, summary["commands"], allowed=(0, 1))
                    singles = {}
                    for side in SIDES:
                        root = fixture_root(fixture, side)
                        analysis = scratch / "analysis" / f"{name}-{side}"
                        run(["node", cli, "code-analysis", "check", root, "--language", "rust", "--config", config,
                             "--fail-on", "never", "--out", analysis, "--json"],
                            out / "checks" / f"{name}-{side}", env, product, summary["commands"])
                        query_path = out / "queries" / f"{name}-{side}.json"
                        run(["node", cli, "code-analysis", "task", analysis, "--root", root, "--entry", oracle["entry"],
                             "--question", "Which calls in this file are known or unknown, and what are their template and expansion sources?",
                             "--format", "json", "--out", query_path, "--json"],
                            query_path.with_suffix(""), env, product, summary["commands"], allowed=(0, 1))
                        singles[side] = json.loads(query_path.read_text())
                    summary["results"].append(score(fixture, profile, json.loads(pair_path.read_text()), singles, qualname_format))
        require(inputs == verify_inputs(oracle), "fixtures changed during execution")
        require(summary["oracleSha256"] == sha256(ORACLE), "source oracle changed during execution")
        require(summary["productSourceSha256"] == {name: sha256(product / name) for name in PRODUCT_SOURCES},
                "product sources changed during execution")
        summarize_scores(summary, oracle)
        summary["artifacts"] = "Temporary Cargo targets and check captures removed; only source fixtures, raw task queries and logs retained."
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        summary["error"] = str(error)
        summary["runPassed"] = False
    return write_summary(out, summary)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
