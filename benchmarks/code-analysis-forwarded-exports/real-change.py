#!/usr/bin/env python3
"""Replay a supplemental real changed-definition investigation; no upstream execution."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--expect',choices=['candidate','baseline'],default='candidate');a=p.parse_args();a.cli=a.cli.resolve();a.samples_root=a.samples_root.resolve();a.out=a.out.resolve();assert not a.out.exists();a.out.mkdir(parents=True)
here=Path(__file__).resolve().parent;m=json.loads((here/'real-change-source-first.json').read_text());roots={side:a.samples_root/('redux-forward-'+side) for side in ['before','after']}
def verify():
 for side,root in roots.items():
  assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==m['sides'][side]['revision']
  assert not subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=no'],text=True)
  for file,digest in m['sides'][side]['hashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest,file
verify();out=a.out/'question.json';cmd=['node',str(a.cli),'code-analysis','task','--base-root',str(roots['before']),'--root',str(roots['after']),'--entry','src/combineReducers.ts','--question','Which captured direct callers refer to implementations changed in this real source revision?','--format','json','--out',str(out),'--json'];r=subprocess.run(cmd,capture_output=True,text=True);(a.out/'stdout').write_text(r.stdout);(a.out/'stderr').write_text(r.stderr);assert r.returncode==0,r.stderr
q=json.loads(out.read_text());assert q['status']=='ready';assert q['changedDefinitions']['total']==2;result={}
for side,label in [('before','base'),('after','head')]:
 outer=next(c[label] for c in q['changedDefinitions']['items'] if c[label]['definition']['name']=='combineReducers');inner=next(c[label] for c in q['changedDefinitions']['items'] if c[label]['definition']['name']=='combination');refs=outer['knownReferences'];units=[]
 for c in m['sides'][side]['knownCallers']:
  matches=[ref for ref in refs['items'] if all(ref['fact'][k]==c[k] for k in ['file','line','column'])];assert len(matches)==(1 if a.expect=='candidate' else 0)
  if matches:assert matches[0]['navigation']['status']=='valid';assert matches[0]['fact']['target']==dict(file='src/combineReducers.ts',name='combineReducers',line=123,column=1)
  units.append(dict(file=c['file'],line=c['line'],column=c['column'],status='correct' if matches else 'missed'))
 assert inner['knownReferences']['total']==0
 result[side]=dict(verifiedSelectedCallers=units,capturedReferences={k:v for k,v in refs.items() if k!='items'},innerReturnedFunctionReferences=0)
verify();report=dict(expect=a.expect,exit=r.returncode,status=q['status'],sides=result,limits=[m['exposure'],m['coordinateCorrection'],'Only two selected callers per side are source-verified here; other captured references are not graded as correct.','40-record display limit is visible; returned combination function value flow remains unknown.','Type annotation change is source evidence, not a runtime effect claim.']);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({side:x['capturedReferences'] for side,x in result.items()}))
