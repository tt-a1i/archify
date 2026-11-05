#!/usr/bin/env python3
"""Exercise evidence/lifecycle boundaries; only an isolated toy source file is changed."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(SKILL / 'scripts'))
spec = importlib.util.spec_from_file_location('review', SKILL/'scripts/review_report.py')
review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review)

def draft(root, run='initial'):
    return {
      'project':'独立协议测试夹具',
      'run':{'id':run,'label':'独立样例','mode':'source','reviewer':'protocol-demo',
             'sources':[{'id':'demo','root':str(root),'revision':run}],
             'coverage':{'status':'complete','checked':['response-projection'],'excluded':['目标应用'],'limitations':['只检验报告闭环；不评估发现能力。']},
             'tools':['source reading']},
      'evidence':[{'id':'before','repository':'demo','path':'response.py','start':1,'end':3,'kind':'source','label':'已受理仍声明无副作用'}],
      'findings':[{
        'key':{'repository':'demo','subject':'response','concern':'accepted-but-retryable'},
        'title':'受理状态与重试承诺冲突','severity':'P2','verdict':'static_confirmed','scope':['response-projection'],
        'trigger':'accepted 为真。','impact':'返回了可安全重试的错误承诺。',
        'checks':{name:{'state':'supported','reason':reason,'evidence':['before']} for name,reason in zip(review.CHECKS,[
            '源码契约：已受理的请求不能承诺没有副作用。','函数接收 accepted 布尔值。','固定返回 retryable=True。','输出直接携带错误重试标记。','函数中不存在状态修正；范围仅限这个独立函数。'])},
        'graph':{'nodes':[{'id':'in','title':'accepted 为真','role':'step','detail':'函数输入','evidence':['before']},
                          {'id':'out','title':'retryable 仍为真','role':'failure','detail':'错误输出','evidence':['before']}],
                 'edges':[{'from':'in','to':'out','label':'返回映射','basis':'source','evidence':['before']}]},
        'counterevidence':[{'reason':'未推断任何外部系统行为。','evidence':['before']}],
        'gaps':[],'recommendation':'根据 accepted 决定重试标记。',
        'acceptance':[{'id':'A1','text':'accepted=True 时 retryable=False。'},{'id':'A2','text':'accepted=False 时保留 retryable=True。'}],
        'next_query':'对两种布尔输入逐句复查源码。'}]}

BEFORE = '# Accepted requests must not promise side-effect-free retry.\ndef response(accepted):\n    return {"retryable": True}\n'
AFTER = '# Accepted requests must not promise side-effect-free retry.\ndef response(accepted):\n    return {"retryable": not accepted}\n'

def recheck_draft(report, root, run='after'):
    return {'baseline_digest':review.report_digest(report), 'run':draft(root,run)['run'],
            'evidence':[dict(draft(root)['evidence'][0],id=run+'-evidence')],
            'items':[{'finding':report['findings'][0]['id'],'outcome':'resolved','basis':'source','reviewer':'protocol-demo',
                      'reason':'新源码将 retryable 绑定到 not accepted，两个分支均符合原契约。',
                      'evidence':[run+'-evidence'],
                      'acceptance':[{'id':id,'status':'passed','reason':reason,'evidence':[run+'-evidence']} for id,reason in
                                    [('A1','accepted 为真时 not accepted 为假。'),('A2','accepted 为假时 not accepted 为真。')]]}]}

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        (self.root/'response.py').write_text(BEFORE)
        self.report=review.publish(draft(self.root))
    def tearDown(self): self.tmp.cleanup()
    def fixed(self):
        (self.root/'response.py').write_text(AFTER)
        return recheck_draft(self.report,self.root)
    def test_evidence_is_captured_from_source(self):
        self.assertEqual(self.report['evidence'][0]['excerpt'],BEFORE.rstrip())
        self.assertEqual(review.freshness(self.report)['evidence']['before'],'current')
    def test_id_survives_title_and_line_changes(self):
        f=copy.deepcopy(self.report['findings'][0]); f['title']='Renamed'; f['run']='another'
        self.assertEqual(review.stable_id(f['key']),f['id'])
    def test_unknown_or_contradicted_checks_cannot_confirm(self):
        for state in ('open','contradicted'):
            d=draft(self.root);d['findings'][0]['checks']['reachability']['state']=state
            with self.assertRaises(ValueError):review.publish(d)
    def test_stale_sources_export_investigation(self):
        (self.root/'response.py').write_text(AFTER)
        t=review.make_task(self.report,self.report['findings'][0],review.freshness(self.report))
        self.assertEqual(t['kind'],'investigate')
        self.assertEqual(review.status(self.report,self.report['findings'][0]),'open')
    def test_missing_source_is_not_fixed(self):
        (self.root/'response.py').unlink()
        self.assertEqual(review.freshness(self.report)['evidence']['before'],'missing')
        self.assertEqual(review.status(self.report,self.report['findings'][0]),'open')
    def test_scope_reduction_cannot_close(self):
        d=self.fixed();d['run']['coverage']['checked']=[]
        with self.assertRaises(ValueError):review.recheck(self.report,d)
    def test_partial_run_cannot_close(self):
        d=self.fixed();d['run']['coverage']['status']='partial'
        with self.assertRaises(ValueError):review.recheck(self.report,d)
    def test_missing_criterion_cannot_close(self):
        d=self.fixed();d['items'][0]['acceptance'].pop()
        with self.assertRaises(ValueError):review.recheck(self.report,d)
    def test_historical_evidence_cannot_close(self):
        d=self.fixed();d['items'][0]['acceptance'][0]['evidence']=['before']
        with self.assertRaises(ValueError):review.recheck(self.report,d)
    def test_wrong_baseline_rejected(self):
        d=self.fixed();d['baseline_digest']='wrong'
        with self.assertRaises(ValueError):review.recheck(self.report,d)
    def test_absent_item_retains_issue_as_pending(self):
        d=self.fixed();d['items']=[]
        out=review.recheck(self.report,d)
        self.assertEqual(len(out['findings']),1)
        self.assertEqual(review.status(out,out['findings'][0]),'pending_recheck')
    def test_real_closed_loop_and_reopen_preserves_history(self):
        frozen=copy.deepcopy(self.report);out=review.recheck(self.report,self.fixed())
        self.assertEqual(review.status(out,out['findings'][0]),'resolved')
        self.assertEqual(self.report,frozen)
        d=recheck_draft(out,self.root,'regressed');(self.root/'response.py').write_text(BEFORE)
        d['items'][0].update(outcome='present',acceptance=[],reason='原来的固定 True 路径再次出现。')
        out=review.recheck(out,d)
        self.assertEqual(review.status(out,out['findings'][0]),'reopened')
        self.assertEqual(len(out['events']),3)
    def test_bad_graph_reference_rejected(self):
        d=draft(self.root);d['findings'][0]['graph']['edges'][0]['to']='nonexistent'
        with self.assertRaises(ValueError):review.publish(d)
    def test_path_escape_rejected(self):
        d=draft(self.root);d['evidence'][0]['path']='../response.py'
        with self.assertRaises(ValueError):review.publish(d)
    def test_html_cannot_execute_source_text(self):
        self.report['findings'][0]['title']='</script><script>alert(1)</script>'
        html=review.render(self.report)
        self.assertNotIn('</script><script>alert(1)</script>',html)
        self.assertIn('\\u003c/script',html)
    def test_no_overwrite(self):
        p=self.root/'out.json';review.write_new(p,self.report)
        with self.assertRaises(FileExistsError):review.write_new(p,{})
    def test_comparison_does_not_need_unused_node_graph(self):
        d=draft(self.root)
        d['findings'][0]['graph']={'kind':'comparison','comparison':{
            'columns':['输入','输出'],'rows':[{'cells':['已受理','固定允许重试'],'evidence':['before']}]}}
        report=review.publish(d)
        self.assertEqual(review.make_task(report,report['findings'][0],review.freshness(report))['kind'],'repair')
        self.assertIn('已受理',review.render(report))
    def test_comparison_rejects_broken_rows(self):
        d=draft(self.root)
        d['findings'][0]['graph']={'kind':'comparison','comparison':{
            'columns':['输入','输出'],'rows':[{'cells':['已受理'],'evidence':['before']}]}}
        with self.assertRaises(ValueError):review.publish(d)
    def test_no_findings_keeps_coverage_and_renders(self):
        d=draft(self.root);d['findings']=[];d['evidence']=[]
        r=review.publish(d)
        self.assertEqual(r['events'],[])
        self.assertIn('REVIEW_PAYLOAD', (SKILL/'assets/report.html').read_text())
        self.assertNotIn('REVIEW_PAYLOAD',review.render(r))

def demo(output):
    output.mkdir(parents=True,exist_ok=False)
    before=output/'before';after=output/'after';before.mkdir();after.mkdir()
    (before/'response.py').write_text(BEFORE);(after/'response.py').write_text(AFTER)
    report=review.publish(draft(before))
    review.write_new(output/'baseline.json',report)
    review.write_new(output/'repair.task.json',review.make_task(report,report['findings'][0],review.freshness(report)))
    d=recheck_draft(report,after)
    review.write_new(output/'recheck.draft.json',d)
    final=review.recheck(report,d)
    review.write_new(output/'resolved.json',final)
    review.write_new(output/'index.html',review.render(final))

if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='--demo':demo(Path(sys.argv[2]).resolve())
    else:unittest.main()
