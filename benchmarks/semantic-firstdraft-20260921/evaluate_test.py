import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("evaluate.py")
SPEC = importlib.util.spec_from_file_location("semantic_firstdraft_evaluate", MODULE_PATH)
evaluate = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(evaluate)


FREEZE = {
    "author": {
        "model": "gpt-5.6-terra",
        "effort": "medium",
        "native_cap_seconds": 600,
    }
}


def _valid_start(condition="B1"):
    return {"condition": condition}


def _valid_integrity():
    return {
        "source_unchanged": True,
        "package_unchanged": True,
        "helper_unchanged": True,
        "guide_unchanged": True,
    }


def _valid_native():
    return {
        "identity": {"model": "gpt-5.6-terra", "effort": "medium"},
        "native_task_seconds": 42,
        "task_started_at": "1970-01-01T00:16:40Z",
    }


class EligibilityTest(unittest.TestCase):
    def test_valid_pure_eligibility(self):
        result = evaluate.eligibility(
            _valid_start(), _valid_integrity(), _valid_native(), FREEZE
        )

        self.assertEqual(result, {"eligible": True, "reasons": []})

    def test_model_and_time_mismatch_are_ineligible(self):
        wrong_model = _valid_native()
        wrong_model["identity"] = {"model": "other-model", "effort": "medium"}
        result = evaluate.eligibility(
            _valid_start(), _valid_integrity(), wrong_model, FREEZE
        )
        self.assertFalse(result["eligible"])
        self.assertIn("author-identity-mismatch", result["reasons"])

        over_time = _valid_native()
        over_time["native_task_seconds"] = FREEZE["author"]["native_cap_seconds"] + 1
        result = evaluate.eligibility(
            _valid_start(), _valid_integrity(), over_time, FREEZE
        )
        self.assertFalse(result["eligible"])
        self.assertIn("author-time-ineligible", result["reasons"])


class EvaluateProtocolGateTest(unittest.TestCase):
    def _write_ineligible_run(self, scratch, evidence_root, field, missing):
        run_name = f"compact-{field}-{'missing' if missing else 'modified'}"
        workspace = scratch / "runs" / run_name / "output"
        evidence = evidence_root / run_name
        workspace.mkdir(parents=True)
        evidence.mkdir(parents=True)

        integrity = _valid_integrity()
        if missing:
            del integrity[field]
        else:
            integrity[field] = False

        candidate = workspace / "diagram.architecture.json"
        candidate.write_text('{"type":"architecture"}\n')
        final_sha = hashlib.sha256(candidate.read_bytes()).hexdigest()
        (workspace / "diagram.html").write_text("<html>complete</html>\n")
        (workspace / "diagram.finalize-summary.json").write_text(
            json.dumps({"ok": True, "specification": {"sha256": final_sha}})
        )

        (evidence / "start.json").write_text(
            json.dumps({"condition": "C1", "task_id": "fixture"})
        )
        (evidence / "integrity.json").write_text(json.dumps(integrity))
        (evidence / "native-trace.json").write_text(json.dumps(_valid_native()))
        (evidence / "receipt.json").write_text(
            json.dumps(
                {
                    "start_epoch": 1000,
                    "snapshots": [
                        {
                            "index": 1,
                            "elapsed_seconds": 1,
                            "sha256": "snapshot-sha",
                            "structurally_complete": True,
                        }
                    ],
                }
            )
        )
        (evidence / "snapshot-001.json").write_text('{"type":"architecture"}\n')
        return run_name

    def test_integrity_defects_block_evaluation_and_all_commands(self):
        defects = (
            "source_unchanged",
            "package_unchanged",
            "helper_unchanged",
            "guide_unchanged",
        )
        for field in defects:
            for missing in (False, True):
                with self.subTest(field=field, missing=missing):
                    with tempfile.TemporaryDirectory() as directory:
                        root = pathlib.Path(directory)
                        scratch = root / "scratch"
                        evidence_root = root / "evidence"
                        out_freeze = evidence_root / "freeze.json"
                        scratch.mkdir()
                        evidence_root.mkdir()
                        out_freeze.write_text(json.dumps(FREEZE))
                        run_name = self._write_ineligible_run(
                            scratch, evidence_root, field, missing
                        )

                        with mock.patch.object(
                            evaluate,
                            "command",
                            side_effect=AssertionError(
                                "ineligible evaluation invoked a validator or capture"
                            ),
                        ) as command:
                            evaluate.evaluate(scratch, evidence_root, run_name)

                        command.assert_not_called()
                        result = json.loads(
                            (evidence_root / run_name / "evaluation.json").read_text()
                        )
                        self.assertFalse(result["protocol"]["eligible"])
                        self.assertIn(field, result["protocol"]["reasons"])
                        self.assertTrue(result["final"]["author_finalized"])
                        self.assertTrue(result["final"]["hash_bound"])
                        self.assertTrue(result["final"]["html_available"])
                        self.assertFalse(result["final"]["eligible_delivery"])
                        self.assertEqual(result["snapshots"][0]["validation_exit"], None)
                        self.assertIsNone(result["final"]["visual_capture_exit"])


if __name__ == "__main__":
    unittest.main()
