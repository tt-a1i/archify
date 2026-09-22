"""Replay preserved first/final bytes through both frozen static validators.

This is a mechanism diagnostic, never a counterfactual author latency.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
WORKTREE = HERE.parents[1]


def read(path):
    return json.loads(path.read_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    frozen = read(args.out / 'freeze.json')
    runtimes = {'base': WORKTREE / 'archify',
                'candidate': pathlib.Path(frozen['runtime_candidate']['path'])}
    for label, runtime in runtimes.items():
        expected = frozen['package'] if label == 'base' else frozen['runtime_candidate']['files']
        actual = {str(p.relative_to(runtime)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(runtime.rglob('*')) if p.is_file()
                  and '.git' not in p.relative_to(runtime).parts}
        assert actual == expected, f'{label} runtime changed'
    rows = []
    for run in frozen['initial_order']:
        observed = args.out / run
        evaluation = read(observed / 'evaluation.json')
        source = args.scratch / 'repos' / run.rsplit('-', 1)[0]
        stages = {'final': observed / 'artifacts/diagram.architecture.json'}
        if evaluation['snapshots']:
            stages['first'] = observed / f"snapshot-{evaluation['snapshots'][0]['index']:03}.json"
        cache = {}
        for stage, candidate in stages.items():
            if not candidate.exists():
                rows.append({'run': run, 'stage': stage, 'available': False})
                continue
            digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
            if digest not in cache:
                result = {}
                for label, runtime in runtimes.items():
                    completed = subprocess.run(['node', str(runtime / 'bin/archify.mjs'),
                        'validate', 'architecture', str(candidate), '--repo-root', str(source),
                        '--quality', 'showcase', '--json'], capture_output=True, text=True)
                    receipt_path = observed / f'replay-{stage}-{label}.json'
                    receipt_path.write_text(completed.stdout)
                    receipt_path.with_suffix('.stderr').write_text(completed.stderr)
                    receipt = json.loads(completed.stdout)
                    result[label] = {'exit': completed.returncode, 'ok': receipt.get('ok'),
                        'codes': [item.get('code') for item in receipt.get('diagnostics', [])],
                        'receipt': str(receipt_path)}
                cache[digest] = result
            assert hashlib.sha256(candidate.read_bytes()).hexdigest() == digest
            rows.append({'run': run, 'stage': stage, 'available': True,
                         'sha256': digest, **cache[digest]})
    result = {'rows': rows, 'limit': 'Post-run static replay of identical bytes. It does not simulate model repairs or establish a successful full-task latency.'}
    (args.out / 'route-replays.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'stages': len(rows), 'base_fail_candidate_pass': sum(
        row.get('base', {}).get('ok') is False and row.get('candidate', {}).get('ok') is True
        for row in rows)}))
