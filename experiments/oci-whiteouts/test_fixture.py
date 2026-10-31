"""Bounded semantic checks for our original fixture, not a generic tar/OCI test suite."""
import copy
import unittest
import subprocess
import sys
import tempfile
from pathlib import Path
from fixture import LOWER, UPPER, EXPECTED, archive, inventory, observe, project_known_fixture, verify_projection


class WhiteoutReading(unittest.TestCase):
    def test_observed_members_are_complete_and_markers_are_empty(self):
        _, _, obs = observe()
        for layer, declared in [("lower", LOWER), ("upper", UPPER)]:
            rows = obs["inventory"][layer]
            self.assertEqual(len(rows), 5)  # 2 explicit directories + 3 regular members
            self.assertEqual({r["path"] for r in rows if r["type"] == "regular"}, set(declared))
        for row in obs["inventory"]["upper"]:
            if "/.wh." in row["path"]:
                self.assertEqual(row["size"], 0)

    def test_lower_removals_and_same_layer_survivor_are_distinct(self):
        _, _, obs = observe()
        view = obs["specDerivedVisibleRegularPaths"]
        self.assertEqual(view, EXPECTED)
        self.assertNotIn("app/config.txt", view)
        self.assertNotIn("app/cache/old.txt", view)
        self.assertEqual(view["app/cache/new.txt"], "upper")
        self.assertEqual(view["app/keep.txt"], "lower")
        self.assertTrue(all(".wh." not in path for path in view))

    def test_all_six_upper_orders_preserve_spec_derived_visibility(self):
        _, _, obs = observe()
        self.assertEqual(len(obs["orderVariants"]), 6)
        self.assertEqual(len({x["tarSha256"] for x in obs["orderVariants"]}), 6)
        for variant in obs["orderVariants"]:
            self.assertEqual(variant["projection"], EXPECTED)

    def test_deleting_same_layer_new_or_leaking_marker_is_rejected(self):
        for wrong in [{"app/keep.txt": "lower"}, dict(EXPECTED, **{"app/cache/.wh..wh..opq": "upper"})]:
            with self.assertRaises(ValueError):
                verify_projection(wrong)

    def test_changed_payload_or_missing_marker_cannot_inherit_fixed_model(self):
        below, above = inventory(archive(LOWER)), inventory(archive(UPPER))
        missing = [row for row in above if row["path"] != "app/cache/.wh..wh..opq"]
        changed = copy.deepcopy(above)
        changed[-1]["size"] = 1
        for wrong in [missing, changed]:
            with self.assertRaises(ValueError):
                project_known_fixture(below, wrong)

    def test_deterministic_archives_and_duplicate_order_rejection(self):
        self.assertEqual(archive(LOWER), archive(LOWER))
        with self.assertRaises(ValueError):
            archive(UPPER, ["app/cache/new.txt"] * 3)

    def test_build_rejects_existing_directory_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "keep.txt").write_text("existing user data")
            run = subprocess.run([sys.executable, str(Path(__file__).with_name("build.py")), str(folder)], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual([p.name for p in folder.iterdir()], ["keep.txt"])
            self.assertEqual((folder / "keep.txt").read_text(), "existing user data")


if __name__ == "__main__":
    unittest.main()
