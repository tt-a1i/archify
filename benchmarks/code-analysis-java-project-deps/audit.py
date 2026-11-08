#!/usr/bin/env python3
"""Compare new direct-project targets with independent javac source attribution."""
import argparse,base64,json,re
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['baseline','candidate','sample','compiler','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args();b=json.loads(a.baseline.read_text());c=json.loads(a.candidate.read_text());scope=json.loads((a.compiler/'receipt.json').read_text());log=(a.compiler/'compiler.log').read_text();assert scope['exit']==0 and re.search(r'FILES\t77\tERRORS\t0\s*$',log)
texts={x['path']:x['sourceText'] for x in c['files']}
for file,text in texts.items():assert (a.sample/file).read_bytes().decode('utf8')==text,file
key=lambda r:tuple(r[k] for k in ['file','line','column','endLine','endColumn'])
def offset(text,line,column):return len(''.join(text.splitlines(keepends=True)[:line-1]).encode('utf-16-le'))//2+column-1
def point(text,n):
 prefix=text.encode('utf-16-le')[:n*2].decode('utf-16-le');return prefix.count('\n')+1,len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1
index={}
for row in (a.compiler/'compiler.tsv').read_text().splitlines():
 x=row.split('\t');file=base64.b64decode(x[0]).decode();target=base64.b64decode(x[3]).decode();line,column=point(texts[target],int(x[4]));index[(file,int(x[1]),int(x[2]))]=dict(file=target,line=line,column=column,name=base64.b64decode(x[5]).decode())
old={key(x):x for x in b['calls']};assert len(old)==len(c['calls']);rows=[];preserved=0
for call in c['calls']:
 before=old[key(call)]
 if before.get('target'):assert before['target']==call.get('target');preserved+=1
 if call.get('target') and not before.get('target'):
  expected=index.get((call['file'],offset(texts[call['file']],call['line'],call['column']),offset(texts[call['file']],call['endLine'],call['endColumn'])))
  rows.append(dict(call=call,compiler=expected,status='agree' if expected==call['target'] else 'different' if expected else 'unavailable'))
for field in ['files','imports','functions','parse_errors','packageMarkers']:assert b.get(field)==c.get(field),field
report=dict(counts={s:sum(r['status']==s for r in rows) for s in ['agree','different','unavailable']},preservedTargets=preserved,callRanges=len(old),files=len(c['files']),functions=len(c['functions']),metadataFiles=len(c['languageScope']['metadata']),metadataBytes=sum(len(x['sourceText'].encode('utf8')) for x in c['languageScope']['metadata']),evidenceAttached=sum(bool(x.get('buildEvidence')) for x in c['calls']),compilerScope=scope,compilerDiagnostics=log,rows=rows,limits=['Two frozen design calls are the entire new-target denominator; not an additional independent sample.','Two reserved preservation cases already resolved before this rule.','Compiler checks a selected 77-file API/Simple graph, not all 260 source files or the built Maven/runtime classpath.'],projectExecuted=False)
assert report['counts']==dict(agree=2,different=0,unavailable=0);a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['counts','preservedTargets','metadataFiles','metadataBytes','evidenceAttached']}))
