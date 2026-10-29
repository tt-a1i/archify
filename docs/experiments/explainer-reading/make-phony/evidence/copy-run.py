from pathlib import Path
import os,subprocess,tempfile,json,hashlib
r=Path('/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round29')
copies=json.loads((r/'copies.json').read_text())['payloads']
probe=json.loads((r/'source/probe-1.json').read_text())
assert copies[:2]==[probe['cases'][0]['makefile'].rstrip('\n'),probe['cases'][2]['makefile'].rstrip('\n')]
assert copies[2]==probe['cases'][4]['makefile'].rstrip('\n')
assert copies[3]=="printf 'hello\\n' > input.txt\nmake check\nmake check"
env={k:v for k,v in os.environ.items() if k not in ['MAKEFLAGS','MFLAGS','MAKEFILES','GNUMAKEFLAGS','MAKELEVEL']};env.update(PATH='/usr/bin:/bin',LC_ALL='C',LANG='C')
results=[]
with tempfile.TemporaryDirectory(prefix='archify-make-copy-') as root:
 for index,phony in [(0,False),(1,True)]:
  for exists in [False,True]:
   p=Path(root)/f'{index}-{exists}';p.mkdir();(p/'Makefile').write_text(copies[index]+'\n')
   if exists:(p/'check').write_text('preserve me\n')
   out=[]
   for _ in range(2):out.append(subprocess.run(['/usr/bin/make','--no-print-directory','check'],cwd=p,env=env,text=True,capture_output=True,check=True).stdout)
   expected=next(c for c in probe['cases'] if c.get('phony')==phony and c.get('sameNameFile')==exists)
   assert out==[c['stdout'] for c in expected['calls']]
   if exists:assert (p/'check').read_text()=='preserve me\n'
   results.append({'case':expected['case'],'stdout':out,'matchesProbe':True,'filePreserved':True})
 p=Path(root)/'complete';p.mkdir();(p/'Makefile').write_text(copies[2]+'\n')
 call=subprocess.run(['/bin/sh','-c',copies[3]],cwd=p,env=env,text=True,capture_output=True,check=True)
 assert call.stdout=='built\nchecked\nchecked\n' and call.stderr==''
 assert (p/'input.txt').read_text()==(p/'report.txt').read_text()=='hello\n'
 results.append({'case':'complete-copied-example','stdout':call.stdout,'stderr':call.stderr,'exitCode':call.returncode,'output':'hello\n'})
result={'ok':True,'scope':'only copied Makefiles and shell payload in disposable directories; Clipboard API interception, not OS clipboard permission','tabCounts':[s.count('\t') for s in copies[:3]],'results':results}
(r/'copy-run.json').write_text(json.dumps(result,indent=2)+'\n');print({'ok':True,'cases':len(results),'tabCounts':result['tabCounts']})
