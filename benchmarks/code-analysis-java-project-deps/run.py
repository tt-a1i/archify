#!/usr/bin/env python3
"""Replay fixed direct-project questions through the normal CLI; no project execution."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','sample','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli=a.cli.resolve();a.sample=a.sample.resolve();a.out=a.out.resolve();assert not a.out.exists();a.out.mkdir(parents=True)
m=json.loads((Path(__file__).parent/'source-first.json').read_text());commands=[];units=[];questions={}
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 assert not subprocess.check_output(['git','-C',str(a.sample),'status','--porcelain','--untracked-files=no'],text=True)
 for file,digest in m['project']['hashes'].items():assert hashlib.sha256((a.sample/file).read_bytes()).hexdigest()==digest,file
def run(label,args):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];start=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True);commands.append(dict(label=label,command=cmd,exit=r.returncode,seconds=time.monotonic()-start));(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==0,(label,r.stderr)
verify();run('check',['check',a.sample,'--language','java','--fail-on','never','--out',a.out/'capture','--json']);f=json.loads((a.out/'capture/raw-facts.json').read_text());assert f['callModel']==('java-static-lexical-v4' if a.expect=='baseline' else 'java-static-lexical-v5')
for case in m['cases']+m['counterexamples']:
 point=case['call'];call=next(c for c in f['calls'] if all(c[k]==point[k] for k in ['file','line','column','endLine','endColumn']));negative='expectedCapturedTarget' in case
 status='unknown-external-target' if negative and not call.get('target') else 'correct' if not negative and call.get('target')==case['target'] else 'wrong' if call.get('target') else 'missed'
 expected='unknown-external-target' if negative else 'missed' if a.expect=='baseline' and case['cohort'].startswith('design') else 'correct';assert status==expected,(case.get('id'),call)
 owners=[fn for fn in f['functions'] if fn['file']==point['file'] and fn['line']<=point['line']<=fn['endLine']];assert owners;owner=min(owners,key=lambda fn:fn['endLine']-fn['line']);key=(point['file'],owner['qualname'])
 if key not in questions:
  label='question-'+str(len(questions));dest=a.out/(label+'.json');run(label,['task',a.out/'capture','--root',a.sample,'--entry',point['file'],'--function',owner['qualname'],'--question','Which captured static source is justified by this project dependency route, and what remains unknown?','--format','json','--out',dest,'--json']);questions[key]=json.loads(dest.read_text())
 q=questions[key];assert q['calls']['coverage']=='available';record=next(r for r in q['calls']['records'] if r['fact']==call);assert record['targetNavigation']['status']==('valid' if status=='correct' else 'unresolved')
 if status=='correct' and a.expect=='candidate':
  assert record['targetNavigation']['location']==case['target'];assert len(call['buildEvidence'])==4;assert len(record['targetNavigation']['buildEvidence'])==4
 units.append(dict(id=case.get('id','external-reload4j'),cohort=case.get('cohort','source-known-counterexample'),status=status,call=call,navigation=record['targetNavigation']['status']))
verify();scope=f.get('languageScope',{});report=dict(expect=a.expect,score={s:sum(u['status']==s for u in units) for s in ['correct','wrong','missed','unknown-external-target']},units=units,commands=commands,scope=dict(model=f['callModel'],files=len(f['files']),calls=len(f['calls']),functions=len(f['functions']),parseErrors=f.get('parse_errors',[]),metadataFiles=len(scope.get('metadata',[])),metadataBytes=sum(len(x['sourceText'].encode('utf8')) for x in scope.get('metadata',[])),projects=len(scope.get('projects',[])),unknowns=scope.get('unknowns',[])),limits=['Previously exposed corpus, not blind. Two preservation calls were reserved only from initial dependency-rule tuning.','Two correct existing targets are not new accuracy gains. Default fail-on=warning also returns 1 for an existing complexity warning; this replay selects --fail-on never explicitly.','Declared direct candidates do not prove complete classpaths, compilation, runtime dispatch or total impact.'],projectExecuted=False)
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
