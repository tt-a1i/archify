#!/usr/bin/env python3
"""Common machine and capture checks on frozen output; never assert semantic pass."""
import argparse, hashlib, json, os, pathlib, subprocess, time

def hashfile(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--run-dir',type=pathlib.Path,required=True);ap.add_argument('--workspace',type=pathlib.Path,required=True);ap.add_argument('--common-skill',type=pathlib.Path,required=True);ap.add_argument('--out-name',default='machine-review');a=ap.parse_args()
 summary=a.run_dir/'summary.json'
 if not summary.exists():raise SystemExit('Author must be terminal before independent verification')
 output=a.run_dir/a.out_name
 if output.exists():raise SystemExit('Review exists; keep original evidence rather than overwrite')
 output.mkdir();cli=a.common_skill/'bin/archify.mjs';node='/opt/homebrew/opt/node@22/bin/node'
 env=dict(os.environ,ARCHIFY_CHROME=str(a.workspace/'chrome-wrapper'),TMPDIR=str(a.workspace/'tmp'))
 rows=[];t0=time.monotonic();before={p.name:hashfile(p) for p in [a.workspace/'candidate.json',a.workspace/'diagram.html'] if p.exists()}
 metadata=json.loads((a.run_dir/'metadata.json').read_text());legacy=metadata.get('variant')=='A'
 strict=[] if legacy else ['--require-provenance']
 def command(name,args):
  st=time.monotonic();p=subprocess.run(list(map(str,args)),cwd=a.workspace,env=env,capture_output=True,text=True,timeout=90)
  (output/(name+'.stdout.txt')).write_text(p.stdout);(output/(name+'.stderr.txt')).write_text(p.stderr)
  row={'name':name,'exit_code':p.returncode,'duration_ms':1000*(time.monotonic()-st),'command':list(map(str,args)),'status':'passed' if p.returncode==0 else 'failed'};rows.append(row);return p.returncode
 def run(name,args):return command(name,[node,str(cli),*args])
 candidate=a.workspace/'candidate.json';artifact=a.workspace/'diagram.html';source=a.workspace/'source'
 if candidate.exists():run('common-final-validate',['validate','architecture',candidate,'--repo-root',source,'--quality','showcase','--json'])
 identity=None
 if legacy and candidate.exists() and artifact.exists():
  # Legacy A has an inline deliver receipt, not B's persistent sidecar.
  # Bind actual observed native output; never manufacture a delivery sidecar.
  receipts=[];decoder=json.JSONDecoder()
  for line in (a.run_dir/'events.jsonl').read_text().splitlines():
   event=json.loads(line)
   if event.get('exit_code')!=0 or 'archify.mjs deliver ' not in (event.get('command') or ''):continue
   raw=event.get('output') or ''
   for offset,char in enumerate(raw):
    if char!='{':continue
    try:item,_=decoder.raw_decode(raw[offset:])
    except ValueError:continue
    if isinstance(item,dict) and item.get('command')=='deliver' and item.get('ok') is True:receipts.append(item)
  bound=any(x.get('specification',{}).get('sha256')==before['candidate.json'] and x.get('artifact',{}).get('sha256')==before['diagram.html'] for x in receipts)
  target_sha=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
  identity={'status':'passed' if bound and target_sha==metadata['target_repo_sha'] else 'failed','candidate_sha256':before['candidate.json'],'artifact_sha256':before['diagram.html'],'target_repo_sha':target_sha,'basis':'captured successful native A deliver stdout receipt and independently recomputed file hashes; target SHA checked','persistent_provenance':'unavailable in A; no sidecar synthesized'}
  (output/'external-identity.json').write_text(json.dumps(identity,indent=2)+'\n')
 if artifact.exists():
  checked=run('common-final-check',['check',artifact,*strict])
  if checked==0:
   run('common-final-browser',['browser-check',artifact,*strict,'--out-dir',output/'final-browser','--json'])
   run('common-final-captures',['visual-check',artifact,*strict,'--out-dir',output/'final-visual','--json'])
   command('common-final-1920',[node,pathlib.Path(__file__).parent/'capture-1920.mjs',a.common_skill,artifact,output/'final-visual'])
 snapshots=a.run_dir/'candidate-snapshots.jsonl'
 # Every snapshot is retained; select the observer's first structural complete.
 index=[json.loads(line) for line in snapshots.read_text().splitlines() if line.strip()] if snapshots.exists() else []
 if isinstance(index,dict):index=index.get('snapshots',index.get('candidates',[]))
 first=next((x for x in index if x.get('complete')),None)
 if first:
  files=sorted((a.run_dir/'candidate-snapshots').glob('*.json'))
  snap=next((p for p in files if hashfile(p)==first['sha256']),None)
  if snap:
   valid=run('common-first-validate',['validate','architecture',snap,'--repo-root',source,'--quality','showcase','--json'])
   if valid==0:
    html=output/'first.html'
    delivered=run('common-first-deliver',['deliver','architecture',snap,html,'--repo-root',source,'--quality','showcase','--json'])
    if delivered==0:
     run('common-first-captures',['visual-check',html,'--require-provenance','--out-dir',output/'first-visual','--json'])
     command('common-first-1920',[node,pathlib.Path(__file__).parent/'capture-1920.mjs',a.common_skill,html,output/'first-visual'])
 after={name:hashfile(a.workspace/name) for name in before}
 report={'status':'machine_checked; semantic and perceptual review pending','adapter_revision':2,'legacy_A':legacy,'external_identity':identity,'checks':rows,'duration_ms':1000*(time.monotonic()-t0),'author_bytes_unchanged':before==after,'frozen_hashes':before,'first_snapshot':first,'common_skill':str(a.common_skill),'warning':'Common B checks supplement each variant native gate; images must actually be inspected. B JSON validation rerenders with B and is diagnostic for legacy A geometry, never a replacement for actual A artifact metrics. A uses observed inline receipt hashes instead of unavailable persistent provenance. First snapshot audit cost is separate from final acceptance.'}
 (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'checks':len(rows),'author_bytes_unchanged':before==after,'output':str(output)}))
if __name__=='__main__':main()
