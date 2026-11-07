#!/usr/bin/env python3
"""Replay frozen forwarding questions using the public source or ZIP CLI."""
import argparse, hashlib, json, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',required=True,type=Path);p.add_argument('--sample',required=True,type=Path);p.add_argument('--out',required=True,type=Path);p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli=a.cli.resolve();a.sample=a.sample.resolve();a.out=a.out.resolve();assert not a.out.exists();a.out.mkdir(parents=True)
here=Path(__file__).resolve().parent;m=json.loads((here/'source-first.json').read_text());commands=[]
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 assert not subprocess.check_output(['git','-C',str(a.sample),'status','--porcelain','--untracked-files=no'],text=True)
 for file,digest in m['project']['hashes'].items(): assert hashlib.sha256((a.sample/file).read_bytes()).hexdigest()==digest,file
verify()
def run(label,args):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];r=subprocess.run(cmd,capture_output=True,text=True);commands.append(dict(label=label,command=cmd,exit=r.returncode));(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==0,(label,r.returncode,r.stderr)
run('check',['check',a.sample,'--language','ts','--fail-on','never','--out',a.out/'capture','--json'])
facts=json.loads((a.out/'capture/raw-facts.json').read_text());assert facts['callModel']==('js-ts-lexical-v4' if a.expect=='baseline' else 'js-ts-lexical-v5')
keys=['file','line','column','endLine','endColumn'];key=lambda c:tuple(c[k] for k in keys);calls={key(c):c for c in facts['calls']};units=[]
for case in m['cases']:
 c=calls[key(case['call'])];status='correct' if c.get('target')==case['target'] else 'wrong' if c.get('target') else 'missed';assert status==('missed' if a.expect=='baseline' else 'correct'),(case['id'],c)
 units.append(dict(id=case['id'],cohort=case['cohort'],status=status,call=c))
for control in m['controls']:
 c=calls[key(control['call'])];assert c['resolution']=='unresolved' and 'target' not in c;units.append(dict(id=control['id'],status='unknown',call=c))
for index,file in enumerate(dict.fromkeys(c['call']['file'] for c in m['cases'])):
 label='question-'+str(index);qpath=a.out/(label+'.json');run(label,['task',a.out/'capture','--root',a.sample,'--entry',file,'--question','Which implementation does this public API call reach through the captured export path?','--format','json','--out',qpath,'--json']);q=json.loads(qpath.read_text());assert q['calls']['coverage']=='available'
 for case in [c for c in m['cases'] if c['call']['file']==file]:
  record=next(r for r in q['calls']['records'] if key(r['fact'])==key(case['call']));nav=record['targetNavigation'];assert nav['status']==('unresolved' if a.expect=='baseline' else 'valid')
  if a.expect=='candidate':
   assert nav['location']==case['target'];assert record['fact']['via']==[dict(file=case['barrel']['file'],line=case['barrel']['import']['line'],column=case['barrel']['import']['column'])]
verify();report=dict(expect=a.expect,score={s:sum(u['status']==s for u in units) for s in ['correct','wrong','missed','unknown']},units=units,scope=dict(files=len(facts['files']),calls=len(facts['calls']),functions=len(facts['functions']),parseErrors=facts.get('parse_errors',[]),model=facts['callModel'],adapterRevision=facts['repository']['adapterRevision']),commands=commands,limits=m['gaps']+[m['exposure'],m['knownCallerScope']],projectExecuted=False);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
