#!/usr/bin/env python3
"""Compare recorded source/ZIP runs; do not infer accuracy from parity."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for key in ['work','source-tree','package','out']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();a.work=a.work.resolve();a.source_tree=a.source_tree.resolve();a.package=a.package.resolve();prefix='rust-specialized-';replacements=[(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package),'$INSTALL')]
families=['accepted','inherent','direct']
for family in families:
 for mode in ['source','zip']:replacements.append((str(a.work/(prefix+family+'-'+mode)),'$OUT'))
def norm(x):
 if isinstance(x,dict):return {k:norm(v) for k,v in x.items()}
 if isinstance(x,list):return [norm(v) for v in x]
 if isinstance(x,str):
  for old,new in replacements:x=x.replace(old,new)
 return x
raw=[];questions=[];digests=set();question_digests=set();commands=[];scores={}
for family in families:
 source=a.work/(prefix+family+'-source');archive=a.work/(prefix+family+'-zip')
 files=sorted(f.relative_to(source) for f in source.rglob('raw-facts.json'));assert files==sorted(f.relative_to(archive) for f in archive.rglob('raw-facts.json'))
 for f in files:
  data=(source/f).read_bytes();assert data==(archive/f).read_bytes();raw.append(family+'/'+str(f));digests.add(hashlib.sha256(data).hexdigest())
 for f in sorted(source.glob('*.json')):
  d=json.loads(f.read_text())
  if 'question' not in d:continue
  n=norm(d);assert n==norm(json.loads((archive/f.name).read_text())),f.name;questions.append(family+'/'+f.name);question_digests.add(hashlib.sha256(json.dumps(n,sort_keys=True).encode()).hexdigest())
 left=json.loads((source/'report.json').read_text());right=json.loads((archive/'report.json').read_text());assert left['score']==right['score'];scores[family]=left['score']
 def compact(d):return [dict(label=c['label'],command=c.get('command',c.get('argv')),exit=c['exit']) for c in d['commands']]
 assert norm(compact(left))==norm(compact(right));commands.extend(dict(family=family,**c) for c in compact(left))
legacy=[]
for version in [1,2]:
 source=json.loads((a.work/(prefix+'legacy-v'+str(version)+'-source.json')).read_text());archive=json.loads((a.work/(prefix+'legacy-v'+str(version)+'-zip.json')).read_text());assert norm(source)==norm(archive);assert source['calls']['coverage']=='available' and source['calls']['provenance']['callModel']=='rust-source-direct-v'+str(version);legacy.append(dict(version=version,bindingCoverage=source['calls']['bindingCoverage']))
module_files=subprocess.check_output(['git','-C',str(a.source_tree),'ls-files','archify/modules/code-analysis'],text=True).splitlines()
for f in module_files:assert (a.source_tree/f).read_bytes()==(a.package/Path(f).relative_to('archify')).read_bytes(),f
zipfile=a.source_tree/'archify.zip';assert zipfile.read_bytes()==(a.work/(prefix+'repeat.zip')).read_bytes()
report=dict(runtimeCommit='f8ca96645',testCorrection='1ef5ed43d',rawCaptures=raw,distinctRawPayloads=len(digests),currentQuestions=questions,distinctNormalizedQuestionPayloads=len(question_digests),historicalQuestions=legacy,commandsPerDistribution=len(commands),expectedNonzero=[dict(family=c['family'],label=c['label'],exit=c['exit']) for c in commands if c['exit']],scores=scores,trackedModuleFilesMatch=len(module_files),canonicalBuildsEqual=True,zipSha256=hashlib.sha256(zipfile.read_bytes()).hexdigest(),buildNode='22.23.3',buildZlib='1.3.1-e00f703',runtimeNode=subprocess.check_output(['node','--version'],text=True).strip(),limits=['Captures/questions include overlapping profiles/repeated selections; no independent accuracy denominator inferred.','Only install/output paths normalized; known partial exits retained.'])
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(captures=len(raw),distinctPayloads=len(digests),questions=len(questions),distinctQuestions=len(question_digests),historical=len(legacy),commands=len(commands),moduleFiles=len(module_files),zip=report['zipSha256'])))
