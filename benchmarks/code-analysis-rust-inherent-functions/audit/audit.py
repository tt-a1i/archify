"""Optional independent language-server navigation audit, not a product backend."""
import argparse, json, os, queue, subprocess, threading, time, hashlib
from pathlib import Path
from urllib.parse import unquote,urlparse
p=argparse.ArgumentParser();p.add_argument('--profile',choices=['serde-default','serde-arbitrary','regex'],required=True);p.add_argument('--workspaces-root',type=Path,required=True);p.add_argument('--facts-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--negative-control',action='store_true');a=p.parse_args()
here=Path(__file__).resolve().parent;project='regex' if a.profile=='regex'else'serde-json';root=a.workspaces_root.resolve()/project;output=a.out.resolve();out=output/(a.profile+'-negative-control'if a.negative_control else a.profile);out.mkdir(parents=True,exist_ok=True);started=time.monotonic()
inputs=json.loads((here/'inputs.json').read_text());assert hashlib.sha256((root/'Cargo.lock').read_bytes()).hexdigest()==inputs['projects'][project]['lockSha256']
assert (output/'bin/cargo').is_file() and (output/'cargo-home/bin/cargo').resolve()==(output/'bin/cargo').resolve(), 'Run prepare.py with this exact --out first'
assert subprocess.check_output(['rust-analyzer','--version'],text=True).strip()==inputs['rustAnalyzer']
config=json.loads((here/'lsp-config.json').read_text());config['cargo']['target']=inputs['target'];config['cargo']['features']=['arbitrary_precision']if a.profile=='serde-arbitrary'else[]
(out/'config.json').write_text(json.dumps(config,indent=2)+'\n')
env={**os.environ,'PATH':str(output/'bin')+os.pathsep+os.environ['PATH'],'CARGO':str(output/'bin/cargo'),'CARGO_NET_OFFLINE':'true','CARGO_HOME':str(output/'cargo-home'),'RUSTUP_AUTO_INSTALL':'0','RUSTUP_TOOLCHAIN':'stable','RA_LOG':'project_model=info'}
stderr=(out/'stderr.log').open('wb');proc=subprocess.Popen(['rust-analyzer'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,env=env,cwd=root);messages=queue.Queue();counter=0;transcript=[];statuses=[]
def send(x):
 data=json.dumps(x).encode();proc.stdin.write(f'Content-Length: {len(data)}\r\n\r\n'.encode()+data);proc.stdin.flush()
def reader():
 try:
  while True:
   headers={}
   while True:
    line=proc.stdout.readline()
    if not line:return
    if line==b'\r\n':break
    k,v=line.decode().split(':',1);headers[k.lower()]=v.strip()
   messages.put(json.loads(proc.stdout.read(int(headers['content-length']))))
 except Exception as e:messages.put({'readerError':str(e)})
threading.Thread(target=reader,daemon=True).start()
def handle(m):
 if 'method'in m:
  transcript.append({'method':m['method'],'params':m.get('params')})
  if m['method']=='experimental/serverStatus':statuses.append(m['params'])
  if 'id'in m:
   if m['method']=='workspace/configuration':
    result=[config if item.get('section')in [None,'rust-analyzer']else None for item in m['params']['items']]
   elif m['method']=='workspace/applyEdit':result={'applied':False,'failureReason':'read-only navigation audit'}
   else:result=None
   send({'jsonrpc':'2.0','id':m['id'],'result':result})
  return True
 return False
def request(method,params,timeout=60):
 global counter
 counter+=1;wanted=counter;send({'jsonrpc':'2.0','id':wanted,'method':method,'params':params});deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  try:m=messages.get(timeout=min(1,deadline-time.monotonic()))
  except queue.Empty:
   if proc.poll()is not None:raise RuntimeError('server exited '+str(proc.returncode))
   continue
  if handle(m):continue
  if m.get('id')==wanted:return m
 raise TimeoutError(method)
rows=[]
try:
 init=request('initialize',{'processId':os.getpid(),'rootUri':root.as_uri(),'workspaceFolders':[{'uri':root.as_uri(),'name':project}],'capabilities':{'window':{'workDoneProgress':True},'workspace':{'configuration':True},'experimental':{'serverStatusNotification':True}},'initializationOptions':config})
 (out/'initialize.json').write_text(json.dumps(init,indent=2)+'\n');send({'jsonrpc':'2.0','method':'initialized','params':{}})
 deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  try:m=messages.get(timeout=1)
  except queue.Empty:continue
  handle(m)
  if statuses and statuses[-1].get('quiescent'):
   break
 else:raise TimeoutError('workspace quiescence')
 status=request('rust-analyzer/analyzerStatus',{});(out/'analyzer-status.json').write_text(json.dumps(status,indent=2)+'\n')
 assert all((key+': false,') in status.get('result','')for key in ['checkOnSave','procMacro_enable','cargo_buildScripts_enable'])
 facts=json.loads((a.facts_root/a.profile/'raw-facts.json').read_text())
 def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 expected=inputs['profiles'][a.profile]
 assert facts['callModel']==expected['model'] and digest(facts['calls'])==expected['callsSha256']
 assert digest(facts['functions'])==expected['functionsSha256']
 assert digest({x['path']:x['sourceText']for x in facts['files']})==expected['sourcesSha256']
 function_ranges={(f['file'],f['name'],f['sourceRange']['line'],f['sourceRange']['column']):f['sourceRange']for f in facts['functions']}
 candidates=[c for c in facts['calls']if c['resolution']=='rust-inherent-source-candidate']
 if project=='serde-json':
  for line in [526,535]:
   text=(root/'src/map.rs').read_text().splitlines()[line-1];column=text.index('Map::new()')+1
   candidates.append({'file':'src/map.rs','line':line,'column':column,'endLine':line,'endColumn':column+len('Map::new()'),'resolution':'unresolved','target':{'file':'src/map.rs','line':41,'column':5,'name':'new'},'auditRole':'known source miss, not emitted product target'})
 if a.negative_control:
  assert a.profile=='regex'
  control=json.loads(json.dumps(next(c for c in candidates if c['file']=='src/regex/string.rs'and c['line']==125)))
  control['target']={'file':'src/regex/bytes.rs','line':178,'column':5,'name':'new'}
  control['auditRole']='Deliberately wrong nominal target; grader discrimination, not product output'
  candidates=[control]
 for i,c in enumerate(candidates):
  line=(root/c['file']).read_text().splitlines()[c['line']-1];target=c['target'];needle='::'+target['name'];start=len(line.encode('utf-16-le')[:(c['column']-1)*2].decode('utf-16-le'))
  # Every eligible product path has an explicit, nongeneric terminal segment.
  index=line.find(needle,start)
  if index<0:
   rows.append({'call':c,'status':'identifier-not-found'});continue
  pos=len(line[:index+2].encode('utf-16-le'))//2
  if c['endLine']==c['line']:assert pos+len(target['name'].encode('utf-16-le'))//2<=c['endColumn']-1
  response=request('textDocument/definition',{'textDocument':{'uri':(root/c['file']).as_uri()},'position':{'line':c['line']-1,'character':pos}})
  definitions=response.get('result')or[]
  if isinstance(definitions,dict):definitions=[definitions]
  locations=[]
  for loc in definitions:
   uri=loc.get('targetUri',loc.get('uri'));rg=loc.get('targetSelectionRange',loc.get('range'));file=Path(unquote(urlparse(uri).path))
   try:relative=str(file.relative_to(root))
   except ValueError:relative=str(file)
   locations.append({'file':relative,'line':rg['start']['line']+1,'column':rg['start']['character']+1,'range':rg})
  # RA selection points to the identifier; our target starts at pub/fn. Match
  # exact captured function range plus source name on the declaration line.
  rg=function_ranges[(target['file'],target['name'],target['line'],target['column'])]
  agreement=any(loc['file']==target['file']and loc['line']==target['line']and (rg['line'],rg['column'])<=(loc['line'],loc['column'])<(rg['endLine'],rg['endColumn'])and (root/loc['file']).read_text().splitlines()[loc['line']-1][loc['column']-1:].startswith(target['name'])for loc in locations)
  rows.append({'call':c,'query':{'file':c['file'],'line':c['line'],'column':pos+1},'expectedFunctionRange':rg,'languageServerLocations':locations,'status':'agrees'if agreement else'different'if locations else'unavailable','error':response.get('error')})
  if (i+1)%100==0:print(json.dumps({'profile':a.profile,'completed':i+1,'total':len(candidates)}),flush=True)
 report={'profile':a.profile,'negativeControl':a.negative_control,'tool':subprocess.check_output(['rust-analyzer','--version'],text=True).strip(),'sourceCandidate':inputs['candidate'],'lockSha256':hashlib.sha256((root/'Cargo.lock').read_bytes()).hexdigest(),'generatedLockNotOriginal':True,'config':config,'effectiveSafetySettings':{key:(''+key+': false,') in status.get('result','') for key in ['checkOnSave','procMacro_enable','cargo_buildScripts_enable']},'serverStatuses':statuses,'seconds':time.monotonic()-started,'counts':{s:sum(r['status']==s for r in rows)for s in ['agrees','different','unavailable','identifier-not-found']},'rowsPath':'rows.jsonl','limits':['Independent language-server navigation under explicit config, not rustc compilation/runtime proof.','No build scripts/proc macros/check/tests; missing expansions and source-profile differences affect availability.','Generated dependency lock belongs to audit copy, not fixed original source.']}
 if a.negative_control:assert len(rows)==1 and rows[0]['status']=='different'
 (out/'rows.jsonl').write_text(''.join(json.dumps(row,separators=(',',':'))+'\n'for row in rows));(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']),flush=True)
finally:
 (out/'transcript.json').write_text(json.dumps(transcript,indent=2)+'\n')
 try:request('shutdown',None,timeout=5);send({'jsonrpc':'2.0','method':'exit','params':None});proc.wait(timeout=5)
 except Exception:proc.terminate();proc.wait(timeout=5)
 stderr.close()

if not a.negative_control and any(row["status"]!="agrees"for row in rows):raise SystemExit(1)
