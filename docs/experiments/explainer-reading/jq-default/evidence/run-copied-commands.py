"""Run the five reviewed jq-only copied snippets in a fresh temporary directory."""
import json, pathlib, shlex, shutil, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parent
packet=json.loads((root/'copied-commands.json').read_text())
assert packet['copies']==packet['rendered']
expected=['true\n','false\n','null\n','0\n','"fallback"\n"fallback"\n0\n']
programs=['{"enabled":false}\n  | .enabled // true','{"enabled":false}\n  | .enabled\n  | if . == null then true\n    else . end','{"enabled":null}\n  | if has("enabled")\n    then .enabled\n    else true end','(false, null, 0) // "fallback"','(false, null, 0) | . // "fallback"']
rows=[]
with tempfile.TemporaryDirectory(prefix='archify-jq-copy-') as directory:
 for index,(snippet,program,stdout) in enumerate(zip(packet['copies'],programs,expected,strict=True)):
  assert shlex.split(snippet,comments=True)==['jq','-cn',program]
  command=pathlib.Path(directory)/f'command-{index+1}.sh';command.write_text(snippet+'\n')
  result=subprocess.run(['/bin/zsh','-f',str(command)],cwd=directory,text=True,capture_output=True,timeout=10)
  rows.append({'index':index+1,'shell':'/bin/zsh -f','copiedText':snippet,'expectedStdout':stdout,'stdout':result.stdout,'stderr':result.stderr,'exitCode':result.returncode,'pass':result.stdout==stdout and result.stderr=='' and result.returncode==0})
assert len(rows)==5 and all(r['pass'] for r in rows)
output={'jq':shutil.which('jq'),'version':subprocess.run(['jq','--version'],capture_output=True,text=True,check=True).stdout.strip(),'clipboardScope':packet['mode'],'copiedEqualsRendered':True,'commands':rows,'allPassed':True}
(root/'copied-command-results.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'version':output['version'],'commands':len(rows),'allPassed':True}))
