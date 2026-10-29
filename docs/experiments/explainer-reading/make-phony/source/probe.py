from pathlib import Path
import os,json,subprocess,tempfile
make='/usr/bin/make'
env={k:v for k,v in os.environ.items() if k not in ['MAKEFLAGS','MFLAGS','MAKEFILES','GNUMAKEFLAGS','MAKELEVEL']}
env.update(LC_ALL='C',LANG='C')
version=subprocess.run([make,'--version'],env=env,text=True,capture_output=True,check=True).stdout.splitlines()[0]
results=[]
with tempfile.TemporaryDirectory(prefix='archify-make-phony-') as root:
 for phony in [False,True]:
  for exists in [False,True]:
   p=Path(root)/f'p{int(phony)}-e{int(exists)}';p.mkdir()
   mf=('.PHONY: check\n' if phony else '')+"check:\n\t@printf 'checked\\n'\n"
   (p/'Makefile').write_text(mf)
   if exists:(p/'check').write_text('this is a file, not proof of a completed check\n')
   before=(p/'check').read_bytes() if exists else None
   calls=[]
   for _ in range(2):
    call=subprocess.run([make,'--no-print-directory','check'],cwd=p,env=env,text=True,capture_output=True,check=True)
    calls.append({'stdout':call.stdout,'stderr':call.stderr,'exitCode':call.returncode})
   should_run=phony or not exists
   assert all(('checked\n'==c['stdout'])==should_run for c in calls)
   assert before==((p/'check').read_bytes() if (p/'check').exists() else None)
   results.append({'case':f'phony-{str(phony).lower()}-file-{str(exists).lower()}','phony':phony,'sameNameFile':exists,'makefile':mf,'calls':calls,'recipeRuns':sum(c['stdout']=='checked\n' for c in calls),'filePreserved':True})
 # A contrasting real output: only the named action is phony, not its prerequisite.
 p=Path(root)/'real-output';p.mkdir();(p/'input.txt').write_text('hello\n')
 mf=".PHONY: check\ncheck: report.txt\n\t@printf 'checked\\n'\nreport.txt: input.txt\n\t@printf 'built\\n'\n\t@cp input.txt report.txt\n"
 (p/'Makefile').write_text(mf);calls=[]
 for _ in range(2):
  call=subprocess.run([make,'--no-print-directory','check'],cwd=p,env=env,text=True,capture_output=True,check=True)
  calls.append({'stdout':call.stdout,'stderr':call.stderr,'exitCode':call.returncode})
 assert [c['stdout'] for c in calls]==['built\nchecked\n','checked\n']
 assert (p/'report.txt').read_bytes()==(p/'input.txt').read_bytes()
 results.append({'case':'real-prerequisite-not-inherited','makefile':mf,'input':'hello\n','calls':calls,'output':'hello\n','scope':'unchanged real prerequisite builds only on first call; check is phony on both calls'})
print(json.dumps({'version':version,'scope':'five constructed cases, two ordinary explicit make invocations each; no -n/-q/-t; temporary directories, no user files','cases':results},indent=2))
