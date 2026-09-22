import copy
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).with_name('offline.py')
spec = importlib.util.spec_from_file_location('repair_offline', path)
offline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offline)


class SemanticBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.source = {
            'meta': {'title': 'Ownership', 'viewBox': [800, 600]},
            'components': [{'id': 'a', 'label': 'Owner', 'pos': [20, 20],
                            'sources': [{'path': 'src/a.js', 'start': 1, 'end': 3}]}],
            'connections': [{'id': 'e', 'from': 'a', 'to': 'a', 'label': 'retry'}],
            'boundaries': [{'label': 'Instance', 'wraps': ['a'], 'pad': 20}],
            'cards': [{'title': 'Limit', 'body': 'Caller owns cancellation'}],
        }

    def test_geometry_changes_are_not_semantic_changes(self):
        changed = copy.deepcopy(self.source)
        changed['components'][0].update(pos=[40, 50], size=[180, 80])
        changed['connections'][0]['labelAt'] = [230, 50]
        changed['meta']['viewBox'] = [900, 700]
        self.assertEqual(offline.semantics(changed), offline.semantics(self.source))

    def test_material_and_unknown_fields_remain_bound(self):
        mutations = [
            lambda d: d['components'][0].update(label='Other'),
            lambda d: d['components'][0]['sources'][0].update(end=2),
            lambda d: d['connections'][0].update(to='other'),
            lambda d: d['connections'][0].update(label=''),
            lambda d: d['boundaries'][0].update(wraps=[]),
            lambda d: d['cards'][0].update(body='Changed claim'),
            lambda d: d.update(unknown_semantic_field='new'),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(self.source)
                mutation(changed)
                self.assertNotEqual(offline.semantics(changed), offline.semantics(self.source))


if __name__ == '__main__':
    unittest.main()
