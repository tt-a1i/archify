"""Replay fixed Rust source questions; never build or execute sample code.

Original evidence is manifest.json; extra use/use-as observations are disclosed
supplemental observations, not a blind holdout or whole-repository accuracy.
"""
import argparse, hashlib, json, pathlib, subprocess, time
p=argparse.ArgumentParser()
p.add_argument('--cli',type=pathlib.Path,required=True);p.add_argument('--node',default='node')
p.add_argument('--samples-root',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True)
a=p.parse_args();a.cli=a.cli.resolve();a.samples_root=a.samples_root.resolve();a.out=a.out.resolve()
assert a.out!=a.samples_root and a.samples_root not in a.out.parents
a.out.mkdir(parents=True,exist_ok=True)
m=json.loads((pathlib.Path(__file__).parent/'manifest.json').read_text());projects={x['project']:x for x in m['projects'] if x['language']=='rust'}
commands=[];facts={};results=[]
def run(label,arguments,expected=0):
 cmd=[a.node,str(a.cli),'code-analysis',*map(str,arguments)];start=time.monotonic();r=subprocess.run(cmd,text=True,capture_output=True)
 (a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr)
 commands.append({'label':label,'command':cmd,'exit':r.returncode,'seconds':time.monotonic()-start})
 assert r.returncode==expected,(label,r.returncode,r.stdout[:1000],r.stderr[:1000]);return json.loads(r.stdout)
for name in ['regex-base','regex','serde-json-base','serde-json']:
 project=projects[name.removesuffix('-base')];side='base' if name.endswith('-base') else 'head';root=a.samples_root/name
 actual=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip();assert actual==project[side]
 for entry in project['expected_evidence'][side]:assert hashlib.sha256((root/entry['file']).read_bytes()).hexdigest()==entry['sha256'],(name,entry['file'])
 profiles=['default','float'] if name.startswith('serde') else ['default']
 for profile in profiles:
  key=name+('-float' if profile=='float' else '');config=a.out/(key+'-config.json')
  config.write_text(json.dumps({'rust':{'offline':True,**({'features':{'serde_json':['float_roundtrip']}} if profile=='float' else {})}}))
  run(key+'-check',['check',root,'--language','rust','--config',config,'--fail-on','never','--out',a.out/key,'--json'])
  facts[key]=json.loads((a.out/key/'raw-facts.json').read_text())
def check(key,file,line,needle,target_file=None,target_line=None,target_name=None,exposure='original-frozen'):
 root=a.samples_root/key.removesuffix('-float');text=(root/file).read_text().splitlines()[line-1];column=text.index(needle)+1
 rows=[c for c in facts[key]['calls'] if c['file']==file and c['line']==line and c['column']==column and c['endLine']==line]
 expected=None
 if target_file:
  # Rust attributes belong to definitions; direct target starts at the fn token.
  target_text=(root/target_file).read_text().splitlines()[target_line-1];prefix=target_text[:target_text.index('fn ')];column_target=len(prefix)-len(prefix.lstrip())+1
  expected={'file':target_file,'name':target_name,'line':target_line,'column':column_target}
 actual={**rows[0]['target'],'file':rows[0]['target'].get('file',file)} if len(rows)==1 and rows[0].get('target') else None
 status='omitted-call' if len(rows)!=1 else 'wrong-target' if actual and actual!=expected else 'missed-target' if expected and not actual else 'correct-target' if expected else 'reasonable-unknown'
 results.append({'project':key,'file':file,'line':line,'column':column,'needle':needle,'expected':expected,'actual':actual,'status':status,'reason':rows[0].get('reason') if len(rows)==1 else None,'exposure':exposure})
