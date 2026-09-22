import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("summarize.py")
SPEC = importlib.util.spec_from_file_location("authoring_summarize", MODULE_PATH)
summarize = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(summarize)
ANNOTATE_SPEC = importlib.util.spec_from_file_location("authoring_annotate", Path(__file__).with_name("annotate.py"))
annotate = importlib.util.module_from_spec(ANNOTATE_SPEC)
assert ANNOTATE_SPEC.loader is not None
ANNOTATE_SPEC.loader.exec_module(annotate)


class SummarizeTests(unittest.TestCase):
    def test_all_registered_attempts_and_explicit_accepted_timing_components(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            evidence = root / "evidence"
            run_a = evidence / "case-A"
            run_c = evidence / "case-C"
            run_a.mkdir(parents=True)
            run_c.mkdir(parents=True)
            manifest = {
                "runs": [
                    {"run_id": "case-A", "case_id": "case", "variant": "A", "repeat": 1},
                    {"run_id": "case-B", "case_id": "case", "variant": "B", "repeat": 1},
                    {"run_id": "case-C", "case_id": "case", "variant": "C", "repeat": 1},
                ],
                "tasks": [{"id": "case", "cohort": "development"}],
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            (run_a / "summary.json").write_text(json.dumps({"status": "completed", "returncode": 0, "execution_wall_ms": 100, "pre_first_complete_ms": 20, "usage": {"input_tokens": 9}}))
            (run_a / "quality.json").write_text(json.dumps({"status": "failed", "first_candidate": {"status": "failed"}, "repair_edits": 3}))
            (run_c / "summary.json").write_text(json.dumps({"status": "completed", "returncode": 0, "execution_wall_ms": 200, "process_started_observed_utc": "2026-09-20T06:00:00.000Z", "usage": {"input_tokens": 10}}))
            (run_c / "run-setup.json").write_text(json.dumps({"duration_ms": 50}))
            (run_c / "quality.json").write_text(json.dumps({"status": "passed", "native_acceptance": "passed", "common_acceptance": "passed", "semantic": {"status": "passed"}, "visual": {"status": "passed"}, "final_machine_duration_ms": 30, "review_duration_ms": 20, "first_snapshot_audit_ms": 7, "reviewer_idle_queue_ms": 11}))
            (run_c / "independent-review").mkdir()
            (run_c / "independent-review" / "review.json").write_text(json.dumps({"status": "passed", "reviewed_at_utc": "2026-09-20T06:00:02.500Z"}))
            output = root / "output"
            self.assertEqual(summarize.main(["--manifest", str(root / "manifest.json"), "--evidence", str(evidence), "--output", str(output)]), 0)
            rows = json.loads((output / "runs.json").read_text())
            self.assertEqual(len(rows), 3)
            pending = next(row for row in rows if row["run_id"] == "case-B")
            self.assertEqual(pending["registered_status"], "pending")
            accepted = next(row for row in rows if row["run_id"] == "case-C")
            self.assertEqual(accepted["accepted_total_ms"], 300)
            self.assertEqual(accepted["observed_accepted_subtotal_ms"], 250)
            self.assertEqual(accepted["observed_non_setup_work_ms"], 250)
            self.assertEqual(accepted["accepted_active_work_ms"], 300)
            self.assertEqual(accepted["dispatch_to_independent_review_wall_ms"], 2500.0)
            self.assertEqual(accepted["dispatch_to_accepted_wall_ms"], 2500.0)
            self.assertEqual(accepted["diagnostic_first_snapshot_ms"], 7)
            self.assertEqual(accepted["reviewer_idle_queue_ms"], 11)
            stage = json.loads((output / "stage-summary.json").read_text())
            self.assertEqual(stage["registered_attempts"], 3)
            self.assertEqual(stage["pending_attempts"], 1)
            self.assertIn("same_file_reads", stage["unavailable_metrics"])
            self.assertIn("cost", stage["unavailable_metrics"])
            self.assertIsNone(stage["comparisons"][0]["accepted_only_difference_ms"])
            c_group = next(group for group in stage["groups"] if group["case_id"] == "case" and group["variant"] == "C")
            self.assertEqual(c_group["dispatch_to_independent_review_wall"]["median_ms"], 2500.0)

    def test_repair_edit_summary_uses_edit_units_and_keeps_missing_values_unknown(self):
        rows = [
            {"case_id": "case", "variant": "C", "registered_status": "observed", "execution_status": "completed", "quality_status": "passed", "first_quality_status": "failed", "process_completed": True, "process_execution_ms": 10, "process_completed_ms": 10, "accepted_author_execution_ms": 10, "accepted_total_ms": None, "dispatch_to_accepted_wall_ms": None, "repair_edits": 3, "diagnostic_first_snapshot_ms": None, "reviewer_idle_queue_ms": None, "accepted_timing_status": "not_accepted"},
            {"case_id": "case", "variant": "C", "registered_status": "observed", "execution_status": "completed", "quality_status": "failed", "first_quality_status": "failed", "process_completed": True, "process_execution_ms": 20, "process_completed_ms": 20, "accepted_author_execution_ms": None, "accepted_total_ms": None, "dispatch_to_accepted_wall_ms": None, "repair_edits": 1, "diagnostic_first_snapshot_ms": None, "reviewer_idle_queue_ms": None, "accepted_timing_status": "not_accepted"},
            {"case_id": "case", "variant": "C", "registered_status": "observed", "execution_status": "completed", "quality_status": "failed", "first_quality_status": "failed", "process_completed": True, "process_execution_ms": 30, "process_completed_ms": 30, "accepted_author_execution_ms": None, "accepted_total_ms": None, "dispatch_to_accepted_wall_ms": None, "repair_edits": None, "diagnostic_first_snapshot_ms": None, "reviewer_idle_queue_ms": None, "accepted_timing_status": "not_accepted"},
        ]
        group = summarize.group_report(rows, {"id": "case", "cohort": "holdout"}, "C")
        self.assertEqual(group["repair_edits"], {"sample_count": 2, "median_edits": 2.0, "range_edits": [1, 3]})
        self.assertNotIn("median_ms", group["repair_edits"])
        self.assertEqual(group["accepted_dispatch_wall"]["count"], 0)
        self.assertIsNone(group["accepted_dispatch_wall"]["median_ms"])

    def test_passed_quality_without_independent_review_is_not_claimed_accepted(self):
        quality = {"status": "passed", "native_delivery": "passed", "common_final_json_validate": "passed"}
        accepted, reason = summarize.quality_acceptance(quality)
        self.assertIsNone(accepted)
        self.assertIn("independent-review", reason)

    def test_unknown_quality_and_gates_are_not_reported_as_failed_acceptance(self):
        accepted, reason = summarize.quality_acceptance({"status": "unknown", "native_acceptance": "unknown"})
        self.assertIsNone(accepted)
        self.assertIn("unknown", reason)
        self.assertIsNone(summarize.status_value("unknown"))

    def test_group_reports_first_and_final_unknown_separately(self):
        rows = [
            {"case_id": "case", "variant": "C", "registered_status": "observed", "execution_status": "completed", "quality_status": "unknown", "first_quality_status": "unknown", "process_completed": False, "process_execution_ms": 10, "process_completed_ms": None, "accepted_author_execution_ms": None, "accepted_total_ms": None, "dispatch_to_accepted_wall_ms": None, "repair_edits": None, "diagnostic_first_snapshot_ms": None, "reviewer_idle_queue_ms": None, "accepted_timing_status": "not_accepted"},
            {"case_id": "case", "variant": "C", "registered_status": "observed", "execution_status": "completed", "quality_status": "failed", "first_quality_status": "failed", "process_completed": True, "process_execution_ms": 20, "process_completed_ms": 20, "accepted_author_execution_ms": None, "accepted_total_ms": None, "dispatch_to_accepted_wall_ms": None, "repair_edits": 1, "diagnostic_first_snapshot_ms": None, "reviewer_idle_queue_ms": None, "accepted_timing_status": "not_accepted"},
        ]
        group = summarize.group_report(rows, {"id": "case", "cohort": "holdout"}, "C")
        self.assertEqual(group["first_fail"], 1)
        self.assertEqual(group["first_unknown"], 1)
        self.assertEqual(group["final_fail"], 1)
        self.assertEqual(group["final_unknown"], 1)
        self.assertEqual(group["final_not_accepted"], 2)

    def test_process_completion_is_separate_from_accepted_author_timing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / "run"
            run.mkdir()
            spec = {"run_id": "r", "case_id": "c", "variant": "A", "repeat": 1}
            case = {"id": "c", "cohort": "development"}
            (run / "summary.json").write_text(json.dumps({"status": "completed", "returncode": 0, "execution_wall_ms": 123}))
            (run / "quality.json").write_text(json.dumps({"status": "failed"}))
            row = summarize.make_row(spec, case, run)
            self.assertTrue(row["process_completed"])
            self.assertEqual(row["process_completed_ms"], 123)
            self.assertIsNone(row["accepted_author_execution_ms"])

    def test_adjudicated_review_controls_duration_and_dispatch_end(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / "run"
            run.mkdir()
            (run / "summary.json").write_text(json.dumps({
                "status": "completed",
                "returncode": 0,
                "execution_wall_ms": 100,
                "process_started_observed_utc": "2026-09-20T07:00:00Z",
            }))
            (run / "quality.json").write_text(json.dumps({
                "status": "passed",
                "native_acceptance": "passed",
                "common_acceptance": "passed",
                "semantic": {"status": "passed"},
                "visual": {"status": "passed"},
                "review_duration_ms": 20,
                "final_machine_duration_ms": 30,
            }))
            review_dir = run / "independent-review"
            review_dir.mkdir()
            (review_dir / "review.json").write_text(json.dumps({
                "reviewed_at_utc": "2026-09-20T07:00:02Z",
                "duration_ms": 20,
            }))
            (review_dir / "adjudicated-review.json").write_text(json.dumps({
                "reviewed_at_utc": "2026-09-20T07:00:07Z",
                "duration_ms": 70,
            }))
            row = summarize.make_row({"run_id": "r", "case_id": "c", "variant": "A", "repeat": 1}, {"id": "c", "cohort": "development"}, run)
            self.assertEqual(row["independent_review_ms"], 70)
            self.assertEqual(row["reviewed_at_utc"], "2026-09-20T07:00:07Z")
            self.assertEqual(row["dispatch_to_independent_review_wall_ms"], 7000.0)

    def test_annotation_unwraps_only_exact_shell_reads_and_keeps_compounds_unknown(self):
        self.assertEqual(annotate.classify("/bin/zsh -lc 'cat archify/SKILL.md'")[0], "run_setup")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'rg --files source'")[0], "repo_discovery")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'nl -ba source/index.js'")[0], "evidence_read")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'node archify/bin/archify.mjs validate candidate.json'")[0], "combined_validation")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'cat source/a && rm source/b'")[0], "unknown")


if __name__ == "__main__":
    unittest.main()
