import argparse,hashlib,json,os,pathlib,subprocess,time,concurrent.futures
D=pathlib.Path(os.environ['REPLAY_OUTPUTS']); F=pathlib.Path(os.environ['REPLAY_INPUTS'])/'eval-design'; manifest=json.loads((F/'manifest.json').read_text()); oracle=json.loads((F/'frozen-oracle.json').read_text())
node=os.environ.get('NODE', 'node')
p=argparse.ArgumentParser();p.add_argument('--name',required=True);p.add_argument('--cli',required=True);p.add_argument('--archive-sha256');a=p.parse_args(); out=D/a.name;out.mkdir(exist_ok=False)
env=os.environ.copy();env.update(BAUIFY_PYTHON=os.environ.get('PYTHON', 'python3.13'))
pre={'sources':{},'commits':{},'node':subprocess.check_output([node,'--version'],text=True).strip(),'python':subprocess.check_output([env['BAUIFY_PYTHON'],'--version'],text=True).strip(),'cli':a.cli,'product_revision':('archive; see archive_sha256' if a.archive_sha256 else subprocess.check_output(['git','-C',str(pathlib.Path(a.cli).parents[2]),'rev-parse','HEAD'],text=True).strip()),'archive_sha256':a.archive_sha256}
if not a.archive_sha256:
 pre['product_clean_tracked']=not bool(subprocess.check_output(['git','-C',str(pathlib.Path(a.cli).parents[2]),'status','--porcelain','--untracked-files=no'],text=True).strip())
for f,h in oracle['source_hashes_sha256'].items():
 actual=hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest();pre['sources'][f]={'expected':h,'actual':actual,'match':h==actual}
for project in manifest['projects']:
 for side in ['base','head']:
  root=project['checkout_paths'].get(side); sha=project.get(side+'_sha')
  if root and sha:
   actual=subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip();dirty=subprocess.check_output(['git','-C',root,'status','--porcelain','--untracked-files=no'],text=True).strip();pre['commits'][project['id']+'-'+side]={'root':root,'expected':sha,'actual':actual,'clean_tracked':not bool(dirty)}
(out/'preflight.json').write_text(json.dumps(pre,indent=2)+'\n')
assert pre.get('product_clean_tracked',True) and pre['node']=='v22.23.2' and pre['python'].startswith('Python 3.13.') and all(x['match'] for x in pre['sources'].values()) and all(x['actual']==x['expected'] and x['clean_tracked'] for x in pre['commits'].values()),'preflight failed; see receipt'
projs={x['id']:x for x in manifest['projects']}; jobs=[]
def run(id,args):
 d=out/id;d.mkdir(parents=True,exist_ok=True);cmd=[node,a.cli,*args];t=time.monotonic();r=subprocess.run(cmd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE);elapsed=time.monotonic()-t
 (d/'stdout').write_text(r.stdout);(d/'stderr').write_text(r.stderr);(d/'command.json').write_text(json.dumps({'argv':cmd,'exit':r.returncode,'seconds':elapsed,'stdout_bytes':len(r.stdout.encode()),'stderr_bytes':len(r.stderr.encode())},indent=2)+'\n');return (id,r.returncode,round(elapsed,2))
def root(p,side):
 r=p['checkout_paths'][side];return r+'/src' if p['id']=='redux' else r+'/guava/src' if p['id']=='guava' else r
for p in manifest['projects']:
 for side in ['base','head']:
  if not p['checkout_paths'].get(side) or not p.get(side+'_sha'):continue
  id='check-'+p['id']+'-'+side;cap=out/id/'capture';lang={'typescript':'ts','javascript':'ts','python':'py','java':'java'}[p['language']]
  jobs.append((id,['code-analysis','check',root(p,side),'--language',lang,'--fail-on','never','--json','--out',str(cap)]))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 for v in ex.map(lambda job:run(*job),jobs): print(v,flush=True)
questions=[('pandas','pandas/core/frame.py','DataFrame.__getitem__'),('pandas','pandas/core/frame.py','DataFrame._getitem_bool_array'),('httpx','httpx/_transports/default.py','map_httpcore_exceptions'),('httpx','httpx/_transports/default.py','_load_httpcore_exceptions'),('httpx','httpx/_client.py','Client._init_transport'),('pluggy','src/pluggy/_manager.py','PluginManager.subset_hook_caller'),('commander','lib/command.js','Command._dispatchSubcommand'),('redux','utils/isPlainObject.ts','isPlainObject'),('slf4j','slf4j-api/src/main/java/org/slf4j/LoggerFactory.java','LoggerFactory.bind()'),('guava','com/google/common/base/Stopwatch.java','Stopwatch.start()')]
for idx,(project,entry,fn) in enumerate(questions):
 cap=out/('check-'+project+'-head')/'capture'; path=out/('question-'+str(idx))/'result.json'; id='question-'+str(idx)
 print(run(id,['code-analysis','task',str(cap),'--question','Locate the selected function and its direct calls.','--entry',entry,'--function',fn,'--root',root(projs[project],'head'),'--format','json','--out',str(path),'--json']),flush=True)
(out/'question-index.json').write_text(json.dumps(questions,indent=2)+'\n')
for project,entry in [('redux','src/index.ts'),('commander','lib/command.js'),('httpx','httpx/_transports/default.py'),('pluggy','src/pluggy/_manager.py'),('slf4j','slf4j-api/src/main/java/org/slf4j/LoggerFactory.java')]:
 p=projs[project];id='paired-'+project; result=out/id/'result.json'
 print(run(id,['code-analysis','task','--question','Which source definitions changed?','--base-root',p['checkout_paths']['base'],'--root',p['checkout_paths']['head'],'--entry',entry,'--format','json','--out',str(result),'--json']),flush=True)

if not a.archive_sha256:
 after=subprocess.check_output(['git','-C',str(pathlib.Path(a.cli).parents[2]),'status','--porcelain','--untracked-files=no'],text=True); (out/'product-postflight.txt').write_text(after); assert not after, 'product tree changed during evaluation; discard results'
