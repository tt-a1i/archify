#!/usr/bin/env python3
"""Evaluate saved public CLI facts against a frozen Java source oracle."""
import argparse, base64, collections, hashlib, json, pathlib, re, subprocess, sys, datetime, zipfile, stat
HERE=pathlib.Path(__file__).resolve().parent
ORACLE=HERE/'oracle.json'
ORACLE_SHA='bc61d7769560713d87314233178db08cc7827aea5e48733d8a5991900eb6e622'
NODE='node'
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(root,*args): return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
def run(cmd, log):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    log.write_text(json.dumps({'argv':cmd,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr},indent=2))
    if p.returncode: raise RuntimeError(f'command failed: {log} (exit {p.returncode})')
def qual(identity):
    # Source parameters in oracle carry variable names; measured qualnames carry types.
    prefix,params=identity.split('(',1); cls,name=prefix.rsplit('.',1); params=re.sub(r'@\w+\s*', '', params[:-1])
    parts=[]; depth=0; token=''
    for c in params+',':
        if c=='<': depth+=1
        if c=='>': depth-=1
        if c==',' and not depth:
            if token.strip(): parts.append(re.sub(r'\s+\w+\s*$', '', token.strip()).replace(' ',''))
            token=''
        else: token+=c
    return cls.split('.')[-1]+'.'+name+'('+','.join(parts)+')'
