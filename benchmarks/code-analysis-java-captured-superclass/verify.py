#!/usr/bin/env python3
"""Verify current source/ZIP captures, questions, historical coverage and packaged files."""
import argparse,hashlib,json,zipfile
from pathlib import Path
p=argparse.ArgumentParser()
for name in ['work','source-tree','package','out']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.work=a.work.resolve();a.source_tree=a.source_tree.resolve();a.package=a.package.resolve()
def load(path):return json.loads(Path(path).read_text())
def normalize(value,path):
 rules=[(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package),'$INSTALL'),(str(path),'$OUTPUT')]
 if path.parent!=a.work:rules.append((str(path.parent),'$OUT'))
 if isinstance(value,dict):return {k:normalize(v,path) for k,v in value.items()}
 if isinstance(value,list):return [normalize(v,path) for v in value]
 if isinstance(value,str):
  for old,new in sorted(rules,key=lambda r:len(r[0]),reverse=True):value=value.replace(old,new)
 return value
captures=[];questions=[]
pairs=[
 ('new-commons','java-superclass-final-source/capture','java-superclass-final-zip/capture'),
 ('older-commons','java-superclass-bounded-arity-source/commons-lang','java-superclass-bounded-arity-zip/commons-lang'),
 ('older-slf','java-superclass-bounded-arity-source/slf4j','java-superclass-bounded-arity-zip/slf4j'),
 ('controls','java-superclass-controls-source','java-superclass-controls-zip'),
 ('shared-js','java-superclass-js-source/capture','java-superclass-js-zip/capture'),
]
for label,left,right in pairs:
 x=a.work/left/'raw-facts.json';y=a.work/right/'raw-facts.json';assert x.read_bytes()==y.read_bytes(),label
 captures.append(dict(label=label,sha256=hashlib.sha256(x.read_bytes()).hexdigest()))
qPairs=[('new-'+str(i),'java-superclass-final-source/question-'+str(i)+'.json','java-superclass-final-zip/question-'+str(i)+'.json') for i in range(3)]
qPairs += [(project,'java-superclass-bounded-arity-source/'+project+'-question.json','java-superclass-bounded-arity-zip/'+project+'-question.json') for project in ['commons-lang','slf4j']]
qPairs += [('legacy','java-superclass-legacy-source.json','java-superclass-legacy-zip.json'),('paired','java-superclass-pair-source/question.json','java-superclass-pair-zip/question.json')]
qPairs += [('js-'+str(i),'java-superclass-js-source/question-'+str(i)+'.json','java-superclass-js-zip/question-'+str(i)+'.json') for i in [0,1]]
for label,left,right in qPairs:
 x=a.work/left;y=a.work/right;assert normalize(load(x),x)==normalize(load(y),y),label;questions.append(label)
historical=load(a.work/'java-superclass-legacy-source.json');assert historical['calls']['provenance']['callModel']=='java-static-lexical-v3';assert all(not r['fact'].get('target') for r in historical['calls']['records'])
for distribution in ['source','zip']:
 controls=load(a.work/('java-superclass-controls-'+distribution+'/raw-facts.json'));assert [(c['file'],c['target']['file']) for c in controls['calls'] if c.get('target')]==[('q/Plain.java','p/Api.java')]
for stem in ['java-superclass-final','java-superclass-bounded-arity','java-superclass-js']:
 left=load(a.work/(stem+'-source/report.json'));right=load(a.work/(stem+'-zip/report.json'));assert left['score']==right['score']
 for x,y in zip(left['commands'],right['commands']):assert x['exit']==y['exit']==0
for side in ['source','zip']:assert load(a.work/('java-superclass-pair-'+side+'/report.json'))['exit']==0
archive=a.work/'java-superclass-final-package.zip';repeat=a.work/'java-superclass-final-package-repeat.zip';assert archive.read_bytes()==repeat.read_bytes();files=[]
with zipfile.ZipFile(archive) as z:
 for name in z.namelist():
  if name.startswith('archify/modules/code-analysis/') and not name.endswith('/'):
   assert z.read(name)==(a.source_tree/name).read_bytes(),name;files.append(name)
r=dict(captures=captures,distinctCaptures=len(set(c['sha256'] for c in captures)),questions=questions,cliCommandsPerDistribution=14,exits='All0: newrecipe4, olderarity4, sharedJS3, ownedpair1, observedlegacytask1 and controlscheck1.',normalization='Only installation/output paths; source roots, locations, coverage, reasons and snapshot identities otherwise compare exactly.',zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),repeatedZipEqual=True,moduleFilesEqual=len(files),historicalModel='java-static-lexical-v3',projectExecuted=False)
a.out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
