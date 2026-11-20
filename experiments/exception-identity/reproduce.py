"""Run from any directory. Raw receipts stay local; portable copies are explicitly summaries."""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
NODE = os.environ.get("ARCHIFY_NODE", "node")
RUN = HERE / "raw" / datetime.datetime.now(datetime.timezone.utc).strftime("run-%Y%m%dT%H%M%S%fZ")
RUN.mkdir(parents=True)
PREFIX = "experiments/exception-identity/"


def portable(value):
    if isinstance(value, str):
        return value.replace(str(REPO) + "/", "")
    if isinstance(value, list):
        return [portable(item) for item in value]
    if isinstance(value, dict):
        return {key: portable(item) for key, item in value.items()}
    return value


def stage(name, command, cwd=REPO):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    (RUN / (name + ".stdout")).write_text(result.stdout)
    (RUN / (name + ".stderr")).write_text(result.stderr)
    record = {"stage": name, "started": started, "command": portable(command), "exitCode": result.returncode}
    try:
        record["result"] = portable(json.loads(result.stdout))
    except json.JSONDecodeError:
        record["stdout"] = portable(result.stdout)
        record["stderr"] = portable(result.stderr)
    records.append(record)
    (HERE / "evidence/latest-run.json").write_text(json.dumps({"note": "Portable summary; raw CLI evidence remains local", "stages": records}, indent=2) + "\n")
    if result.returncode:
        raise SystemExit("Failed stage: " + name + "; see raw logs")
    return record.get("result", {})


records = []
stage("fixture", [sys.executable, "fixture.py"], HERE)
stage("semantics", [sys.executable, "-m", "unittest", "-v", "test_fixture.py"], HERE)
cli = [NODE, "archify/bin/archify.mjs"]
stage("finalize", cli + ["finalize", "architecture", PREFIX + "candidate.json", PREFIX + "exception-identity.html", "--quality", "showcase", "--out-dir", str(RUN / "finalize"), "--json"])
visual = stage("visual", cli + ["visual-check", PREFIX + "exception-identity.html", "--summary", "--require-provenance", "--out-dir", str(RUN / "visual")])
for shot in visual["evidence"]["screenshots"]:
    source = REPO / shot["path"]
    shutil.copyfile(source, HERE / "evidence" / source.name)
print("Fixture, 5 semantic tests, finalize and captures passed. See evidence/latest-run.json.")
