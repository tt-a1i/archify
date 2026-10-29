import json, pathlib, subprocess, tempfile, sys, hashlib
root = pathlib.Path(__file__).parent
copies = json.loads((root / 'copies.json').read_text())
assert copies['payloads'] == copies['visible'] and len(copies['payloads']) == 2
program, expected = copies['payloads']
with tempfile.TemporaryDirectory(prefix='networkx-copied-') as temp:
    target = pathlib.Path(temp) / 'example.py'
    target.write_bytes(program.encode())
    result = subprocess.run([sys.executable, str(target)], cwd=temp, capture_output=True, text=True, check=True)
    assert result.stdout == expected + '\n' and result.stderr == ''
print(json.dumps({'python': sys.version, 'executable':sys.executable, 'programSha256':hashlib.sha256(program.encode()).hexdigest(), 'returncode':result.returncode, 'stdout':result.stdout, 'stderr':result.stderr, 'expectedCopiedOutput':expected, 'exactMatch':True, 'temporaryDirectoryRemoved':True}, indent=2) + '\n', end='')