check('regex-base','regex-syntax/src/lib.rs',252,'unicode::is_word_character(', 'regex-syntax/src/unicode.rs',400,'is_word_character')
check('regex','regex-syntax/src/lib.rs',369,'unicode::is_word_character(', 'regex-syntax/src/unicode.rs',463,'is_word_character')
check('regex','src/lib.rs',1345,'regex_syntax::escape(', 'regex-syntax/src/lib.rs',201,'escape')
for line in [364,365]:check('regex','regex-automata/src/dfa/special.rs',line,'write::<E>(', 'regex-automata/src/util/wire.rs',663,'write_state_id','supplemental-exposed-use-as')
for line in [1588,1603]:check('regex','regex-automata/src/util/look.rs',line,'try_is_word_character(', 'regex-syntax/src/lib.rs',366,'try_is_word_character','supplemental-exposed-use')
for name in ['serde-json-base','serde-json']:
 check(name+'-float','src/lexical/parse.rs',18,'fast_path(', 'src/lexical/algorithm.rs',18,'fast_path')
 check(name+'-float','src/lexical/algorithm.rs',24,'F::exponent_limit(')
 assert not any(f['path'].startswith('src/lexical/') for f in facts[name]['files'])
 assert any(f['path']=='src/lexical/parse.rs' for f in facts[name+'-float']['files'])
question=a.out/'regex-question.json'
run('regex-question',['task',a.out/'regex','--root',a.samples_root/'regex','--entry','regex-syntax/src/lib.rs','--function','try_is_word_character','--question','Where does unicode::is_word_character resolve?','--format','json','--out',question,'--json'])
q=json.loads(question.read_text());assert any(r.get('targetNavigation',{}).get('status')=='valid' and r['fact'].get('target',{}).get('name')=='is_word_character' for r in q['calls']['records'])
paired={}
for name,entry,symbol,caller_file,caller_line in [('regex','regex-syntax/src/unicode.rs','is_word_character','regex-syntax/src/lib.rs',369),('serde-json','src/lexical/algorithm.rs','fast_path','src/lexical/parse.rs',18)]:
 out=a.out/(name+'-paired.json');arguments=['task','--root',a.samples_root/name,'--base-root',a.samples_root/(name+'-base'),'--entry',entry,'--question','Which known calls reach this changed definition?','--format','json','--out',out,'--json']
 if name=='serde-json':arguments+=['--config',a.out/'serde-json-float-config.json']
 run(name+'-paired',arguments,expected=1)
 data=json.loads(out.read_text());changed=next(row for row in data['changedDefinitions']['items'] if row.get('head',{}).get('definition',{}).get('name')==symbol)
 for side in ['base','head']:
  refs=changed[side]['knownReferences'];assert refs['coverage']=='available'
  line=252 if name=='regex' and side=='base' else caller_line
  assert any(r['fact']['file']==caller_file and r['fact']['line']==line and r['navigation']['status']=='valid' for r in refs['items'])
 paired[name]={'status':data['status'],'knownReferences':{side:changed[side]['knownReferences'] for side in ['base','head']},'limits':data.get('limitations',[]),'comparison':data.get('comparison')}
summary={k:sum(r['status']==k for r in results)for k in ['correct-target','wrong-target','missed-target','omitted-call','reasonable-unknown']}
def scope(f):
 s=f['languageScope'];return {'files':len(f['files']),'functions':len(f['functions']),'calls':len(f['calls']),'parseErrors':f.get('parse_errors',[]),'macroRecords':len(s['opaqueMacros']),'conditionalDefinitions':len(s['conditionalDefinitions']),'build':s['build'],'crates':s['crates'],'excludedFiles':s['excludedFiles'],'excludedTargets':s['excludedTargets'],'excludedRegionCount':len(s['excludedRegions']),'missingModules':s['missingModules'],'metadata':[{'file':x['file'],'sha256':x['sha256']}for x in s['metadata']]}
report={'commands':commands,'score':summary,'units':results,'paired':paired,'scope':{k:scope(f)for k,f in facts.items()},'limits':['Finite versioned observations, not unique sites or general precision.','serde_json reserved from initial tuning; source previously inspected to freeze expectations.','Use/use-as observations were supplemental and exposed during implementation.','Partial paired profiles do not prove equivalent Cargo builds or complete references.']}
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'score':summary,'paired':{k:v['status']for k,v in paired.items()}}))
assert not any(summary[k]for k in ['wrong-target','missed-target','omitted-call'])
