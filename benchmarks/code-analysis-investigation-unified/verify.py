#!/usr/bin/env python3
"""Verify distribution equality; no accuracy denominator is inferred."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
p=argparse.ArgumentParser()
for name in ['source-results','zip-results','source-tree','package-tree','zip','repeat','out']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
for key,val in vars(a).items():setattr(a,key,val.resolve())
replacements=[(str(a.source_results),'$OUT'),(str(a.zip_results),'$OUT'),(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package_tree),'$INSTALL')]
def norm(x):
    if isinstance(x,dict):return {k:norm(v) for k,v in x.items()}
    if isinstance(x,list):return [norm(v) for v in x]
    if isinstance(x,str):
        for old,new in replacements:x=x.replace(old,new)
    return x
raw=sorted(p.relative_to(a.source_results) for p in a.source_results.rglob('raw-facts.json'))
assert raw==sorted(p.relative_to(a.zip_results) for p in a.zip_results.rglob('raw-facts.json'))
for rel in raw:assert (a.source_results/rel).read_bytes()==(a.zip_results/rel).read_bytes(),str(rel)
questions=[]
for f in sorted(a.source_results.glob('*/*.json')):
    data=json.loads(f.read_text())
    if 'question' not in data:continue
    rel=f.relative_to(a.source_results);other=json.loads((a.zip_results/rel).read_text())
    assert norm(data)==norm(other),str(rel);questions.append(str(rel))
modules=subprocess.check_output(['git','-C',str(a.source_tree),'ls-files','archify/modules/code-analysis'],text=True).splitlines()
for f in modules:assert (a.source_tree/f).read_bytes()==(a.package_tree/Path(f).relative_to('archify')).read_bytes(),f
assert a.zip.read_bytes()==a.repeat.read_bytes()
ancestors=['bbfa46ce6bee206f1bf17267168539902d36ab40','b7495c1d73736a81c8e58d9763bfdea3e2d8e579','93378351dc97768fd7e0882a50f32ecc7a34e2a6','f8470917f7f80e279555025bee25af81f544c8f1','1788ace7a692586332bdb7ceabf17ec8eab3d54e','3b2bdd1aec833f85c51aaf8c2d8c711fb7083c32','68f54478ae16d824e43198ac94d6e05746510edf']
for revision in ancestors:subprocess.run(['git','-C',str(a.source_tree),'merge-base','--is-ancestor',revision,'HEAD'],check=True)
commands=[];scores={}
for recipe in sorted(p for p in a.source_results.iterdir() if p.is_dir()):
    report='result.json' if recipe.name=='py-import' else 'report.json'
    left=json.loads((recipe/report).read_text());right=json.loads((a.zip_results/recipe.name/report).read_text())
    score=left.get('score',left.get('counts'));assert score==right.get('score',right.get('counts'));scores[recipe.name]=score
    def items(d):
        return [dict(label=x['label'],argv=x.get('argv',x.get('command',x.get('args'))),exit=x['exit']) for x in d.get('commands',[])]
    lc,rc=items(left),items(right);assert norm(lc)==norm(rc),recipe.name
    commands.extend(dict(recipe=recipe.name,**x) for x in lc)
receipt=dict(runtimeMerge='11a0350919efc5553eff118094aa9cf1a39106be',preservedAncestors=ancestors,rawFactsByteIdentical=[str(x) for x in raw],questionParityOnlyInstallOutputPaths=questions,trackedModuleFilesMatch=len(modules),canonicalBuildsEqual=True,zipSha256=hashlib.sha256(a.zip.read_bytes()).hexdigest(),scores=scores,cliCommandsCompared=len(commands),nonzeroExpectedCommands=[dict(recipe=x['recipe'],label=x['label'],exit=x['exit']) for x in commands if x['exit']],limits=['Replayed exposed fixed samples, not new independent accuracy samples.','Different language denominators/scopes overlap and must not be summed.','Distribution equality does not prove compilation, runtime behavior, full impact or Labs integration.'])
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(dict(rawCaptures=len(raw),questions=len(questions),moduleFiles=len(modules),commands=len(commands),zipSha256=receipt['zipSha256'])))
