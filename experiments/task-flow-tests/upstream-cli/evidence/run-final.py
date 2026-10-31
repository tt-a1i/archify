from pathlib import Path
import subprocess,json,hashlib,time
raw=Path(__file__).resolve().parent
packet=Path('ARCHIVED_WORKSPACE/experiments/task-flow-tests/upstream-cli')
run=raw/'final-run';run.mkdir(exist_ok=False);binary=raw/'task-view-darwin-arm64';repo=raw/'run/repository'
before=subprocess.check_output(['git','-C',str(repo),'status','--porcelain']);assert not before
records=[]
for name in ['shared-review','shared-review-invalid-range']:
 original=(packet/'inputs'/(name+'.json')).read_text();assert original.count('<REPOSITORY_ROOT>')==1
 (run/(name+'.json')).write_text(original.replace('<REPOSITORY_ROOT>','../run/repository'))
for name,args in [('shared-review-validate',['validate','shared-review.json','--format','json']),('shared-review-invalid-range-validate',['validate','shared-review-invalid-range.json','--format','json']),('shared-review-open',['open','shared-review.json','--out','native.html','--no-browser'])]:
 start=time.monotonic();result=subprocess.run([str(binary),*args],cwd=run,capture_output=True)
 (run/(name+'.stdout')).write_bytes(result.stdout);(run/(name+'.stderr')).write_bytes(result.stderr)
 records.append({'name':name,'argv':[str(binary),*args],'exitCode':result.returncode,'seconds':time.monotonic()-start,'stdoutBytes':len(result.stdout),'stderrBytes':len(result.stderr)})
 (run/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
after=subprocess.check_output(['git','-C',str(repo),'status','--porcelain']);assert before==after
(run/'repository-status.txt').write_bytes(after)
print(json.dumps(records,indent=2))
