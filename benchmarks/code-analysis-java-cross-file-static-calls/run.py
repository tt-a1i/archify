"""Public CLI replay of the finite source-first Java investigation.

No JDK is required to run the analyzer. JDK attribution is separate evidence.
"""
import argparse,hashlib,json,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--cli',type=pathlib.Path,required=True);p.add_argument('--samples-root',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--node',default='node');p.add_argument('--expect',choices=['baseline','candidate'],default='candidate');a=p.parse_args()
a.cli=a.cli.resolve();a.samples_root=a.samples_root.resolve();a.out=a.out.resolve();assert a.out!=a.samples_root and a.samples_root not in a.out.parents;a.out.mkdir(parents=True,exist_ok=True)
here=pathlib.Path(__file__).resolve().parent;original=json.loads((here/'source-first.json').read_text());reserved=json.loads((here/'reserved-commons.json').read_text());commands=[];facts={}
for name,manifest in [('slf4j',original),('commons-lang',reserved)]:
 root=a.samples_root/name;assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==manifest['revision']
 for file,expected in manifest['sourceSha256'].items():assert hashlib.sha256((root/file).read_bytes()).hexdigest()==expected

def run(label,arguments):
 cmd=[a.node,str(a.cli),'code-analysis',*map(str,arguments)];start=time.monotonic();r=subprocess.run(cmd,text=True,capture_output=True);commands.append({'label':label,'command':cmd,'exit':r.returncode,'seconds':time.monotonic()-start});(a.out/(label+'.stdout')).write_text(r.stdout);(a.out/(label+'.stderr')).write_text(r.stderr);assert r.returncode==0,(label,r.stdout[:1000],r.stderr[:1000]);return json.loads(r.stdout)
roots={'slf4j':a.samples_root/'slf4j/slf4j-api','commons':a.samples_root/'commons-lang/src/main/java'}
for name,root in roots.items():
 run(name+'-check',['check',root,'--language','java','--fail-on','never','--out',a.out/name,'--json']);facts[name]=json.loads((a.out/name/'raw-facts.json').read_text())
cases=[('slf4j','src/main/java/org/slf4j/LoggerFactory.java',454,'Util.getCallingClass(',{'file':'src/main/java/org/slf4j/helpers/Util.java','name':'getCallingClass','line':98,'column':5},'LoggerFactory.getLogger(Class<?>)'),('commons','org/apache/commons/lang3/ClassUtils.java',733,'StringUtils.isEmpty(',{'file':'org/apache/commons/lang3/StringUtils.java','name':'isEmpty','line':3604,'column':5},'ClassUtils.getPackageName(String)'),('commons','org/apache/commons/lang3/ClassUtils.java',995,'StringUtils.isEmpty(',{'file':'org/apache/commons/lang3/StringUtils.java','name':'isEmpty','line':3604,'column':5},'ClassUtils.getShortClassName(String)')]
units=[]
for i,(name,file,line,needle,expected,symbol)in enumerate(cases):
 text=(roots[name]/file).read_text().splitlines()[line-1];column=text.index(needle)+1;selected=[c for c in facts[name]['calls']if c['file']==file and c['line']==line and c['column']==column and c['endLine']==line];assert len(selected)==1;call=selected[0];actual=call.get('target');status='correct' if actual==expected else 'wrong' if actual else 'missed';units.append({'project':name,'call':call,'expected':expected,'status':status})
 qout=a.out/('question-'+str(i)+'.json');run('question-'+str(i),['task',a.out/name,'--root',roots[name],'--entry',file,'--function',symbol,'--question','Where is this explicit static implementation?','--format','json','--out',qout,'--json']);q=json.loads(qout.read_text());rows=[r for r in q['calls']['records']if r['fact']==call];assert len(rows)==1
 if a.expect=='candidate':assert status=='correct' and rows[0]['targetNavigation']['status']=='valid'
 else:assert status=='missed' and q['calls']['coverage']=='available'
# Interface/provider dispatch stays unknown, even though javac identifies the interface declaration.
negative=[c for c in facts['slf4j']['calls']if c['file']=='src/main/java/org/slf4j/LoggerFactory.java'and c['line']==427 and c['column']==16];assert len(negative)==1 and negative[0]['resolution']=='unresolved'
if a.expect=='candidate':
 qout=a.out/'follow-up.json';run('follow-up',['task',a.out/'slf4j','--root',roots['slf4j'],'--entry','src/main/java/org/slf4j/helpers/Util.java','--function','Util.getCallingClass()','--question','What is the next direct implementation step?','--format','json','--out',qout,'--json']);q=json.loads(qout.read_text());assert any(r['fact'].get('target',{}).get('name')=='getSecurityManager'and r['targetNavigation']['status']=='valid'for r in q['calls']['records'])
report={'mode':a.expect,'commands':commands,'score':{s:sum(u['status']==s for u in units)for s in ['correct','wrong','missed']},'units':units,'reasonableUnknowns':negative,'scope':{n:{'files':len(f['files']),'functions':len(f['functions']),'calls':len(f['calls']),'parseErrors':f.get('parse_errors',[]),'model':f['callModel']}for n,f in facts.items()},'limits':['Three finite source-first direct targets, not whole-project recall or runtime execution.','Commons reserved after initial code was written but before its first run; not blind.','Compiler audit of all emitted main-source qualified targets is supplemental, post-design evidence.','Paired cross-file changed-definition coverage is authored regression evidence, not a new real version-pair study.']};(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['score']))
