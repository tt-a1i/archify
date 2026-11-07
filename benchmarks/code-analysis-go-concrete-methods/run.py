"""Replay pinned concrete-method questions through public source or ZIP CLI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--cli', type=Path, required=True)
p.add_argument('--samples-root', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--expect', choices=['baseline', 'candidate'], default='candidate')
a = p.parse_args()
a.cli, a.samples_root, a.out = a.cli.resolve(), a.samples_root.resolve(), a.out.resolve()
assert a.out != a.samples_root and a.samples_root not in a.out.parents
a.out.mkdir(parents=True, exist_ok=True)
here = Path(__file__).resolve().parent
manifest = json.loads((here/'source-first.json').read_text())
reserved = json.loads((here/'reserved-grpc.json').read_text())
pair = json.loads((here/'version-pair.json').read_text())
projects = {**manifest['projects'], 'grpc-go': reserved, 'chi-base': pair['sides']['base']}
for name, meta in projects.items():
    root = a.samples_root/name
    assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == meta['revision']
    for file, digest in meta['hashes'].items():
        assert hashlib.sha256((root/file).read_bytes()).hexdigest() == digest, (name, file)
commands, facts = [], {}
def run(label, arguments, expected=0):
    command = ['node', str(a.cli), 'code-analysis', *map(str, arguments)]
    started = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True)
    commands.append({'label': label, 'command': command, 'exit': result.returncode, 'seconds': time.monotonic()-started})
    (a.out/(label+'.stdout')).write_text(result.stdout)
    (a.out/(label+'.stderr')).write_text(result.stderr)
    assert result.returncode == expected, (label, result.returncode, result.stdout[:1000], result.stderr[:1000])
for name in ['cobra', 'chi', 'grpc-go']:
    run(name+'-check', ['check', a.samples_root/name, '--language', 'go', '--fail-on', 'never', '--out', a.out/name, '--json'])
    facts[name] = json.loads((a.out/name/'raw-facts.json').read_text())
    assert facts[name]['callModel'] == ('go-source-direct-v2' if a.expect == 'candidate' else 'go-source-direct-v1')
units = []
positive = []
for case in manifest['cases']:
    # The frozen name was a qualified source label. Existing raw target.name
    # remains the short method name; see the pre-implementation correction note.
    target = {k: case['target'][k] for k in ['file', 'line', 'column']}
    target['name'] = case['target']['name'].split('.')[-1]
    positive.append((case['project'], case['call'], target, 'original'))
positive.append(('grpc-go', reserved['call'], reserved['expected'], 'reserved-after-initial-code'))
for project, point, target, exposure in positive:
    line = (a.samples_root/project/point['file']).read_text().splitlines()[point['line']-1]
    column = point.get('column', line.index(point['needle'])+1)
    rows = [c for c in facts[project]['calls'] if c['file'] == point['file'] and c['line'] == point['line'] and c['column'] == column]
    assert len(rows) == 1
    call = rows[0]
    status = 'correct' if call.get('target') == target else 'wrong' if call.get('target') else 'missed'
    assert status == ('correct' if a.expect == 'candidate' else 'missed'), (project, call, target)
    units.append({'project': project, 'call': call, 'expected': target, 'status': status, 'exposure': exposure})
for case in manifest['unknownControls']:
    point = case['call']
    call = next(c for c in facts[case['project']]['calls'] if all(c[k] == point[k] for k in ['file','line','column']))
    assert call['resolution'] == 'unresolved' and 'target' not in call
    units.append({'project': case['project'], 'call': call, 'status': 'reasonable-unknown', 'reason': case['reason']})
questions = {}
for name, entry, symbol in [('cobra', 'doc/util.go', 'hasSeeAlso'), ('chi', 'mux_test.go', 'TestMuxBasic'), ('chi', 'mux_test.go', 'TestMuxMatch_HasBasePath')]:
    label = 'question-'+symbol
    dest = a.out/(label+'.json')
    run(label, ['task', a.out/name, '--root', a.samples_root/name, '--entry', entry, '--function', symbol, '--question', 'Where is the concrete method implementation?', '--format', 'json', '--out', dest, '--json'])
    q = json.loads(dest.read_text())
    questions[symbol] = q
    if symbol != 'TestMuxBasic':
        wanted = 'HasParent' if name == 'cobra' else 'Match'
        calls = [r for r in q['calls']['records'] if r['fact'].get('target', {}).get('name') == wanted]
        assert len(calls) == (1 if a.expect == 'candidate' else 0)
        assert all(r['targetNavigation']['status'] == 'valid' for r in calls)
large = questions['TestMuxBasic']['calls']
assert large['total'] == 102 and large['included'] == 40 and large['omitted'] == 62
assert not any(r['fact']['line'] == 105 for r in large['records']), 'do not erase the existing bounded-output omission'
dest = a.out/'paired.json'
run('paired', ['task', '--base-root', a.samples_root/'chi-base', '--root', a.samples_root/'chi', '--entry', 'mux.go', '--question', 'Which known concrete callers reach changed Mux.Match?', '--format', 'json', '--out', dest, '--json'], expected=1)
q = json.loads(dest.read_text())
changed = next(d for d in q['changedDefinitions']['items'] if d.get('head', {}).get('definition', {}).get('qualname') == '*Mux.Match')
for side in ['base', 'head']:
    refs = changed[side]['knownReferences']
    expected = pair['sides'][side]['selectedCallers']
    assert refs['total'] == (len(expected) if a.expect == 'candidate' else 0)
    if a.expect == 'candidate':
        assert [r['fact']['line'] for r in refs['items']] == [c['line'] for c in expected]
        assert all(r['navigation']['status'] == 'valid' for r in refs['items'])
report = {'expect': a.expect, 'commands': commands, 'score': {s: sum(u['status'] == s for u in units) for s in ['correct','wrong','missed','reasonable-unknown']}, 'units': units, 'largeQuestion': {k: large[k] for k in ['total','included','omitted','limit']}, 'paired': {'status': q['status'], 'knownReferences': {side: changed[side]['knownReferences'] for side in ['base','head']}}, 'scope': {name: {'files': len(f['files']), 'calls': len(f['calls']), 'parseErrors': f.get('parse_errors', []), 'model': f['callModel'], 'languageScope': f['languageScope']} for name, f in facts.items()}, 'limits': ['Three fixed positives include a separately exposed reserved grpc slice; not blind or whole-project accuracy.', 'Original two method questions and supplemental real changed-method pair have separate denominators.', 'Partial paired status/nonzero exit and TestMuxBasic omitted calls are preserved.']}
(a.out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'score': report['score'], 'knownReferences': {s: changed[s]['knownReferences']['total'] for s in ['base','head']}, 'pairedStatus': q['status']}))
