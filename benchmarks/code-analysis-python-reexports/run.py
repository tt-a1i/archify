#!/usr/bin/env python3
"""Pinned source/question replay; never imports or executes the target projects."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--cli', type=Path, required=True)
p.add_argument('--samples-root', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--node', default='node')
p.add_argument('--expect', choices=['baseline', 'candidate'], default='candidate')
a = p.parse_args()
a.cli = a.cli.resolve(); a.samples_root = a.samples_root.resolve(); a.out = a.out.resolve()
assert not a.out.exists(), 'Use a fresh output directory; existing evidence is not overwritten.'
m = json.loads(Path(__file__).with_name('source-first.json').read_text())
functions = {'jinja-undefined': 'TestExtendedAPI.test_expressions', 'jinja-logging': 'TestUndefined.test_logging_undefined', 'flask-render': 'index', 'flask-json': 'add'}

def verify():
    for project, meta in m['projects'].items():
        root = a.samples_root / project
        assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == meta['commit']
        assert not subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=no'], text=True)
        for file, digest in meta['files'].items():
            assert hashlib.sha256((root / file).read_bytes()).hexdigest() == digest, file

verify(); a.out.mkdir(parents=True)
commands = []
def cli(args, label):
    command = [a.node, str(a.cli), 'code-analysis', *map(str, args)]
    proc = subprocess.run(command, text=True, capture_output=True)
    (a.out / (label + '.stdout')).write_text(proc.stdout)
    (a.out / (label + '.stderr')).write_text(proc.stderr)
    commands.append({'label': label, 'args': command, 'exit': proc.returncode})
    assert proc.returncode == 0, (label, proc.returncode, proc.stderr)

rows = []; scopes = {}
for project in m['projects']:
    dest = a.out / project
    cli(['check', a.samples_root / project, '--language', 'py', '--fail-on', 'never', '--json', '--out', dest], project + '-check')
    facts = json.loads((dest / 'raw-facts.json').read_text())
    scopes[project] = {'files': len(facts['files']), 'functions': len(facts['functions']), 'calls': len(facts['calls']), 'parseErrors': facts.get('parse_errors', []), 'callModel': facts['callModel']}
    for case in m['cases']:
        if case['project'] != project: continue
        point = case['call']
        found = [r for r in facts['calls'] if all(r[k] == point[k] for k in ['file', 'line', 'column', 'endLine', 'endColumn'])]
        assert len(found) == 1, (case['id'], 'omitted or duplicate call')
        observed = found[0]
        qpath = a.out / (case['id'] + '-question.json')
        cli(['task', dest, '--question', 'Which captured implementation does this imported API function name reach?', '--entry', point['file'], '--function', functions[case['id']], '--root', a.samples_root / project, '--format', 'json', '--out', qpath, '--json'], case['id'])
        question = json.loads(qpath.read_text())
        assert question['calls']['coverage'] == 'available'
        records = [r for r in question['calls']['records'] if r['fact'] == observed]
        assert len(records) == 1, (case['id'], 'question omitted selected call')
        target = {k: case['target'][k] for k in ['file', 'name', 'line', 'column']}
        grade = 'correct' if observed.get('target') == target else 'missed' if 'target' not in observed else 'wrong'
        assert grade == ('missed' if a.expect == 'baseline' else 'correct'), (case['id'], grade)
        if grade == 'correct': assert records[0]['targetNavigation']['status'] == 'valid'
        rows.append({'id': case['id'], 'grade': grade, 'observation': observed, 'navigationStatus': records[0]['targetNavigation']['status']})
    for control in m['controls']:
        if control['project'] != project: continue
        # Source AST positions: expr2 inside is_undefined, and request.form.get.
        column = 29 if control['id'] == 'jinja-generated-expr' else 9
        observed = next(r for r in facts['calls'] if r['file'] == control['file'] and r['line'] == control['line'] and r['column'] == column)
        assert observed['resolution'] == 'unresolved' and 'target' not in observed
        rows.append({'id': control['id'], 'grade': 'unknown', 'observation': observed})
verify()
report = {'sourceManifestSha256': hashlib.sha256(Path(__file__).with_name('source-first.json').read_bytes()).hexdigest(), 'expect': a.expect, 'counts': {grade: sum(r['grade'] == grade for r in rows) for grade in ['correct', 'wrong', 'missed', 'unknown']}, 'scopes': scopes, 'units': rows, 'commands': commands}
(a.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['counts']))
