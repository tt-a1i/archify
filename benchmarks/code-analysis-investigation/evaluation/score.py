import json,pathlib,collections,sys,hashlib,os
from grading import grade_call,grade_pair,grade_supplemental_pair,grade_outgoing
D=pathlib.Path(os.environ['REPLAY_OUTPUTS']); B=pathlib.Path(os.environ['REPLAY_INPUTS']); O=json.loads((B/'eval-design/frozen-oracle.json').read_text()); S=json.loads((B/'paired-design/supplemental-source-oracle.json').read_text()); I=json.loads((B/'evaluation/outgoing-source-oracle.json').read_text()); output={}
for path in (B/'paired-design/supplemental-source-oracle.json',B/'evaluation/outgoing-source-oracle.json'):
 expected=path.with_suffix('.sha256').read_text().split()[0]
 if hashlib.sha256(path.read_bytes()).hexdigest()!=expected: raise ValueError('frozen oracle digest mismatch: '+str(path))
for variant in (sys.argv[1:] or ['labs','combined']):
 root=D/variant; units=[]; capabilities=[]
 for c in O['python_function_and_callsite_cases']:
  raw=json.loads((root/f"check-{c['project']}-head/capture/raw-facts.json").read_text()); fs=[x for x in raw['functions'] if x['file']==c['file'] and x.get('qualname')==c['function']]; status='correct-target' if len(fs)==1 and fs[0]['line']==c['line'] and fs[0]['endLine']==c['end_line'] else ('wrong-target' if fs else 'omitted');units.append({'kind':'function-location','project':c['project'],'name':c['function'],'expected':[c['line'],c['end_line']],'observed':fs,'status':status,'source':'raw-facts'})
  q={'DataFrame.__getitem__':0,'DataFrame._getitem_bool_array':1,'map_httpcore_exceptions':2,'_load_httpcore_exceptions':3,'Client._init_transport':4}[c['function']]
  p=root/f'question-{q}/result.json'; qdata=json.loads(p.read_text()) if p.exists() else None
  calls=qdata.get('calls',{}) if qdata else {}; unavailable=calls.get('coverage')=='unavailable';capabilities.append({'kind':'function-call-coverage','project':c['project'],'function':c['function'],'status':'explicit-unknown' if unavailable else 'workflow-unsupported' if not qdata else calls.get('coverage'),'reason':calls.get('reason') if qdata else 'Labs rejects --question','evidence':str(p if qdata else root/f'question-{q}/stdout')})
  for call in c['calls']:
   status,obs=grade_call(c,call,calls.get('records',[]),raw['functions'])
   units.append({'kind':'python-callsite','project':c['project'],'function':c['function'],'line':call['line'],'column_utf16_zero_based':call['column_utf16'],'callee':call['callee'],'expectation':call['expectation'],'expected_target':call['target'],'status':status,'observed':obs,'capability_notice':'unavailable' if unavailable else 'question unsupported' if not qdata else None})
 # Independent Java and JS location units from frozen oracle.
 for project,file,name,line,end in [('redux','utils/isPlainObject.ts','isPlainObject',5,14),('slf4j','slf4j-api/src/main/java/org/slf4j/LoggerFactory.java','LoggerFactory.bind()',181,215),('guava','com/google/common/base/Stopwatch.java','Stopwatch.start()',163,169)]:
  raw=json.loads((root/f'check-{project}-head/capture/raw-facts.json').read_text()); fs=[x for x in raw['functions'] if x['file']==file and x.get('qualname')==name];status='correct-target' if len(fs)==1 and fs[0]['line']==line and fs[0]['endLine']==end else 'wrong-target' if fs else 'omitted';units.append({'kind':'function-location','project':project,'name':name,'expected':[line,end],'observed':fs,'status':status,'source':'raw-facts'})
 # Two explicitly frozen Commander member/dynamic callsites; unresolved is a recorded boundary.
 raw=json.loads((root/'check-commander-head/capture/raw-facts.json').read_text())
 for line,description in [(1058,'this._chainOrCallSubCommandHook member call'),(1207,'registered hook callback')]:
  hits=[c for c in raw['calls'] if c.get('file')=='lib/command.js' and c.get('line')==line]; status='omitted' if not hits else 'explicit-unknown' if len(hits)==1 and hits[0].get('resolution')=='unresolved' and hits[0].get('reason') else 'wrong-target';units.append({'kind':'javascript-boundary-callsite','project':'commander','line':line,'description':description,'status':status,'observed':hits,'source':'raw-facts'})
 # Frozen source import-site presence; external resolution is not expected.
 for project,side,file,line,spec,target in [('redux','head','index.ts',8,'./utils/isPlainObject','utils/isPlainObject.ts'),('httpx','base','httpx/_config.py',9,'certifi',None),('httpx','head','httpx/_config.py',78,'certifi',None),('httpx','base','httpx/_transports/default.py',34,'httpcore',None),('httpx','head','httpx/_transports/default.py',75,'httpcore',None),('slf4j','head','slf4j-api/src/main/java/org/slf4j/LoggerFactory.java',28,'java.lang.reflect.Constructor',None),('slf4j','head','slf4j-api/src/main/java/org/slf4j/LoggerFactory.java',29,'java.lang.reflect.InvocationTargetException',None)]:
  raw=json.loads((root/f'check-{project}-{side}/capture/raw-facts.json').read_text()); hits=[i for i in raw['imports'] if i.get('from')==file and i.get('line')==line and i.get('specifier')==spec]; status='correct-target' if len(hits)==1 and (target is None or hits[0].get('to')==target) else 'wrong-target' if hits else 'omitted';units.append({'kind':'import-site','project':project,'side':side,'file':file,'line':line,'specifier':spec,'expected_target':target,'status':status,'observed':hits,'source':'raw-facts; site identity only, no claim of external target resolution'})
 # Paired mode must actually report the change, not infer it from two captures.
 paired=root/'paired-commander/result.json'; x=json.loads(paired.read_text()) if paired.exists() else None
 for name in ['Command.hook','Command._dispatchSubcommand','Command._chainOrCallSubCommandHook']:
  base_root=json.loads((root/'preflight.json').read_text())['commits']['commander-base']['root'];head_root=json.loads((root/'preflight.json').read_text())['commits']['commander-head']['root']
  status,found=grade_pair(name,x['changedDefinitions']['items'],x['unpairedDefinitions']['items'],base_root,head_root,x) if x else ('omitted',None)
  units.append({'kind':'changed-definition','project':'commander','name':name,'status':status,'observed':found,'source':'paired question','capability_notice':'question unsupported' if x is None else None})
 for project,qualname in [('httpx','_load_httpcore_exceptions'),('httpx','map_httpcore_exceptions'),('pluggy','PluginManager.subset_hook_caller'),('slf4j','LoggerFactory.bind()'),('slf4j','LoggerFactory.loadExplicitlySpecified(String)')]:
  p=root/f'paired-{project}/result.json'; result=json.loads(p.read_text()) if p.exists() else None
  pre=json.loads((root/'preflight.json').read_text())['commits']; roots={side:pre[project+'-'+side]['root'] for side in ('base','head')}
  status,found=grade_supplemental_pair(result,project,qualname,S,roots)
  units.append({'kind':'changed-definition','project':project,'name':qualname,'status':status,'observed':found,'source':'paired question; independent supplemental source oracle','capability_notice':'question unsupported' if result is None else None})
 # Java calls are unsupported; known zero is not an acceptable substitute.
 for name in ('LoggerFactory.bind()','LoggerFactory.loadExplicitlySpecified(String)'):
  p=root/'paired-slf4j/result.json'; result=json.loads(p.read_text()) if p.exists() else None
  if result:
   records=[z for key in ('changedDefinitions','unpairedDefinitions') for item in result.get(key,{}).get('items',[]) for z in ([item.get('base',{}),item.get('head',{})] if key=='changedDefinitions' else [item]) if z.get('definition',{}).get('qualname')==name]
   statuses=[z.get(k,{}) for z in records for k in ('knownReferences','unresolvedWithinSourceRange')]
   status='explicit-unknown' if records and all(t.get('coverage')=='unavailable' and t.get('total') is None and t.get('included')==0 and t.get('omitted') is None for t in statuses) else 'wrong-target' if records else 'omitted'
  else: records=[];status='omitted'
  units.append({'kind':'java-call-boundary','project':'slf4j','name':name,'status':status,'observed':records,'source':'paired question; unavailable is not known zero'})
 for u in I['units']:
  p=root/f"paired-{u['project']}/result.json"; result=json.loads(p.read_text()) if p.exists() else None
  source_root=json.loads((root/'preflight.json').read_text())['commits'][u['project']+'-'+u['side']]['root']
  status,found=grade_outgoing(result,u,source_root)
  units.append({'kind':'paired-outgoing-import','project':u['project'],'side':u['side'],'line':u['line'],'specifier':u['specifier'],'status':status,'observed':found,'source':'source-frozen selected entry import'})
 for project in ['redux','commander','httpx','pluggy','slf4j']:
  p=root/f'paired-{project}/stdout';j=json.loads(p.read_text());capabilities.append({'kind':'paired-workflow','project':project,'status':'workflow-unsupported' if j.get('status')=='error' else 'available','evidence':str(p)})
 summary={}
 for kind in sorted(set(u['kind'] for u in units)):
  subset=[u for u in units if u['kind']==kind];summary[kind]={'total':len(subset),'statuses':dict(collections.Counter(u['status'] for u in subset))}
 output[variant]={'units':units,'capabilities':capabilities,'summary':summary}
(D/'unit-results.json').write_text(json.dumps(output,indent=2)+'\n')
for k,v in output.items(): print(k,v['summary'])
