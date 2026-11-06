import pathlib,json,hashlib,sys,os
D=pathlib.Path(os.environ['REPLAY_OUTPUTS']);a=D/sys.argv[1];b=D/sys.argv[2]
result={'source':str(a),'archive':str(b),'raw_facts':{},'commands':{},'questions':{},'paired':{},'normalization':'CLI and per-run output paths in command argv; rawFactsPath and absolute workflow in result JSON; no other result fields'}
def norm(x):
 if isinstance(x,dict):return {k:('<RUN_SPECIFIC_PATH>' if k=='rawFactsPath' or (k=='workflow' and isinstance(v,str) and v.startswith('/')) else norm(v)) for k,v in x.items()}
 if isinstance(x,list):return [norm(v) for v in x]
 return x
ids=[f'check-{p}-{s}' for p in ('redux','commander','pluggy','httpx','slf4j','guava','pandas') for s in ('base','head') if s=='head' or p not in ('guava','pandas')]+[f'question-{i}' for i in range(10)]+['paired-'+p for p in ('redux','commander','httpx','pluggy','slf4j')]
for id in ids:
 da,db=a/id,b/id;ca=json.loads((da/'command.json').read_text());cb=json.loads((db/'command.json').read_text())
 def argv(c,root):return ['<CLI>' if i==1 else str(x).replace(str(root.resolve()),'<OUTPUT>') for i,x in enumerate(c['argv'])]
 sa=json.loads((da/'stdout').read_text());sb=json.loads((db/'stdout').read_text())
 # Status and the error receipt must agree; successful receipt paths may differ.
 same=ca['exit']==cb['exit'] and argv(ca,a)==argv(cb,b) and sa.get('status')==sb.get('status')
 if sa.get('status')=='error':same=same and sa==sb
 result['commands'][id]={'equal':same,'exit_source':ca['exit'],'exit_archive':cb['exit'],'status_source':sa.get('status'),'status_archive':sb.get('status')}
 if id.startswith('check-'):
  x=da/'capture/raw-facts.json';y=db/'capture/raw-facts.json';one=x.read_bytes();two=y.read_bytes();result['raw_facts'][id]={'source_sha256':hashlib.sha256(one).hexdigest(),'archive_sha256':hashlib.sha256(two).hexdigest(),'byte_equal':one==two}
 else:
  x=da/'result.json';y=db/'result.json'; exists=(x.exists(),y.exists()); diagnostics=sa.get('diagnostics',[])
  unsupported_option=any(d.get('code')=='cli/usage' and any('Invalid option: '+opt in d.get('message','') for opt in ('--question','--base-root')) for d in diagnostics)
  unsupported_entry=id in ('paired-httpx','paired-pluggy','paired-slf4j') and any(d.get('code')=='task/entry-invalid' and d.get('message')=='Pass a repository-relative JS/TS source file with --entry.' for d in diagnostics)
  unsupported=not any(exists) and ca['exit']==2 and sa.get('status')=='error' and same and (unsupported_option or unsupported_entry)
  equal=(all(exists) and norm(json.loads(x.read_text()))==norm(json.loads(y.read_text()))) or unsupported
  result['questions' if id.startswith('question-') else 'paired'][id]={'normalized_equal':bool(equal),'present_source':exists[0],'present_archive':exists[1],'matching_unsupported_receipts':unsupported}
path=D/(sys.argv[1]+'-vs-'+sys.argv[2]+'.json');path.write_text(json.dumps(result,indent=2)+'\n')
if any(not x.get('equal',x.get('byte_equal',x.get('normalized_equal',False))) for category in ('commands','raw_facts','questions','paired') for x in result[category].values()):raise SystemExit('equivalence failed; inspect '+str(path))
print('PASS 27 command exits/statuses, 12 raw facts, 10 questions and 5 paired results or matching unsupported receipts')
