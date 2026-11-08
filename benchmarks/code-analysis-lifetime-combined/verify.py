#!/usr/bin/env python3
"""Verify composed distributions; do not infer a total accuracy denominator."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['source-tree','package','base-source','base-zip','recent-source','recent-zip','archive','repeat','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--runtime-revision',required=True);a=p.parse_args()
for n in vars(a):
 if isinstance(getattr(a,n),Path):setattr(a,n,getattr(a,n).resolve())
load=lambda f:json.loads(f.read_text())
replacements=[(str(a.source_tree/'archify'),'$INSTALL'),(str(a.package),'$INSTALL')]
for s,z in [(a.base_source,a.base_zip),(a.recent_source,a.recent_zip)]:replacements.extend([(str(s),'$OUT'),(str(z),'$OUT')])
replacements.sort(key=lambda x:len(x[0]),reverse=True)
def norm(x):
 if isinstance(x,dict):return {k:norm(v)for k,v in x.items()}
 if isinstance(x,list):return [norm(v)for v in x]
 if isinstance(x,str):
  for old,new in replacements:x=x.replace(old,new)
 return x
def command(c):return dict(label=c.get('label'),argv=c.get('argv',c.get('command',c.get('args'))),exit=c['exit'])
raw=[];questions=[];commands=[];scores={}
for group,s,z in [('base',a.base_source,a.base_zip),('recent',a.recent_source,a.recent_zip)]:
 plan=load(s/'commands.json');other=load(z/'commands.json')
 assert [(c['name'],c['exit'])for c in plan]==[(c['name'],c['exit'])for c in other]
 assert len(plan)==(9 if group=='base'else 10)and all(c['exit']==0 for c in plan),group
 sr=sorted(x.relative_to(s)for x in s.rglob('raw-facts.json'));zr=sorted(x.relative_to(z)for x in z.rglob('raw-facts.json'));assert sr==zr,group
 for rel in sr:assert (s/rel).read_bytes()==(z/rel).read_bytes(),(group,str(rel));raw.append(group+'/'+str(rel))
 for f in sorted(s.glob('*/*.json')):
  data=load(f);rel=f.relative_to(s)
  if 'question'in data:
   assert norm(data)==norm(load(z/rel)),(group,str(rel));questions.append(group+'/'+str(rel))
 families=sorted(x for x in s.iterdir()if x.is_dir()and any((x/n).is_file()for n in ['report.json','result.json']))
 assert len(families)==len(plan),group
 for family in families:
  name='report.json'if (family/'report.json').is_file()else 'result.json';left=load(family/name);right=load(z/family.name/name)
  score=left.get('score',left.get('counts'))
  if score is not None:assert score==right.get('score',right.get('counts'));scores[group+'/'+family.name]=score
  lc=[command(c)for c in left.get('commands',[])];rc=[command(c)for c in right.get('commands',[])]
  if 'command'in left and 'exit'in left:lc.append(command(left));rc.append(command(right))
  assert norm(lc)==norm(rc),(group,family.name,'commands')
  commands.extend(dict(group=group,family=family.name,**c)for c in lc)
modules=subprocess.check_output(['git','-C',str(a.source_tree),'ls-files','archify/modules/code-analysis'],text=True).splitlines()
for f in modules:assert (a.source_tree/f).read_bytes()==(a.package/Path(f).relative_to('archify')).read_bytes(),f
assert a.archive.read_bytes()==a.repeat.read_bytes()==(a.source_tree/'archify.zip').read_bytes()
parents=subprocess.check_output(['git','-C',str(a.source_tree),'show','-s','--format=%P',a.runtime_revision],text=True).split()
assert parents==['196dd3569efba785d456a6dd0825ea6ebdf489bf','915d528e584a6343ab79284bd274ed11762cf9c9'],parents
for revision in [a.runtime_revision,*parents]:subprocess.run(['git','-C',str(a.source_tree),'merge-base','--is-ancestor',revision,'HEAD'],check=True)
subprocess.run(['git','-C',str(a.source_tree),'diff','--quiet',a.runtime_revision,'--','archify/modules/code-analysis'],check=True)
receipt=dict(runtimeMerge=a.runtime_revision,preservedOriginalParents=parents,rawCapturesByteIdentical=raw,questionsEqualOnlyInstallOutputPaths=questions,commandsPerDistribution=len(commands),expectedNonzero=[dict(group=c['group'],family=c['family'],label=c['label'],exit=c['exit'])for c in commands if c['exit']],scores=scores,moduleFilesEqual=len(modules),canonicalBuildsEqual=True,zip=dict(sha256=hashlib.sha256(a.archive.read_bytes()).hexdigest(),bytes=a.archive.stat().st_size),producerLabelNote='The unchanged original nine-recipe Python import report carries the symbolic label HEAD in both distributions. The runtimeMerge above, parent verification, unchanged module bytes and matched packaged bytes establish the immutable producer; HEAD is not used as immutable evidence.',limits=['Previously exposed fixed corpora; no new blind accuracy claim.','Recipes and profiles overlap; scores must not be summed.','Existing compiler/LSP audit results keep their original individual PR/runtime attribution; these replays do not rerun those oracles.','Source/ZIP equality is distribution validation, not compilation, runtime, complete impact, Labs integration or release.'],projectExecuted=False)
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({k:len(receipt[k])for k in ['rawCapturesByteIdentical','questionsEqualOnlyInstallOutputPaths']}|dict(commands=len(commands),moduleFiles=len(modules),zip=receipt['zip'])))
