"""Replay pinned source answers through the public source or extracted-ZIP CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--cli', type=Path, required=True)
parser.add_argument('--sample', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--expect', choices=['baseline', 'candidate'], default='candidate')
args = parser.parse_args()
args.cli, args.sample, args.out = args.cli.resolve(), args.sample.resolve(), args.out.resolve()
assert args.out != args.sample and args.sample not in args.out.parents
args.out.mkdir(parents=True, exist_ok=True)
here = Path(__file__).resolve().parent
source = json.loads((here / 'source-first.json').read_text())
reserved = json.loads((here / 'reserved-barrel.json').read_text())
assert subprocess.check_output(['git', '-C', str(args.sample), 'rev-parse', 'HEAD'], text=True).strip() == source['revision']
for manifest in [source, reserved]:
    for file, digest in manifest['sourceSha256'].items():
        assert hashlib.sha256((args.sample / file).read_bytes()).hexdigest() == digest, file
commands = []
def run(label, arguments):
    command = ['node', str(args.cli), 'code-analysis', *map(str, arguments)]
    start = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True)
    commands.append({'label': label, 'command': command, 'exit': result.returncode, 'seconds': time.monotonic() - start})
    (args.out / (label + '.stdout')).write_text(result.stdout)
    (args.out / (label + '.stderr')).write_text(result.stderr)
    assert result.returncode == 0, (label, result.returncode, result.stderr)

run('check', ['check', args.sample, '--language', 'ts', '--fail-on', 'never', '--out', args.out / 'capture', '--json'])
facts = json.loads((args.out / 'capture/raw-facts.json').read_text())
units = []
for case in source['cases']:
    matches = [c for c in facts['calls'] if c['file'] == case['file'] and c['line'] == case['line']]
    call = next(c for c in matches if c['column'] == 12)
    actual = call.get('target')
    status = 'correct' if actual == case['expected'] else 'wrong' if actual else 'missed'
    units.append({'call': call, 'expected': case['expected'], 'status': status})
    assert status == ('correct' if args.expect == 'candidate' else 'missed'), units[-1]
for case in [source['unknownControl'], reserved['case']]:
    column = (args.sample / case['file']).read_text().splitlines()[case['line']-1].index(case['needle']) + 1
    call = next(c for c in facts['calls'] if c['file'] == case['file'] and c['line'] == case['line'] and c['column'] == column)
    forwarded = facts['callModel'] == 'js-ts-lexical-v5' and 'eventualSourceDefinition' in case
    if forwarded:
        expected = {**case['eventualSourceDefinition'], 'name': 'combineReducers'}
        assert call.get('target') == expected, call
    else:
        assert call['resolution'] == 'unresolved' and 'target' not in call, call
    # Preserve older known-source misses; v5 now verifies that original source target.
    units.append({'call': call, 'expected': case.get('eventualSourceDefinition'), 'status': 'correct' if forwarded else 'missed' if 'eventualSourceDefinition' in case else 'reasonable-unknown', 'reason': 'Explicit captured ESM forwarding under v5; original v4 miss remains historical.' if forwarded else case['reason']})
question_file = args.out / 'question.json'
run('question', ['task', args.out / 'capture', '--root', args.sample, '--entry', source['import']['file'], '--question', 'Where does the aliased default function resolve?', '--format', 'json', '--out', question_file, '--json'])
question = json.loads(question_file.read_text())
records = [r for r in question['calls']['records'] if r['fact'].get('target', {}).get('name') == 'isPlainObject']
assert len(records) == (6 if args.expect == 'candidate' else 0)
assert all(r['targetNavigation']['status'] == 'valid' for r in records)
report = {'expect': args.expect, 'revision': source['revision'], 'commands': commands, 'units': units, 'score': {status: sum(u['status'] == status for u in units) for status in ['correct', 'wrong', 'missed', 'reasonable-unknown']}, 'scope': {'files': len(facts['files']), 'parseErrors': facts.get('parse_errors', []), 'model': facts['callModel'], 'adapterRevision': facts['repository']['adapterRevision']}, 'limits': ['Source configuration, not runtime module loading or successful compilation.', 'Original v4 reserved barrel miss is historical; v5 forwarding reuses this source answer as design input, not a fresh holdout.']}
(args.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'score': report['score'], 'scope': report['scope']}))
