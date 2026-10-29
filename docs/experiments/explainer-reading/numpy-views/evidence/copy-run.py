import ast, hashlib, json, pathlib, subprocess, sys, tempfile
import numpy as np
root = pathlib.Path(__file__).parent
value = json.loads((root / 'copies.json').read_text())
assert value['copied'] == value['visible'] and len(value['copied']) == 4
programs = []
for index in [0, 2]:
    code, expected = value['copied'][index:index+2]
    with tempfile.TemporaryDirectory(prefix='numpy-copied-') as temp:
        path = pathlib.Path(temp) / 'example.py'
        path.write_bytes(code.encode())
        result = subprocess.run([sys.executable, str(path)], cwd=temp, text=True, capture_output=True, check=True)
        assert result.stdout == expected + '\n' and result.stderr == ''
    programs.append({'copyIndex':index,'sha256':hashlib.sha256(code.encode()).hexdigest(),'stdout':result.stdout,'expectedCopiedOutput':expected,'exactMatch':True})
tables = []
assert len(value['table']) == 3
for row in value['table']:
    statements = [code for code in row['codes'] if '=' in code]
    expected = ast.literal_eval(row['codes'][-1])
    env = {'np':np, 'a':np.array([10,20,30,40], dtype=np.int64)}
    exec('\n'.join(statements), env)
    actual = env['a'].tolist()
    assert actual == expected
    tables.append({'renderedStatements':statements,'renderedExpectedA':expected,'actualA':actual,'exactMatch':True})
print(json.dumps({'python':sys.version.split()[0],'numpy':np.__version__,'programs':programs,'renderedTableOperations':tables,'temporaryDirectoriesRemoved':True},ensure_ascii=False,indent=2))
