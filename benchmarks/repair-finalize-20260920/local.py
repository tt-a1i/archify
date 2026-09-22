"""Compare the prescribed post-repair routes, with identical JSON and final gates."""
import argparse, hashlib, json, os, pathlib, re, statistics, subprocess, time

NODE='/opt/homebrew/opt/node@22/bin/node'
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x): p.write_text(json.dumps(x,indent=2)+'\n')
def main():
 p=argparse.ArgumentParser();p.add_argument('--base',type=pathlib.Path,required=True);p.add_argument('--candidate',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
 a.out.mkdir(parents=True,exist_ok=False)
 fixtures={'small':'starter.architecture.json','medium':'web-app.architecture.json','stress':'production-deployment.architecture.json'}
 write(a.out/'protocol.json',{'fixtures':fixtures,'scope':'post-repair fixed candidate; no authored source assertions','rounds':10,'warmups':1,'order':'M,E on even rounds; E,M on odd rounds','cold':'fresh CLI and Chrome processes; OS cache uncontrolled','node':NODE,'chrome':CHROME,'bytes':'Candidate identical. Final diagram SVG identical; receipt/output path, timestamps, provenance IDs may differ. No geometry difference allowed.','M':'standalone validate then hash-bound finalize','E1':'direct finalize','not_measured':'model adoption or request saving'})
 rows=[]
 for label,name in fixtures.items():
  src=a.base/'archify/examples'/name;candidate=a.out/(label+'.json');candidate.write_bytes(src.read_bytes());identity=sha(candidate)
  for rep in range(11):
   for v in (['M','E1'] if rep%2==0 else ['E1','M']):
    d=a.out/f'{label}-{rep:02}-{v}';d.mkdir();html=d/'diagram.html';cli=(a.base if v=='M' else a.candidate)/'archify/bin/archify.mjs'
    common=['architecture',str(candidate),'--quality','showcase','--json']
    commands=[('finalize',['finalize','architecture',str(candidate),str(html),'--quality','showcase','--json'])]
    if v=='M':commands.insert(0,('validate',['validate',*common]));commands[-1][1].extend(['--candidate-sha256',identity])
    start=time.monotonic();checks=[]
    for command,args in commands:
     t=time.monotonic()
     try:
      r=subprocess.run([NODE,str(cli),*args],env=dict(os.environ,ARCHIFY_CHROME=CHROME),capture_output=True,text=True,timeout=90)
      code=r.returncode;stdout=r.stdout;stderr=r.stderr
     except subprocess.TimeoutExpired:code=124;stdout='';stderr='supervisor timeout'
     checks.append({'command':command,'duration_ms':1000*(time.monotonic()-t),'exit_code':code})
     (d/(command+'.stdout.json')).write_text(stdout);(d/(command+'.stderr.txt')).write_text(stderr)
     if code:break
    row={'fixture':label,'repeat':rep,'warmup':rep==0,'variant':v,'duration_ms':1000*(time.monotonic()-start),'checks':checks,'status':'passed' if all(c['exit_code']==0 for c in checks) else 'failed','candidate_sha256':identity,'artifact_sha256':sha(html) if html.exists() else None}
    if html.exists():
     svg=re.search(r'<svg\b[^>]*id="diagram-svg"[\s\S]*?</svg>',html.read_text())
     if not svg: svg=re.search(r'<svg\b[\s\S]*?</svg>',html.read_text())
     row['svg_sha256']=hashlib.sha256(svg.group().encode()).hexdigest() if svg else None
    rows.append(row);write(a.out/'runs.json',rows);print(json.dumps(row),flush=True)
    if row['status']!='passed':raise SystemExit('Fixed fixture failed: retain evidence, do not time failing pipeline as a speedup')
    assert sha(candidate)==identity
  group=[x for x in rows if x['fixture']==label]
  assert len({x['svg_sha256'] for x in group})==1 and group[0]['svg_sha256'],'Geometry changed'
 summary={}
 for f in fixtures:
  values={v:[r['duration_ms'] for r in rows if r['fixture']==f and r['variant']==v and not r['warmup']] for v in ['M','E1']}
  summary[f]={v:{'median_ms':statistics.median(x),'min_ms':min(x),'max_ms':max(x),'n':len(x)} for v,x in values.items()}
  summary[f]['paired_saved_ms']=[values['M'][i]-values['E1'][i] for i in range(10)]
 write(a.out/'summary.json',summary)
if __name__=='__main__':main()
