import copy,json,pathlib,os
from grading import grade_supplemental_pair,grade_outgoing
D=pathlib.Path(os.environ['REPLAY_INPUTS']); o=json.loads((D/'paired-design/supplemental-source-oracle.json').read_text()); imports=json.loads((D/'evaluation/outgoing-source-oracle.json').read_text())['units']; manifest=json.loads((D/'eval-design/manifest.json').read_text()); pre={p['id']+'-'+side:{'root':root} for p in manifest['projects'] for side,root in p['checkout_paths'].items()}
def roots(p):return {side:pre[p+'-'+side]['root'] for side in ('base','head')}
def fixture(project,name):
 units={u['side']:u for u in o['units'] if u['project']==project and u['qualname']==name}; sides={s:{'side':s,'sourceIdentity':'valid','snapshot':{'snapshotId':('a' if s=='base' else 'b')*64}} for s in ('base','head')}
 def rec(s):
  u=units[s];r=u['definition_range'];d=dict(file=u['file'],name=name.rsplit('.',1)[-1].split('(')[0],qualname=name,kind=u['kind'],line=u.get('identity_line',r['line']),column=r['column'],endLine=r['endLine'],endColumn=r['endColumn'],sourceRange={**r,'sha256':u['definition_sha256']},textSha256=u['definition_sha256']);return dict(side=s,snapshotId=('a' if s=='base' else 'b')*64,definition=d)
 result=dict(sides=sides,changedDefinitions={'items':[]},unpairedDefinitions={'items':[]},positionOnlyDefinitions={'items':[]})
 if units['base'].get('absent'): result['unpairedDefinitions']['items'].append({**rec('head'),'reason':'head-only'})
 else: result['changedDefinitions']['items'].append({'pairing':'unique-exact-source-slot','base':rec('base'),'head':rec('head')})
 return result
for project,name in [('httpx','map_httpcore_exceptions'),('httpx','_load_httpcore_exceptions'),('pluggy','PluginManager.subset_hook_caller'),('slf4j','LoggerFactory.bind()'),('slf4j','LoggerFactory.loadExplicitlySpecified(String)')]:
 x=fixture(project,name);grade=lambda v:grade_supplemental_pair(v,project,name,o,roots(project))[0];assert grade(x)=='correct-target'; changed=bool(x['changedDefinitions']['items']); key='changedDefinitions' if changed else 'unpairedDefinitions'
 for mutation in ['id','name','qualname','kind','side','status','range','end','hash','duplicate','sourceidentity']:
  y=copy.deepcopy(x);item=y[key]['items'][0];r=item['head'] if changed else item;d=r['definition']
  if mutation=='id': r['snapshotId']='bad'
  if mutation=='name': d['name']='bad'
  if mutation=='qualname': d['qualname']='bad'
  if mutation=='kind': d['kind']='bad'
  if mutation=='side': r['side']='base'
  if mutation=='status': item['pairing' if changed else 'reason']='bad'
  if mutation=='range': d['sourceRange']['line']+=1
  if mutation=='end': d['endColumn']+=1
  if mutation=='hash': d['textSha256']='bad'
  if mutation=='duplicate': y[key]['items'].append(copy.deepcopy(item))
  if mutation=='sourceidentity': y['sides']['head']['sourceIdentity']='stale'
  assert grade(y)!='correct-target',(project,name,mutation)
u=imports[0]; x=fixture('httpx','map_httpcore_exceptions'); sid='a'*64;rec={'side':'base','snapshotId':sid,'factIndex':1,'originStatus':'valid','fact':{'from':u['file'],'line':u['line'],'specifier':u['specifier'],'kind':'static','resolved':False},'targetNavigation':{'status':'external-or-unresolved','location':None,'reason':'external-or-unresolved-import-destination'}};x['outgoingImports']={'base':{'side':'base','snapshotId':sid,'originStatus':'valid','items':[rec]}};g=lambda v:grade_outgoing(v,u,roots('httpx')['base'])[0];assert g(x)=='correct-target'
for mutation in ['id','side','index','status','target','duplicate','lazy']:
 y=copy.deepcopy(x);group=y['outgoingImports']['base'];r=group['items'][0]
 if mutation=='id':r['snapshotId']='bad'
 if mutation=='side':r['side']='head'
 if mutation=='index':r['factIndex']=-1
 if mutation=='status':r['originStatus']='stale'
 if mutation=='target':r['targetNavigation']['location']={'file':'bad'}
 if mutation=='duplicate':group['items'].append(copy.deepcopy(r))
 if mutation=='lazy':r['fact']['lazy']=True
 assert g(y)!='correct-target',mutation
print('PASS 5 positive paired units, 55 paired corruptions, 1 outgoing positive, 7 outgoing corruptions')
