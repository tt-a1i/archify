"""Replay the fixed Java arity questions through normal source/extracted CLI."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli,a.samples_root,a.out=a.cli.resolve(),a.samples_root.resolve(),a.out.resolve();a.out.mkdir(parents=True,exist_ok=True)
here=Path(__file__).resolve().parent;manifest=json.loads((here/'source-first.json').read_text());commands=[];facts={}
for project,meta in manifest['projects'].items():
 root=a.samples_root/project;assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==meta['revision']
 for file,digest in meta['hashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest
 def freeze(file):return hashlib.sha256((root/file).read_bytes()).hexdigest()
def run(label,args,expected=0):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];start=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True);commands.append({'label':label,'command':cmd,'exit':r.returncode,'seconds':time.monotonic()-start});(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==expected,(label,r.returncode,r.stdout[:700],r.stderr[:700])
for project in ['commons-lang','slf4j']:
 run(project+'-check',['check',a.samples_root/project,'--language','java','--fail-on','never','--out',a.out/project,'--json']);facts[project]=json.loads((a.out/project/'raw-facts.json').read_text());assert facts[project]['callModel']==('java-static-lexical-v3'if a.expect=='candidate'else'java-static-lexical-v2')
units=[]
for role,cases in [('original-test-misses',manifest['cases']),('production-arity',manifest['supplementalProductionCases'])]:
 for case in cases:
  p=case['call'];rows=[c for c in facts[case['project']]['calls']if all(c[k]==p[k]for k in ['file','line','column'])and c['endColumn']==p['column']+len(p['needle'])];assert len(rows)==1;call=rows[0];t=call.get('target');target={**t,'file':t.get('file',call['file'])}if t else None;expected={k:case['target'][k]for k in ['file','line','column','name']};status='correct'if target==expected else'wrong'if target else'missed';assert status==('correct'if role=='production-arity'and a.expect=='candidate'else'missed');units.append({'role':role,'project':case['project'],'call':call,'expected':expected,'status':status})
questions={}
for case in manifest['supplementalProductionCases']:
 project=case['project'];entry=case['call']['file'];point=case['call']['line'];fn=next(f for f in facts[project]['functions']if f['file']==entry and f['line']<=point<=f['endLine']);dest=a.out/(project+'-question.json')
 run(project+'-question',['task',a.out/project,'--root',a.samples_root/project,'--entry',entry,'--function',fn['qualname'],'--question','Where does the fixed-arity static call lead?','--format','json','--out',dest,'--json'])
 q=json.loads(dest.read_text());selected=[r for r in q['calls']['records']if r['fact']['line']==point and r['fact']['column']==case['call']['column']]
 assert len(selected)==1
 assert selected[0]['targetNavigation']['status']==('valid'if a.expect=='candidate'else'unresolved')
 questions[project]={'function':fn['qualname'],'calls':q['calls']['total'],'included':q['calls']['included'],'omitted':q['calls']['omitted'],'selected':selected[0]}
# Same-arity production call remains unproved by this arity-only model.
x=manifest['sameArityCounterexample'];line=(a.samples_root/x['project']/x['call']['file']).read_text().splitlines()[x['call']['line']-1];column=line.index('LoggerFactory.getLogger')+1;control=next(c for c in facts[x['project']]['calls']if c['file']==x['call']['file']and c['line']==x['call']['line']and c['column']==column);assert not control.get('target')
report={'expect':a.expect,'commands':commands,'score':{s:sum(u['status']==s for u in units)for s in ['correct','wrong','missed']},'units':units,'sameArityUnknown':control,'questions':questions,'scope':{p:{'model':f['callModel'],'files':len(f['files']),'calls':len(f['calls']),'functions':len(f['functions']),'parseErrors':f.get('parse_errors',[])}for p,f in facts.items()},'limits':['Original five test calls remain known misses because inherited/wildcard caller guards apply before arity.','Two supplemental production source answers follow the initial baseline; not blind samples.','Unique fixed count is source navigation, not argument typing, runtime dispatch or full compiler attribution.','Checks deliberately use fail-on never; zero does not mean no findings.']}
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
