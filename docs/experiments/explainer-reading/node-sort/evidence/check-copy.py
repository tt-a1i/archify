from pathlib import Path
import hashlib,json,subprocess
r=Path(__file__).parent
node='/Users/tsk/.local/share/archify-tuning/rounds/pr671-20261025/tools/node-v22.23.3-darwin-arm64/bin/node'
p=json.loads((r/'source/probe-1.json').read_text())
expected=[]
for label,c in zip(['sort 默认','sort 数值','toSorted 默认','toSorted 数值'],p['cases'][:4]):
 enc=lambda a:json.dumps(a,separators=(',',':'))
 expected.append(f"{label} {enc(c['result'])} {enc(c['after'])} {str(c['returnsSameArray']).lower()}")
expected.append('类型 '+','.join(p['cases'][0]['resultTypes']))
expected='\n'.join(expected)+'\n'
checks=[]
for version in ['author','candidate-1']:
 f=r/(version+'-copied.mjs')
 syntax=subprocess.run([node,'--check',str(f)],capture_output=True,text=True)
 run=subprocess.run([node,str(f)],capture_output=True,text=True)
 (r/(version+'-copied.stdout')).write_text(run.stdout)
 assert syntax.returncode==0 and run.returncode==0,(syntax.stderr,run.stderr)
 assert run.stdout==expected
 assert run.stdout.rstrip('\n')==(r/(version+'-output.txt')).read_text().rstrip('\n')
 checks.append({'version':version,'syntaxExit':syntax.returncode,'executionExit':run.returncode,'stdoutMatchesFourProbeResultsAndTypeCheck':True,'displayedOutputMatchesIgnoringOnlyTerminalNewline':True,'copiedSha256':hashlib.sha256(f.read_bytes()).hexdigest()})
a=''.join((r/'author-copied.mjs').read_text().split());b=''.join((r/'candidate-1-copied.mjs').read_text().split())
assert a==b
print(json.dumps({'checks':checks,'equalAfterWhitespaceRemoval':True,'qualification':'Whitespace comparison is not a JavaScript AST comparison. Manually reviewed formatting-only code diff; actual execution and probe results independently checked. Clipboard API was instrumented, not OS clipboard permissions.'},indent=2))
