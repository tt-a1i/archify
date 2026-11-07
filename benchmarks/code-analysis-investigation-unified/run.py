#!/usr/bin/env python3
"""Compose existing fixed-source graders without executing analyzed projects."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

p=argparse.ArgumentParser()
p.add_argument('--cli',type=Path,required=True)
p.add_argument('--samples-root',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
p.add_argument('--product-sha',required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[2]
a.cli=a.cli.resolve();a.samples_root=a.samples_root.resolve();a.out=a.out.resolve()
assert not a.out.exists(), 'Use a fresh output directory.'
assert a.cli.is_file();a.out.mkdir(parents=True)
recipes=[('go-direct','code-analysis-go-rust/run-go.py',['--samples-root',a.samples_root]),('go-sdk','code-analysis-go-stdlib-types/run.py',['--samples-root',a.samples_root]),('rust-direct','code-analysis-go-rust/run-rust.py',['--samples-root',a.samples_root]),('rust-inherent','code-analysis-rust-inherent-functions/run.py',['--samples-root',a.samples_root]),('java-arity','code-analysis-java-fixed-arity/run.py',['--samples-root',a.samples_root]),('js-default','code-analysis-js-default-reference-calls/run.py',['--samples-root',a.samples_root]),('ts-alias','code-analysis-ts-captured-alias-calls/run.py',['--sample',a.samples_root/'redux']),('py-import','code-analysis-python-import-calls/run.py',['--sources',a.samples_root,'--product-sha',a.product_sha]),('py-reexport','code-analysis-python-reexports/run.py',['--samples-root',a.samples_root])]
commands=[]
for name,script,args in recipes:
    harness=root/'benchmarks'/script;assert harness.is_file()
    cmd=[sys.executable,str(harness),'--cli',str(a.cli),'--out',str(a.out/name),*map(str,args)]
    proc=subprocess.run(cmd,capture_output=True,text=True,cwd=root)
    (a.out/(name+'.stdout')).write_text(proc.stdout);(a.out/(name+'.stderr')).write_text(proc.stderr)
    commands.append(dict(name=name,exit=proc.returncode,command=cmd))
    (a.out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
    print(name,'exit',proc.returncode,flush=True)
    if proc.returncode:print(proc.stderr[-1000:],flush=True)
sys.exit(any(c['exit'] for c in commands))
