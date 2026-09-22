#!/usr/bin/env python3
"""Add conservative display labels to observed spans without changing them."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import shlex
from typing import Any, Mapping


READ_TOOLS = {"cat", "sed", "nl"}
CLI_PHASES = {"validate", "render", "finalize", "deliver", "check", "browser-check", "visual-check"}
SHELL_MARKERS = ("&&", "||", ";", "|", ">", "<", "&", "\n", "\r", "<<", "$(", "`")
OBSERVER_PATH_PLACEHOLDERS = {
    "<WORKSPACE_PARENT>": "__OBSERVER_WORKSPACE_PARENT__",
    "<WORKSPACE>": "__OBSERVER_WORKSPACE__",
    "<HOME>": "__OBSERVER_HOME__",
    "<TMP_PATH>": "__OBSERVER_TMP_PATH__",
}


def _normalize_observer_placeholders(command: str) -> str:
    """Make observer-only redacted paths parseable without changing raw data."""
    for placeholder, sentinel in OBSERVER_PATH_PLACEHOLDERS.items():
        command = command.replace(placeholder, sentinel)
    return command


def _unwrap_shell(command: str) -> tuple[list[str] | None, str]:
    """Unwrap one exact shell ``-lc``/``-c`` payload, rejecting compounds."""
    try:
        outer = shlex.split(command)
    except ValueError:
        return None, "unparseable command"
    if not outer:
        return None, "empty command"
    executable = pathlib.Path(outer[0]).name.lower()
    if executable not in {"sh", "bash", "zsh", "dash", "fish"}:
        if any(token in command for token in SHELL_MARKERS):
            return None, "compound direct command"
        return outer, "direct command"
    if len(outer) != 3 or outer[1] not in {"-c", "-lc"}:
        return None, "shell form is not exact single payload"
    payload = outer[2]
    if any(token in payload for token in SHELL_MARKERS):
        return None, "compound shell payload"
    try:
        inner = shlex.split(payload)
    except ValueError:
        return None, "unparseable shell payload"
    return inner if inner else None, "exact shell payload"


def classify(command: Any) -> tuple[str, str]:
    if not isinstance(command, str) or not command.strip():
        return "unknown", "missing command"
    tokens, basis = _unwrap_shell(_normalize_observer_placeholders(command))
    if tokens is None:
        return "unknown", basis
    executable = pathlib.Path(tokens[0]).name.lower()
    if executable == "rg" and tokens[1:] == ["--files", "source"]:
        return "repo_discovery", "exact rg --files source operation"
    if executable in READ_TOOLS:
        if executable == "sed":
            # Only recognize a non-mutating, single-file line print.  In
            # particular, sed -i and scripts containing e/s/d remain unknown.
            if len(tokens) != 4 or tokens[1] != "-n" or not re.fullmatch(r"\d+(,\d+)?p", tokens[2]):
                return "unknown", "sed form is not exact -n line-range print"
        joined = " ".join(tokens[1:]).lower()
        if executable in {"cat", "nl"} and ("skill.md" in joined or "references/" in joined):
            return "run_setup", "exact Skill/reference read"
        if executable in {"cat", "nl"} and "source" in joined:
            return "evidence_read", "exact source read executable"
        return "evidence_read", "exact simple read executable"
    if executable == "git" and len(tokens) > 1 and tokens[1].lower() in {"show", "diff", "log", "status", "ls-files", "rev-parse"}:
        return "repo_discovery", "exact git read operation"
    for index, token in enumerate(tokens):
        if pathlib.Path(token).name == "archify.mjs" and index + 1 < len(tokens) and tokens[index + 1].lower() in CLI_PHASES:
            operation = tokens[index + 1].lower()
            if operation == "validate":
                return "combined_validation", "exact Archify validate operation includes render and check"
            if operation == "check":
                return "artifact_check", "exact Archify artifact check operation"
            if operation == "render":
                return "layout_render", "exact Archify layout render operation"
            if operation in {"browser-check", "visual-check"}:
                return "combined_browser_quality", f"exact Archify {operation} operation"
            if operation in {"finalize", "deliver"}:
                return "combined_pipeline", "exact Archify finalize/deliver operation"
            return "unknown", "unclassified Archify CLI operation"
    return "unknown", "compound or unclassified command"


def annotate(spans: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for source in spans:
        row = dict(source)
        phase, basis = classify(source.get("command"))
        row["raw_phase"] = source.get("phase")
        row["annotated_phase"] = phase
        row["annotation_basis"] = basis
        output.append(row)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spans", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args(argv)
    rows = []
    if args.spans.exists():
        for line in args.spans.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, Mapping):
                rows.append(value)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in annotate(rows):
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"spans": len(rows), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
