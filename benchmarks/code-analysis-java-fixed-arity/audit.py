"""Compare newly emitted arity targets against successful javac main-source attribution."""
import argparse,base64,json,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--candidate',type=Path,required=True);p.add_argument('--oracles',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();reports={}
def offset(text,line,column):return len(''.join(text.splitlines(keepends=True)[:line-1]).encode('utf-16-le'))//2+column-1
def location(text,off):
 prefix=text.encode('utf-16-le')[:off*2].decode('utf-16-le');return prefix.count('\n')+1,len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1
for project,short,prefix in [('commons-lang','commons','src/main/java/'),('slf4j','slf4j','slf4j-api/src/main/java/')]:
 diagnostics=(a.oracles/(short+'.log')).read_text();assert re.search(r'FILES\t\d+\tERRORS\t0\s*$',diagnostics),diagnostics[-1000:]
 before=json.loads((a.baseline/project/'raw-facts.json').read_text());facts=json.loads((a.candidate/project/'raw-facts.json').read_text());texts={f['path']:f['sourceText']for f in facts['files']};index={}
 for row in(a.oracles/(short+'.tsv')).read_text().splitlines():
  x=row.split('\t');file=prefix+base64.b64decode(x[0]).decode();to=prefix+base64.b64decode(x[3]).decode();line,column=location(texts[to],int(x[4]));index[(file,int(x[1]),int(x[2]))]={'file':to,'line':line,'column':column,'name':base64.b64decode(x[5]).decode()}
 key=lambda c:tuple(c[k]for k in ['file','line','column','endLine','endColumn']);old={key(c):c for c in before['calls']};rows=[]
 for call in facts['calls']:
  if not call.get('target')or old[key(call)].get('target'):continue
  expected=None
  if not call['file'].startswith(prefix):status='outside-compiler-source-scope'
  else:
   expected=index.get((call['file'],offset(texts[call['file']],call['line'],call['column']),offset(texts[call['file']],call['endLine'],call['endColumn'])));actual={**call['target'],'file':call['target'].get('file',call['file'])};status='compiler-agreed'if actual==expected else'compiler-disagreed'
  rows.append({'call':call,'expected':expected,'status':status})
 reports[project]={'counts':{s:sum(r['status']==s for r in rows)for s in ['compiler-agreed','compiler-disagreed','outside-compiler-source-scope']},'compilerDiagnostics':diagnostics,'rows':rows,'limits':['Only newly emitted targets in the chosen main-source graph receive compiler attribution.','Out-of-scope records require separate source review, not an automatic compiler correctness grade.','No project bytecode generation, execution or annotation processor; attribution does not prove runtime dispatch or whole-project recall.']}
a.out.write_text(json.dumps(reports,indent=2)+'\n');print({p:r['counts']for p,r in reports.items()});assert all(r['counts']['compiler-disagreed']==0 for r in reports.values())
