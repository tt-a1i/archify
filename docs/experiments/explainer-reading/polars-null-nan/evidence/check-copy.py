from pathlib import Path
import ast,json,subprocess
r=Path(__file__).parent;python=str(r/'venv/bin/python')
p=json.loads((r/'source/probe-1.json').read_text());cases={x['id']:x for x in p['cases']}
def decoded(v):
 return None if v['kind']=='null' else float('nan') if v['kind']=='nan' else v['value']
lines=[]
for label,key in [('fill_null','fill_null_0'),('nan_to_null','nan_to_null'),('both_to_zero','both_to_0')]:
 c=cases[key];lines.append(f"{label} {[decoded(v) for v in c['result']]} mean: {decoded(c['mean'])}")
expected='\n'.join(lines)+'\n';trees=[];checks=[]
for version in ['author','candidate-1']:
 f=r/(version+'-copied.py');trees.append(ast.dump(ast.parse(f.read_text()),include_attributes=False))
 run=subprocess.run([python,str(f)],capture_output=True,text=True);(r/(version+'-copied.stdout')).write_text(run.stdout)
 assert run.returncode==0,run.stderr
 assert run.stdout==expected,(run.stdout,expected)
 checks.append({'version':version,'exit':run.returncode,'stdoutMatchesThreeProbeResultsAndMeans':True})
assert trees[0]==trees[1]
print(json.dumps({'checks':checks,'pythonASTIdentical':True,'clipboard':'Actual Copy controls captured through an instrumented Clipboard API; not an OS clipboard-permission test.'},indent=2))
