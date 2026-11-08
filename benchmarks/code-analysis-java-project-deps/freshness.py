#!/usr/bin/env python3
"""Public saved-task probes: POM invalidation and unchanged historical Java4 scope."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','capture','baseline','sample','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for n in ['cli','capture','baseline','sample','out']:setattr(a,n,getattr(a,n).resolve())
a.out.mkdir(parents=True,exist_ok=True);facts=json.loads((a.capture/'raw-facts.json').read_text());root=a.out/'changed-metadata-root';assert not root.exists();root.mkdir()
for file in [dict(file=x['path'],sourceText=x['sourceText']) for x in facts['files']]+facts['languageScope']['metadata']:
 dest=root/file['file'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(file['sourceText'].encode('utf8'))
parent=root/'parent-pom.xml';parent.write_bytes(parent.read_bytes()+b'\n<!-- changed after capture -->\n');entry='slf4j-simple/src/test/java/org/slf4j/simple/SimpleLoggerMultithreadedInitializationTest.java';rows=[]
for label,capture,current,expected in [('changed-pom',a.capture,root,1),('saved-java4',a.baseline,a.sample,0)]:
 dest=a.out/(label+'.json');cmd=['node',str(a.cli),'code-analysis','task',str(capture),'--root',str(current),'--entry',entry,'--function','SimpleLoggerMultithreadedInitializationTest.setup()','--question','Can the saved call evidence still establish a current source route?','--format','json','--out',str(dest),'--json'];r=subprocess.run(cmd,capture_output=True,text=True);(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==expected,(label,r.returncode,r.stderr)
 q=json.loads(dest.read_text())
 if label=='changed-pom':assert q['entry']['factsStatus']=='resolution-input-changed' and q['calls']['coverage']=='unavailable'
 else:
  assert q['calls']['coverage']=='available' and q['calls']['provenance']['callModel']=='java-static-lexical-v4'
  reset=next(x for x in q['calls']['records'] if x['fact']['line']==53);assert reset['targetNavigation']['status']=='unresolved' and reset['fact']['reason']=='java-inherited-build-scope'
 rows.append(dict(label=label,command=cmd,exit=r.returncode,coverage=q['calls']['coverage'],entryFactsStatus=q['entry']['factsStatus'],callModel=q['calls']['provenance']['callModel']))
(a.out/'report.json').write_text(json.dumps(dict(commands=rows,projectExecuted=False),indent=2)+'\n');print(json.dumps(rows))
