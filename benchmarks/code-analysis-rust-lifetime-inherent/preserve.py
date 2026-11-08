#!/usr/bin/env python3
"""Compare unchanged source/call identity and review newly bound nominal imports."""
import argparse,hashlib,json,re
from pathlib import Path
p=argparse.ArgumentParser()
for n in ['baseline','candidate','sample','out']:p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args();b=json.loads(a.baseline.read_text());c=json.loads(a.candidate.read_text());texts={x['path']:x['sourceText']for x in c['files']}
for file,text in texts.items():assert (a.sample/file).read_bytes().decode('utf8')==text,file
for field in ['files','functions','parse_errors','packageMarkers']:assert b.get(field)==c.get(field),field
key=lambda x:tuple(x[k]for k in ['file','line','column','endLine','endColumn']);old={key(x):x for x in b['calls']};assert len(old)==len(c['calls']);new=[]
for call in c['calls']:
 before=old[key(call)]
 if before.get('target'):assert before['target']==call.get('target'),call
 elif call.get('target'):new.append(call)
ikey=lambda x:(x['from'],x.get('line'),x['specifier'],x.get('kind'),tuple(x.get('names',[])));oldi={ikey(x):x for x in b['imports']};assert len(b['imports'])==len(c['imports']);imports=[]
for item in c['imports']:
 before=oldi[ikey(item)]
 if before==item:continue
 assert not before['resolved']and item['resolved']and item['to']in texts
 name=item['specifier'].split('::')[-1];matches=list(re.finditer(r'(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum)\s+('+re.escape(name)+r')\b',texts[item['to']]));assert len(matches)==1,(name,item['to'])
 offset=matches[0].start(1);prefix=texts[item['to']][:offset];line=prefix.count('\n')+1;column=len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1
 statement='\n'.join(texts[item['from']].splitlines()[item['line']-1:]).split(';',1)[0]+';';assert re.search(r'\b'+re.escape(name)+r'\b',statement)
 imports.append(dict(before=before,after=item,sourceStatement=statement,targetSource=dict(file=item['to'],line=line,column=column,name=name,text=texts[item['to']].splitlines()[line-1]),verification='Post-design fixed-source nominal declaration/import spelling review; not independent LSP attribution or blind evaluation.'))
report=dict(newCallCandidates=len(new),preservedTargets=sum(bool(x.get('target'))for x in b['calls']),callRanges=len(c['calls']),files=len(c['files']),functions=len(c['functions']),parseErrors=c.get('parse_errors',[]),importRecords=len(c['imports']),newBoundImports=len(imports),newCalls=new,importSourceReview=imports,sourceReviewLimits='Source spelling/declaration match for these fixed nominals; no standalone type/module graph compilation claim.',projectExecuted=False);a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k not in ['newCalls','importSourceReview']}))
