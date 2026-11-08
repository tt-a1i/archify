#!/usr/bin/env python3
"""Compare source/ZIP payloads and exit states; parity is not independent accuracy."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['work','source-tree','package','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for n in ['work','source_tree','package','out']:setattr(a,n,getattr(a,n).resolve())
prefix='rust-lifetime-';paths=[(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package),'$INSTALL')]
for family in ['candidate','older','pair','extras']:
 for mode in ['source','zip']:paths.append((str(a.work/(prefix+family+'-'+mode)),'$OUT'))
def norm(x):
 if isinstance(x,dict):return {k:norm(v)for k,v in x.items()}
 if isinstance(x,list):return [norm(v)for v in x]
 if isinstance(x,str):
  for before,after in paths:x=x.replace(before,after)
 return x
raw=[];questions=[];commands=[];scores={}
for family in ['candidate','older','pair','extras']:
 s=a.work/(prefix+family+'-source');z=a.work/(prefix+family+'-zip')
 rawPaths=sorted(x.relative_to(s)for x in s.rglob('raw-facts.json'));assert rawPaths==sorted(x.relative_to(z)for x in z.rglob('raw-facts.json'))
 for file in rawPaths:assert (s/file).read_bytes()==(z/file).read_bytes(),(family,file);raw.append(family+'/'+str(file))
 for file in sorted(s.glob('*.json')):
  q=json.loads(file.read_text())
  if 'question'in q:
   assert norm(q)==norm(json.loads((z/file.name).read_text())),(family,file.name);questions.append(family+'/'+file.name)
 sr=json.loads((s/'report.json').read_text());zr=json.loads((z/'report.json').read_text())
 if 'score'in sr:assert sr['score']==zr['score'];scores[family]=sr['score']
 if family in ['candidate','older','extras']:
  compact=lambda r:[{k:v for k,v in c.items()if k!='seconds'}for c in r['commands']]
  assert norm(compact(sr))==norm(compact(zr)),family;commands+=compact(sr)
 else:
  assert sr['references']==zr['references']and sr['status']==zr['status'];assert sr['exit']==zr['exit'];commands.append(dict(command=sr['command'],exit=sr['exit'],label='owned-pair'))
archive=json.loads((a.work/'rust-lifetime-archive.json').read_text());assert hashlib.sha256((a.source_tree/'archify.zip').read_bytes()).hexdigest()==archive['sha256']
report=dict(rawCaptures=raw,currentAndHistoricalQuestions=questions,commandsPerDistribution=len(commands),nonzeroExits=[dict(label=x['label'],exit=x['exit'])for x in commands if x['exit']],scores=scores,archive=archive,limits=['Three current raw captures match; paired owned snapshots are represented by their complete question payload.','Historical captures are read unchanged, not rebound or counted as new product accuracy samples.','Five older physical Map sites are ten overlapping profile observations. The three new selected sites are included in the independent73-call audit.'],projectExecuted=False)
a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
