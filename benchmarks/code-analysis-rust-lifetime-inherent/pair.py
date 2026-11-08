#!/usr/bin/env python3
"""Owned changed-body integration: no claim of a real upstream version change."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','work','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
for n in ['cli','work','out']:setattr(a,n,getattr(a,n).resolve())
a.out.mkdir(parents=True,exist_ok=True);base=a.work/'lifetime-owned-before';head=a.work/'lifetime-owned-after'
files={'Cargo.toml':'[workspace]\nmembers=["api","app"]\nresolver="2"\n','api/Cargo.toml':'[package]\nname="borrowed-api"\nversion="0.1.0"\nedition="2021"\n[lib]\nname="actual_api"\n','app/Cargo.toml':'[package]\nname="client"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nrenamed={package="borrowed-api",path="../api"}\n','api/src/lib.rs':"pub struct Borrowed<'a>(&'a str);\nimpl<'a> Borrowed<'a>{pub fn new(v:&'a str)->Self{Self(v)}}\n",'app/src/lib.rs':'use renamed::Borrowed as Imported;\npub fn caller(){Imported::new("one");renamed::Borrowed::new("two");actual();}\nfn actual(){Imported::new("three");}\n'}
for root in [base,head]:
 for file,text in files.items():
  expected=text.replace('Self(v)','Self(v.trim())')if root==head and file=='api/src/lib.rs'else text;dest=root/file
  if not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(expected)
  assert dest.read_bytes()==expected.encode(),dest
out=a.out/'question.json';cmd=['node',str(a.cli),'code-analysis','task','--base-root',str(base),'--root',str(head),'--entry','api/src/lib.rs','--question','Which captured callers refer to this changed owned lifetime-only constructor?','--format','json','--out',str(out),'--json'];r=subprocess.run(cmd,capture_output=True,text=True);(a.out/'stdout').write_text(r.stdout);(a.out/'stderr').write_text(r.stderr);assert r.returncode==0,r.stderr
q=json.loads(out.read_text());assert q['status']=='ready'and q['changedDefinitions']['total']==1
refs=[]
for side in ['base','head']:
 x=q['changedDefinitions']['items'][0][side]['knownReferences'];assert x['total']==(0 if a.expect=='baseline'else 3)
 if a.expect=='candidate':assert all(v['navigation']['status']=='valid'and v['fact']['file']=='app/src/lib.rs'for v in x['items'])
 refs.append(dict(side=side,knownSites=x['total'],items=x['items']))
report=dict(expect=a.expect,command=cmd,exit=0,status=q['status'],references=refs,sourceScope='Owned Cargo workspace with renamed dependency and custom actual_api library name; three physical direct sites in two caller functions.',limits=['Synthetic changed-body integration, not a real upstream change.','Original real Go/Rust upstream acceptance remains separately attributed; no runtime or complete impact proof.'],projectExecuted=False);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(exit=0,status=q['status'],knownSitesPerSide=refs[0]['knownSites'])))
