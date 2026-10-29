from pathlib import Path
import json, os, shlex, subprocess, tempfile
r=Path('/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round28')
old=json.loads((r.parent/'2026-10-30-reading-round27/source/probe-1.json').read_text())
expected=next(c for c in old['cases'] if c['case']=='same-endpoints')
commands=(r/'copied-commands.sh').read_text().splitlines()
assert commands==['git diff --cached -- value.txt','git diff -- value.txt','git diff HEAD -- value.txt']
with tempfile.TemporaryDirectory(prefix='archify-copied-diff-') as d:
 env=dict(os.environ,GIT_CONFIG_GLOBAL=os.devnull,GIT_CONFIG_SYSTEM=os.devnull,GIT_CONFIG_NOSYSTEM='1')
 def git(*args):
  return subprocess.run(['/usr/bin/git',*args],cwd=d,env=env,text=True,capture_output=True,check=True).stdout
 git('init','-q');git('config','user.name','Explainer fixture');git('config','user.email','fixture@example.invalid')
 f=Path(d)/'value.txt';f.write_text(expected['head']);git('add','--','value.txt');git('commit','-qm','fixture')
 f.write_text(expected['index']);git('add','--','value.txt');f.write_text(expected['worktree'])
 def state(): return [git('rev-parse','HEAD'),git('show',':value.txt'),f.read_text()]
 before=state();results=[]
 for command in commands:
  args=shlex.split(command);out=git(*args[1:]);key=command.split(' -- value.txt')[0]
  assert out==expected['diffs'][key]
  results.append({'command':command,'stdout':out,'matchesPriorProbe':True})
 assert before==state()
 result={'ok':True,'gitVersion':git('--version').strip(),'scope':'exact payload intercepted from actual Copy button; isolated tracked-file repository; OS clipboard permission not exercised','commands':results,'readOnlyPreserved':True}
 (r/'copy-run.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'ok':True,'commands':len(results),'readOnlyPreserved':True}))
