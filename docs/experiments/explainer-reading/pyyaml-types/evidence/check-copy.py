import ast
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).parent
probe = json.loads((root / "source/probe-1.json").read_text())
by_name = {case["case"]: case for case in probe["scalars"]}
expected = "".join(
    f"{case['input'].strip()} => {case['repr']} {case['pythonType']}\n"
    for case in (by_name[name] for name in ["plain_on", "quoted_on", "tagged_on"])
)
original = ast.dump(ast.parse((root / "author-copied.py").read_text()))
results = []
for label in sys.argv[1:]:
    program = root / f"{label}-copied.py"
    run = subprocess.run([str(root / "venv/bin/python"), str(program)],
                         capture_output=True, text=True, check=True)
    assert not run.stderr and run.stdout == expected
    shown = (root / f"{label}-output.txt").read_text()
    assert shown.rstrip("\n") == expected.rstrip("\n")
    assert ast.dump(ast.parse(program.read_text())) == original
    (root / f"{label}-copied.stdout").write_text(run.stdout)
    results.append({"label": label, "exitCode": run.returncode,
                    "stdoutMatchesProbe": True, "displayedOutputMatches": True,
                    "astIdenticalToOriginal": True, "stdout": run.stdout})
print(json.dumps({"results": results,
                  "scope": "Actual Copy-control bytes executed in the pinned venv. Clipboard API instrumented; OS clipboard permission not tested. Displayed text code fences may omit the final newline."},
                 ensure_ascii=False, indent=2))
