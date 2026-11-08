#!/usr/bin/env python3
"""Replay the fixed real upstream migration, retaining its partial status and exit1."""
import argparse,hashlib,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['cli','base-root','head-root','out']:p.add_argument('--'+n,type=Path,required=True)
p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
for n in ['cli','base_root','head_root','out']:setattr(a,n,getattr(a,n).resolve())
a.out.mkdir(parents=True,exist_ok=True);m=json.loads((Path(__file__).parent/'upstream-pair-source.json').read_text())
def verify():
 for side in ['base','head']:
  root=getattr(a,side+'_root')
  for file,value in m['source'][m[side+'Revision']].items():
   dest=root/file
   if value.get('absent'):assert not dest.exists(),(side,file)
   else:assert hashlib.sha256(dest.read_bytes()).hexdigest()==value['sha256'],(side,file)
verify();dest=a.out/'question.json';entry='slf4j-api/src/main/java/org/slf4j/LoggerFactoryFriend.java';cmd=['node',str(a.cli),'code-analysis','task','--base-root',str(a.base_root),'--root',str(a.head_root),'--entry',entry,'--question','Which captured callers refer to this newly shared implementation, and what was absent before the migration?','--format','json','--out',str(dest),'--json'];r=subprocess.run(cmd,capture_output=True,text=True);(a.out/'stdout').write_text(r.stdout);(a.out/'stderr').write_text(r.stderr);assert r.returncode==1,(r.returncode,r.stderr)
q=json.loads(dest.read_text());assert q['status']=='partial';assert q['definitionCoverage']==dict(base='not-captured',head='available');assert q['changedDefinitions']['total']==0
reset=next(x for x in q['unpairedDefinitions']['items'] if x['definition']['name']=='reset');assert reset['reason']=='head-only' and reset['definition']['line']==19
refs=reset['knownReferences'];simple=[x for x in refs['items'] if x['fact']['file']=='slf4j-simple/src/test/java/org/slf4j/simple/SimpleLoggerMultithreadedInitializationTest.java'];assert len(simple)==(0 if a.expect=='baseline' else 2)
if a.expect=='candidate':
 assert {x['fact']['line'] for x in simple}=={56,61}
 for ref in simple:assert ref['navigation']['status']=='valid' and ref['fact']['target']==dict(file=entry,name='reset',line=19,column=5) and len(ref['fact']['buildEvidence'])==3
verify();report=dict(expect=a.expect,command=cmd,exit=r.returncode,status=q['status'],baseRevision=m['baseRevision'],headRevision=m['headRevision'],definitionCoverage=q['definitionCoverage'],pairedChangedDefinitions=q['changedDefinitions']['total'],headOnlyReset=reset,sourceLimits=[dict(side=side,capturedFiles=q['sides'][side]['capturedFiles'],unavailable=q['sides'][side]['unavailableFiles'],parseErrors=q['sides'][side]['parseErrors']) for side in ['base','head']],reasons=q['comparison']['reasons'],limits=['Supplemental post-rule real upstream added-definition migration; not a changed-body pair or blind sample.','Base entry absent, POM contents differ, and unrelated sources fail parsing. Partial/exit1 is retained; no two-sided ready claim.','Two Simple callers are source-frozen before this pair was analyzed. Remaining head references are post-output preservation observations, not additional designed positive samples.'],projectExecuted=False)
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(exit=r.returncode,status=q['status'],knownHeadReferences=refs['total'],simpleReferences=len(simple))))
