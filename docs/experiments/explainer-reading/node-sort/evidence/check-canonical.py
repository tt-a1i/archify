from pathlib import Path
import hashlib,json,subprocess
r=Path(__file__).parent
p=json.loads((r/'source/probe-1.json').read_text());states=json.loads((r/'canonical-browser.json').read_text())
node='/Users/tsk/.local/share/archify-tuning/rounds/pr671-20261025/tools/node-v22.23.3-darwin-arm64/bin/node'
for state in states:
 assert state['width']==state['pageWidth']
 assert all(item['client']==item['scroll'] for item in state['tables']+state['code'])
 table=state['tables'][0]['rows'];assert table[0]==['比较规则','sort','toSorted']
 assert [json.loads(v) for v in table[1][1:]]==[p['cases'][0]['result'],p['cases'][2]['result']]
 assert [json.loads(v) for v in table[2][1:]]==[p['cases'][1]['result'],p['cases'][3]['result']]
 if state['width']==1440:
  panels={x['id']:x for x in state['panels']}
  assert panels['choices']['top']==panels['why']['top']
  assert panels['run']['top']>=max(panels[k]['top']+panels[k]['height'] for k in ['choices','why'])
assert (r/'canonical-copied.mjs').read_bytes()==(r/'candidate-1-copied.mjs').read_bytes()
run=subprocess.run([node,str(r/'canonical-copied.mjs')],capture_output=True,text=True);assert run.returncode==0,run.stderr
assert run.stdout==(r/'candidate-1-copied.stdout').read_text()
assert run.stdout.rstrip('\n')==(r/'canonical-output.txt').read_text().rstrip('\n')
(r/'canonical-copied.stdout').write_text(run.stdout)
print(json.dumps({'tableMatchesFourProbeCasesInFourStates':True,'pageTablesCodeFitFourStates':True,'desktopConceptualPanelsAlignAndCodeDoesNotOverlap':True,'canonicalCopyBytesMatchExecutedParent':True,'canonicalCopyExecutionExit':run.returncode,'canonicalOutputMatchesProbeVerifiedParentAndDisplayedOutput':True},indent=2))
