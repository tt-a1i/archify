#!/usr/bin/env python3
"""Replay source-frozen lifetime-only constructor questions via the normal CLI."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','sample','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
for n in ['cli','sample','out']:setattr(a,n,getattr(a,n).resolve())
assert not a.out.exists();a.out.mkdir(parents=True);m=json.loads((Path(__file__).parent/'source-first.json').read_text());commands=[];units=[]
def verify():
 assert subprocess.check_output(['git','-C',str(a.sample),'rev-parse','HEAD'],text=True).strip()==m['project']['revision']
 assert not subprocess.check_output(['git','-C',str(a.sample),'status','--porcelain','--untracked-files=no'],text=True)
 for file,digest in m['project']['hashes'].items():assert hashlib.sha256((a.sample/file).read_bytes()).hexdigest()==digest,file
def run(label,args):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];start=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True);commands.append(dict(label=label,command=cmd,exit=r.returncode,seconds=time.monotonic()-start));(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==0,(label,r.returncode,r.stderr)
verify();config=a.out/'profile.json';config.write_text(json.dumps(dict(rust=m['profile']))+'\n');capture=a.out/'capture';run('check',['check',a.sample,'--language','rust','--config',config,'--fail-on','never','--out',capture,'--json']);f=json.loads((capture/'raw-facts.json').read_text());assert f['callModel']==('rust-source-direct-v3' if a.expect=='baseline' else 'rust-source-direct-v4')
for case in m['cases']:
 point=case['call'];call=next(x for x in f['calls'] if all(x[k]==point[k] for k in ['file','line','column','endLine','endColumn']));status='correct' if call.get('target')==case['target'] else 'wrong' if call.get('target') else 'missed';assert status==('missed' if a.expect=='baseline' else 'correct'),(case['id'],call)
 owners=[fn for fn in f['functions'] if fn['file']==point['file'] and (fn['sourceRange']['line'],fn['sourceRange']['column'])<=(point['line'],point['column']) and (point['endLine'],point['endColumn'])<=(fn['sourceRange']['endLine'],fn['sourceRange']['endColumn'])];assert owners;owner=min(owners,key=lambda fn:fn['sourceRange']['endLine']-fn['sourceRange']['line']);label=case['id'];dest=a.out/(label+'.json');run(label,['task',capture,'--root',a.sample,'--entry',point['file'],'--function',owner['qualname'],'--question','Which captured lifetime-only inherent implementation does this constructor path identify, and what remains unknown?','--format','json','--out',dest,'--json']);q=json.loads(dest.read_text());assert q['calls']['coverage']=='available';record=next(r for r in q['calls']['records'] if r['fact']==call);assert record['targetNavigation']['status']==('unresolved' if a.expect=='baseline' else 'valid')
 if a.expect=='candidate':assert record['targetNavigation']['location']==case['target']
 units.append(dict(id=label,cohort=case['cohort'],status=status,call=call,navigation=record['targetNavigation']['status']))
for i,control in enumerate(m['controls']):
 call=next(x for x in f['calls'] if all(x[k]==control[k] for k in ['file','line','column','endLine','endColumn']));assert not call.get('target') and call['resolution']=='unresolved';units.append(dict(id='trait-control-'+str(i),status='unknown',call=call))
verify();report=dict(expect=a.expect,score={s:sum(x['status']==s for x in units)for s in ['correct','wrong','missed','unknown']},units=units,commands=commands,scope=dict(model=f['callModel'],files=len(f['files']),calls=len(f['calls']),functions=len(f['functions']),parseErrors=f.get('parse_errors',[]),build=f['languageScope']['build']),limits=['Previously analyzed regex corpus; two same-spelled constructors reserved only from initial rule tuning, not blind.','Source candidates do not prove lifetime/argument applicability, compilation, runtime dispatch or complete impact.'],projectExecuted=False);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
