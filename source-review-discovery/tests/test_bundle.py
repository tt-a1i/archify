"""Trust and delivery boundaries using only a synthetic protocol fixture."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_protocol import review, draft, BEFORE
import review_panorama


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        (self.root/'response.py').write_text(BEFORE)
        (self.root/'caller.py').write_text('import response\n')
        d=draft(self.root)
        graph=d['findings'][0]['graph']
        graph['kind']='data_flow'
        graph['nodes'].insert(1,{'id':'map','title':'构造返回值','role':'failure','detail':'独立夹具中的返回转换','evidence':['before']})
        graph['edges']=[dict(graph['edges'][0],to='map'),dict(graph['edges'][0],**{'from':'map','to':'out'})]
        self.report=review.publish(d)
        self.finding=self.report['findings'][0]
        digest=lambda p:review.digest((self.root/p).read_bytes())
        self.report['architecture']={'sources':[{'id':'demo','repository':'demo','revision':'initial','title':'Synthetic protocol fixture','entry':'','root':str(self.root)}],
            'nodes':[{'id':'demo:','parent':None,'source':'demo','kind':'source','label':'Fixture','path':'','files':2,'loc':4},
                *[{'id':'demo:'+p,'parent':'demo:','source':'demo','kind':'file','repository':'demo','repository_path':p,'path':p,'label':p,'files':1,'loc':lines,'sha256':digest(p)} for p,lines in [('response.py',3),('caller.py',1)]]],
            'edges':[{'from':'demo:caller.py','to':'demo:response.py','file':'demo:caller.py','line':1,'kind':'import','specifier':'response'}],
            'coverage':{'limitations':['Unit-test fixture only.'],'unresolved_or_excluded_imports':0}}
        script='print("unit fixture")'
        self.report['verifications']=[{'finding':self.finding['id'],'run':'initial','outcome':'reproduced','claim':'Unit-test record; not a product run.',
            'limitations':['Synthetic schema fixture.'],'input_basis':['before'],
            'targets':[{'repository':'demo','path':'response.py','sha256':digest('response.py')}],
            'scripts':[{'path':str(self.root/'probe.py'),'content':script,'sha256':review.digest(script.encode())}],
            'source_unchanged':True,'execution':{'exit_code':0},'cases':[
                {'name':'yes','kind':'trigger','expected':{'count':0},'actual':{'count':0},'passed':True},
                {'name':'no','kind':'control','expected':{'count':1},'actual':{'count':1},'passed':True}]}]
        self.scene={'schema_version':2,'report_digest':review.report_digest(self.report),'finding_id':self.finding['id'],'input_node':'in',
            'lanes':[{'id':'result','title':'返回映射','nodes':['map','out'],'output_node':'out','measure':{'label':'标志','unit':'','actual_key':'count'}}],
            'scenarios':[{'id':'yes','title':'True 输入','kind':'trigger','input':{'origin':'synthetic','groups':[{'label':'输入','fields':[{'label':'accepted','value':True,'unit':''}]}],'evidence':['before']},
                'states':[],'verification_case':{'run':'initial','name':'yes'}}],
            'default_scenario':'yes','focus':{'map':{'evidence':'before','start':1,'end':3,'highlight':[3]}}}

    def tearDown(self):self.tmp.cleanup()
    def rebind(self):self.scene['report_digest']=review.report_digest(self.report)
    def model(self):return review_panorama.model(self.report,{self.finding['id']:'finding.html'})

    def test_overview_membership_and_import_locations_are_not_invented(self):
        data=self.model()
        self.assertEqual(data['file_count'],2)
        self.assertEqual(data['import_count'],1)
        fault=[m for m in data['modules'] if m['faults']]
        self.assertEqual([m['path'] for m in fault],['response.py'])
        self.assertEqual(data['dependencies'][0]['references'][0]['line'],1)
        self.assertEqual(len(data['findings']),1)

    def test_stale_or_conditional_verification_does_not_enter_default_queue(self):
        self.assertTrue(self.model()['findings'][0]['verified'])
        self.finding['verdict']='conditional'
        self.assertFalse(self.model()['findings'][0]['verified'])
        self.finding['verdict']='static_confirmed'
        (self.root/'response.py').write_text(BEFORE+'# changed\n')
        self.assertFalse(self.model()['findings'][0]['verified'])

    def test_latest_deferred_record_cannot_reuse_old_success(self):
        self.report['verifications'].append({'finding':self.finding['id'],'run':'initial','outcome':'deferred','reason':'Wait for new source','claim':'Check later','limitations':['Not run']})
        self.assertFalse(self.model()['findings'][0]['verified'])

    def test_zero_and_false_are_not_unknown(self):
        case=review.compile_scene(self.report,self.scene)['scene']['scenarios'][0]
        self.assertEqual(case['outputs']['out'],0)
        self.report['verifications'][0]['cases'][0]['actual']['count']=False;self.rebind()
        self.assertIs(review.compile_scene(self.report,self.scene)['scene']['scenarios'][0]['outputs']['out'],False)
        self.scene['scenarios'][0].pop('verification_case')
        self.assertEqual(review.compile_scene(self.report,self.scene)['scene']['scenarios'][0]['outputs'],{})

    def test_scene_cannot_inject_outputs_or_escape_highlight(self):
        self.scene['scenarios'][0]['outputs']={'out':999}
        with self.assertRaises(ValueError):review.compile_scene(self.report,self.scene)
        self.scene['scenarios'][0].pop('outputs')
        self.scene['focus']['map']['highlight']=[100]
        with self.assertRaises(ValueError):review.compile_scene(self.report,self.scene)

    def test_invalid_binding_and_duplicate_scenes_leave_no_output(self):
        out=self.root/'site'
        self.scene['report_digest']='wrong'
        with self.assertRaises(ValueError):review.bundle(self.report,[self.scene],out)
        self.assertFalse(out.exists())
        self.rebind()
        with self.assertRaisesRegex(ValueError,'duplicate scene'):
            review.bundle(self.report,[self.scene,self.scene],out)
        self.assertFalse(out.exists())

    def test_bundle_preserves_previous_artifact_and_cleans_render_failure(self):
        out=self.root/'site';out.mkdir();(out/'keep.txt').write_text('keep')
        with self.assertRaises(ValueError):review.bundle(self.report,[],out)
        self.assertEqual((out/'keep.txt').read_text(),'keep')
        fresh=self.root/'failed'
        with patch('review_panorama.render',side_effect=ValueError('layout failure')):
            with self.assertRaises(ValueError):review.bundle(self.report,[],fresh)
        self.assertFalse(fresh.exists())

    def test_public_bundle_contains_linked_offline_views_and_same_facts(self):
        original=copy.deepcopy(self.report)
        self.finding['title']='Literal </script><script>alert(1)</script>'
        self.rebind()
        out=self.root/'site'
        links=review.bundle(self.report,[self.scene],out)
        self.assertEqual(review.read(out/'review.json'),self.report)
        self.assertEqual(links[self.finding['id']],'findings/'+self.finding['id']+'.html')
        overview=(out/'index.html').read_text()
        detail=(out/links[self.finding['id']]).read_text()
        self.assertNotIn(self.finding['title'],overview)
        self.assertNotIn(self.finding['title'],detail)
        self.assertIn('\\u003c/script',overview)
        self.assertIn('../index.html#finding='+self.finding['id'],detail)
        self.assertTrue((out/'findings.html').is_file())
        self.assertEqual(self.report['events'],original['events'])

    def test_no_scene_has_a_real_evidence_fallback(self):
        out=self.root/'fallback'
        links=review.bundle(self.report,[],out)
        self.assertEqual(links[self.finding['id']],'findings.html#finding='+self.finding['id'])
        self.assertIn(self.finding['title'],(out/'findings.html').read_text())

if __name__=='__main__':unittest.main()
