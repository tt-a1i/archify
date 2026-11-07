#!/usr/bin/env python3
"""Replay frozen source answers through the public check/task CLI; never imports projects."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
p=argparse.ArgumentParser(); p.add_argument('--cli',type=pathlib.Path,required=True); p.add_argument('--sources',type=pathlib.Path,required=True); p.add_argument('--out',type=pathlib.Path,required=True); p.add_argument('--node',default='node'); p.add_argument('--python',default=sys.executable); p.add_argument('--product-sha',required=True)
a=p.parse_args(); a.cli=a.cli.resolve(); a.sources=a.sources.resolve(); a.out=a.out.resolve()
if a.out.exists(): p.error('--out must be new')
m=json.loads((pathlib.Path(__file__).parent/'manifest.json').read_text()); a.out.mkdir(parents=True)
def git(root,*args): return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
for name,meta in m['projects'].items():
 root=a.sources/name
 assert git(root,'rev-parse','HEAD')==meta['sha']
 assert not git(root,'status','--porcelain','--untracked-files=no'), name
for key,wanted in m['sourceSha256'].items(): assert hashlib.sha256((a.sources/key).read_bytes()).hexdigest()==wanted,key
runs=[]
def cli(args,label):
 cmd=[a.node,str(a.cli),'code-analysis',*map(str,args)]
 r=subprocess.run(cmd,capture_output=True,text=True,env={**os.environ,'BAUIFY_PYTHON':a.python})
 (a.out/(label+'.stdout')).write_text(r.stdout); (a.out/(label+'.stderr')).write_text(r.stderr)
 runs.append({'label':label,'argv':cmd,'exit':r.returncode})
 assert r.returncode==0,(cmd,r.returncode,r.stdout,r.stderr)
 return json.loads(r.stdout)
facts={}; questions={}
for name in m['projects']:
 dest=a.out/name
 cli(['check',a.sources/name,'--language','py','--out',dest,'--fail-on','never','--json'],name+'-check')
 f=json.loads((dest/'raw-facts.json').read_text()); assert not f.get('parse_errors'),f.get('parse_errors'); facts[name]=f
 for u in [x for x in m['units'] if x['project']==name]:
  key=(name,u['file'],u['function'])
  if key in questions: continue
  label=f'{name}-{len(questions)}-question'; qpath=a.out/(label+'.json')
  cli(['task',dest,'--question','Which captured source function does this call name bind to?','--entry',u['file'],'--function',u['function'],'--root',a.sources/name,'--format','json','--out',qpath,'--json'],label)
  questions[key]=json.loads(qpath.read_text())
rows=[]
for u in m['units']:
 f=facts[u['project']]; matches=[c for c in f['calls'] if c['file']==u['file'] and c['line']==u['line'] and c['column']==u['column']]
 assert len(matches)<=1
 observed=matches[0] if matches else None
 target=observed.get('target') if observed else None
 if not observed: grade='omitted'
 elif u['expected'] is None: grade='unknown' if observed['resolution']=='unresolved' and target is None else 'wrong'
 elif target==u['expected'] and observed['resolution']=='imported-function': grade='correct'
 elif target is None and observed['resolution']=='unresolved': grade='missed'
 else: grade='wrong'
 q=questions[(u['project'],u['file'],u['function'])]
 calls=q['calls']; assert calls['coverage']=='available' and calls['omitted']==0
 qr=[r for r in calls['records'] if r['fact']==observed]
 assert len(qr)==1,(u['id'],'question omitted captured call')
 nav=qr[0].get('targetNavigation')
 if grade=='correct':
  assert nav['location']==u['expected'] and nav['status']=='valid',nav
 if u['expected'] is None: assert not nav or nav.get('location') is None,nav
 rows.append({'id':u['id'],'expected':u['expected'],'observed':observed,'grade':grade,'navigation':nav})
# Ensure the analyzer did not mutate the selected sources.
for key,wanted in m['sourceSha256'].items(): assert hashlib.sha256((a.sources/key).read_bytes()).hexdigest()==wanted,key
result={'productSha':a.product_sha,'node':subprocess.check_output([a.node,'--version'],text=True).strip(),'python':subprocess.check_output([a.python,'--version'],text=True).strip(),'manifestSha256':hashlib.sha256((pathlib.Path(__file__).parent/'manifest.json').read_bytes()).hexdigest(),'counts':{g:sum(r['grade']==g for r in rows) for g in ['correct','wrong','missed','omitted','unknown']},'units':rows,'commands':runs}
(a.out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['counts']))
if result['counts']['wrong'] or result['counts']['omitted']: sys.exit(1)
