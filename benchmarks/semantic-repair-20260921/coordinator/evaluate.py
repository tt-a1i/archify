import pathlib,json,subprocess,sys,time,hashlib,datetime
T=pathlib.Path('/private/tmp/archify-semantic-repair-20260921');O=pathlib.Path('/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-repair-20260921');node='/opt/homebrew/opt/node@22/bin/node'
for run in sys.argv[1:]:
 root=T/'runs'/run;obs=O/run;cli=root/'archify/bin/archify.mjs';receipt=json.loads((obs/'receipt.json').read_text());trace=json.loads((obs/'native-trace.json').read_text());start=datetime.datetime.fromisoformat(trace['task_started_at'].replace('Z','+00:00')).timestamp();results=[]
 for snap in receipt['snapshots']:
  if not snap['structurally_complete']:continue
  candidate=obs/f"snapshot-{snap['index']:03}.json";p=subprocess.run([node,str(cli),'validate','architecture',str(candidate),'--quality','showcase','--repo-root',str(root/'source'),'--json'],capture_output=True,text=True);(obs/f"snapshot-{snap['index']:03}.validate.json").write_text(p.stdout);(obs/f"snapshot-{snap['index']:03}.validate.stderr").write_text(p.stderr)
  try:d=json.loads(p.stdout)
  except ValueError:d={}
  results.append({'snapshot':snap['index'],'sha256':snap['sha256'],'from_native_start_seconds':receipt['start_epoch']+snap['elapsed_seconds']-start,'validation_exit':p.returncode,'codes':sorted(set(x.get('code') for x in d.get('diagnostics',[]) if x.get('code')))})
 result={'snapshots':results,'note':'post-run checking of exact preserved bytes, separate from author timing and semantic/perceptual acceptance'};html=root/'output/diagram.html'
 if html.exists():
  p=subprocess.run([node,str(cli),'visual-check',str(html),'--require-provenance','--out-dir',str(obs/'visual'),'--json'],capture_output=True,text=True);(obs/'visual.json').write_text(p.stdout);(obs/'visual.stderr').write_text(p.stderr);result['visual_exit']=p.returncode
 first=next((x for x in results),None)
 if first:
  current=root/'output/candidate.json';same=current.exists() and hashlib.sha256(current.read_bytes()).hexdigest()==first['sha256']
  if same and html.exists():result['first_visual']={'reused_final':True,'candidate_sha256':first['sha256']}
  elif first['validation_exit']==0:
   candidate=obs/f"snapshot-{first['snapshot']:03}.json";first_html=obs/'first-diagram.html'
   q=subprocess.run([node,str(cli),'finalize','architecture',str(candidate),str(first_html),'--repo-root',str(root/'source'),'--quality','showcase','--json'],capture_output=True,text=True);(obs/'first-finalize.json').write_text(q.stdout);(obs/'first-finalize.stderr').write_text(q.stderr)
   result['first_visual']={'postrun_finalize_exit':q.returncode,'candidate_sha256':first['sha256'],'postrun_only':True}
   if q.returncode==0:
    v=subprocess.run([node,str(cli),'visual-check',str(first_html),'--require-provenance','--out-dir',str(obs/'first-visual'),'--json'],capture_output=True,text=True);(obs/'first-visual.json').write_text(v.stdout);(obs/'first-visual.stderr').write_text(v.stderr);result['first_visual']['visual_exit']=v.returncode
  else:result['first_visual']={'available':False,'reason':'first candidate fails production validation; no accepted artifact to capture','candidate_sha256':first['sha256']}
 (obs/'evaluation.json').write_text(json.dumps(result,indent=2)+'\n');print(run,json.dumps(result),flush=True)
