#!/usr/bin/env python3
"""Check exact captures and normalized orientation parity; never rebind history."""
import argparse,hashlib,json,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--source-tree',type=Path,required=True);p.add_argument('--package',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.work=a.work.resolve();a.source_tree=a.source_tree.resolve();a.package=a.package.resolve()
def load(file):return json.loads(Path(file).read_text())
def normalize(value,out):
 if isinstance(value,dict):return {k:normalize(v,out) for k,v in value.items()}
 if isinstance(value,list):return [normalize(v,out) for v in value]
 if isinstance(value,str):
  for old,new in sorted([(str(out),'$OUT'),(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package),'$INSTALL')],key=lambda pair:len(pair[0]),reverse=True):value=value.replace(old,new)
 return value
captures=[];questions=[]
for label,left,right in [('redux','forwarded-exports-accepted-source/capture','forwarded-exports-accepted-zip/capture'),('controls','forwarded-exports-controls-source-cli','forwarded-exports-controls-zip-cli'),('older-alias-replay','forwarded-exports-old-alias-source/capture','forwarded-exports-old-alias-zip/capture')]:
 x=a.work/left/'raw-facts.json';y=a.work/right/'raw-facts.json';assert x.read_bytes()==y.read_bytes(),label;captures.append(dict(label=label,sha256=hashlib.sha256(x.read_bytes()).hexdigest()))
for i in [0,1]:
 name='question-'+str(i)+'.json';x=a.work/'forwarded-exports-accepted-source'/name;y=a.work/'forwarded-exports-accepted-zip'/name;assert normalize(load(x),x.parent)==normalize(load(y),y.parent),name;questions.append(name)
for label,left,right in [('real-pair','forwarded-exports-pair-accepted-source/question.json','forwarded-exports-pair-accepted-zip/question.json'),('actual-v4','forwarded-exports-legacy-v4-source.json','forwarded-exports-legacy-v4-zip.json')]:
 x=a.work/left;y=a.work/right;assert normalize(load(x),x.parent)==normalize(load(y),y.parent),label;questions.append(label)
x=a.work/'forwarded-exports-old-alias-source/question.json';y=a.work/'forwarded-exports-old-alias-zip/question.json';assert normalize(load(x),x.parent)==normalize(load(y),y.parent);questions.append('older-alias-replay')
old=load(a.work/'forwarded-exports-legacy-v4-source.json');assert old['calls']['provenance']['callModel']=='js-ts-lexical-v4';assert all('via' not in r['fact'] for r in old['calls']['records'])
current=load(a.work/'forwarded-exports-accepted-source/report.json');packaged=load(a.work/'forwarded-exports-accepted-zip/report.json');assert current['score']==packaged['score']
for left,right in zip(current['commands'],packaged['commands']):assert left['exit']==right['exit']==0
for distribution in ['source','zip']:
 own=load(a.work/('forwarded-exports-controls-'+distribution+'-cli/raw-facts.json'));assert all(c['resolution']=='unresolved' for c in own['calls'] if c['file'] in ['consumer.mjs','eval-consumer.mjs'])
archive=a.work/'forwarded-exports-package.zip';repeat=a.work/'forwarded-exports-package-repeat.zip';assert archive.read_bytes()==repeat.read_bytes();module=[]
with zipfile.ZipFile(archive) as z:
 for file in z.namelist():
  if file.startswith('archify/modules/code-analysis/') and not file.endswith('/'):
   assert z.read(file)==(a.source_tree/file).read_bytes(),file;module.append(file)
result=dict(captures=captures,questions=questions,currentScore=current['score'],cliCommandsPerDistribution=8,commands='check + 2 orientation questions + real-pair task + actual v4 question + authored controls check; all exit0; older alias recipe adds check/question',zipSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),moduleFilesEqual=len(module),repeatZipEqual=True,actualHistoricalModel='js-ts-lexical-v4',normalization='Only installation and output paths; repository source roots, target locations, coverage, facts, reasons and snapshot identities compared.',projectExecuted=False);a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
