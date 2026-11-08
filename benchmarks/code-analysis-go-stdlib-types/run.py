"""Replay SDK typing questions using the normal source or extracted ZIP CLI."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli,a.samples_root,a.out=a.cli.resolve(),a.samples_root.resolve(),a.out.resolve();a.out.mkdir(parents=True,exist_ok=True)
here=Path(__file__).resolve().parent;previous=here.parent/'code-analysis-go-concrete-methods';frozen=json.loads((here/'source-first.json').read_text());original=json.loads((previous/'source-first.json').read_text());grpc=json.loads((previous/'reserved-grpc.json').read_text());pair=json.loads((previous/'version-pair.json').read_text());oracle=json.loads((previous/'evidence/compiler-audit.json').read_text());commands=[];facts={}
for project,meta in {**original['projects'],'grpc-go':grpc,'chi-base':pair['sides']['base']}.items():
 root=a.samples_root/project
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==meta['revision']
 for file,digest in meta['hashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest,(project,file)
for project in ['cobra','chi','grpc-go']:
 for file,digest in oracle[project]['sourceDigests'].items():assert hashlib.sha256((a.samples_root/project/file).read_bytes()).hexdigest()==digest
def run(label,args,expected=0):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];start=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True)
 commands.append({'label':label,'command':cmd,'exit':r.returncode,'seconds':time.monotonic()-start});(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr)
 assert r.returncode==expected,(label,r.returncode,r.stdout[:1000],r.stderr[:1000])
for project in ['chi','grpc-go','cobra']:
 run(project+'-check',['check',a.samples_root/project,'--language','go','--fail-on','never','--out',a.out/project,'--json'])
 f=json.loads((a.out/project/'raw-facts.json').read_text());facts[project]=f
 assert f['callModel']==('go-source-direct-v3'if a.expect=='candidate'else'go-source-direct-v2')
units=[]
def point(x):return tuple(x[k]for k in ['file','line','column','endLine','endColumn'])
def target(x):
 t=x.get('target');return{**t,'file':t.get('file',x['file'])}if t else None
for project in ['chi','grpc-go']:
 known=json.loads((previous/'evidence'/oracle[project]['knownMissesFile']).read_text());calls={point(c):c for c in facts[project]['calls']}
 for case in known:
  actual=calls[point(case['call'])];status='correct'if target(actual)==case['compilerTarget']else'wrong'if target(actual)else'missed'
  assert status==('correct'if a.expect=='candidate'else'missed'),(project,actual,case['compilerTarget'])
  units.append({'project':project,'call':actual,'sourceKnownTarget':case['compilerTarget'],'status':status,'basis':'Earlier fixed full compiler oracle; source hashes rechecked; reserved gRPC not tuned in first Chi SDK prototype.'})
for line in [73,90]:
 call=next(c for c in facts['chi']['calls']if c['file']=='mux.go'and c['line']==line);assert not target(call)
 units.append({'project':'chi','call':call,'status':'reasonable-unknown','basis':'http.Handler interface dispatch, not an arbitrary concrete method body'})
questions={}
for project,entry,function,wanted in [('chi','mux.go','*Mux.ServeHTTP','Reset'),('chi','mux.go','*Mux.Mount','NotFound'),('grpc-go','picker_wrapper.go','*pickerWrapper.pick','getReadyTransport'),('cobra','doc/util.go','hasSeeAlso','HasParent')]:
 label='question-'+project+'-'+wanted;dest=a.out/(label+'.json')
 run(label,['task',a.out/project,'--root',a.samples_root/project,'--entry',entry,'--function',function,'--question','Where does this known concrete method lead?','--format','json','--out',dest,'--json'])
 q=json.loads(dest.read_text());rows=[r for r in q['calls']['records']if r['fact'].get('target',{}).get('name')==wanted]
 if a.expect=='candidate' or project=='cobra':assert rows and all(r['targetNavigation']['status']=='valid'for r in rows),(project,wanted)
 else:assert not rows
 questions[label]={'total':q['calls']['total'],'included':q['calls']['included'],'omitted':q['calls']['omitted'],'selectedTargetShown':len(rows),'validTargets':sum(r['targetNavigation']['status']=='valid'for r in rows)}
# Retain the prior actual changed Match investigation as a regression, not a new
# body-change claim about Reset (whose body is unchanged in this pair).
paired=a.out/'paired.json';run('paired',['task','--base-root',a.samples_root/'chi-base','--root',a.samples_root/'chi','--entry','mux.go','--question','Which known callers reach changed Mux.Match?','--format','json','--out',paired,'--json'],expected=1)
q=json.loads(paired.read_text());changed=next(d for d in q['changedDefinitions']['items']if d.get('head',{}).get('definition',{}).get('qualname')=='*Mux.Match')
for side in ['base','head']:
 expected=pair['sides'][side]['selectedCallers'];refs=changed[side]['knownReferences'];assert refs['total']==len(expected);assert all(r['navigation']['status']=='valid'for r in refs['items'])
if a.expect=='candidate':
 disabled=a.out/'stdlib-disabled.json';disabled.write_text(json.dumps({'go':{'stdlib':False}})+'\n');run('disabled-check',['check',a.samples_root/'chi','--language','go','--config',disabled,'--fail-on','never','--out',a.out/'disabled','--json'])
 f=json.loads((a.out/'disabled/raw-facts.json').read_text());assert f['languageScope']['standardLibrary']['mode']=='disabled'
 for case in frozen['cases']:assert not next(c for c in f['calls']if all(c[k]==case[k]for k in ['file','line','column'])).get('target')
 dest=a.out/'question-disabled.json';run('question-disabled',['task',a.out/'disabled','--root',a.samples_root/'chi','--entry','mux.go','--function','*Mux.ServeHTTP','--question','What remains unknown without SDK types?','--format','json','--out',dest,'--json']);assert json.loads(dest.read_text())['calls']['bindingCoverage']=='go-types-direct-functions-and-concrete-methods-with-sdk-types-disabled'
report={'expect':a.expect,'commands':commands,'score':{s:sum(u['status']==s for u in units)for s in ['correct','wrong','missed','reasonable-unknown']},'units':units,'questions':questions,'paired':{'status':q['status'],'references':{side:changed[side]['knownReferences']for side in ['base','head']}},'scope':{p:{'model':f['callModel'],'files':len(f['files']),'calls':len(f['calls']),'parseErrors':f.get('parse_errors',[]),'build':f['languageScope']['build'],'typing':f['languageScope']['typing'],'standardLibrary':f['languageScope'].get('standardLibrary')}for p,f in facts.items()},'limits':['37 already known misses in exposed repositories, not a new blind corpus or whole-project precision/recall.','Prototype and accepted CLI observations overlap the original full compiler cohort.','Paired Match is a reused regression; Reset body is unchanged in that pair.','Checks deliberately use fail-on never; exit zero does not mean no findings.']}
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'score':report['score'],'paired':{s:changed[s]['knownReferences']['total']for s in ['base','head']}}))
