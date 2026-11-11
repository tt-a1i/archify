#!/usr/bin/env python3
"""Audit archived bytes and observed output, not upstream validation."""
from pathlib import Path
import json, hashlib, struct, subprocess, sys
r=Path(__file__).resolve().parent
def sha(b): return hashlib.sha256(b).hexdigest()
for f in json.loads((r/'sources.json').read_text())['files']:
    b=(r/f['path']).read_bytes()
    assert len(b)==f['bytes'] and sha(b)==f['sha256'],f['path']
    assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==f['gitBlob']
before={p.name:p.read_bytes() for p in (r/'pages').glob('*')}
subprocess.run([sys.executable,str(r/'build.py')],check=True,capture_output=True)
assert before=={p.name:p.read_bytes() for p in (r/'pages').glob('*')}
observations=0
for mode in ['shared','legacy-only','occurrences']:
    for flow in ['missing','delivered','omitted-link']:
        d=json.loads((r/'browser'/f'{mode}-{flow}.json').read_text())
        expected=int(mode=='shared' or (mode=='occurrences' and flow=='missing'))
        assert d['testCount']==expected and d['nodeCount']==2+expected
        assert sum('回归测试：缺失产物' in n['text'] for n in d['nodes'])==expected
        assert 'The account matches the diff' not in d['text']
        observations+=1
mapping=json.loads((r.parent/'input/mapping.json').read_text())
display=json.loads((r/'browser/inspector-code.json').read_text())
assert display['lines']==next(n['excerpt'].split('\n') for n in mapping['nodes'] if n['id']=='guard')
for p in (r/'images').glob('*.png'):
    assert struct.unpack('>II',p.read_bytes()[16:24])==(1440,900),p.name
manifest=json.loads((r/'manifest.json').read_text())
paths={str(p.relative_to(r)) for p in r.rglob('*') if p.is_file() and p.name!='manifest.json'}
assert paths=={x['path'] for x in manifest['files']}
for f in manifest['files']:
    b=(r/f['path']).read_bytes()
    assert len(b)==f['bytes'] and sha(b)==f['sha256'],f['path']
print(f"PASS: 10 upstream files, deterministic pages, {observations} DOM observations, exact displayed excerpt, 11 final PNGs, {len(paths)} manifest files")
