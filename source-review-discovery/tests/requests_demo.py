"""Build a local public-source demo from pinned checkouts; never commit outputs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL/'scripts'))
import review_report as rr
import verify_finding

REQUESTS_COMMIT = '147c8511ddbfa5e8f71bbf5c18ede0c4ceb3bba4'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requests', required=True)
    parser.add_argument('--deps', required=True, help='urllib3 2.0.7 and Requests dependencies installed here')
    parser.add_argument('--out', required=True)
    args=parser.parse_args()
    root,deps,out=map(lambda x:Path(x).resolve(),(args.requests,args.deps,args.out))
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    assert revision==REQUESTS_COMMIT, 'Use the documented v2.31.0 checkout'
    assert not subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip(), 'Use a clean source checkout'
    out.mkdir(parents=True,exist_ok=False)
    evidence=[]
    def ev(id, repo, path, start, end, label):
        evidence.append(dict(id=id,repository=repo,path=path,start=start,end=end,kind='source',label=label))
    ev('input','requests','requests/models.py',140,152,'字符串请求体保留原值')
    ev('prepare','requests','requests/models.py',552,587,'准备请求体和 Content-Length')
    ev('length','requests','requests/utils.py',133,148,'super_len 使用对象长度')
    ev('adapter','requests','requests/adapters.py',469,500,'适配器同时传递请求体和已有头部')
    ev('encode','urllib3','urllib3/util/request.py',189,219,'传输层将字符串转换为字节')
    ev('transport','urllib3','urllib3/connection.py',355,411,'传输层保留已有长度头并发送字节')
    def node(id,title,role,detail,refs):return dict(id=id,title=title,role=role,detail=detail,evidence=refs)
    nodes=[node('input','同一份请求正文','step','字符串或已编码字节进入 Requests。',['input']),
        node('length','准备长度：直接使用 len(body)','failure','Unicode 字符串的 len 是字符数，尚未转换为发送字节。',['length','prepare']),
        node('header','Content-Length 请求头','step','准备阶段将长度写入头部，后续传输层保留这个值。',['prepare','transport']),
        node('encode','传输编码：转换为 UTF-8','guard','urllib3 2.0.7 按 UTF-8 生成实际发送字节。',['encode']),
        node('wire','发送给网络层的正文','step','真实编码路径输出字节；验证只替换网络发送端。',['transport'])]
    edges=[dict(**{'from':a,'to':b},label=label,basis='source',evidence=refs) for a,b,label,refs in [
        ('input','length','准备长度',['input','prepare']),('length','header','写入头部',['length','prepare']),
        ('input','encode','传递正文',['adapter','encode']),('encode','wire','发送字节',['encode','transport'])]]
    reasons={'contract':('头部按字节标记长度；传输层生成字节并尊重已有 Content-Length。',['transport']),
        'reachability':('合法 data 字符串经过 prepare_body，再由适配器同时传给 urllib3 的 body 和 headers。',['input','prepare','adapter']),
        'violation':('准备长度时直接 len(str)，在传输编码前将字符数写为字节长度。',['length','prepare']),
        'impact':('多字节字符串的声明长度短于实际发送正文；接收端后果取决于其读取策略。',['encode','transport']),
        'protections':('提前编码的 bytes 和 ASCII 长度一致；已有长度头使传输层不再重算头部。',['length','transport'])}
    finding=dict(key={'repository':'requests','subject':'PreparedRequest.prepare_content_length','concern':'unicode-length-before-utf8'},
        title='中文正文发送 6 字节，请求头却声明 2 字节',severity='P2',verdict='static_confirmed',scope=['request-body-framing'],
        trigger='Requests 2.31.0 搭配 urllib3 2.0.7，直接通过 data 传入包含多字节字符的字符串。',
        impact='Content-Length 小于实际正文长度；按头部长度读取的接收端可能只读到部分正文。本次未运行真实服务端。',
        recommendation='在计算 Content-Length 前确定发送编码，或使用已编码的 bytes；保留 ASCII 与 bytes 对照。',
        next_query='在目标版本重新执行三个用例，并检查长度头和发送正文的字节数一致。',
        presentation={'summary':'同一份“中文”正文，准备阶段按 2 个字符计数，传输阶段编码为 6 字节。','condition':'直接传入 Unicode 字符串，且 UTF-8 字节数大于字符数。','caption':'上方是声明长度，下方是实际发送字节；两条路径应得出相同长度。'},
        checks={k:{'state':'supported','reason':reason,'evidence':refs} for k,(reason,refs) in reasons.items()},
        counterevidence=[{'reason':'ASCII 字符串和预编码 bytes 的长度一致；问题限定为直接传入的多字节字符串。','evidence':['length','encode']}],
        gaps=['没有运行真实 HTTP 服务端，未验证服务器截断、超时或连接复用后果。','这是公开历史问题的回放，不代表当前 Requests 版本仍有此问题。'],
        graph={'kind':'data_flow','nodes':nodes,'edges':edges},acceptance=[{'id':'length-match','text':'ASCII、Unicode、bytes 三类输入的声明长度均等于实际发送字节数。'}])
    draft=dict(project='Requests 2.31.0 · 开源历史案例',run=dict(id='requests-v2310',label='公开历史问题 #6586 · 源码回放',mode='source',reviewer='source-review-discovery',
        sources=[{'id':'requests','root':str(root),'revision':revision},{'id':'urllib3','root':str(deps),'revision':'urllib3-2.0.7'}],
        coverage={'status':'partial','checked':['request-body-framing'],'excluded':['真实网络服务端','其他 Requests 行为'],'limitations':['目录图仅覆盖 Requests；urllib3 以源码证据关联。','此案例验证交付流程，不评估盲审发现率。']},
        tools=[{'name':'源码阅读与隔离执行','version':'Requests 2.31.0 / urllib3 2.0.7'}]),evidence=evidence,findings=[finding])
    report=rr.publish(draft);f=report['findings'][0]
    probe=Path(__file__).with_name('requests_probe.py')
    spec=dict(claim='已声明长度与真实传输编码后的字节数不一致；ASCII 和 bytes 为正常对照。',
        limitations=['仅替换网络发送端，保留原版准备、编码和头部处理函数。','没有请求公网或本地服务；不证明实际用户影响或发生频率。'],
        isolation=['禁止创建 socket；捕获原版 HTTPConnection.request 的发送参数。'],
        input_basis=['input','prepare','encode'],targets=[{'repository':e['repository'],'path':e['path']} for e in evidence],
        scripts=[str(probe)],command=[sys.executable,str(probe),str(root),str(deps)])
    record=verify_finding.run(report,f['id'],spec)
    assert record['outcome']=='reproduced',record['execution']
    sources={'sources':[{'id':'requests','repository':'requests','title':'Requests · HTTP 客户端','root':str(root),'revision':revision,'language':'py','entry':'requests','exclude':[]} ]}
    rr.write_new(out/'sources.json',sources)
    subprocess.run(['node',str(SKILL/'scripts/architecture.mjs'),str(out/'sources.json'),str(out/'structure')],check=True)
    report=rr.enrich(report,rr.read(out/'structure/architecture.json'),[record])
    rr.write_new(out/'review.json',report)
    scenes=[]
    for name,title,kind,text,header,wire in [('ascii','ASCII 字符串','control','AB',2,2),('unicode','中文字符串','trigger','中文',2,6),('encoded','提前编码 bytes','control','中文 → UTF-8 bytes',6,6)]:
        scenes.append(dict(id=name,title=title,kind=kind,input={'origin':'synthetic','groups':[{'label':'请求正文','fields':[{'label':'data','value':text,'unit':''}]}],'evidence':['input']},
            states=[{'node':'length','summary':f'准备阶段记录长度 {header}，写入 Content-Length。','basis':'source','evidence':['length','prepare']},
                    {'node':'encode','summary':f'原版传输编码产生 {wire} 字节。已有长度头保持为 {header}。','basis':'source','evidence':['encode','transport']}],
            verification_case={'run':f['run'],'name':name}))
    scene=dict(schema_version=2,report_digest=rr.report_digest(report),finding_id=f['id'],input_node='input',
        lanes=[{'id':'declared','title':'声明长度','nodes':['length','header'],'output_node':'header','measure':{'label':'Content-Length','unit':'字节','actual_key':'header_bytes'}},
               {'id':'actual','title':'传输正文','nodes':['encode','wire'],'output_node':'wire','measure':{'label':'编码后的正文长度','unit':'字节','actual_key':'wire_bytes'}}],
        scenarios=scenes,default_scenario='unicode',focus={'length':{'evidence':'length','start':133,'end':141,'highlight':[137,138]},'encode':{'evidence':'encode','start':210,'end':219,'highlight':[215,216,217]}})
    rr.write_new(out/'scene.json',scene)
    rr.bundle(report,[scene],out/'site')
    print(json.dumps({'site':str(out/'site'),'finding':f['id'],'cases':record['cases']},ensure_ascii=False))

if __name__=='__main__':main()
