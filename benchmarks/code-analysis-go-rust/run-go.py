"""Replay the finite Go investigation through the public CLI; never run project code.

The samples directory contains fixed upstream clones/worktrees named cobra,
cobra-base, chi and grpc-go (versions in manifest.json/supplemental-go-alias.json).
Supply --cli for either source or an extracted ZIP entrypoint. JSON evidence is
written outside all sample roots. Only the fixed selected cases are graded.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--cli', type=pathlib.Path, required=True)
parser.add_argument('--node', default='node')
parser.add_argument('--samples-root', type=pathlib.Path, required=True)
parser.add_argument('--out', type=pathlib.Path, required=True)
args = parser.parse_args()
args.cli = args.cli.resolve(); args.samples_root = args.samples_root.resolve(); args.out = args.out.resolve()
assert args.out != args.samples_root and args.samples_root not in args.out.parents, 'Write evidence outside the sample roots'
args.out.mkdir(parents=True, exist_ok=True)
here = pathlib.Path(__file__).resolve().parent
manifest = json.loads((here / 'manifest.json').read_text())
supplement = json.loads((here / 'supplemental-go-alias.json').read_text())
expected_revisions = {'cobra': manifest['projects'][0]['head'], 'cobra-base': manifest['projects'][0]['base'],
                      'chi': manifest['projects'][1]['head'], 'grpc-go': supplement['revision']}
commands = []

def run(label, arguments):
    cmd = [args.node, str(args.cli), 'code-analysis', *map(str, arguments)]
    start = time.monotonic(); result = subprocess.run(cmd, text=True, capture_output=True)
    (args.out / (label + '.stdout')).write_text(result.stdout)
    (args.out / (label + '.stderr')).write_text(result.stderr)
    row = {'label': label, 'command': cmd, 'exit': result.returncode, 'seconds': time.monotonic() - start}
    commands.append(row)
    assert result.returncode == 0, (label, result.returncode, result.stdout[:1000], result.stderr[:1000])
    return json.loads(result.stdout)

facts = {}
for name, revision in expected_revisions.items():
    root = args.samples_root / name
    actual = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    assert actual == revision, (name, actual, revision)
    # Recheck the originally inspected file bytes independently of analyzer facts.
    entries = supplement['cases'] if name == 'grpc-go' else manifest['projects'][0 if name.startswith('cobra') else 1]['expected_evidence']['base' if name.endswith('-base') else 'head']
    for entry in entries:
        assert hashlib.sha256((root / entry['file']).read_bytes()).hexdigest() == entry['sha256'], (name, entry['file'])
    run(name + '-check', ['check', root, '--language', 'go', '--fail-on', 'never', '--out', args.out / name, '--json'])
    facts[name] = json.loads((args.out / name / 'raw-facts.json').read_text())

results = []

def check(name, file, needle, target_file=None, target_needle=None, target_name=None):
    root = args.samples_root / name
    lines = (root / file).read_text().splitlines()
    locations = [(i + 1, line.index(needle) + 1) for i, line in enumerate(lines) if needle in line]
    assert locations, (name, file, needle)
    for line, column in locations:
        matched = [call for call in facts[name]['calls'] if call['file'] == file and call['line'] == line and call['column'] == column]
        expected = None
        if target_file:
            target_lines = (root / target_file).read_text().splitlines()
            definitions = [(i + 1, text.index('func ') + 1) for i, text in enumerate(target_lines) if target_needle in text]
            assert len(definitions) == 1
            expected = {'file': target_file, 'name': target_name, 'line': definitions[0][0], 'column': definitions[0][1]}
        actual = None
        if len(matched) == 1 and matched[0].get('target'):
            actual = {**matched[0]['target'], 'file': matched[0]['target'].get('file', file)}
        status = 'omitted-call' if len(matched) != 1 else 'wrong-target' if actual and actual != expected else 'missed-target' if expected and not actual else 'correct-target' if expected else 'reasonable-unknown'
        results.append({'project': name, 'file': file, 'line': line, 'column': column, 'needle': needle, 'expected': expected, 'actual': actual, 'status': status})

for name in ['cobra-base', 'cobra']:
    check(name, 'doc/man_examples_test.go', 'doc.GenMan(', 'doc/man_docs.go', 'func GenMan(', 'GenMan')
    check(name, 'doc/man_docs.go', 'GenMan(cmd, &headerCopy, f)', 'doc/man_docs.go', 'func GenMan(', 'GenMan')
    check(name, 'doc/man_docs.go', 'fillHeader(header,', 'doc/man_docs.go', 'func fillHeader(', 'fillHeader')
    check(name, 'doc/man_docs.go', 'w.Write(md2man.Render(b))')
check('chi', 'middleware/strip.go', 'chi.RouteContext(', 'context.go', 'func RouteContext(', 'RouteContext')
check('chi', 'middleware/strip.go', 'next.ServeHTTP(')
check('grpc-go', 'clientconn.go', 'iresolver.GetConfigSelector(', 'internal/resolver/config_selector.go', 'func GetConfigSelector(', 'GetConfigSelector')
check('grpc-go', 'internal/resolver/config_selector.go', 'state.Attributes.Value(csKey)')

question_out = args.out / 'cobra-question.json'
run('cobra-question', ['task', args.out / 'cobra', '--root', args.samples_root / 'cobra', '--entry', 'doc/man_examples_test.go', '--function', 'ExampleGenMan', '--question', 'Where does GenMan resolve?', '--format', 'json', '--out', question_out, '--json'])
question = json.loads(question_out.read_text())
selected = [row for row in question['calls']['records'] if row['fact'].get('target', {}).get('name') == 'GenMan']
assert len(selected) == 1 and selected[0]['targetNavigation']['status'] == 'valid'
paired_out = args.out / 'cobra-paired.json'
run('cobra-paired', ['task', '--root', args.samples_root / 'cobra', '--base-root', args.samples_root / 'cobra-base', '--entry', 'doc/man_docs.go', '--question', 'What known references reach changed GenMan?', '--format', 'json', '--out', paired_out, '--json'])
paired = json.loads(paired_out.read_text())
changed = next(row for row in paired['changedDefinitions']['items'] if row['head']['definition']['name'] == 'GenMan')
# Two originally frozen callers must be included on both sides. Additional
# returned references are separately inspectable, not added to the frozen score.
for side in ['base', 'head']:
    refs = changed[side]['knownReferences']
    assert refs['coverage'] == 'available'
    for file, line in [('doc/man_examples_test.go', 33), ('doc/man_docs.go', 78)]:
        matches = [row for row in refs['items'] if row['fact']['file'] == file and row['fact']['line'] == line]
        assert len(matches) == 1 and matches[0]['navigation']['status'] == 'valid'

summary = {status: sum(row['status'] == status for row in results) for status in ['correct-target', 'wrong-target', 'missed-target', 'omitted-call', 'reasonable-unknown']}
report = {'commands': commands, 'score': summary, 'units': results, 'pairedKnownReferences': {side: changed[side]['knownReferences']['total'] for side in ['base', 'head']},
          'scope': {name: {'files': len(data['files']), 'calls': len(data['calls']), 'parseErrors': data.get('parse_errors', []), 'languageScope': data['languageScope']} for name, data in facts.items()},
          'limits': ['Finite selected source cases; not whole-repository target accuracy or runtime dispatch.', 'Chi presenter alias expectation is a corrected oracle error, not a valid local target.', 'Grpc alias is supplemental source evidence, not the original pre-development holdout.', 'Known references mean captured direct references, not complete impact.']}
(args.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'score': summary, 'pairedKnownReferences': report['pairedKnownReferences']}, indent=2))
assert not any(summary[key] for key in ['wrong-target', 'missed-target', 'omitted-call'])
