#!/usr/bin/env python3
"""Compare packaging modes without normalizing source facts or target evidence."""
import argparse, hashlib, json, pathlib, zipfile
p=argparse.ArgumentParser()
for name in ('source','archive','source-tree','zip','repeat','out'): p.add_argument('--'+name,type=pathlib.Path,required=True)
a=p.parse_args(); digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
sr=json.loads((a.source/'result.json').read_text()); ar=json.loads((a.archive/'result.json').read_text())
assert sr['productSha']==ar['productSha'] and sr['manifestSha256']==ar['manifestSha256']
assert sr['units']==ar['units']
comparisons=[]
for name in ('click','jinja'):
 x=a.source/name/'raw-facts.json'; y=a.archive/name/'raw-facts.json'
 assert x.read_bytes()==y.read_bytes(),name
 comparisons.append({'file':name+'/raw-facts.json','equalBytes':True,'sha256':digest(x)})
for x in sorted(a.source.glob('*question.json')):
 y=a.archive/x.name; s=json.loads(x.read_text()); t=json.loads(y.read_text())
 for q,folder in [(s,a.source),(t,a.archive)]:
  q['calls']['provenance']['rawFactsPath']=q['calls']['provenance']['rawFactsPath'].replace(str(folder.resolve()),'${OUTPUT}')
  assert q['workflow'].endswith('/modules/code-analysis/docs/FUNCTION-ANALYSIS.md')
  q['workflow']='${MODULE}/docs/FUNCTION-ANALYSIS.md'
 assert s==t,x.name
 comparisons.append({'file':x.name,'equalAfterRawFactsPathAndWorkflowNormalization':True})
def commands(result,folder):
 normalized=[]
 for r in result['commands']:
  argv=list(r['argv']); argv[1]='${CLI}'
  normalized.append({'label':r['label'],'argv':[v.replace(str(folder.resolve()),'${OUTPUT}') for v in argv],'exit':r['exit']})
 return normalized
assert commands(sr,a.source)==commands(ar,a.archive)
with zipfile.ZipFile(a.zip) as z:
 files=[n for n in z.namelist() if n.startswith('archify/modules/code-analysis/') and not n.endswith('/')]
 assert all(z.read(n)==(a.source_tree/n).read_bytes() for n in files)
assert a.zip.read_bytes()==a.repeat.read_bytes()
result={'productSha':sr['productSha'],'archiveSha256':digest(a.zip),'repeatBuildIdentical':True,'moduleFileCount':len(files),'allPackagedModuleBytesMatchSource':True,'cliInvocationsPerMode':len(sr['commands']),'unitsEqual':True,'commandsAndExitsEqualAfterEntrypointAndOutputPathNormalization':True,'comparisons':comparisons}
a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
