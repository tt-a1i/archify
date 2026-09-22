import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


OBSERVE_PATH = Path(__file__).with_name("observe.py")
SPEC = importlib.util.spec_from_file_location("authoring_observe", OBSERVE_PATH)
observe = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(observe)


class ObserveTests(unittest.TestCase):
    def test_sanitize_redacts_secrets_and_user_paths(self):
        value = observe.sanitize(
            {
                "api_key": "do-not-write",
                "command": "/Users/tushaokun/private/diagram.json Bearer abcdefghijklmnop",
            }
        )
        self.assertNotIn("do-not-write", json.dumps(value))
        self.assertNotIn("/Users/", value["command"])
        self.assertIn("<REDACTED>", value["command"])

    def test_public_event_parser_drops_reasoning_and_accumulates_usage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            observer = observe.Observer(root / "run", root / "workspace", {"run_id": "r1", "case_id": "c1"}, 1)
            observer._handle_json(
                {"type": "item.completed", "item": {"id": "reason", "type": "reasoning", "text": "private thought"}},
                observer.mono_start + 0.01,
                "stdout",
                1,
            )
            observer._handle_json(
                {
                    "type": "item.started",
                    "item": {"id": "cmd-1", "type": "command_execution", "command": "printf ok", "cwd": str(root)},
                },
                observer.mono_start + 0.02,
                "stdout",
                2,
            )
            observer._handle_json(
                {
                    "type": "item.completed",
                    "item": {"id": "cmd-1", "type": "command_execution", "command": "printf ok", "aggregated_output": "ok", "exit_code": 0, "status": "completed"},
                },
                observer.mono_start + 0.07,
                "stdout",
                3,
            )
            observer._handle_json(
                {"type": "turn.completed", "usage": {"input_tokens": 3, "reasoning_output_tokens": 2}},
                observer.mono_start + 0.08,
                "stdout",
                4,
            )
            self.assertEqual(len(observer.events), 3)
            self.assertNotIn("private thought", json.dumps(observer.events))
            self.assertEqual(observer.usage, {"input_tokens": 3, "reasoning_output_tokens": 2})
            span = observer.spans["cmd-1"]
            self.assertEqual(span["exit_code"], 0)
            self.assertAlmostEqual(span["duration_ms"], 50.0, delta=0.1)
            observer._write_outputs({"usage": observer.usage})
            persisted_events = (root / "run" / "events.jsonl").read_text()
            self.assertIn('"input_tokens":3', persisted_events)
            self.assertIn('"reasoning_output_tokens":2', persisted_events)
            self.assertIn('"output":"ok"', persisted_events)

    def test_completion_without_start_has_unknown_duration_and_errors_are_public(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            observer = observe.Observer(root / "run", root / "workspace", {}, 1)
            observer._handle_json(
                {"type": "item.completed", "item": {"id": "only-end", "type": "command_execution", "command": "cat candidate.json", "exit_code": 1, "status": "failed"}},
                observer.mono_start + 0.1,
                "stdout",
                1,
            )
            observer._handle_json({"type": "error", "message": "provider failed to start"}, observer.mono_start + 0.2, "stdout", 2)
            span = observer.spans["only-end"]
            self.assertIsNone(span["duration_ms"])
            self.assertEqual(span["phase"], "read")
            self.assertIn("provider failed to start", json.dumps(observer.events))

    def test_cli_fixture_watches_invalid_then_complete_candidate_and_prompt_pipe(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run_dir = root / "private-run"
            workspace = root / "workspace"
            workspace.mkdir()
            metadata = root / "metadata.json"
            metadata.write_text(json.dumps({"run_id": "fixture", "case_id": "case", "model": {"name": "fixture"}}))
            prompt = root / "prompt.txt"
            prompt.write_text("fixture prompt")
            fixture = (
                "import json,sys,time,pathlib; "
                "p=pathlib.Path('candidate.json'); "
                "assert sys.stdin.read() == 'fixture prompt'; "
                "p.write_text('{bad'); time.sleep(.16); "
                "p.write_text(json.dumps({'meta':{},'components':[{'id':'a'}],'connections':[]})); time.sleep(.16); "
                "print(json.dumps({'type':'item.started','item':{'id':'x','type':'command_execution','command':'true'}}),flush=True); "
                "print(json.dumps({'type':'item.completed','item':{'id':'x','type':'command_execution','command':'true','exit_code':0,'status':'completed'}}),flush=True); "
                "print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'done'}}),flush=True)"
            )
            command = [sys.executable, "-c", fixture]
            proc = subprocess.run(
                [sys.executable, str(OBSERVE_PATH), "--run-dir", str(run_dir), "--workspace", str(workspace), "--metadata", str(metadata), "--timeout-seconds", "3", "--prompt-file", str(prompt), "--", *command],
                capture_output=True,
                text=True,
                timeout=8,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads((run_dir / "summary.json").read_text())
            self.assertGreaterEqual(summary["candidate_count"], 2)
            self.assertIsNotNone(summary["pre_first_complete_ms"])
            self.assertEqual(summary["usage"], None)
            events_text = (run_dir / "events.jsonl").read_text()
            self.assertIn("assistant_summary", events_text)
            self.assertNotIn("fixture prompt", events_text)
            self.assertTrue((run_dir / "candidate-snapshots" / "000001.invalid").exists())
            first_snapshot = run_dir / "candidate-snapshots" / "000001.invalid"
            first_record = summary["candidate_snapshots"][0]
            self.assertEqual(observe._sha256(first_snapshot.read_bytes()), first_record["sha256"])

    def test_timeout_terminates_process_group_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            metadata = root / "metadata.json"
            metadata.write_text("{}")
            proc = subprocess.run(
                [sys.executable, str(OBSERVE_PATH), "--run-dir", str(root / "run"), "--workspace", str(root / "workspace"), "--metadata", str(metadata), "--timeout-seconds", "0.1", "--", sys.executable, "-c", "import time; time.sleep(10)"],
                capture_output=True,
                text=True,
                timeout=6,
            )
            self.assertEqual(proc.returncode, 124)
            summary = json.loads((root / "run" / "summary.json").read_text())
            self.assertTrue(summary["timed_out"])
            self.assertEqual(summary["status"], "timeout")


if __name__ == "__main__":
    unittest.main()
