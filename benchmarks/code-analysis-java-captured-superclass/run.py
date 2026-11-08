#!/usr/bin/env python3
"""Replay source-frozen inherited qualifier questions through the normal CLI."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for name in ['cli','sample','out']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');p.add_argument('--candidate-model',default='java-static-lexical-v4');a=p.parse_args()
a.cli=a.cli.resolve();a.sample=a.sample.resolve();a.out=a.out.resolve();assert not a.out.exists();a.out.mkdir(parents=True)
m=json.loads((Path(__file__).parent/'source-first.json').read_text());commands=[];units=[];questions={}
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 assert not subprocess.check_output(['git','-C',str(a.sample),'status','--porcelain','--untracked-files=no'],text=True)
 for file,digest in m['project']['hashes'].items():assert hashlib.sha256((a.sample/file).read_bytes()).hexdigest()==digest,file
def run(label,args):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];r=subprocess.run(cmd,capture_output=True,text=True);commands.append(dict(label=label,command=cmd,exit=r.returncode));(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==0,(label,r.stderr)
verify();run('check',['check',a.sample,'--language','java','--fail-on','never','--out',a.out/'capture','--json']);f=json.loads((a.out/'capture/raw-facts.json').read_text());assert f['callModel']==('java-static-lexical-v3' if a.expect=='baseline' else a.candidate_model)
for case in m['cases']:
 point=case['call'];call=next(c for c in f['calls'] if all(c[k]==point[k] for k in ['file','line','column','endLine','endColumn']));status='correct' if call.get('target')==case['target'] else 'wrong' if call.get('target') else 'missed';assert status==('missed' if a.expect=='baseline' else 'correct'),case['id']
 # Narrowest captured enclosing method selects the question, not the target oracle.
 owners=[fn for fn in f['functions'] if fn['file']==point['file'] and fn['line']<=point['line']<=fn['endLine']];assert owners;owner=min(owners,key=lambda fn:fn['endLine']-fn['line']);key=(point['file'],owner['qualname'])
 if key not in questions:
  label='question-'+str(len(questions));dest=a.out/(label+'.json');run(label,['task',a.out/'capture','--root',a.sample,'--entry',point['file'],'--function',owner['qualname'],'--question','Which static implementation does this class qualifier select in its captured superclass context?','--format','json','--out',dest,'--json']);questions[key]=json.loads(dest.read_text())
 q=questions[key];assert q['calls']['coverage']=='available';record=next(r for r in q['calls']['records'] if r['fact']==call);assert record['targetNavigation']['status']==('unresolved' if a.expect=='baseline' else 'valid')
 if a.expect=='candidate':
  assert record['targetNavigation']['location']==case['target'];assert call['qualifierAncestry']==[dict(file=m['parent']['file'],line=27,column=8)]
 units.append(dict(id=case['id'],cohort=case['cohort'],status=status,call=call,navigation=record['targetNavigation']['status']))
verify();r=dict(expect=a.expect,score={s:sum(u['status']==s for u in units) for s in ['correct','wrong','missed']},units=units,commands=commands,scope=dict(model=f['callModel'],files=len(f['files']),calls=len(f['calls']),functions=len(f['functions']),parseErrors=f.get('parse_errors',[])),limits=['Previously exposed corpus, not blind. Two source-known calls reserved from initial rule tuning.','Source candidates do not prove runtime dispatch, complete impact or total recall.'],projectExecuted=False);(a.out/'report.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r['score']))
