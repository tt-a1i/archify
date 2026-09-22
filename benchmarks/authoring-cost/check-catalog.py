#!/usr/bin/env python3
"""Check frozen source identities/ranges; this does not establish semantic truth."""
import json, pathlib, subprocess, sys
p=pathlib.Path(sys.argv[1]);catalog=json.loads(p.read_text());errors=[]
for c in catalog['tasks']:
 root=pathlib.Path(c['target_repo']);actual=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
 if actual!=c['target_repo_sha']:errors.append([c['id'],'sha mismatch'])
 if not c['repository_url'].startswith(('https://','http://','ssh://')):errors.append([c['id'],'unsupported repository URL'])
 for ref in c['source_evidence']:
  text=(root/ref['path']).read_text();lines=text.splitlines()
  for start,end in ref.get('line_ranges',[]):
   if start<1 or end<start or end>len(lines):errors.append([c['id'],ref['path'],'invalid range',start,end,len(lines)])
  for anchor in ref.get('anchors',[]):
   if anchor not in text:errors.append([c['id'],ref['path'],'missing anchor',anchor])
print(json.dumps({'tasks':len(catalog['tasks']),'errors':errors,'semantic_truth':'requires independent review'},ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
