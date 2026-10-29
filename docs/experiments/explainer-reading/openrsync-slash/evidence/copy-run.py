from pathlib import Path
import json,subprocess,tempfile,shlex,os
root=Path(__file__).resolve().parent
copies=json.loads((root/'copies.json').read_text())['payloads']
assert len(copies)==5
content={'.hidden':'hidden\n','a.txt':'alpha\n','nested/b.txt':'beta\n'}
assert copies[0]=='\n'.join('src/'+k for k in sorted(content))
def tree(path,prefix=''):
 entries=sorted(path.iterdir());lines=[]
 for i,p in enumerate(entries):
  last=i==len(entries)-1
  lines.append(prefix+('└── ' if last else '├── ')+p.name+('/' if p.is_dir() else ''))
  if p.is_dir():lines+=tree(p,prefix+('    ' if last else '│   '))
 return lines
results=[]
with tempfile.TemporaryDirectory(prefix='archify-copied-rsync-') as temp:
 for exists in [True,False]:
  for slash,cmdindex,treeindex in [(False,1,2),(True,3,4)]:
   p=Path(temp)/f'{exists}-{slash}';p.mkdir();src=p/'src';src.mkdir();(src/'nested').mkdir()
   for name,text in content.items():(src/name).write_text(text)
   if exists:(p/'dst').mkdir()
   argv=shlex.split(copies[cmdindex]);assert argv==['rsync','-r','--','src/' if slash else 'src','dst']
   proc=subprocess.run(['/usr/bin/rsync',*argv[1:]],cwd=p,env=dict(os.environ,LC_ALL='C'),text=True,capture_output=True,check=True)
   actual='dst/\n'+'\n'.join(tree(p/'dst'));assert actual==copies[treeindex],actual
   got={str(f.relative_to(p/'dst')):f.read_text() for f in sorted((p/'dst').rglob('*')) if f.is_file()}
   assert got=={('' if slash else 'src/')+k:v for k,v in content.items()}
   assert {str(f.relative_to(src)):f.read_text() for f in src.rglob('*') if f.is_file()}==content
   results.append(dict(destinationExisted=exists,sourceTrailingSlash=slash,command=copies[cmdindex],exitCode=proc.returncode,stdout=proc.stdout,stderr=proc.stderr,directoryTree=actual,copiedTreeMatches=True,fileContents=got,sourcePreserved=True))
print(json.dumps({'scope':'Actual reader Copy payloads; allowlisted command argv executed via /usr/bin/rsync in fresh temporary fixtures; directory trees generated from filesystem, not stdout','cases':results},indent=2)+'\n')
