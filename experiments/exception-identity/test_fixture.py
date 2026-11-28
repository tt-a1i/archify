"""Protect identity and edge meaning using live Python objects, not a golden graph."""
import copy
import json
import unittest
from pathlib import Path
from fixture import construct, observe


def verify(model, objects):
    ids = [node["id"] for node in model["components"]]
    assert len(ids) == len(set(ids)) == len(objects) == 3
    assert set(ids) == set(objects)
    expected = set()
    for source, obj in objects.items():
        for target, other in objects.items():
            if isinstance(obj, BaseExceptionGroup) and any(child is other for child in obj.exceptions):
                expected.add((source, target, "contains"))
            if obj.__cause__ is other:
                expected.add((source, target, "caused-by"))
    edges = [(edge["from"], edge["to"], edge["label"]) for edge in model["connections"]]
    assert len(edges) == len(set(edges)) == len(expected)
    assert set(edges) == expected


class Semantics(unittest.TestCase):
    def setUp(self):
        self.objects = construct()
        self.model = json.loads(Path("candidate.json").read_text())

    def test_model_matches_actual_object_properties(self):
        verify(self.model, self.objects)
        self.assertIs(self.objects["outer"].exceptions[0], self.objects["inner"])
        self.assertIs(self.objects["inner"].__cause__, self.objects["outer"])
        self.assertEqual(len({id(obj) for obj in self.objects.values()}), 3)

    def test_actual_trace_repeats_the_same_objects(self):
        actual = observe(self.objects)
        self.assertEqual(actual["printed_exception_lines"], {"leaf": 2, "inner": 2, "outer": 1})
        self.assertTrue(all(actual["identity_checks"].values()))
        self.assertTrue(self.objects["inner"].__suppress_context__)
        self.assertIn("direct cause", actual["traceback"])

    def test_rejects_cause_mislabeled_as_containment(self):
        wrong = copy.deepcopy(self.model)
        next(edge for edge in wrong["connections"] if edge["label"] == "caused-by")["label"] = "contains"
        with self.assertRaises(AssertionError):
            verify(wrong, self.objects)

    def test_rejects_reversed_cause(self):
        wrong = copy.deepcopy(self.model)
        edge = next(edge for edge in wrong["connections"] if edge["label"] == "caused-by")
        edge["from"], edge["to"] = edge["to"], edge["from"]
        with self.assertRaises(AssertionError):
            verify(wrong, self.objects)

    def test_rejects_duplicate_identity(self):
        wrong = copy.deepcopy(self.model)
        wrong["components"].append(copy.deepcopy(wrong["components"][0]))
        with self.assertRaises(AssertionError):
            verify(wrong, self.objects)


if __name__ == "__main__":
    unittest.main()
