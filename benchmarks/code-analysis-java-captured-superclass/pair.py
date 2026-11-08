#!/usr/bin/env python3
"""Exercise the public paired CLI using owned compiler-control sources, not an upstream version pair."""
import argparse,json,shutil,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--work',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.cli=a.cli.resolve();a.work=a.work.resolve();a.out=a.out.resolve();a.out.mkdir(parents=True,exist_ok=True)
before=a.work/'java-superclass-pair-before';after=a.work/'java-superclass-pair-after';controls=Path(__file__).resolve().parent/'controls'
if not before.exists():
 for root in [before,after]:
  for file in controls.rglob('*.java'):
   dest=root/file.relative_to(controls);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dest)
 p=after/'p/Api.java';s=p.read_text();assert 'void run() {}'in s;p.write_text(s.replace('void run() {}','void run() { int changed = 1; }'))
for root in [before,after]:
 for file in controls.rglob('*.java'):
  expected=file.read_bytes()
  if root==after and file.name=='Api.java':expected=expected.replace(b'void run() {}',b'void run() { int changed = 1; }')
  assert (root/file.relative_to(controls)).read_bytes()==expected
dest=a.out/'question.json';cmd=['node',str(a.cli),'code-analysis','task','--base-root',str(before),'--root',str(after),'--entry','p/Api.java','--question','Which captured-superclass caller refers to this changed owned control implementation?','--format','json','--out',str(dest),'--json'];r=subprocess.run(cmd,capture_output=True,text=True);(a.out/'stdout').write_text(r.stdout);(a.out/'stderr').write_text(r.stderr);assert r.returncode==0,r.stderr
q=json.loads(dest.read_text());assert q['status']=='ready';assert q['changedDefinitions']['total']==1
for side in ['base','head']:
 refs=q['changedDefinitions']['items'][0][side]['knownReferences'];assert refs['total']==1
 ref=refs['items'][0];assert ref['fact']['file']=='q/Plain.java';assert ref['navigation']['status']=='valid';assert len(ref['fact']['qualifierAncestry'])==2
(a.out/'report.json').write_text(json.dumps(dict(command=cmd,exit=0,status=q['status'],knownCallersPerSide=1,scope='Owned compiler controls changed body; synthetic paired integration, not a real upstream version change.',projectExecuted=False),indent=2)+'\n');print('one known inherited-context caller per side; ready/exit0')
