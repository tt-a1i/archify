import hashlib
import json
import pathlib
import sys

source = pathlib.Path(__file__).resolve().parent.parent / 'probe.py'
raw = source.read_bytes()
lines = raw.decode('utf-8').splitlines(keepends=True)
results = []
for end in (3, 4, 5, 6):
    namespace = {}
    exec(compile(''.join(lines[:end]), str(source), 'exec'), namespace)
    root, alias, copy = (namespace[name] for name in ('root', 'alias', 'copy'))
    results.append({
        'end_line': end,
        'values': {'root': root, 'alias': alias, 'copy': copy},
        'identity': {
            'root is alias': root is alias,
            'root is copy': root is copy,
            'root[0] is copy[0]': root[0] is copy[0],
            'root[1] is copy[1]': root[1] is copy[1],
            'alias[0] is root[0]': alias[0] is root[0],
        },
    })
print(json.dumps({'source_sha256': hashlib.sha256(raw).hexdigest(),
                  'python_version': sys.version,
                  'method': 'independent source prefixes in fresh namespaces',
                  'results': results}, indent=2))
