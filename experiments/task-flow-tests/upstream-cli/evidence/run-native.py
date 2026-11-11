from pathlib import Path
import subprocess,json,hashlib,time
raw=Path(__file__).resolve().parent
source=Path('ARCHIVED_WORKSPACE')
packet=source/'experiments/task-flow-tests/upstream-cli'
run=raw/'run';run.mkdir(exist_ok=False)
binary=raw/'task-view-darwin-arm64'
assert hashlib.sha256(binary.read_bytes()).hexdigest()=='4b4d5b7076db29c31ca70c6693ec88d7ed57b30f39a7e2e1c4b090413b6d9f1a'
records=[]
def command(name,args,cwd=run):
 start=time.monotonic();result=subprocess.run(args,cwd=cwd,capture_output=True)
 (run/(name+'.stdout')).write_bytes(result.stdout);(run/(name+'.stderr')).write_bytes(result.stderr)
 records.append({'name':name,'argv':list(map(str,args)),'exitCode':result.returncode,'seconds':time.monotonic()-start,'stdoutBytes':len(result.stdout),'stderrBytes':len(result.stderr)})
 (run/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
 return result
assert command('clone',['git','clone','--shared','--no-checkout',str(source),'repository']).returncode==0
assert command('checkout',['git','-C','repository','checkout','--detach','ed62bfefaf490e831259261fdc12f985267590fb']).returncode==0
before=command('status-before',['git','-C','repository','status','--porcelain']);assert before.returncode==0 and not before.stdout
assert command('head',['git','-C','repository','rev-parse','HEAD']).returncode==0
for name in ['shared-review','shared-review-invalid-range']:
 original=(packet/'inputs'/(name+'.json')).read_text()
 assert original.count('<REPOSITORY_ROOT>')==1
 (run/(name+'.json')).write_text(original.replace('<REPOSITORY_ROOT>','repository'))
 command(name+'-validate',[str(binary),'validate',name+'.json','--format','json'])
command('shared-review-open',[str(binary),'open','shared-review.json','--out','native.html','--no-browser'])
after=command('status-after',['git','-C','repository','status','--porcelain']);assert after.returncode==0 and before.stdout==after.stdout
input_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (packet/'inputs').glob('*.json')}
(run/'identity.json').write_text(json.dumps({'portableBinarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'inputTemplates':input_hashes,'repositoryHead':'ed62bfefaf490e831259261fdc12f985267590fb','repositoryStatusBeforeAfter':'clean','scope':'Native public review validation and HTML generation only; no historical code, test, build or installation commands.'},indent=2)+'\n')
print(json.dumps(records,indent=2))
