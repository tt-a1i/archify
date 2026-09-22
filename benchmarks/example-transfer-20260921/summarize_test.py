import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('example_summary', pathlib.Path(__file__).with_name('summarize.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EvidenceSemanticsTest(unittest.TestCase):
    def test_initializing_receipt_is_not_failure_and_pre_finalize_change_is_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            out = pathlib.Path(directory)
            def write(p, value):
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(value))
            write(out / 'freeze.json', {'initial_order':['fixture-B1','fixture-P1'],
                'tasks':{'tasks':[{'id':'fixture'}]}, 'protocol':{'screen':{
                'minimum_both_quality_pairs':2, 'median_full_saving_seconds':20,
                'median_full_saving_fraction':.15, 'median_all_observed_revision_reduction':1,
                'max_pair_slowdown_fraction':.1}}})
            run = out / 'fixture-P1'
            write(run / 'snapshot-001.json', {'components':[{'label':'Before'}]})
            write(run / 'snapshot-002.json', {'components':[{'label':'After'}]})
            write(run / 'initial.json', {'ok':False, 'specification':{'sha256':'same'}})
            write(run / 'terminal.json', {'ok':True, 'specification':{'sha256':'same'}, 'durationMs':200})
            write(run / 'receipt.json', {'start_epoch':0,'snapshots':[
                {'index':1,'structurally_complete':True,'elapsed_seconds':1},
                {'index':2,'structurally_complete':True,'elapsed_seconds':2}], 'sidecars':[
                {'filename':'diagram.finalize-summary.json','snapshot':'initial.json','epoch':3},
                {'filename':'diagram.finalize-summary.json','snapshot':'terminal.json','epoch':4}]})
            write(run / 'evaluation.json', {'final':{'eligible_delivery':True}})
            result = module.summarize(out)
            row = result['rows'][1]
            self.assertTrue(row['first_finalize_pass'])
            self.assertEqual(row['observed_finalized_repairs_after_failure'], 0)
            self.assertEqual(row['candidate_content_changes_before_first_finalize'], 1)
            self.assertEqual(row['nonterminal_finalize_updates'], 1)
            self.assertIsNone(row['final_quality'])
            self.assertFalse(row['qualified_delivery'])
            self.assertFalse(result['screen_pass'])
            self.assertIsNone(result['median_seconds_saved'])


if __name__ == '__main__':
    unittest.main()
