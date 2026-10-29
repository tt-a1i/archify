#!/usr/bin/env python3
"""Exercise jq defaults using constructed in-memory values; no files or network."""
import json
import shutil
import subprocess

jq = shutil.which('jq')
if not jq:
    raise SystemExit('jq is required; this probe does not install it')
version = subprocess.run([jq, '--version'], capture_output=True, text=True, check=True).stdout.strip()
cases = []

def check(case_id, expression, expected):
    argv = [jq, '-cn', expression]
    run = subprocess.run(argv, capture_output=True, text=True, check=False)
    expected_stdout = ''.join(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n' for value in expected)
    assert run.returncode == 0 and run.stderr == '' and run.stdout == expected_stdout, (case_id, run.returncode, run.stdout, run.stderr)
    cases.append({'id': case_id, 'expression': expression, 'argv': argv,
                  'exit_code': run.returncode, 'stdout': run.stdout, 'stderr': run.stderr,
                  'outputs': [json.loads(line) for line in run.stdout.splitlines()]})

for name, expression, expected in [
    ('false', 'false', ['fallback']), ('null', 'null', ['fallback']),
    ('empty', 'empty', ['fallback']), ('zero', '0', [0]),
    ('empty_string', '""', ['']), ('empty_array', '[]', [[]]), ('empty_object', '{}', [{}]),
]:
    check('alternative_' + name, expression + ' // "fallback"', expected)

check('empty_has_no_output', 'empty', [])
check('null_is_one_value', 'null', [None])
check('empty_array_is_one_value', '[]', [[]])

policies = {
    'alternative': '.enabled // true',
    'null_only': '.enabled | if . == null then true else . end',
    'missing_only': 'if has("enabled") then .enabled else true end',
}
for name, value, expected in [
    ('false', {'enabled': False}, {'alternative': True, 'null_only': False, 'missing_only': False}),
    ('true', {'enabled': True}, {'alternative': True, 'null_only': True, 'missing_only': True}),
    ('null', {'enabled': None}, {'alternative': True, 'null_only': True, 'missing_only': None}),
    ('missing', {}, {'alternative': True, 'null_only': True, 'missing_only': True}),
]:
    literal = json.dumps(value, separators=(',', ':'))
    for policy, expression in policies.items():
        check(name + '_' + policy, literal + ' | ' + expression, [expected[policy]])

check('whole_stream', '(false, null, 0) // "fallback"', [0])
check('each_stream_value', '(false, null, 0) | . // "fallback"', ['fallback', 'fallback', 0])

print(json.dumps({'schema_version': 1, 'executable': jq, 'version': version,
                  'scope': 'Constructed values and JSON objects; stdout is a result stream, not an input-file mutation.',
                  'case_count': len(cases), 'cases': cases}, ensure_ascii=False, indent=2))