def position(source, offset):
    # javac offsets and columns count UTF-16 code units, not Unicode code points.
    units=source.encode('utf-16-le')
    prefix=units[:offset*2].decode('utf-16-le')
    return (prefix.count('\n')+1, len(prefix.rsplit('\n',1)[-1].encode('utf-16-le'))//2+1)
def full_span(source, d):
    return (*position(source,d['start_utf16']),*position(source,d['end_utf16_exclusive']))
def location(c): return (c.get('line'),c.get('column'),c.get('endLine'),c.get('endColumn'))
def expected_span(c,source): return full_span(source,c['javac_invocation'])
def target_inventory(p,root,source,out,java):
    names=sorted({c['name'] for m in p['methods'] for c in m['calls'] if c['expected']=='target'})
    if not names: return []
    r=subprocess.run([java,'-cp',str(out),'CallOracle',str(root),p['path'],'parse',','.join(names)],text=True,capture_output=True)
    (out/(p['project']+'-'+p['revision']+'-declarations.log')).write_text(json.dumps({'argv':r.args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr},indent=2))
    if r.returncode: raise RuntimeError('javac declaration inventory failed')
    result=[]
    for line in r.stdout.splitlines():
        v=line.split('\t')
        if v[0]=='M':
            span=full_span(source,{'start_utf16':int(v[2]),'end_utf16_exclusive':int(v[3])})
            result.append({'name':v[1],'span':span,'start_utf16':int(v[2]),'end_utf16_exclusive':int(v[3]),'source_tree':base64.b64decode(v[4]).decode()})
    receipt={'oracle_sha256':sha(pathlib.Path(p['_oracle'])),'source_sha256':p['source_sha256'],'helper_sha256':sha(HERE/'CallOracle.java'),'declarations':result}
    receipt_path=out/(p['project']+'-'+p['revision']+'-declarations.json'); receipt_path.write_text(json.dumps(receipt,indent=2)+'\n'); (out/(receipt_path.name+'.sha256')).write_text(sha(receipt_path)+'\n')
    return result
def range_match(f,d,source):
    actual=f.get('sourceRange') or {}; span=full_span(source,d); data=source.encode('utf-16-le')[d['start_utf16']*2:d['end_utf16_exclusive']*2].decode('utf-16-le').encode('utf-8')
    return (actual.get('line'),actual.get('column'),actual.get('endLine'),actual.get('endColumn'))==span and actual.get('sha256')==hashlib.sha256(data).hexdigest()
def evaluate(p,m,facts,question,source,declarations):
    entry=p['entry']; declaration=full_span(source,m['javac_declaration']); funcs=facts.get('functions',[])
    caller=[f for f in funcs if f.get('file')==entry and f.get('name')==m['identity'].split('(')[0].split('.')[-1] and f.get('qualname')==qual(m['identity']) and (f.get('line'),f.get('endLine'))==(declaration[0],declaration[2]) and range_match(f,m['javac_declaration'],source)]
    lo,hi=m['body_start'],m['body_end_exclusive']; calls=facts.get('calls',[])
    candidates=[(i,c) for i,c in enumerate(calls) if c.get('file')==entry and (lo['line'],lo['column_utf16']) <= (c.get('line',-1),c.get('column',-1)) < (hi['line'],hi['column_utf16'])]
    q=question.get('calls') or {}; records=q.get('records') or []; used=set(); rows=[]
    for c in m['calls']:
        span=expected_span(c,source); exact=[(i,a) for i,a in candidates if location(a)==span and i not in used]
        row={'name':c['name'],'span':span,'expected':c['expected'],'inventory':'omitted','binding':'omitted','navigation':'omitted'}
        if len(exact)==1:
            i,a=exact[0]; used.add(i); row['inventory']='present'; t=a.get('target'); res=a.get('resolution'); row['observed_resolution']=res
            if len(caller)!=1: row['binding']='wrong_caller'
            elif not t and res in ('unresolved','unknown'): row['binding']='explicit_unknown'
            elif t and c['expected']=='unknown': row['binding']='unsupported_target'
            elif t:
                target=c['target']; expqual=qual(target['identity']+'('+target['signature'].split('(',1)[1]); ds=[d for d in declarations if d['name']==c['name'] and d['span'][0] <= target['declaration_line'] <= d['span'][2]]
                matching=[f for f in funcs if len(ds)==1 and f.get('file')==entry and f.get('name')==c['name'] and f.get('qualname')==expqual and (f.get('line'),f.get('endLine'))==(ds[0]['span'][0],ds[0]['span'][2]) and range_match(f,ds[0],source)]
                start=tuple(ds[0]['span']) if len(ds)==1 else None
                # same-file-static-method defines an omitted target.file as the caller file.
                good=len(matching)==1 and res=='same-file-static-method' and t.get('file',entry)==entry and (t.get('line'),t.get('column'))==start[:2] and t.get('name')==c['name']
                row['target_expected']={'file':entry,'qualname':expqual,'declaration_span':start}; row['target_observed']=t
                row['binding']='correct' if good else 'wrong'
                recs=[r for r in records if r.get('factIndex')==i]; nav=recs[0].get('targetNavigation',{}) if len(recs)==1 else {}; loc=nav.get('location') or {}
                selection=(q.get('selection') or {}).get('range') or {}; selected=(selection.get('line'),selection.get('column'),selection.get('endLine'),selection.get('endColumn'))==declaration
                valid=q.get('coverage')=='available' and selected and len(recs)==1 and recs[0].get('fact')==a and row['binding']=='correct' and nav.get('status')=='valid' and (loc.get('file'),loc.get('line'),loc.get('column'),loc.get('name'))==(entry,start[0],start[1],c['name'])
                row['navigation']='valid_correct' if valid else ('missing' if not recs or q.get('coverage')!='available' else 'wrong_or_stale')
            else: row['binding']='wrong'
        rows.append(row)
    extras=[a for i,a in candidates if i not in used]
    return {'method':m['identity'],'caller_matches':len(caller),'caller_declaration_span':declaration,'question_coverage':q.get('coverage'),'rows':rows,'extra_calls':extras,'counts':{key:dict(collections.Counter(r[key] for r in rows)) for key in ('inventory','binding','navigation')}}
def selfcheck():
    source='void g() {\n  obj.f();\n}\nvoid f() {}\n'; p={'entry':'C.java'}
    def off(s): return len(source[:source.index(s)].encode('utf-16-le'))//2
    c={'name':'f','javac_invocation':{'start_utf16':off('obj.f()'),'end_utf16_exclusive':off('obj.f()')+7},'expected':'target','target':{'identity':'p.C.f','declaration_line':4,'signature':'f()'}}
    m={'identity':'p.C.g()','body_start':{'line':1,'column_utf16':10},'body_end_exclusive':{'line':3,'column_utf16':2},'javac_declaration':{'start_utf16':0,'end_utf16_exclusive':off('}\n')+1},'calls':[c]}
    d=[{'name':'f','span':(4,1,4,12),'start_utf16':off('void f()'),'end_utf16_exclusive':len(source)-1}]; a={'file':'C.java','name':'f','line':2,'column':3,'endLine':2,'endColumn':10,'resolution':'same-file-static-method','target':{'file':'C.java','name':'f','line':4,'column':1}}
    facts={'calls':[a],'functions':[{'file':'C.java','name':'g','qualname':'C.g()','line':1,'endLine':3},{'file':'C.java','name':'f','qualname':'C.f()','line':4,'endLine':4}]}
    for f,decl in zip(facts['functions'],[m['javac_declaration'],d[0]]):
        sp=full_span(source,decl); part=source.encode('utf-16-le')[decl['start_utf16']*2:decl['end_utf16_exclusive']*2].decode('utf-16-le'); f['sourceRange']=dict(zip(('line','column','endLine','endColumn'),sp)); f['sourceRange']['sha256']=hashlib.sha256(part.encode()).hexdigest()
    q={'calls':{'coverage':'available','selection':{'range':dict(zip(('line','column','endLine','endColumn'),full_span(source,m['javac_declaration'])))},'records':[{'factIndex':0,'fact':a,'targetNavigation':{'status':'valid','location':{'file':'C.java','line':4,'column':1,'name':'f'}}}]}}
    get=lambda: evaluate(p,m,facts,q,source,d)['rows'][0]
    assert get()['binding']=='correct' and get()['navigation']=='valid_correct'
    assert evaluate(p,m,facts,q,source,json.loads(json.dumps(d)))['rows'][0]['binding']=='correct'
    annotated=source.replace('void f()', '@A\nvoid f()'); decorated=json.loads(json.dumps(d)); decorated[0].update(span=[4,1,5,12],end_utf16_exclusive=len(annotated)-1); oldtarget=c['target']['declaration_line']; c['target']['declaration_line']=5; fact=facts['functions'][1]; saved_end=fact['endLine']; saved_range=fact['sourceRange']; fact['endLine']=5; fragment=annotated[decorated[0]['start_utf16']:decorated[0]['end_utf16_exclusive']]; fact['sourceRange']={'line':4,'column':1,'endLine':5,'endColumn':12,'sha256':hashlib.sha256(fragment.encode()).hexdigest()}; assert evaluate(p,m,facts,q,annotated,decorated)['rows'][0]['binding']=='correct'; fact['endLine']=saved_end; fact['sourceRange']=saved_range; c['target']['declaration_line']=oldtarget
    a['column']=7; assert get()['inventory']=='omitted'; a['column']=3
    saved=facts['functions'][0].pop('sourceRange'); assert get()['binding']=='wrong_caller'; facts['functions'][0]['sourceRange']=saved
    c['expected']='unknown'; assert get()['binding']=='unsupported_target'; c['expected']='target'
    caller=facts['functions'].pop(0); assert get()['binding']=='wrong_caller'; facts['functions'].insert(0,caller)
    facts['functions'][1]['qualname']='C.f(int)'; assert get()['binding']=='wrong'; facts['functions'][1]['qualname']='C.f()'
    facts['functions'][1]['endLine']=5; assert get()['binding']=='wrong'; facts['functions'][1]['endLine']=4
    q['calls']['coverage']='unavailable'; assert get()['navigation']=='missing'; q['calls']['coverage']='available'
    q['calls']['records'][0]['targetNavigation']['status']='stale'; assert get()['navigation']=='wrong_or_stale'
    facts['calls']=[]; assert get()['binding']=='omitted'
    print('grader adversarial self-check passed')
def verify_archive(archive, digest, cli):
    archive=pathlib.Path(archive).resolve()
    if sha(archive)!=digest: raise RuntimeError('archive hash mismatch')
    root=cli.parents[1]
    if cli != root/'bin'/'archify.mjs' or root.name != 'archify':
        raise RuntimeError('CLI must be extracted archify/bin/archify.mjs')
    with zipfile.ZipFile(archive) as z:
        members={}
        for info in z.infolist():
            path=pathlib.PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0]!='archify' or info.filename in members:
                raise RuntimeError('invalid or duplicate archive member: '+info.filename)
            if info.is_dir(): continue
            if stat.S_ISLNK(info.external_attr >> 16): raise RuntimeError('archive symlink: '+info.filename)
            members[info.filename]=info
        if 'archify/bin/archify.mjs' not in members: raise RuntimeError('archive CLI missing')
        for name,info in members.items():
            target=root.joinpath(*pathlib.PurePosixPath(name).parts[1:])
            if target.is_symlink() or not target.is_file() or target.read_bytes()!=z.read(info):
                raise RuntimeError('archive member mismatch: '+name)
        for path in root.rglob('*'):
            relative=path.relative_to(root)
            if 'node_modules' in relative.parts: continue
            if path.is_symlink(): raise RuntimeError('unexpected symlink: '+str(relative))
            if path.is_file() and 'archify/'+relative.as_posix() not in members:
                raise RuntimeError('extra extracted file: '+str(relative))
        return len(members)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--cli'); ap.add_argument('--name'); ap.add_argument('--product-sha'); ap.add_argument('--archive'); ap.add_argument('--archive-sha'); ap.add_argument('--self-check',action='store_true'); ap.add_argument('--oracle',default=str(ORACLE)); ap.add_argument('--oracle-sha',default=ORACLE_SHA); ap.add_argument('--node',default=NODE); ap.add_argument('--output',default='.'); ap.add_argument('--slf4j-base'); ap.add_argument('--slf4j-head'); ap.add_argument('--guava'); ap.add_argument('--java',default='java'); a=ap.parse_args()
    if a.self_check: selfcheck(); return
    if not all([a.cli,a.name,a.product_sha]): ap.error('--cli, --name and --product-sha required')
    if not re.fullmatch(r'[A-Za-z0-9_-]+',a.name): ap.error('invalid name')
    oracle=pathlib.Path(a.oracle).resolve(); node=a.node
    if sha(oracle)!=a.oracle_sha: raise RuntimeError('oracle hash mismatch')
    cli=pathlib.Path(a.cli).resolve(); repo=cli.parents[2]
    if bool(a.archive)!=bool(a.archive_sha): ap.error('--archive and --archive-sha must be supplied together')
    if a.archive: verify_archive(a.archive,a.archive_sha,cli)
    elif git(repo,'rev-parse','HEAD')!=a.product_sha or git(repo,'status','--porcelain','--untracked-files=all'): raise RuntimeError('product commit mismatch or dirty product')
    if not all([a.slf4j_base,a.slf4j_head,a.guava]): ap.error('--slf4j-base, --slf4j-head and --guava are required')
    out=pathlib.Path(a.output).resolve()/a.name; out.mkdir(parents=True,exist_ok=False); manifest=json.loads(oracle.read_text()); report=[]
    run([str(pathlib.Path(a.java).with_name('javac')),'-d',str(out),str(HERE/'CallOracle.java')],out/'oracle-compile.log')
    (out/'inputs.json').write_text(json.dumps({'oracle_sha256':a.oracle_sha,'cli':str(cli),'product_sha':a.product_sha,'archive':a.archive,'archive_sha':a.archive_sha,'node':node,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2))
    projects=[]
    # Freeze the supplemental javac declaration inventory before any analyzer runs.
    for orig in manifest['projects']:
        p=dict(orig); p['_oracle']=str(oracle); override={'slf4j-base':a.slf4j_base,'slf4j-head':a.slf4j_head,'guava-head':a.guava}[p['project']+'-'+p['revision']]; root=pathlib.Path(override).resolve(); source=root/p['path']
        if git(root,'rev-parse','HEAD')!=p['commit'] or sha(source)!=p['source_sha256'] or git(root,'status','--porcelain','--untracked-files=all','--','*.java'): raise RuntimeError('source integrity mismatch or dirty Java files: '+str(root))
        analysis_root=root/'guava/src' if p['project']=='guava' else root
        p['entry']=str(source.relative_to(analysis_root)); ident=p['project']+'-'+p['revision']; source_text=source.read_text()
        declarations=target_inventory(p,root,source_text,out,a.java)
        projects.append((p,root,source,analysis_root,ident,source_text,declarations))
    for p,root,source,analysis_root,ident,source_text,declarations in projects:
        dest=out/ident
        run([node,str(cli),'code-analysis','check',str(analysis_root),'--language','java','--fail-on','never','--json','--out',str(dest)],out/(ident+'-check.log'))
        facts=json.loads((dest/'raw-facts.json').read_text())
        for i,m in enumerate(p['methods']):
            task=out/(ident+'-task-'+str(i)+'.json')
            run([node,str(cli),'code-analysis','task',str(dest),'--question','Which calls occur in this method?','--entry',p['entry'],'--function',qual(m['identity']),'--root',str(analysis_root),'--format','json','--out',str(task),'--json'],out/(ident+'-task-'+str(i)+'.log'))
            report.append(evaluate(p,m,facts,json.loads(task.read_text()),source_text,declarations))
        if git(root,'rev-parse','HEAD')!=p['commit'] or sha(source)!=p['source_sha256'] or git(root,'status','--porcelain','--untracked-files=all','--','*.java'): raise RuntimeError('source changed during run')
    if a.archive: verify_archive(a.archive,a.archive_sha,cli)
    elif git(repo,'rev-parse','HEAD')!=a.product_sha or git(repo,'status','--porcelain','--untracked-files=all'): raise RuntimeError('product changed during run')
    (out/'report.json').write_text(json.dumps(report,indent=2)); print(json.dumps([{k:v for k,v in r.items() if k not in ('rows','extra_calls')} | {'extra_count':len(r['extra_calls'])} for r in report],indent=2))
if __name__=='__main__': main()
