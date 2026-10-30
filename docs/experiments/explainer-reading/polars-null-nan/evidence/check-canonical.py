from pathlib import Path
import ast,json,subprocess
r=Path(__file__).parent
p=json.loads((r/'source/probe-1.json').read_text());cases={x['id']:x for x in p['cases']};states=json.loads((r/'canonical-browser.json').read_text())
def parsed(value):
 return ast.literal_eval(value.replace('NaN', "'nan'").replace('null','None'))
def encoded(v):
 return {'kind':'null'} if v is None else {'kind':'nan'} if v=='nan' else {'kind':'number','value':v}
for state in states:
 assert state['width']==state['pageWidth']
 assert all(x['client']==x['scroll'] for x in state['tables']+state['code'])
 rows=state['tables'][1]['rows'];assert len(rows)==4
 for cells,key in zip(rows[1:],['fill_null_0','nan_to_null','both_to_0']):
  assert [encoded(v) for v in parsed(cells[1])]==cases[key]['result']
  assert encoded(parsed(cells[2]))==cases[key]['mean']
 panels=state['panels']
 for i,a in enumerate(panels):
  for b in panels[i+1:]:
   overlap=min(a['right'],b['right'])-max(a['left'],b['left'])>0.1 and min(a['bottom'],b['bottom'])-max(a['top'],b['top'])>0.1
   assert not overlap,(a['id'],b['id'])
assert (r/'canonical-copied.py').read_bytes()==(r/'candidate-1-copied.py').read_bytes()
run=subprocess.run([str(r/'venv/bin/python'),str(r/'canonical-copied.py')],capture_output=True,text=True);assert run.returncode==0,run.stderr
assert run.stdout==(r/'candidate-1-copied.stdout').read_text();(r/'canonical-copied.stdout').write_text(run.stdout)
print(json.dumps({'threeResultRowsAndMeansMatchProbeInFourStates':True,'pageTablesCodeFitFourStates':True,'panelsDoNotOverlap':True,'canonicalCopyBytesMatchASTVerifiedParent':True,'canonicalCopyExecutionExit':run.returncode,'canonicalOutputMatchesProbeVerifiedParent':True},indent=2))
