#!/usr/bin/env python3
"""Export only registered author outputs into the private evidence tree.

The session tree is treated as untrusted input. This exporter never walks it:
every copied source path is an explicit allow-list entry. Existing destination
bytes are retained when their hash matches and cause an error when they differ.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any


SIDECARS = (
    "browser-check-output.json",
    "browser-check.json",
    "browser-command-receipt.json",
    "browser-command.json",
    "delivery-receipt.json",
    "delivery.json",
    "diagram.browser-check.json",
    "diagram.delivery.json",
    "diagram.finalize-summary.json",
    "diagram.finalize.json",
    "diagram.visual-check.json",
    "handoff-receipt.json",
    "handoff.json",
    "validation-receipt.json",
    "validation.json",
)
SCREENSHOTS = (
    "diagram.visual-check.1440x900.dark.png",
    "diagram.visual-check.1440x900.light.png",
    "diagram.visual-check.2048x1320.dark.png",
    "diagram.visual-check.2048x1320.light.png",
    "diagram.visual-check.contact.png",
    "first.visual-check.1440x900.dark.png",
    "first.visual-check.1440x900.light.png",
    "first.visual-check.2048x1320.dark.png",
    "first.visual-check.2048x1320.light.png",
    "first.visual-check.contact.png",
)
SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def digest(path: Path) -> tuple[int, str]:
    hasher = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            hasher.update(chunk)
    return size, hasher.hexdigest()


def read_manifest(path: Path) -> list[str]:
    value = json.loads(path.read_text(encoding="utf-8"))
    runs = value.get("runs")
    if not isinstance(runs, list):
        raise ValueError("manifest.runs must be a list")
    ids: list[str] = []
    for entry in runs:
        if not isinstance(entry, dict) or not isinstance(entry.get("run_id"), str):
            raise ValueError("every manifest run needs a string run_id")
        run_id = entry["run_id"]
        if not SAFE_RUN_ID.fullmatch(run_id):
            raise ValueError(f"unsafe run_id: {run_id!r}")
        if run_id in ids:
            raise ValueError(f"duplicate run_id: {run_id}")
        ids.append(run_id)
    return ids


def copy_one(source: Path, destination: Path, source_rel: str, category: str) -> dict[str, Any]:
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"allow-listed source is not a regular file: {source}")
    size, sha256 = digest(source)
    if destination.is_symlink():
        raise ValueError(f"destination is a symlink: {destination}")
    if destination.exists():
        if not destination.is_file():
            raise ValueError(f"destination is not a regular file: {destination}")
        existing_size, existing_sha256 = digest(destination)
        if (existing_size, existing_sha256) != (size, sha256):
            raise ValueError(f"destination differs; refusing overwrite: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    return {
        "source": source_rel,
        "destination": destination.name,
        "category": category,
        "bytes": size,
        "sha256": sha256,
    }


def export_run(run_id: str, sessions: Path, evidence: Path) -> dict[str, Any]:
    source_root = sessions / run_id
    destination_root = evidence / run_id / "author-output"
    if destination_root.exists() and destination_root.is_symlink():
        raise ValueError(f"destination is a symlink: {destination_root}")
    destination_root.mkdir(parents=True, exist_ok=True)
    copied: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []

    if not source_root.is_dir() or source_root.is_symlink():
        missing.append({"source": ".", "category": "run-root"})
        return {
            "run_id": run_id,
            "source_root": str(source_root),
            "destination_root": str(destination_root),
            "copied": copied,
            "missing": missing,
        }

    def optional_file(name: str, category: str) -> None:
        source = source_root / name
        if source.is_symlink():
            raise ValueError(f"allow-listed source is a symlink: {source}")
        if source.is_file():
            copied.append(copy_one(source, destination_root / name, name, category))
        else:
            missing.append({"source": name, "category": category})

    optional_file("candidate.json", "candidate")
    artifact_found = False
    for name in ("diagram.html", "artifact.html"):
        source = source_root / name
        if source.is_symlink():
            raise ValueError(f"allow-listed source is a symlink: {source}")
        if source.is_file():
            artifact_found = True
            copied.append(copy_one(source, destination_root / name, name, "artifact"))
    if not artifact_found:
        missing.append({"source": "diagram.html|artifact.html", "category": "artifact"})

    for name in SIDECARS:
        optional_file(name, "native-json-sidecar")
    for name in SCREENSHOTS:
        optional_file(name, "screenshot")

    return {
        "run_id": run_id,
        "source_root": str(source_root),
        "destination_root": str(destination_root),
        "copied": copied,
        "missing": missing,
        "excluded": [
            "home/",
            ".codex/",
            "source/",
            "archify/",
            "auth/",
            "configuration and private logs",
            "all paths not named by the allow-list",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--sessions", type=Path, required=True, help="S: registered session roots")
    parser.add_argument("--evidence", type=Path, required=True, help="R: private evidence root")
    args = parser.parse_args(argv)

    run_ids = read_manifest(args.manifest)
    sessions = args.sessions.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    runs = [export_run(run_id, sessions, evidence) for run_id in run_ids]
    index = {
        "schema_version": 1,
        "manifest": str(args.manifest.resolve()),
        "sessions": str(sessions),
        "evidence": str(evidence),
        "allowlist": {
            "root_files": ["candidate.json", "diagram.html", "artifact.html"],
            "json_sidecars": list(SIDECARS),
            "root_screenshots": list(SCREENSHOTS),
        },
        "runs": runs,
    }
    index_path = evidence / "export-index.json"
    payload = (json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + chr(10)).encode("utf-8")
    if index_path.exists():
        if index_path.is_symlink() or not index_path.is_file() or index_path.read_bytes() != payload:
            raise ValueError(f"existing export index differs; refusing overwrite: {index_path}")
    else:
        index_path.write_bytes(payload)
    print(json.dumps({"runs": len(runs), "index": str(index_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
