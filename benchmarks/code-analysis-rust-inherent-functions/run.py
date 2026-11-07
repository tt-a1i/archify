"""Replay source-frozen Rust inherent-path questions through source or ZIP CLI."""
import argparse, hashlib, json, subprocess, time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cli',type=Path,required=True);p.add_argument('--samples-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli,a.samples_root,a.out=a.cli.resolve(),a.samples_root.resolve(),a.out.resolve();a.out.mkdir(parents=True,exist_ok=True)
here=Path(__file__).resolve().parent;m=json.loads((here/'source-first.json').read_text());commands=[];facts={};units=[]
for project,meta in m['projects'].items():
 root=a.samples_root/project
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==meta['revision']
 for file,digest in meta['hashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest,(project,file)
 for file in meta.get('absentFiles',[]):assert not(root/file).exists()
def run(label,args,expected=0):
 cmd=['node',str(a.cli),'code-analysis',*map(str,args)];start=time.monotonic();r=subprocess.run(cmd,capture_output=True,text=True)
 commands.append({'label':label,'command':cmd,'exit':r.returncode,'seconds':time.monotonic()-start});(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr)
 assert r.returncode==expected,(label,r.returncode,r.stdout[:1000],r.stderr[:1000])
profiles=[('regex','regex',{'offline':True,'tests':False}),('serde-default','serde-json',{'offline':True,'tests':False}),('serde-arbitrary','serde-json',{'offline':True,'tests':False,'features':{'serde_json':['arbitrary_precision']}})]
def at(profile,point):
 line=(a.samples_root/('regex' if profile=='regex' else 'serde-json')/point['file']).read_text().splitlines()[point['line']-1];column=point.get('column',line.index(point['needle'])+1)
 # Chained calls share their start. Grade the inner call by its exact end too.
 end=column+len(point['needle']);rows=[c for c in facts[profile]['calls'] if (c['file'],c['line'],c['column'],c['endLine'],c['endColumn'])==(point['file'],point['line'],column,point['line'],end)]
 assert len(rows)==1,(profile,point,rows)
 return rows[0]
for profile,project,rust in profiles:
 config=a.out/(profile+'-config.json');config.write_text(json.dumps({'rust':rust})+'\n');run(profile+'-check',['check',a.samples_root/project,'--language','rust','--config',config,'--out',a.out/profile,'--fail-on','never','--json'])
 f=json.loads((a.out/profile/'raw-facts.json').read_text());facts[profile]=f
 assert f['callModel']==('rust-source-direct-v1' if a.expect=='baseline' else 'rust-source-direct-v2')
 for case in m['cases']:
  if case['project']!=project:continue
  call=at(profile,case['call']);expected={k:case['target'][k] for k in ['file','line','column','name']};status='correct' if call.get('target')==expected else 'wrong' if call.get('target') else 'missed'
  assert status==('missed' if a.expect=='baseline' else 'correct'),(profile,call,expected)
  units.append({'profile':profile,'call':call,'expected':expected,'status':status,'exposure':'design source freeze'})
 if project=='serde-json':
  call=at(profile,m['traitControl']['call']);assert call['resolution']=='unresolved' and 'target'not in call;units.append({'profile':profile,'call':call,'status':'reasonable-unknown','reason':m['traitControl']['reason']})
  assert any(x['file']=='src/value/from.rs' and x['line']==20 and x['kind']=='item-expansion' for x in f['languageScope']['opaqueMacros'])
  for case in json.loads((here/'review-source-first.json').read_text())['cases']:
   call=at(profile,case['call']);assert call['resolution']=='unresolved' and 'target'not in call
   units.append({'profile':profile,'call':call,'expected':case.get('target'),'status':'missed' if case.get('target') else 'reasonable-unknown','exposure':'reserved file inspected after first rule, before extraction','reason':case['expected']})
 # Whole source file orientation avoids collapsing repeated trait method qualnames.
 entry='src/regex/string.rs' if project=='regex' else 'src/value/from.rs';dest=a.out/(profile+'-question.json')
 run(profile+'-question',['task',a.out/profile,'--root',a.samples_root/project,'--entry',entry,'--question','Where do the explicit inherent calls lead?','--format','json','--out',dest,'--json'])
 q=json.loads(dest.read_text());expected_name='new' if project=='regex' else 'from_f64';rows=[r for r in q['calls']['records'] if r['fact'].get('target',{}).get('name')==expected_name]
 # Regex file exceeds the 40-record display bound; retain its visible omissions.
 if project!='regex' and a.expect=='candidate':assert any(r['targetNavigation']['status']=='valid' for r in rows)
pair=json.loads((here/'version-pair.json').read_text())
for side,meta in pair['sides'].items():
 root=a.samples_root/meta['folder']
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==meta['revision']
 for file,digest in meta['hashes'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest
paired=a.out/'paired.json'
run('paired',['task','--base-root',a.samples_root/pair['sides']['base']['folder'],'--root',a.samples_root/pair['sides']['head']['folder'],'--entry','src/number.rs','--config',a.out/'serde-default-config.json','--question','Which known callers reach changed Number.from_f64?','--format','json','--out',paired,'--json'],expected=1)
q=json.loads(paired.read_text());changed=next(d for d in q['changedDefinitions']['items'] if d.get('head',{}).get('definition',{}).get('qualname')=='number::Number::from_f64')
for side in ['base','head']:
 refs=changed[side]['knownReferences'];expected=pair['sides'][side]['sourceKnownCallers']
 assert refs['total']==(len(expected) if a.expect=='candidate' else 0)
 if a.expect=='candidate':
  assert sorted((r['fact']['file'],r['fact']['line'],r['fact']['column'])for r in refs['items'])==sorted((r['file'],r['line'],r['column'])for r in expected)
  assert all(r['navigation']['status']=='valid'for r in refs['items'])
report={'expect':a.expect,'paired':{'status':q['status'],'knownReferences':{side:changed[side]['knownReferences'] for side in ['base','head']}},'commands':commands,'score':{s:sum(u['status']==s for u in units) for s in ['correct','wrong','missed','reasonable-unknown']},'units':units,'profiles':{p:{'files':len(f['files']),'calls':len(f['calls']),'newSourceCandidates':sum(c['resolution']=='rust-inherent-source-candidate'for c in f['calls']),'parseErrors':f.get('parse_errors',[]),'build':f['languageScope']['build'],'conditionalDefinitions':len(f['languageScope']['conditionalDefinitions']),'opaqueMacros':len(f['languageScope']['opaqueMacros']),'excludedFiles':f['languageScope']['excludedFiles'],'missingModules':f['languageScope']['missingModules']}for p,f in facts.items()},'limits':['Finite source-checked positives and review misses; not whole-project precision or compiler attribution.','Additional source candidates outside these units are not independently graded.','Reserved file follows initial implementation, repositories were previously exposed.','Checks use --fail-on never; exit zero does not mean no findings.']}
(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'score':report['score'],'profiles':{p:{k:v[k]for k in ['files','calls','newSourceCandidates']}for p,v in report['profiles'].items()}}))
