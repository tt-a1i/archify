"""Supplemental compiler/source audit of captured Java call ranges, not runtime impact."""
from pathlib import Path
import json,base64
import argparse
p=argparse.ArgumentParser()
for project in ['slf4j','commons']:
 p.add_argument('--'+project+'-facts',type=Path,required=True);p.add_argument('--'+project+'-oracle',type=Path,required=True)
p.add_argument('--out',type=Path,required=True);args=p.parse_args()
reports={}
for project,prefix in [('slf4j','src/main/java/'),('commons','')]:
 facts=json.loads(getattr(args,project+'_facts').read_text());texts={f['path']:f['sourceText']for f in facts['files']}
 def offset(text,line,column):
  return len(''.join(text.splitlines(keepends=True)[:line-1]).encode('utf-16-le'))//2+column-1
 def location(text,off):
  prefix=text.encode('utf-16-le')[:off*2].decode('utf-16-le');return prefix.count('\n')+1,len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1
 index={}
 for row in getattr(args,project+'_oracle').read_text().splitlines():
  a=row.split('\t');file=prefix+base64.b64decode(a[0]).decode();target_file=prefix+base64.b64decode(a[3]).decode();name=base64.b64decode(a[5]).decode();line,column=location(texts[target_file],int(a[4]));index[(file,int(a[1]),int(a[2]))]={'file':target_file,'name':name,'line':line,'column':column}
 rows=[]
 for call in facts['calls']:
  if call['resolution']!='java-qualified-static-method':continue
  if prefix and not call['file'].startswith(prefix):status='outside-compiler-source-scope';expected=None
  else:
   key=(call['file'],offset(texts[call['file']],call['line'],call['column']),offset(texts[call['file']],call['endLine'],call['endColumn']));expected=index.get(key);status='compiler-agreed' if expected==call['target'] else 'compiler-disagreed'
  rows.append({'call':call,'expected':expected,'status':status})
 inventory={(c['file'],offset(texts[c['file']],c['line'],c['column']),offset(texts[c['file']],c['endLine'],c['endColumn'])):c for c in facts['calls']}
 known=[]
 for key,expected in index.items():
  actual=inventory.get(key)
  status='omitted-call' if actual is None else 'correct-target' if actual.get('target',{}).get('file',actual['file'])==expected['file'] and {**actual.get('target',{}),'file':actual.get('target',{}).get('file',actual['file'])}==expected else 'wrong-target' if actual.get('target') else 'missed-target'
  known.append({'file':key[0],'startUTF16':key[1],'endUTF16':key[2],'expected':expected,'actual':actual,'status':status})
 known_counts={k:sum(x['status']==k for x in known)for k in ['correct-target','wrong-target','missed-target','omitted-call']}
 reports[project]={'compilerKnownStaticSites':{'counts':known_counts,'units':known,'scope':'All successfully attributed project-source static calls in the chosen main-source graph; not all calls/runtime dispatch.'},'counts':{s:sum(r['status']==s for r in rows)for s in ['compiler-agreed','compiler-disagreed','outside-compiler-source-scope']},'units':rows,'compilerDiagnostics':'Compiler diagnostics must be checked independently before grading; this program does not establish successful attribution.','limits':'Supplemental post-design audit of emitted qualified targets only; not complete recall, runtime dispatch or general precision. Main source graphs only.'}
args.out.write_text(json.dumps(reports,indent=2)+'\n');print({k:v['counts']for k,v in reports.items()});assert not any(v['counts']['compiler-disagreed']for v in reports.values())
