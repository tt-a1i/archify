from pathlib import Path
import subprocess,tempfile,json,os
exe='/usr/bin/rsync';env=dict(os.environ,LC_ALL='C',LANG='C')
version=subprocess.run([exe,'--version'],env=env,text=True,capture_output=True,check=True).stdout
build=subprocess.run(['/usr/bin/what',exe],env=env,text=True,capture_output=True,check=True).stdout
cases=[]
with tempfile.TemporaryDirectory(prefix='archify-rsync-slash-') as root:
 for target_exists in [True,False]:
  for slash in [False,True]:
   p=Path(root)/f'exists-{target_exists}-slash-{slash}';p.mkdir();src=p/'src';src.mkdir();(src/'nested').mkdir()
   content={'a.txt':'alpha\n','nested/b.txt':'beta\n','.hidden':'hidden\n'}
   for name,text in content.items():(src/name).write_text(text)
   if target_exists:(p/'dst').mkdir()
   args=[exe,'-r','--','src/' if slash else 'src','dst']
   result=subprocess.run(args,cwd=p,env=env,text=True,capture_output=True,check=True)
   actual={str(f.relative_to(p/'dst')):f.read_text() for f in sorted((p/'dst').rglob('*')) if f.is_file()}
   assert {str(f.relative_to(src)):f.read_text() for f in sorted(src.rglob('*')) if f.is_file()}==content
   expected={('src/' if not slash else '')+k:v for k,v in content.items()}
   assert actual==expected,(target_exists,slash,actual)
   tree=[str(f.relative_to(p/'dst'))+('/' if f.is_dir() else '') for f in sorted((p/'dst').rglob('*'))]
   cases.append({'destinationExisted':target_exists,'sourceTrailingSlash':slash,'command':['rsync',*args[1:]],'stdout':result.stdout,'stderr':result.stderr,'exitCode':result.returncode,'destinationTree':tree,'fileContents':actual,'sourcePreserved':True})
print(json.dumps({'version':version,'build':build,'scope':'four local recursive-copy constructions; one source directory, target absent or empty directory; no --delete, archive metadata, symlinks, filters or remote transport','cases':cases},indent=2))
