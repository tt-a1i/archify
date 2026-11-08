#!/usr/bin/env python3
"""Read actual historical captures and probe absent compiler tooling via public CLI."""
import argparse,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','samples-root','v1','v2','v3','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for n in ['cli','samples_root','v1','v2','v3','out']:setattr(a,n,getattr(a,n).resolve())
a.out.mkdir(parents=True,exist_ok=True);commands=[];units=[]
for version,capture,project,entry,function in [(1,a.v1,'regex','regex-syntax/src/lib.rs',None),(2,a.v2,'serde-json','src/value/index.rs',None),(3,a.v3,'regex','regex-syntax/src/hir/translate.rs','hir::translate::Translator::translate')]:
 facts=json.loads((capture/'raw-facts.json').read_text());model='rust-source-direct-v'+str(version);assert facts['callModel']==model;dest=a.out/('v'+str(version)+'.json');cmd=['node',str(a.cli),'code-analysis','task',str(capture),'--root',str(a.samples_root/project),'--entry',entry,'--question','What does this original saved Rust source model establish without rebinding?','--format','json','--out',str(dest),'--json']
 if function:cmd+=['--function',function]
 r=subprocess.run(cmd,capture_output=True,text=True);assert r.returncode==0,r.stderr;q=json.loads(dest.read_text());assert q['calls']['coverage']=='available'and q['calls']['provenance']['callModel']==model
 for record in q['calls']['records']:assert record['fact']==facts['calls'][record['factIndex']]
 if version==3:assert next(x for x in q['calls']['records']if x['fact']['line']==174 and x['fact']['column']==25)['targetNavigation']['status']=='unresolved'
 commands.append(dict(label='legacy-v'+str(version),command=cmd,exit=r.returncode));units.append(dict(model=model,coverage=q['calls']['coverage'],bindingCoverage=q['calls']['bindingCoverage'],included=q['calls']['included'],omitted=q['calls']['omitted']))
cmd=['node',str(a.cli),'code-analysis','check',str(a.samples_root/'regex'),'--language','rust','--fail-on','never','--out',str(a.out/'missing-capture'),'--json'];missing=str(a.out/'absent-rust-tool');env={**os.environ,'ARCHIFY_RUSTC':missing,'ARCHIFY_CARGO':missing};r=subprocess.run(cmd,capture_output=True,text=True,env=env);assert r.returncode==2 and 'extract/rust-unavailable'in r.stdout+r.stderr;(a.out/'missing-sdk.stdout').write_text(r.stdout);(a.out/'missing-sdk.stderr').write_text(r.stderr);commands.append(dict(label='missing-sdk',command=cmd,environment=dict(ARCHIFY_RUSTC='$ABSENT_TOOL',ARCHIFY_CARGO='$ABSENT_TOOL'),exit=r.returncode))
report=dict(commands=commands,historical=units,missingSdk=dict(exit=r.returncode,diagnostic='extract/rust-unavailable',normalToolchainRequirement='Installed Cargo/rustc1.71+ and locked helper dependencies; optional RA is not a product requirement.'),projectExecuted=False);(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(historicalModels=[u['model']for u in units],missingSdkExit=r.returncode)))
