#!/usr/bin/env python3
"""Build a labelled front-end fixture; never invokes task-view validation."""
from pathlib import Path
import json, hashlib, html
root = Path(__file__).resolve().parent
experiment = root.parent
meta = json.loads((root/'sources.json').read_text())
for item in meta['files']:
    b=(root/item['path']).read_bytes()
    assert hashlib.sha256(b).hexdigest()==item['sha256']
    assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==item['gitBlob']
mapping_bytes=(experiment/'input/mapping.json').read_bytes()
assert hashlib.sha256(mapping_bytes).hexdigest()=='e04fea9bb1b29fce4926311c6101ad12d8d8d98efaa5eb2f0659a4828557b4cf'
mapping=json.loads(mapping_bytes)
flows=json.loads((experiment/'flows.json').read_text())
result={'status':'agent','reason':'研究夹具：复用归档内容；本轮未运行 task-view 校验器或历史测试。'}
nodes=[]; excerpts={}
for n in mapping['nodes']:
    ref=n['ref'];state=mapping['base'] if ref['side']=='base' else mapping['head']
    rows=[{'t':'ctx','n':ref['start']+i,'h':html.escape(line),'f':True} for i,line in enumerate(n['excerpt'].splitlines())]
    excerpts[n['id']]={'repo':'archify','file':ref['path'],'state':state,'stateKind':'initial' if ref['side']=='base' else 'final','rows':rows,'note':'归档片段；不是本轮 Git 校验或完整文件。'}
    nodes.append({'id':n['id'],'kind':'test' if n['id'] in flows['knownTests'] else 'code','label':n['label'],
        'change':'deleted' if ref['side']=='base' else 'modified','why':n['why'],
        'ref':{'type':'range','repo':'archify','file':ref['path'],'lines':[ref['start'],ref['end']],'at':state},
        'result':result,'excerpt':n['id'],'meta':[{'key':'execution','value':'not-run'}]})
edges=[{'id':'edge-'+str(i),'from':e['from'],'to':e['to'],'kind':'tests' if e['from']=='regression' else 'depends_on','result':result} for i,e in enumerate(mapping['edges'])]
notes=['研究夹具：只运行固定上游前端。没有运行 Go、schema/Git 校验或历史测试。0 verified 不表示引用不存在；0 errors 不表示校验成功。',
       '所有节点和边均标为 Agent statement。归档映射的旧 reference-matches 结果未作为本轮 verified 导入。']
notes += [f"{f['id']}：{f['scope']}；步骤说明："+' / '.join(f['details'])+'；路径声明的测试：'+(', '.join(x['test']+' → '+x['step'] for x in f['testLinks']) or '未声明（不等于无测试）') for f in flows['flows']]
base={'version':'a3fa217 frontend fixture; validator NOT RUN','generated':json.loads((root/'fixture.json').read_text())['generated'],
      'summary':'研究夹具 · 未运行上游校验器/历史测试。比较代码节点关联与路径声明。',
      'notes':notes,'repos':[],'claims':[],'files':[],'excerpts':excerpts,'errors':[],
      'warnings':[{'code':'research_fixture_not_checked','path':'/','message':'研究夹具作者提示：未运行上游校验器；这里不是无错误的校验结果。','hint':'本页面仅验证前端展示与交互。'}],
      'unlisted':[],'exitCode':None}
cases={}
shared_flows=[{'id':f['id'],'title':f['title'],'path':f['path'],'tests':[x['test'] for x in f['testLinks']]} for f in flows['flows']]
cases['shared']=(nodes,edges,shared_flows)
cases['legacy-only']=(nodes,[e for e in edges if e['kind']!='tests'],shared_flows)
# Alternative representation: each flow gets distinct step identities but keeps the
# same archived excerpts. This is not a lossless conversion of the global mapping.
occ_nodes=[n for n in nodes if n['kind']=='test'];occ_edges=[];occ_flows=[]
by_id={n['id']:n for n in nodes}
for flow in flows['flows']:
    ids={id:flow['id']+'-'+id for id in flow['path']}
    occ_nodes += [{**by_id[id],'id':new,'label':by_id[id]['label']+' ['+flow['id']+']'} for id,new in ids.items()]
    occ_flows.append({'id':flow['id'],'title':flow['title'],'path':list(ids.values()),'tests':[x['test'] for x in flow['testLinks']]})
    occ_edges.append({'id':flow['id']+'-path','from':ids['guard'],'to':ids['report'],'kind':'depends_on','result':result})
    occ_edges += [{'id':flow['id']+'-test','from':x['test'],'to':ids[x['step']],'kind':'tests','result':result} for x in flow['testLinks']]
cases['occurrences']=(occ_nodes,occ_edges,occ_flows)
asset='../source/internal/render/assets/'
template=(root/'source/internal/render/assets/index.html').read_text()
out=root/'pages';out.mkdir(exist_ok=True)
for name,(ns,es,fs) in cases.items():
    data={**base,'reviewName':'研究夹具·未校验 / '+name,'reviewPath':'archify-round45-'+name,'nodes':ns,'edges':es,'flows':fs,
          'counts':{'verified':0,'contradicted':0,'unresolved':0,'agentStatements':len(ns)+len(es)}}
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    page=template.replace('{{TITLE}}','task-view 研究夹具 · '+name).replace('<style>{{CSS}}</style>','<link rel="stylesheet" href="'+asset+'app.css">').replace('{{DATA}}',raw)
    page=page.replace('<script>{{VENDOR}}</script>','\n'.join('<script src="'+asset+'vendor/'+v+'"></script>' for v in ['cytoscape.min.js','elk.bundled.js','cytoscape-elk.js']))
    page=page.replace('<script>{{APP}}</script>','<script src="'+asset+'app.js"></script>')
    assert '{{' not in page
    (out/(name+'.html')).write_text(page)
    (out/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({name:{'nodes':len(ns),'edges':len(es),'flows':len(fs)} for name,(ns,es,fs) in cases.items()},indent=2))
