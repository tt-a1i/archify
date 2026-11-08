"""Optional rust-analyzer navigation audit for the frozen trait-change sample.

The language server is an independent oracle for "which declaration does Go to
Definition return", not a product backend and not runtime proof.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import queue
import subprocess
import threading
import time
from urllib.parse import unquote, urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=pathlib.Path, required=True)
parser.add_argument("--positions", type=pathlib.Path, required=True, help="JSON [{file,line,column,name}] 1-based")
parser.add_argument("--out", type=pathlib.Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)
positions = json.loads(args.positions.read_text())

config = {"cargo": {"noDeps": True, "buildScripts": {"enable": False}, "procMacro": {"enable": False},
                    "checkOnSave": False}, "checkOnSave": False, "diagnostics": {"enable": False}}
env = {**os.environ, "CARGO_NET_OFFLINE": "true", "RUSTUP_AUTO_INSTALL": "0", "RA_LOG": "project_model=info"}
stderr = (out / "stderr.log").open("wb")
proc = subprocess.Popen(["rust-analyzer"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, env=env, cwd=root)
messages: queue.Queue = queue.Queue()
counter = 0
statuses: list[dict] = []


def send(payload: dict) -> None:
    data = json.dumps(payload).encode()
    proc.stdin.write(f"Content-Length: {len(data)}\r\n\r\n".encode() + data)
    proc.stdin.flush()


def reader() -> None:
    try:
        while True:
            headers = {}
            while True:
                line = proc.stdout.readline()
                if not line:
                    return
                if line == b"\r\n":
                    break
                key, value = line.decode().split(":", 1)
                headers[key.lower()] = value.strip()
            messages.put(json.loads(proc.stdout.read(int(headers["content-length"]))))
    except Exception as error:  # pragma: no cover - transport failure is reported
        messages.put({"readerError": str(error)})


threading.Thread(target=reader, daemon=True).start()


def handle(message: dict) -> bool:
    if "method" not in message:
        return False
    if message["method"] == "experimental/serverStatus":
        statuses.append(message["params"])
    if "id" in message:
        if message["method"] == "workspace/configuration":
            result = [config if item.get("section") in (None, "rust-analyzer") else None for item in message["params"]["items"]]
        else:
            result = None
        send({"jsonrpc": "2.0", "id": message["id"], "result": result})
    return True


def request(method: str, params: dict, timeout: int = 120) -> dict:
    global counter
    counter += 1
    send({"jsonrpc": "2.0", "id": counter, "method": method, "params": params})
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            message = messages.get(timeout=min(1, deadline - time.monotonic()))
        except queue.Empty:
            if proc.poll() is not None:
                raise RuntimeError(f"server exited {proc.returncode}")
            continue
        if handle(message):
            continue
        if message.get("id") == counter:
            return message
    raise TimeoutError(method)


def uri(path: str) -> str:
    return pathlib.Path(path).resolve().as_uri()


def location(result) -> dict | None:
    if isinstance(result, list):
        result = result[0] if result else None
    if not result:
        return None
    target = result.get("targetUri") or result.get("uri")
    rng = result.get("targetRange") or result.get("range")
    parsed = urlparse(target)
    return {"file": unquote(parsed.path), "relative": os.path.relpath(unquote(parsed.path), root),
            "line": rng["start"]["line"] + 1, "column": rng["start"]["character"] + 1}


rows = []
try:
    init = request("initialize", {"processId": os.getpid(), "rootUri": root.as_uri(),
                                  "workspaceFolders": [{"uri": root.as_uri(), "name": root.name}],
                                  "capabilities": {"workspace": {"configuration": True},
                                                   "experimental": {"serverStatusNotification": True}},
                                  "initializationOptions": config})
    (out / "initialize.json").write_text(json.dumps(init, indent=2) + "\n")
    send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            message = messages.get(timeout=1)
        except queue.Empty:
            continue
        handle(message)
        if statuses and statuses[-1].get("quiescent"):
            break
    opened = set()
    for point in positions:
        file = point["file"]
        if file not in opened:
            text = (root / file).read_text()
            request("textDocument/didOpen", {"textDocument": {"uri": uri(str(root / file)), "languageId": "rust",
                                                              "version": 1, "text": text}})
            opened.add(file)
        response = request("textDocument/definition", {"textDocument": {"uri": uri(str(root / file))},
                                                       "position": {"line": point["line"] - 1, "character": point["column"] - 1}})
        got = location(response.get("result"))
        rows.append({**point, "definition": got,
                     "matches": bool(got and got["relative"] == point.get("expectedFile") and got["line"] == point.get("expectedLine")),
                     "error": response.get("error")})
finally:
    try:
        request("shutdown", None, timeout=10)
        send({"jsonrpc": "2.0", "method": "exit", "params": None})
    except Exception:
        pass
    proc.terminate()

report = {"tool": subprocess.check_output(["rust-analyzer", "--version"], text=True).strip(),
          "root": str(root), "rows": rows, "statuses": statuses,
          "matches": sum(row["matches"] for row in rows), "total": len(rows),
          "limits": ["Go to Definition returns one declaration selected by rust-analyzer's incomplete analysis.",
                     "It does not prove runtime dispatch or execution.",
                     "No build scripts, proc macros, check-on-save or dependency analysis were enabled."]}
(out / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"matches": report["matches"], "total": report["total"], "rows": rows}, indent=2))
