#!/usr/bin/env python3
"""Freeze the pre-implementation catalog and serial allocation before authors run."""
import argparse, datetime, hashlib, json, pathlib, subprocess

def main():
 p=argparse.ArgumentParser();p.add_argument('--catalog',type=pathlib.Path,required=True);p.add_argument('--evidence',type=pathlib.Path,required=True);a=p.parse_args()
 target=a.evidence/'experiment-manifest.json'
 if target.exists():raise SystemExit('Already registered: preserve the frozen manifest')
 catalog=json.loads(a.catalog.read_text());m=json.loads((a.evidence/'experiment-manifest.initial.json').read_text());m['tasks']=[]
 bundles=a.evidence/'targets';bundles.mkdir(exist_ok=True)
 for case in catalog.get('tasks',catalog.get('cases',[])):
  path=case['target_repo'];sha=case['target_repo_sha']
  actual=subprocess.check_output(['git','-C',path,'rev-parse','HEAD'],text=True).strip()
  if actual!=sha:raise SystemExit('Target moved: '+case['id'])
  bundle=bundles/(case['id']+'.bundle');subprocess.run(['git','-C',path,'bundle','create',str(bundle),'HEAD'],check=True,capture_output=True)
  url=case['repository_url']
  m['tasks'].append({'id':case['id'],'cohort':case['cohort'],'selection_rationale':case['selection_rationale'],
    'target_repo':path,'target_repo_sha':sha,'repository_url':url,'target_kind':'fixture' if 'fixtures.invalid' in case['repository_url'] else 'public-repository',
    'target_bundle':str(bundle),'target_bundle_sha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),
    'prompt':case.get('prompt',case.get('ordinary_user_prompt')),'diagram_type':case['diagram_type'],
    'evaluation_case_sha256':hashlib.sha256(json.dumps(case,sort_keys=True,ensure_ascii=False).encode()).hexdigest()})
 development=[x for x in m['tasks'] if x['cohort']=='development'];holdout=[x for x in m['tasks'] if x['cohort']=='holdout']
 if len(development)!=3 or len(holdout)!=3:raise SystemExit('Expected 3 development and 3 holdout tasks')
 for i,c in enumerate(development):
  for v in ('AB' if i%2==0 else 'BA'):m['runs'].append({'run_id':f'dev-{i+1:02d}-{v}','case_id':c['id'],'variant':v,'repeat':1})
 for i,c in enumerate(development):m['runs'].append({'run_id':f'dev-{i+1:02d}-C','case_id':c['id'],'variant':'C','repeat':1})
 for rep in range(3):
  for i,c in enumerate(holdout):
   for v in ['ABC','BCA','CAB'][(rep+i)%3]:m['runs'].append({'run_id':f'holdout-{i+1:02d}-r{rep+1}-{v}','case_id':c['id'],'variant':v,'repeat':rep+1})
 m['registered_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();m['catalog_sha256']=hashlib.sha256(a.catalog.read_bytes()).hexdigest();m['status']='A/B registered; C SHA must be frozen before C author runs'
 (a.evidence/'frozen-case-catalog.json').write_bytes(a.catalog.read_bytes());target.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'manifest':str(target),'runs':len(m['runs']),'tasks':len(m['tasks'])}))
if __name__=='__main__':main()
