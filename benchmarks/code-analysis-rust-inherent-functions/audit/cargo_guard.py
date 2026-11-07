"""Only metadata/version subprocesses are allowed in the optional LSP audit."""
import json, os, sys
from pathlib import Path
settings=json.loads(Path(sys.argv[1]).read_text());requested=sys.argv[2:]
command=next((a for a in requested if not a.startswith('+')), '')
allowed=command in ['metadata','--version','-V','version','locate-project'];args=list(requested)
if command=='metadata':
 for flag in ['--locked','--offline']:
  if flag not in args:args.append(flag)
with open(settings['log'],'a')as f:f.write(json.dumps({'requested':requested,'allowed':allowed,'executed':args if allowed else None})+'\n')
if not allowed:
 print('Audit rejects Cargo execution: '+repr(requested),file=sys.stderr);sys.exit(97)
os.execv(settings['cargo'],[settings['cargo'],*args])
