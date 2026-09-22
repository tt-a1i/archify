#!/usr/bin/env python3
"""Observe one bounded Codex command invocation.

The observer deliberately records a small, public surface of ``codex exec
--json`` events.  Reasoning items, prompts, environment variables, and raw
non-JSON output are never written to disk.  ``run_dir`` is the private
evidence bundle; the workspace is watched for candidate/artifact changes.

The command line is:

    observe.py --run-dir DIR --workspace DIR --metadata FILE
        [--timeout-seconds N] [--prompt-file FILE] -- COMMAND [ARG ...]

The command is started in a new process group and receives ``workspace`` as
its working directory.  The process may be any JSONL-producing command; the
parser understands the event shapes emitted by ``codex exec --json``.
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import json
import os
import queue
import re
import selectors
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterable, Mapping


SCHEMA_FIELDS = (
    "run_id",
    "case_id",
    "cohort",
    "variant_sha",
    "target_repo_sha",
    "config_hash",
    "attempt",
    "span_id",
    "parent_span_id",
    "event",
    "phase",
    "start",
    "end",
    "duration_ms",
    "timing_source",
    "tool",
    "command",
    "cwd",
    "file_refs",
    "bytes",
    "exit_code",
    "diagnostic_codes",
    "artifact_hash",
    "status",
)

SECRET_KEY = re.compile(
    r"(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key)",
    re.I,
)
SECRET_VALUE = re.compile(
    r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+|\b(?:sk|rk|ghp|github_pat|xox[baprs]-)[A-Za-z0-9_-]{8,}\b"
)
ABSOLUTE_USER_PATH = re.compile(r"(?<![A-Za-z0-9_.-])/(?:Users|home)/[^\s\"']+")
ROOT_PATH = re.compile(r"(?<![A-Za-z0-9_.-])/(?:private/)?tmp/[A-Za-z0-9_.@+-]+(?:/[^\s\"']*)?")

PUBLIC_METADATA_KEYS = {
    "run_id",
    "case_id",
    "cohort",
    "variant_sha",
    "target_repo_sha",
    "config_hash",
    "attempt",
}
USAGE_KEYS = re.compile(r"(?:token|usage|count|cost|reasoning|input|output|cache)", re.I)
PUBLIC_USAGE_NUMERIC_KEYS = {
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "reasoning_tokens",
}
COMMAND_TYPES = {"command_execution", "command-execution", "command"}
TOOL_TYPES = {
    "tool_call",
    "tool-call",
    "function_call",
    "function-call",
    "tool_result",
    "tool-result",
    "function_output",
    "function-output",
}
REASONING_TYPES = {
    "reasoning",
    "analysis",
    "message_analysis",
    "chain_of_thought",
}


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _redact_text(value: str, workspace: Path | None = None) -> str:
    """Redact paths and token-shaped material from a public string."""
    text = str(value)
    if workspace is not None:
        for path, label in ((workspace, "<WORKSPACE>"), (workspace.parent, "<WORKSPACE_PARENT>")):
            try:
                text = text.replace(str(path), label)
                text = text.replace(str(path.resolve()), label)
            except OSError:
                pass
    home = os.path.expanduser("~")
    if home:
        text = text.replace(home, "<HOME>")
    text = ABSOLUTE_USER_PATH.sub(lambda m: "<USER_PATH>" + Path(m.group(0)).name, text)
    text = ROOT_PATH.sub(lambda m: "<TMP_PATH>" + Path(m.group(0)).name, text)
    text = SECRET_VALUE.sub(lambda m: (m.group(1) if m.group(1) else "") + "<REDACTED>", text)
    return text


def sanitize(value: Any, workspace: Path | None = None, key: str | None = None) -> Any:
    """Recursively sanitize a JSON-compatible value for persistence."""
    if key and SECRET_KEY.search(key) and not _is_numeric_usage_key(key, value):
        return "<REDACTED>"
    if isinstance(value, Mapping):
        return {
            str(k): sanitize(v, workspace, str(k))
            for k, v in value.items()
            if not SECRET_KEY.search(str(k)) or _is_numeric_usage_key(str(k), v)
        }
    if isinstance(value, list):
        return [sanitize(v, workspace, key) for v in value]
    if isinstance(value, tuple):
        return [sanitize(v, workspace, key) for v in value]
    if isinstance(value, str):
        return _redact_text(value, workspace)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _redact_text(repr(value), workspace)


def _is_numeric_usage_key(key: str, value: Any) -> bool:
    """Usage counters contain the word token but are safe numeric evidence."""
    return key in PUBLIC_USAGE_NUMERIC_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool)


def _json_line(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _iso_for(mono: float, wall_start: float, mono_start: float) -> str:
    stamp = wall_start + max(0.0, mono - mono_start)
    return _dt.datetime.fromtimestamp(stamp, _dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _empty_fields(metadata: Mapping[str, Any]) -> dict[str, Any]:
    result = {field: None for field in SCHEMA_FIELDS}
    for field in PUBLIC_METADATA_KEYS:
        if field in metadata:
            result[field] = sanitize(metadata[field])
    return result


def _public_usage(raw: Any) -> dict[str, int | float]:
    if not isinstance(raw, Mapping):
        return {}
    out: dict[str, int | float] = {}
    for key, value in raw.items():
        if USAGE_KEYS.search(str(key)) and isinstance(value, (int, float)) and not isinstance(value, bool):
            out[str(key)] = value
    return out


def _first(raw: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = raw.get(key)
        if value is not None:
            return value
    return None


def _item_type(item: Mapping[str, Any]) -> str:
    return str(_first(item, "type", "kind") or "").lower()


def _command_phase(command: Any) -> str:
    """Classify explicit CLI/read operations; leave other commands unknown."""
    if not isinstance(command, str) or not command.strip():
        return "unknown"
    try:
        import shlex

        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    if not tokens:
        return "unknown"
    if Path(tokens[0]).name.lower() in {
        "cat", "head", "tail", "sed", "awk", "grep", "rg", "find", "ls", "pwd", "stat", "wc", "realpath"
    }:
        return "read"
    for index, token in enumerate(tokens):
        if Path(token).name == "archify.mjs" and index + 1 < len(tokens):
            operation = tokens[index + 1].lower()
            if operation in {"validate", "render", "finalize", "deliver", "check"}:
                return operation
    return "unknown"


def _event_item(raw: Mapping[str, Any]) -> Mapping[str, Any]:
    item = raw.get("item")
    return item if isinstance(item, Mapping) else raw


def _text_summary(item: Mapping[str, Any], workspace: Path) -> str | None:
    value = _first(item, "text", "summary", "message")
    if isinstance(value, str):
        return _redact_text(value[:16000], workspace)
    return None


def is_complete_candidate(value: Any) -> bool:
    """Return whether *value* is a structurally recognizable architecture."""
    if not isinstance(value, Mapping):
        return False
    components = value.get("components")
    return (
        isinstance(value.get("meta"), Mapping)
        and isinstance(components, list)
        and bool(components)
        and isinstance(value.get("connections"), list)
    )


class CandidateWatcher:
    def __init__(self, workspace: Path, run_dir: Path, interval: float = 0.1) -> None:
        self.workspace = workspace
        self.run_dir = run_dir
        self.path = workspace / "candidate.json"
        self.interval = interval
        self.records: list[dict[str, Any]] = []
        self.first_file_mono: float | None = None
        self.first_complete_mono: float | None = None
        self.max_scan_interval_ms = 0.0
        self._last_hash: str | None = None
        self._previous_scan: float | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.snapshot_dir = run_dir / "candidate-snapshots"

    def start(self) -> None:
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._run, name="candidate-watcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        self.scan_once()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.scan_once()
            self._stop.wait(self.interval)

    def scan_once(self) -> None:
        now = time.monotonic()
        if self._previous_scan is not None:
            self.max_scan_interval_ms = max(self.max_scan_interval_ms, (now - self._previous_scan) * 1000)
        self._previous_scan = now
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        except OSError as exc:
            raw = ("<read-error:" + type(exc).__name__ + ">\n").encode()
        digest = _sha256(raw)
        if digest == self._last_hash:
            return
        self._last_hash = digest
        valid = False
        complete = False
        parse_error: str | None = None
        parsed: Any = None
        try:
            parsed = json.loads(raw.decode("utf-8"))
            valid = True
            complete = is_complete_candidate(parsed)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
            parse_error = type(exc).__name__
        if self.first_file_mono is None:
            self.first_file_mono = now
        if complete and self.first_complete_mono is None:
            self.first_complete_mono = now
        index = len(self.records) + 1
        suffix = ".json" if valid else ".invalid"
        snapshot_path = self.snapshot_dir / f"{index:06d}{suffix}"
        try:
            # Private snapshots preserve the exact bytes whose digest is
            # recorded, enabling repeatable candidate validation.
            snapshot_path.write_bytes(raw)
            private_path = str(snapshot_path)
        except OSError:
            private_path = None
        record = {
            "index": index,
            "path": "<WORKSPACE>/candidate.json",
            "snapshot": private_path,
            "sha256": digest,
            "bytes": len(raw),
            "observed_at": utc_now(),
            "observed_mono": now,
            "parseable": valid,
            "complete": complete,
            "error": parse_error,
        }
        self.records.append(record)

    def public_records(self) -> list[dict[str, Any]]:
        return [
            {key: value for key, value in record.items() if key != "observed_mono" and key != "snapshot"}
            | {"snapshot": _redact_text(str(record["snapshot"])) if record["snapshot"] else None}
            for record in self.records
        ]


class Observer:
    def __init__(self, run_dir: Path, workspace: Path, metadata: Mapping[str, Any], timeout_seconds: float) -> None:
        self.run_dir = run_dir
        self.workspace = workspace
        self.metadata = metadata
        self.timeout_seconds = timeout_seconds
        self.wall_start = time.time()
        self.mono_start = time.monotonic()
        self.events: list[dict[str, Any]] = []
        self.spans: dict[str, dict[str, Any]] = {}
        self.usage: dict[str, int | float] = {}
        self.event_queue: queue.Queue[tuple[str, bytes, float, str]] = queue.Queue()
        self.process: subprocess.Popen[bytes] | None = None
        self.process_started_mono: float | None = None
        self.process_exit_mono: float | None = None
        self.invalid_json_lines = 0
        self._reader_threads: list[threading.Thread] = []
        self.watcher = CandidateWatcher(workspace, run_dir)

    def _base(self) -> dict[str, Any]:
        return _empty_fields(self.metadata)

    def _append_event(self, raw_event: str, received_mono: float, stream: str, line_no: int, event: str, **kwargs: Any) -> None:
        row = self._base()
        row.update(
            {
                "event": event,
                "phase": kwargs.pop("phase", None),
                "start": _iso_for(received_mono, self.wall_start, self.mono_start),
                "timing_source": "observer_received",
                "status": kwargs.pop("status", None),
                "stream": stream,
                "line_no": line_no,
                "received_mono_ms": round((received_mono - self.mono_start) * 1000, 3),
            }
        )
        row.update(sanitize(kwargs, self.workspace))
        self.events.append(row)

    def _merge_usage(self, usage: Mapping[str, Any]) -> None:
        for key, value in _public_usage(usage).items():
            self.usage[key] = self.usage.get(key, 0) + value

    def _handle_json(self, raw: Mapping[str, Any], received_mono: float, stream: str, line_no: int) -> None:
        event_type = str(_first(raw, "type", "event") or "").lower()
        item = _event_item(raw)
        item_type = _item_type(item)
        usage = raw.get("usage")
        if isinstance(usage, Mapping):
            self._merge_usage(usage)
        if event_type == "turn.completed" or event_type.endswith("turn.completed"):
            self._append_event("turn.completed", received_mono, stream, line_no, "turn.completed", phase="usage", usage=_public_usage(usage))
            return
        if event_type in {"item.started", "item.completed", "item.updated"}:
            if item_type in REASONING_TYPES or item_type in {"plan", "analysis_text"}:
                return
            is_command = item_type in COMMAND_TYPES
            is_tool = item_type in TOOL_TYPES or "tool" in item_type
            is_message = item_type in {"agent_message", "assistant_message", "message", "final"}
            if not (is_command or is_tool or is_message):
                return
            completed = event_type.endswith("completed")
            span_id = _first(item, "id", "item_id", "call_id")
            parent = _first(item, "parent_id", "parent_item_id", "parent_call_id")
            command = _first(item, "command", "cmd")
            tool = _first(item, "name", "tool", "tool_name")
            cwd = _first(item, "cwd", "working_directory", "workdir")
            status = _first(item, "status", "state")
            exit_code = _first(item, "exit_code", "exitCode", "returncode")
            output = _first(item, "aggregated_output", "output", "result")
            output_bytes = len(output.encode("utf-8", "replace")) if isinstance(output, str) else None
            file_refs = _first(item, "file_refs", "fileRefs", "file_references", "files")
            if isinstance(file_refs, str):
                file_refs = [file_refs]
            if not isinstance(file_refs, list) or not all(isinstance(ref, str) for ref in file_refs):
                file_refs = None
            explicit_bytes = _first(item, "bytes", "byte_count", "byteCount")
            byte_count = explicit_bytes if isinstance(explicit_bytes, (int, float)) and not isinstance(explicit_bytes, bool) else output_bytes
            diagnostic_codes = _first(item, "diagnostic_codes", "diagnosticCodes")
            if not isinstance(diagnostic_codes, list) or not all(isinstance(code, str) for code in diagnostic_codes):
                diagnostic_codes = None
            artifact_hash = _first(item, "artifact_hash", "artifactHash")
            if not isinstance(artifact_hash, str):
                artifact_hash = None
            if is_command and span_id:
                span_key = str(span_id)
                span = self.spans.setdefault(span_key, self._span_template(span_key, parent))
                if not completed and span["start"] is None:
                    span.update(
                        {
                            "start": _iso_for(received_mono, self.wall_start, self.mono_start),
                            "_start_mono": received_mono,
                            "command": command,
                            "cwd": cwd,
                            "status": status,
                            "phase": _command_phase(command),
                        }
                    )
                elif completed:
                    if span["start"] is None:
                        # A completion without a received start has no
                        # defensible elapsed duration.
                        span.update(
                            {
                                "end": _iso_for(received_mono, self.wall_start, self.mono_start),
                                "command": command,
                                "cwd": cwd,
                                "phase": _command_phase(command),
                                "file_refs": file_refs,
                                "bytes": byte_count,
                                "exit_code": exit_code,
                                "diagnostic_codes": diagnostic_codes,
                                "artifact_hash": artifact_hash,
                                "status": status or ("completed" if exit_code in (0, None) else "failed"),
                            }
                        )
                    else:
                        span.update(
                            {
                                "end": _iso_for(received_mono, self.wall_start, self.mono_start),
                                "_end_mono": received_mono,
                                "duration_ms": round((received_mono - span["_start_mono"]) * 1000, 3),
                                "command": command or span.get("command"),
                                "cwd": cwd or span.get("cwd"),
                                "phase": _command_phase(command or span.get("command")),
                                "file_refs": file_refs,
                                "bytes": byte_count,
                                "exit_code": exit_code,
                                "diagnostic_codes": diagnostic_codes,
                                "artifact_hash": artifact_hash,
                                "status": status or ("completed" if exit_code in (0, None) else "failed"),
                            }
                        )
            if is_message and not completed:
                return
            public_event = "command" if is_command else "tool" if is_tool else "assistant_summary"
            self._append_event(
                event_type,
                received_mono,
                stream,
                line_no,
                public_event,
                phase=_command_phase(command) if is_command else "tool" if is_tool else "summary",
                span_id=span_id,
                parent_span_id=parent,
                tool=tool,
                command=command,
                cwd=cwd,
                file_refs=file_refs,
                bytes=byte_count,
                output=output if is_command else None,
                exit_code=exit_code,
                diagnostic_codes=diagnostic_codes,
                artifact_hash=artifact_hash,
                status=status,
                summary=_text_summary(item, self.workspace) if is_message else None,
            )
            return
        if event_type in {"thread.started", "turn.started", "error", "fatal", "session.started"}:
            # Keep lifecycle/failure markers, but only their safe scalar status.
            self._append_event(
                event_type,
                received_mono,
                stream,
                line_no,
                event_type,
                phase="lifecycle" if "started" in event_type else "error",
                status=_first(raw, "status", "code"),
                diagnostic=_first(raw, "message", "error", "detail"),
                diagnostic_codes=_first(raw, "diagnostic_codes", "diagnosticCodes"),
            )

    def _span_template(self, span_id: str, parent: Any) -> dict[str, Any]:
        row = self._base()
        row.update(
            {
                "span_id": str(span_id),
                "parent_span_id": parent,
                "event": "command_execution",
                "phase": "unknown",
                "start": None,
                "end": None,
                "duration_ms": None,
                "timing_source": "observer_received",
                "tool": None,
                "command": None,
                "cwd": None,
                "file_refs": None,
                "bytes": None,
                "exit_code": None,
                "diagnostic_codes": None,
                "artifact_hash": None,
                "status": None,
                "_start_mono": None,
                "_end_mono": None,
            }
        )
        return row

    def _reader(self, stream: str, pipe: Any) -> None:
        line_no = 0
        try:
            for line in iter(pipe.readline, b""):
                line_no += 1
                self.event_queue.put((stream, line, time.monotonic(), str(line_no)))
        finally:
            try:
                pipe.close()
            except OSError:
                pass

    def _drain_events(self, until: float | None = None) -> None:
        while True:
            timeout = 0.05
            if until is not None:
                timeout = max(0.0, min(timeout, until - time.monotonic()))
                if timeout <= 0:
                    return
            try:
                stream, line, received, line_no = self.event_queue.get(timeout=timeout)
            except queue.Empty:
                if until is not None and time.monotonic() >= until:
                    return
                if self.process is not None and self.process.poll() is not None and all(not t.is_alive() for t in self._reader_threads):
                    return
                continue
            try:
                raw = json.loads(line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.invalid_json_lines += 1
                if stream == "stderr":
                    text = line.decode("utf-8", "replace").strip()
                    # Provider/startup failures are useful diagnostics.  Keep
                    # only a short redacted stderr line; never persist stdout
                    # prose or lines that look like internal reasoning.
                    if text and not re.search(r"(?i)reasoning|chain[_ -]?of[_ -]?thought|private[_ -]?thought", text):
                        self._append_event(
                            "stderr",
                            received,
                            stream,
                            int(line_no),
                            "stderr_diagnostic",
                            phase="error",
                            diagnostic=text,
                        )
                continue
            if isinstance(raw, Mapping):
                self._handle_json(raw, received, stream, int(line_no))

    def _terminate(self) -> str:
        process = self.process
        if process is None or process.poll() is not None:
            return "exited"
        try:
            if hasattr(os, "killpg"):
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
        except ProcessLookupError:
            return "exited"
        try:
            process.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            try:
                if hasattr(os, "killpg"):
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
            except ProcessLookupError:
                pass
            process.wait(timeout=2.0)
            return "killed"
        return "terminated"

    def run(self, command: list[str], prompt_file: Path | None = None) -> dict[str, Any]:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.workspace.mkdir(parents=True, exist_ok=True)
        prompt_bytes: bytes | None = None
        try:
            if prompt_file is not None:
                # Read in the observer and write through a pipe.  Passing a
                # private file descriptor to a sandboxed child can make its
                # startup fstat/read fail even when the file is readable here.
                prompt_bytes = prompt_file.read_bytes()
            self.process = subprocess.Popen(
                command,
                cwd=str(self.workspace),
                stdin=subprocess.PIPE if prompt_bytes is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
                close_fds=True,
            )
            self.process_started_mono = time.monotonic()
        except OSError as exc:
            summary = self._summary(command, None, False, "launch_error", str(exc))
            self._write_outputs(summary)
            return summary
        if prompt_bytes is not None and self.process.stdin is not None:
            try:
                self.process.stdin.write(prompt_bytes)
                self.process.stdin.close()
            except (BrokenPipeError, OSError):
                try:
                    self.process.stdin.close()
                except OSError:
                    pass
        self.watcher.start()
        for stream, pipe in (("stdout", self.process.stdout), ("stderr", self.process.stderr)):
            if pipe is not None:
                thread = threading.Thread(target=self._reader, args=(stream, pipe), daemon=True)
                thread.start()
                self._reader_threads.append(thread)
        deadline = time.monotonic() + self.timeout_seconds
        timed_out = False
        termination = None
        while self.process.poll() is None:
            self._drain_events(until=min(deadline, time.monotonic() + 0.1))
            if time.monotonic() >= deadline and self.process.poll() is None:
                timed_out = True
                termination = self._terminate()
                break
        self.process.wait()
        self.process_exit_mono = time.monotonic()
        self._drain_events(until=time.monotonic() + 0.5)
        for thread in self._reader_threads:
            thread.join(timeout=1.0)
        self._drain_events(until=time.monotonic() + 0.1)
        self.watcher.stop()
        self._close_open_spans(time.monotonic(), "terminated" if timed_out else "incomplete")
        summary = self._summary(command, self.process.returncode, timed_out, termination, None)
        self._write_outputs(summary)
        return summary

    def _close_open_spans(self, end_mono: float, status: str) -> None:
        """Close observed command intervals at the observed process boundary.

        This is an execution interval, rather than an estimate of model time:
        an unfinished command is explicitly marked incomplete/terminated.
        """
        for span in self.spans.values():
            start_mono = span.get("_start_mono")
            if start_mono is None or span.get("_end_mono") is not None:
                continue
            span.update(
                {
                    "end": _iso_for(end_mono, self.wall_start, self.mono_start),
                    "_end_mono": end_mono,
                    "duration_ms": round((end_mono - start_mono) * 1000, 3),
                    "status": status,
                }
            )

    def _summary(self, command: list[str], returncode: int | None, timed_out: bool, termination: str | None, error: str | None) -> dict[str, Any]:
        end_mono = time.monotonic()
        intervals = []
        for span in self.spans.values():
            if span.get("_start_mono") is not None and span.get("_end_mono") is not None:
                intervals.append((span["_start_mono"], span["_end_mono"]))
        accumulated = sum(max(0.0, end - start) * 1000 for start, end in intervals)
        union = _interval_union_ms(intervals)
        first_complete = self.watcher.first_complete_mono
        summary = {
            **self._base(),
            "status": "timeout" if timed_out else "launch_error" if error else "completed" if returncode == 0 else "failed",
            "command": sanitize(command, self.workspace),
            "cwd": "<WORKSPACE>",
            "returncode": returncode,
            "timed_out": timed_out,
            "termination": termination,
            "error": _redact_text(error, self.workspace) if error else None,
            "observer_start_utc": _iso_for(self.mono_start, self.wall_start, self.mono_start),
            "process_started_observed_utc": _iso_for(self.process_started_mono, self.wall_start, self.mono_start) if self.process_started_mono else None,
            "process_exit_observed_utc": _iso_for(self.process_exit_mono, self.wall_start, self.mono_start) if self.process_exit_mono else None,
            "execution_wall_ms": round((self.process_exit_mono - self.process_started_mono) * 1000, 3) if self.process_started_mono and self.process_exit_mono else None,
            "total_wall_ms": round((end_mono - self.mono_start) * 1000, 3),
            "collection_teardown_ms": round((end_mono - self.process_exit_mono) * 1000, 3) if self.process_exit_mono else None,
            "command_accumulated_ms": round(accumulated, 3) if intervals else None,
            "command_union_ms": round(union, 3) if intervals else None,
            "command_overlap_ms": round(max(0.0, accumulated - union), 3) if intervals else None,
            "command_interval_count": len(intervals),
            "pre_first_complete_ms": round((first_complete - self.mono_start) * 1000, 3) if first_complete else None,
            "first_file_ms": round((self.watcher.first_file_mono - self.mono_start) * 1000, 3) if self.watcher.first_file_mono else None,
            "candidate_count": len(self.watcher.records),
            "first_complete_sha256": next((r["sha256"] for r in self.watcher.records if r["complete"]), None),
            "max_scan_interval_ms": round(self.watcher.max_scan_interval_ms, 3),
            "usage": self.usage or None,
            "model": _public_model(self.metadata.get("model"), self.metadata),
            "model_metrics": None,
            "unknown_model_metrics": ["model_time", "read_ranges"],
            "invalid_json_lines": self.invalid_json_lines,
            "event_count": len(self.events),
            "span_count": len(self.spans),
            "candidate_snapshots": self.watcher.public_records(),
            "finished_at": utc_now(),
        }
        return sanitize(summary, self.workspace)

    def _write_outputs(self, summary: Mapping[str, Any]) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        _write_jsonl(self.run_dir / "events.jsonl", self.events)
        public_spans = []
        for span in self.spans.values():
            public_spans.append({key: sanitize(value, self.workspace) for key, value in span.items() if not key.startswith("_")})
        _write_jsonl(self.run_dir / "spans.jsonl", public_spans)
        _write_jsonl(self.run_dir / "candidate-snapshots.jsonl", self.watcher.public_records())
        _write_json(self.run_dir / "summary.json", summary)
        index = _artifact_index(self.workspace, self.run_dir)
        _write_json(self.run_dir / "artifact-index.json", index)


def _interval_union_ms(intervals: Iterable[tuple[float, float]]) -> float:
    ordered = sorted((start, end) for start, end in intervals if end >= start)
    if not ordered:
        return 0.0
    total = 0.0
    start, end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start > end:
            total += end - start
            start, end = next_start, next_end
        else:
            end = max(end, next_end)
    return total * 1000 + (end - start) * 1000


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: Iterable[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for value in values:
            handle.write(_json_line(value))


def _public_model(value: Any, metadata: Mapping[str, Any] | None = None) -> Any:
    """Keep model identity/configuration without persisting arbitrary metadata."""
    if value is None and metadata is not None:
        value = {
            key: metadata[key]
            for key in ("requested_model", "reasoning_effort")
            if key in metadata
        }
    if isinstance(value, str):
        return _redact_text(value)
    if not isinstance(value, Mapping):
        return None
    allowed = {"name", "id", "model", "reasoning", "reasoning_effort", "provider", "version"}
    return {key: sanitize(value[key]) for key in allowed if key in value and not SECRET_KEY.search(key)}


def _receipt_gates(value: Any, prefix: str = "") -> list[dict[str, Any]]:
    """Extract native gate timing scalars without copying a receipt payload."""
    found: list[dict[str, Any]] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(child, Mapping):
                duration = child.get("durationMs", child.get("duration_ms"))
                if isinstance(duration, (int, float)) and not isinstance(duration, bool):
                    status = child.get("status")
                    found.append({"gate": path, "duration_ms": duration, "status": status if isinstance(status, str) else None})
                found.extend(_receipt_gates(child, path))
            elif isinstance(child, list):
                for index, entry in enumerate(child):
                    found.extend(_receipt_gates(entry, f"{path}[{index}]"))
    return found


def _receipt_stages(value: Any) -> list[dict[str, Any]]:
    """Read the stable scalar fields from a native finalize receipt."""
    stages = value.get("stages") if isinstance(value, Mapping) else None
    if not isinstance(stages, Mapping):
        return []
    result: list[dict[str, Any]] = []
    for name, stage in stages.items():
        if not isinstance(stage, Mapping):
            continue
        receipt = stage.get("receipt") if isinstance(stage.get("receipt"), Mapping) else {}
        artifact_hash = receipt.get("artifactHash", receipt.get("artifact_hash"))
        diagnostic_codes = receipt.get("diagnosticCodes", receipt.get("diagnostic_codes"))
        if not isinstance(diagnostic_codes, list):
            diagnostic_codes = None
        result.append(
            {
                "stage": str(name),
                "status": stage.get("status") if isinstance(stage.get("status"), str) else None,
                "exit_code": stage.get("exitCode") if isinstance(stage.get("exitCode"), (int, float)) else None,
                "duration_ms": stage.get("durationMs") if isinstance(stage.get("durationMs"), (int, float)) else None,
                "execution": _redact_text(stage.get("execution")) if isinstance(stage.get("execution"), str) else None,
                "command": _redact_text(stage.get("command")) if isinstance(stage.get("command"), str) else None,
                "artifact_hash": artifact_hash if isinstance(artifact_hash, str) else None,
                "diagnostic_codes": [code for code in diagnostic_codes if isinstance(code, str)] if diagnostic_codes else None,
            }
        )
    return result


def _artifact_index(workspace: Path, run_dir: Path) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    try:
        # The workspace can contain copied home directories and credentials.
        # Index only the documented top-level artifact/receipt names.
        for path in workspace.iterdir():
            name = path.name
            is_artifact = name == "candidate.json" or (
                name.startswith("diagram") and path.suffix.lower() in {".json", ".html", ".png"}
            )
            is_receipt = name.endswith(".finalize.json") or "receipt" in name.lower()
            if not path.is_file() or not (is_artifact or is_receipt):
                continue
            try:
                data = path.read_bytes()
                stat = path.stat()
            except OSError:
                continue
            kind = "candidate" if name == "candidate.json" else "receipt" if is_receipt else "artifact"
            public_path = f"<WORKSPACE>/{name}"
            files.append({"path": public_path, "kind": kind, "bytes": len(data), "sha256": _sha256(data), "mtime_ns": stat.st_mtime_ns})
            if name.endswith(".finalize.json"):
                try:
                    parsed = json.loads(data.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    parsed = None
                gates = _receipt_gates(parsed) if parsed is not None else []
                receipts.append({"path": public_path, "sha256": _sha256(data), "stages": _receipt_stages(parsed), "gates": gates})
    except OSError:
        pass
    return {"observed_at": utc_now(), "files": files, "receipts": receipts}


def _read_metadata(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if not isinstance(value, Mapping):
        return {}
    allowed = PUBLIC_METADATA_KEYS | {"model", "requested_model", "reasoning_effort"}
    return {key: sanitize(value[key]) for key in allowed if key in value and not SECRET_KEY.search(key)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path, help="private evidence directory")
    parser.add_argument("--workspace", required=True, type=Path, help="agent workspace and candidate directory")
    parser.add_argument("--metadata", required=True, type=Path, help="JSON file with run identity fields")
    parser.add_argument("--timeout-seconds", type=float, default=3600.0)
    parser.add_argument("--prompt-file", type=Path, default=None, help="optional file passed as child stdin")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="command after --")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = list(args.command)
    if command and command[0] == "--":
        command.pop(0)
    if not command:
        parser.error("a command is required after --")
    metadata = _read_metadata(args.metadata)
    observer = Observer(args.run_dir, args.workspace, metadata, max(0.0, args.timeout_seconds))
    summary = observer.run(command, args.prompt_file)
    # A compact status line is useful to the parent harness and contains no command output.
    sys.stdout.write(json.dumps({"status": summary.get("status"), "returncode": summary.get("returncode"), "summary": "<RUN_DIR>/summary.json"}) + "\n")
    return 124 if summary.get("timed_out") else 0 if summary.get("status") == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
