"""Run exact-byte comparisons; this is not a model-author latency benchmark."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CLI = ROOT / 'archify/bin/archify.mjs'
GEOMETRY = {'pos', 'size', 'row', 'col'}
EDGE_GEOMETRY = {'via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY',
                 'labelAt', 'labelDx', 'labelDy', 'labelSegment'}


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(path):
    return {str(p.relative_to(path)): sha(p) for p in sorted(path.rglob('*'))
            if p.is_file() and '.git' not in p.relative_to(path).parts}


def semantics(value):
    """Keep unknown fields and every semantic value; remove only allowed geometry."""
    result = json.loads(json.dumps(value))
    result.pop('layout', None)
    if isinstance(result.get('meta'), dict):
        result['meta'].pop('viewBox', None)
    for node in result.get('components', []):
        for key in GEOMETRY:
            node.pop(key, None)
    for edge in result.get('connections', []):
        for key in EDGE_GEOMETRY:
            edge.pop(key, None)
    for boundary in result.get('boundaries', []):
        boundary.pop('pad', None)
    return result


def run(command, stem, timeout=30):
    started = time.monotonic()
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        code, stdout, stderr = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as error:
        code = None
        stdout = error.stdout or b''
        stderr = error.stderr or b''
        stdout = stdout.decode() if isinstance(stdout, bytes) else stdout
        stderr = stderr.decode() if isinstance(stderr, bytes) else stderr
    elapsed = time.monotonic() - started
    stem.with_suffix('.stdout').write_text(stdout)
    stem.with_suffix('.stderr').write_text(stderr)
    try:
        receipt = json.loads(stdout)
    except ValueError:
        receipt = {}
    return {'exit': code, 'seconds': elapsed, 'receipt': receipt}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort', choices=['development', 'holdout'], required=True)
    parser.add_argument('--prior', type=pathlib.Path, required=True)
    parser.add_argument('--repos', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--helper', type=pathlib.Path, required=True)
    args = parser.parse_args()
    protocol = read(HERE / 'protocol.json')
    if args.cohort == 'holdout':
        frozen = read(HERE / 'candidate-freeze.json')
        assert args.helper.resolve() == (HERE / frozen['entrypoint']).resolve()
        for relative, expected in frozen['files'].items():
            assert sha(HERE / relative) == expected, f'Candidate changed: {relative}'
        assert frozen['protocol_sha256'] == sha(HERE / 'protocol.json')
    args.out.mkdir(parents=True, exist_ok=False)
    rows = []
    selection = protocol[args.cohort]
    tasks = read(ROOT / 'benchmarks/semantic-firstdraft-20260921/tasks.json')['tasks']
    runtime_before = tree(ROOT / 'archify')
    for name in selection['firsts']:
        assert tree(ROOT / 'archify') == runtime_before, 'Runtime integrity changed; stop study'
        source = args.prior / selection['cohort'] / name / 'snapshot-001.json'
        key = f"{selection['cohort']}/{name}/snapshot-001.json"
        assert sha(source) == protocol['input_sha256'][key]
        repo = args.repos / name.rsplit('-', 1)[0]
        task = next(x for x in tasks if x['id'] == name.rsplit('-', 1)[0])
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip() == task['revision']
        assert not subprocess.check_output(['git', 'status', '--porcelain=v1'], cwd=repo, text=True).strip()
        source_before = tree(repo)
        folder = args.out / name
        folder.mkdir()
        input_path = folder / 'input.json'
        input_path.write_bytes(source.read_bytes())
        output = folder / 'candidate.json'
        base = run(['node', str(CLI), 'validate', 'architecture', str(input_path),
                    '--repo-root', str(repo), '--quality', 'showcase', '--json'], folder / 'base')
        candidate = run(['node', str(args.helper), str(input_path), '--out', str(output),
                         '--repo-root', str(repo), '--allow-reflow', '--json'], folder / 'proposal', timeout=23)
        input_unchanged = sha(input_path) == protocol['input_sha256'][key]
        source_unchanged = tree(repo) == source_before
        runtime_unchanged = tree(ROOT / 'archify') == runtime_before
        valid = None
        retained = False
        candidate_parse_error = None
        if output.exists():
            try:
                retained = semantics(read(source)) == semantics(read(output))
            except (ValueError, TypeError, AttributeError) as error:
                candidate_parse_error = str(error)
            if source_unchanged and runtime_unchanged and input_unchanged:
                valid = run(['node', str(CLI), 'validate', 'architecture', str(output),
                             '--repo-root', str(repo), '--quality', 'showcase', '--json'], folder / 'candidate-validation')
        passed = bool(candidate['exit'] == 0 and valid and valid['exit'] == 0
                      and valid['receipt'].get('ok') is True and retained and input_unchanged
                      and source_unchanged and runtime_unchanged
                      and candidate['seconds'] <= protocol['prototype']['seconds_cap'])
        row = {'run': name, 'input_sha256': sha(input_path), 'baseline': base,
               'proposal': candidate, 'validation': valid, 'semantic_projection_unchanged': retained,
               'input_unchanged': input_unchanged,
               'source_unchanged': source_unchanged, 'runtime_unchanged': runtime_unchanged,
               'candidate_parse_error': candidate_parse_error,
               'candidate_pass': passed, 'candidate_sha256': sha(output) if output.exists() else None}
        rows.append(row)
        write(folder / 'comparison.json', row)
        print(json.dumps({'run': name, 'base_exit': base['exit'], 'candidate_pass': passed,
                          'proposal_seconds': candidate['seconds']}), flush=True)
    count = sum(x['candidate_pass'] for x in rows)
    required = 2 if args.cohort == 'development' else protocol['holdout']['primary_gate']['minimum_firsts_machine_pass']
    firsts_gate = count >= required
    if args.cohort == 'holdout':
        firsts_gate = firsts_gate and any(x['candidate_pass'] and x['run'].startswith('lilconfig-') for x in rows)
    write(args.out / 'summary.json', {
        'cohort': args.cohort, 'protocol_sha256': sha(HERE / 'protocol.json'),
        'rows': rows, 'pass_count': count, 'first_draft_static_gate_pass': firsts_gate,
        'whole_holdout_gate_pass': False, 'ready_for_author_trials': False, 'promotion_qualified': False,
        'required_separate_evidence': [
            'Frozen candidate and full holdout first-draft screen',
            'No new failures on baseline-passing finals and representative examples',
            'Complete finalize plus independent semantic and common-viewport visual review',
            'Fresh paired author screen and conditional confirmation before any promotion',
        ],
        'note': 'This command never qualifies the whole holdout gate or promotion. It only collects exact-byte first-draft static comparisons; the listed remaining checks must be performed and recorded separately.',
    })


if __name__ == '__main__':
    main()
