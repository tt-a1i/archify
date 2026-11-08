#!/usr/bin/env python3
"""Attribute every new candidate to the independent complete-source javac output."""
import argparse,base64,json,re
from pathlib import Path
p=argparse.ArgumentParser()
for name in ['baseline','candidate','sample','compiler','diagnostics','out']:p.add_argument('--'+name,required=True,type=Path)
p.add_argument('--exclude-source',action='append',default=[]);p.add_argument('--compiler-prefix',default='');a=p.parse_args();b=json.loads(a.baseline.read_text());c=json.loads(a.candidate.read_text())
texts={f['path']:f['sourceText'] for f in c['files']}
def verify():
 for file,text in texts.items():assert (a.sample/file).read_bytes().decode('utf8')==text,file
verify()
diagnostics=a.diagnostics.read_text();match=re.search(r'FILES\t(\d+)\tERRORS\t0\s*$',diagnostics);assert match,diagnostics[-1000:]
expectedFiles=sum(file.startswith(a.compiler_prefix) and file not in a.exclude_source and not file.endswith('module-info.java') for file in texts);assert int(match[1])==expectedFiles,(match[1],expectedFiles)
def offset(text,line,column):return len(''.join(text.splitlines(keepends=True)[:line-1]).encode('utf-16-le'))//2+column-1
def point(text,offset):
 prefix=text.encode('utf-16-le')[:offset*2].decode('utf-16-le');return prefix.count('\n')+1,len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1
index={}
for row in a.compiler.read_text().splitlines():
 x=row.split('\t');file=a.compiler_prefix+base64.b64decode(x[0]).decode();target=a.compiler_prefix+base64.b64decode(x[3]).decode();line,column=point(texts[target],int(x[4]))
 index[(file,int(x[1]),int(x[2]))]=dict(file=target,line=line,column=column,name=base64.b64decode(x[5]).decode())
key=lambda r:tuple(r[k] for k in ['file','line','column','endLine','endColumn'])
old={key(r):r for r in b['calls']};rows=[]
for call in c['calls']:
 if not call.get('target') or old[key(call)].get('target'):continue
 expected=index.get((call['file'],offset(texts[call['file']],call['line'],call['column']),offset(texts[call['file']],call['endLine'],call['endColumn'])))
 status='agree' if expected==call['target'] else 'different' if expected else 'unavailable'
 rows.append(dict(call=call,compiler=expected,status=status))
verify();report=dict(counts={s:sum(r['status']==s for r in rows) for s in ['agree','different','unavailable']},compilerDiagnostics=diagnostics,capturedSourceFiles=len(texts),compilerSourceFiles=expectedFiles,compilerPrefix=a.compiler_prefix,compilerExcludedSources=a.exclude_source,method='Independent javac17 parse/analyze chosen source graph with pinned test dependency classpath; -proc:none, no emit/project execution.',rows=rows,limits=['Selected four calls are included in this denominator.','Definition agreement is not runtime dispatch, complete impact or total recall.'])
a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']))
assert report['counts']['different']==report['counts']['unavailable']==0
