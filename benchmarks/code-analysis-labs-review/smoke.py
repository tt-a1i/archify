"""Replay one changed definition and one direct caller per language in source and ZIP."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

CASES = {
    "JavaScript": ("entry.mjs", "export function selected(){return 1}\nexport function caller(){return selected()}\n", {}),
    "TypeScript": ("entry.ts", "export function selected(): number {return 1}\nexport function caller(){return selected()}\n", {}),
    "Python": ("entry.py", "def selected(): return 1\ndef caller(): return selected()\n", {}),
    "Java": ("Demo.java", "class Demo {\n static int selected(){return 1;}\n static int caller(){return selected();}\n}\n", {}),
    "Go": ("entry.go", "package demo\nfunc selected() int {return 1}\nfunc caller() int {return selected()}\n", {"go.mod": "module example.org/demo\n\ngo 1.22\n"}),
    "Rust": ("src/lib.rs", "pub fn selected()->i32 {1}\npub fn caller()->i32 {selected()}\n", {"Cargo.toml": '[package]\nname="demo"\nversion="0.1.0"\nedition="2021"\n'}),
}


def replay(cli, root, entry, source):
    result = subprocess.run(["node", str(cli), "code-analysis", "task", "--question",
                             "What changed and which known calls point to it?", "--base-root",
                             str(root / "base"), "--root", str(root / "head"), "--entry",
                             entry, "--format", "json"], capture_output=True, text=True)
    assert result.returncode == 0, (entry, result.stderr, result.stdout[-2000:])
    brief = json.loads(result.stdout)
    assert brief["status"] == "ready" and brief["changedDefinitions"]["total"] == 1, entry
    lines = source.splitlines()
    definition_line = next(i for i, line in enumerate(lines, 1) if "selected" in line)
    caller_line = next(i for i, line in enumerate(lines, 1) if "caller" in line)
    for side in ("base", "head"):
        item = brief["changedDefinitions"]["items"][0][side]
        definition = item["definition"]
        assert definition["file"] == entry and definition["line"] == definition_line, definition
        refs = item["knownReferences"]
        assert refs["total"] == 1 and len(refs["items"]) == 1, refs
        ref = refs["items"][0]
        nav = ref["navigation"]
        assert nav["status"] == "valid" and nav["location"]["file"] == entry, nav
        assert nav["location"]["line"] == caller_line, nav
        target = ref["fact"]["target"]
        assert target.get("file", entry) == entry and target["line"] == definition_line, target
    return brief


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_cli", type=Path)
    parser.add_argument("zip_cli", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        for language, (entry, source, manifests) in CASES.items():
            root = Path(directory) / language
            for side in ("base", "head"):
                files = {**manifests, entry: source if side == "base" else source.replace("1", "2")}
                for name, contents in files.items():
                    path = root / side / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(contents)
                if language == "Rust":
                    subprocess.run(["cargo", "generate-lockfile", "--offline"], cwd=root / side, check=True)
            source_result = replay(args.source_cli.resolve(), root, entry, source)
            zip_result = replay(args.zip_cli.resolve(), root, entry, source)
            assert source_result == zip_result, language
            print(f"{language}: changed definition and direct reference match on both sides and in both CLIs", flush=True)


if __name__ == "__main__":
    main()
