import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("assemble-quality.py")
SPEC = importlib.util.spec_from_file_location("assemble_quality", MODULE_PATH)
assemble = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(assemble)


class AssembleQualityTests(unittest.TestCase):
    def _case(self, root, *, variant="B", native=True, common_captures=True, review_gates=True, hash_mismatch=False):
        evidence = root / f"holdout-test-{variant}"
        session = root / "sessions" / evidence.name
        (evidence / "machine-review").mkdir(parents=True)
        (evidence / "independent-review").mkdir(parents=True)
        session.mkdir(parents=True)
        candidate_hash = "candidate-hash"
        artifact_hash = "artifact-hash"
        checks = [
            {"name": "common-final-check", "exit_code": 0, "duration_ms": 1},
            {"name": "common-final-browser", "exit_code": 0, "duration_ms": 1},
            {"name": "common-final-1920", "exit_code": 0, "duration_ms": 1},
        ]
        if common_captures:
            checks.append({"name": "common-final-captures", "exit_code": 0, "duration_ms": 1})
        if variant != "A":
            checks.append({"name": "common-final-validate", "exit_code": 0, "duration_ms": 1})
        machine = {
            "legacy_A": variant == "A",
            "external_identity": {"status": "passed", "candidate_sha256": candidate_hash, "artifact_sha256": artifact_hash} if variant == "A" else None,
            "frozen_hashes": {"candidate.json": candidate_hash, "diagram.html": artifact_hash},
            "checks": checks,
            "author_bytes_unchanged": True,
        }
        if hash_mismatch:
            machine["frozen_hashes"]["diagram.html"] = "different-artifact-hash"
        (evidence / "machine-review/report.json").write_text(json.dumps(machine))
        review = {"status": "passed"}
        if review_gates:
            review.update({"semantic": {"status": "passed"}, "visual": {"status": "passed"}})
        (evidence / "independent-review/review.json").write_text(json.dumps(review))
        (evidence / "summary.json").write_text(json.dumps({"candidate_snapshots": [{"complete": True}], "timed_out": False}))
        if native:
            if variant == "A":
                (session / "diagram.visual-check.json").write_text(json.dumps({"ok": True, "artifact": {"sha256": artifact_hash}}))
            else:
                (session / "diagram.finalize.json").write_text(json.dumps({"ok": True, "specification": {"sha256": candidate_hash}, "artifact": {"sha256": artifact_hash}}))
        return evidence, root / "sessions"

    def test_empty_or_unstarted_directory_does_not_write_quality(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            empty = root / "holdout-empty"
            empty.mkdir()
            self.assertIsNone(assemble.assemble_run(empty, root / "sessions"))
            self.assertFalse((empty / "quality.json").exists())

            partial = root / "holdout-partial"
            (partial / "machine-review").mkdir(parents=True)
            (partial / "independent-review").mkdir(parents=True)
            (partial / "summary.json").write_text(json.dumps({"status": "running"}))
            self.assertIsNone(assemble.assemble_run(partial, root / "sessions"))
            self.assertFalse((partial / "quality.json").exists())

    def test_b_hash_mismatch_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), hash_mismatch=True)
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["native"], "failed")
            self.assertEqual(quality["status"], "failed")
            self.assertEqual(quality["native_acceptance"], "failed")

    def test_a_inline_identity_and_native_visual_can_pass_without_sidecar(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), variant="A")
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["native"], "passed")
            self.assertEqual(quality["status"], "passed")
            self.assertFalse((sessions / evidence.name / "diagram.delivery.json").exists())

    def test_adjudicated_review_receipt_is_authoritative(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp))
            (evidence / "independent-review/adjudicated-review.json").write_text(json.dumps({
                "status": "passed",
                "semantic": {"status": "passed"},
                "visual": {"status": "passed"},
                "duration_ms": 42,
                "reviewed_at_utc": "2026-09-20T07:00:42Z",
            }))
            assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(quality["review_duration_ms"], 42)
            self.assertEqual(quality["independent_review_path"], "independent-review/adjudicated-review.json")

    def test_missing_common_capture_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), common_captures=False)
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["common"], "unknown")
            self.assertEqual(quality["status"], "unknown")

    def test_review_top_level_pass_without_gates_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), review_gates=False)
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(quality["independent_review_status"], "unknown")

    def test_missing_native_receipt_keeps_final_quality_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), native=False)
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["native"], "unknown")
            self.assertEqual(quality["native_acceptance"], "unknown")
            self.assertEqual(quality["status"], "unknown")

    def test_timeout_remains_an_explicit_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp))
            summary_path = evidence / "summary.json"
            summary_path.write_text(json.dumps({"candidate_snapshots": [{"complete": True}], "timed_out": True}))
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["status"], "failed")
            self.assertEqual(quality["status"], "failed")

    def test_old_derived_failure_does_not_override_current_unknown_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp), native=False)
            (evidence / "quality.json").write_text(json.dumps({"status": "failed", "first_candidate": {"status": "failed"}}))
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(quality["status"], "unknown")
            self.assertEqual(quality["first_candidate"]["status"], "failed")

    def test_partial_machine_duration_stays_null(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp))
            machine_path = evidence / "machine-review/report.json"
            machine = json.loads(machine_path.read_text())
            del machine["checks"][0]["duration_ms"]
            machine_path.write_text(json.dumps(machine))
            assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertIsNone(quality["final_machine_duration_ms"])

    def test_failed_finalize_without_artifact_hash_remains_native_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence, sessions = self._case(Path(temp))
            finalize_path = sessions / evidence.name / "diagram.finalize.json"
            finalize_path.write_text(json.dumps({"ok": False, "status": "fail"}))
            result = assemble.assemble_run(evidence, sessions)
            quality = json.loads((evidence / "quality.json").read_text())
            self.assertEqual(result["native"], "failed")
            self.assertEqual(quality["native_acceptance"], "failed")
            self.assertEqual(quality["status"], "failed")


if __name__ == "__main__":
    unittest.main()
