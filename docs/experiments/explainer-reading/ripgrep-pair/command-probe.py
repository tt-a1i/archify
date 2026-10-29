"""Run the reviewed multiline search snippet only against a disposable fixture."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

source = Path(__file__).with_name("readable-commands.archify.md").read_text()
commands = re.findall(r"```sh[^\n]*\n(.*?)\n```", source, re.S)
command = commands[1]
assert command == "rg --no-config --hidden \\\n  --no-ignore -g '!.git' \\\n  -F '[ready]' ./src"
with tempfile.TemporaryDirectory(prefix="archify-ripgrep-command-") as directory:
    root = Path(directory)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    subprocess.run(["git", "-C", directory, "init", "--template=", "--initial-branch=example"],
                   check=True, capture_output=True, env=env)
    (root / "src/.git").mkdir(parents=True)
    for name in ["visible.txt", "ignored.txt", ".hidden.txt", ".hidden-ignored.txt", ".git/sentinel.txt"]:
        (root / "src" / name).write_text("[ready]\n")
    (root / ".gitignore").write_text("src/ignored.txt\nsrc/.hidden-ignored.txt\n")
    (root / "src/decoy.txt").write_text("ready\n")
    result = subprocess.run(["sh", "-c", command], cwd=root, env=env, capture_output=True, text=True)
    expected = [f"./src/{name}:[ready]" for name in ["visible.txt", "ignored.txt", ".hidden.txt", ".hidden-ignored.txt"]]
    assert result.returncode == 0 and not result.stderr, result
    assert sorted(result.stdout.splitlines()) == sorted(expected), result.stdout
    print(json.dumps({"command": command, "exit": result.returncode, "stdout": result.stdout,
                      "stderr": result.stderr, "excluded": ["src/.git/sentinel.txt", "src/decoy.txt"],
                      "scope": "The exact reviewed snippet ran with sh in a disposable local fixture; no user files searched."}, indent=2))
