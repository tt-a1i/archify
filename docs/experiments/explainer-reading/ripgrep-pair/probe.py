"""Observe independent ripgrep filters in a disposable Git repository."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="archify-ripgrep-probe-") as directory:
    root = Path(directory)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    subprocess.run(["git", "-C", directory, "init", "--template=", "--initial-branch=example"],
                   check=True, capture_output=True, env=env)
    files = {"visible.txt": "needle[1]\n", ".hidden.txt": "needle[1]\n",
             "ignored.txt": "needle[1]\n", ".hidden-ignored.txt": "needle[1]\n", "decoy.txt": "needle1\n",
             ".gitignore": "ignored.txt\n.hidden-ignored.txt\n"}
    for name, content in files.items():
        (root / name).write_text(content)
    controls = ["--no-config", "--no-ignore-global", "--no-ignore-parent", "--sort", "path", "--color", "never"]
    cases = [
        ("literal-default", ["-n", "-F", "needle[1]", "."], ["./visible.txt:1:needle[1]"]),
        ("literal-hidden", ["--hidden", "-n", "-F", "needle[1]", "."], ["./.hidden.txt:1:needle[1]", "./visible.txt:1:needle[1]"]),
        ("literal-no-ignore", ["--no-ignore", "-n", "-F", "needle[1]", "."], ["./ignored.txt:1:needle[1]", "./visible.txt:1:needle[1]"]),
        ("literal-both", ["--hidden", "--no-ignore", "-n", "-F", "needle[1]", "."], ["./.hidden-ignored.txt:1:needle[1]", "./.hidden.txt:1:needle[1]", "./ignored.txt:1:needle[1]", "./visible.txt:1:needle[1]"]),
        ("regex-default", ["-n", "needle[1]", "."], ["./decoy.txt:1:needle1"]),
        ("regex-both", ["--hidden", "--no-ignore", "-n", "needle[1]", "."], ["./decoy.txt:1:needle1"]),
        ("explicit-hidden", ["-n", "-F", "needle[1]", ".hidden.txt"], ["1:needle[1]"]),
        ("listed-default", ["--files", "."], ["./decoy.txt", "./visible.txt"]),
    ]
    output = {"version": subprocess.run(["rg", "--version"], capture_output=True, text=True, check=True).stdout,
              "files": files, "isolation_controls": controls, "cases": []}
    for name, args, expected in cases:
        result = subprocess.run(["rg", *controls, *args], cwd=root, env=env, capture_output=True, text=True)
        assert result.returncode == 0, (name, result.stderr)
        assert sorted(result.stdout.splitlines()) == sorted(expected), (name, result.stdout)
        assert not result.stderr, (name, result.stderr)
        output["cases"].append({"name": name, "arguments": args, "exit": result.returncode,
                                "stdout": result.stdout, "stderr": result.stderr})
    debug_args = ["--debug", "-n", "-F", "needle[1]", "."]
    debug = subprocess.run(["rg", *controls, *debug_args], cwd=root, env=env, capture_output=True, text=True)
    assert debug.returncode == 0
    assert ".hidden.txt" in debug.stderr and "ignored.txt" in debug.stderr
    output["debug"] = {"arguments": debug_args, "exit": debug.returncode,
                       "stdout": debug.stdout, "stderr": debug.stderr}
    print(json.dumps(output, indent=2))
