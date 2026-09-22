"""Post-author machine/visual evidence for preserved bytes; never edit candidates."""
import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess


def read(path):
    return json.loads(path.read_text())


def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def command(arguments, stem):
    result = subprocess.run(arguments, capture_output=True, text=True)
    stem.with_suffix('.json').write_text(result.stdout)
    stem.with_suffix('.stderr').write_text(result.stderr)
    try:
        receipt = json.loads(result.stdout)
    except ValueError:
        receipt = {}
    return result.returncode, receipt


def eligibility(start, integrity, native, frozen):
    required = ['source_unchanged', 'package_unchanged', 'task_unchanged', 'instructions_unchanged']
    condition = start.get('condition', '')
    reasons = [name for name in required if integrity.get(name) is not True]
    if condition not in ('B1', 'B2', 'P1', 'P2'):
        reasons.append('unknown-condition')
    expected = frozen['author']
    if native.get('identity') != {key: expected[key] for key in ['model', 'effort']}:
        reasons.append('author-identity-mismatch')
    duration = native.get('native_task_seconds')
    if native.get('censored') or not isinstance(duration, (int, float)) or not 0 <= duration <= expected['native_cap_seconds']:
        reasons.append('author-time-ineligible')
    return {'eligible': not reasons, 'reasons': reasons}


def evaluate(root, out, name):
    workspace = root / 'runs' / name
    evidence = out / name
    observer = read(evidence / 'receipt.json')
    native = read(evidence / 'native-trace.json')
    integrity_path = evidence / 'integrity.json'
    integrity = read(integrity_path) if integrity_path.exists() else {}
    protocol = eligibility(read(evidence / 'start.json'), integrity, native, read(out / 'freeze.json'))
    started = datetime.datetime.fromisoformat(native['task_started_at'].replace('Z', '+00:00')).timestamp() if native.get('task_started_at') else None
    cli = workspace / 'archify/bin/archify.mjs'
    repo = workspace / 'repo'
    snapshots = []
    for item in observer['snapshots']:
        if not item['structurally_complete']:
            continue
        candidate = evidence / f"snapshot-{item['index']:03}.json"
        if protocol['eligible']:
            code, receipt = command(['node', str(cli), 'validate', 'architecture', str(candidate),
                                     '--repo-root', str(repo), '--quality', 'showcase', '--json'],
                                    evidence / f"snapshot-{item['index']:03}-validation")
        else:
            code, receipt = None, {'ok': None, 'diagnostics': [{'code': 'experiment/protocol-ineligible'}]}
        snapshots.append({'index': item['index'], 'sha256': item['sha256'],
                          'native_seconds': observer['start_epoch'] + item['elapsed_seconds'] - started if started is not None else None,
                          'validation_exit': code, 'validation_ok': receipt.get('ok'),
                          'diagnostic_codes': sorted({x.get('code') for x in receipt.get('diagnostics', []) if x.get('code')})})
    candidate = workspace / 'output/diagram.architecture.json'
    html = workspace / 'output/diagram.html'
    summary_path = workspace / 'output/diagram.finalize-summary.json'
    summary = read(summary_path) if summary_path.exists() else {}
    final_sha = hashlib.sha256(candidate.read_bytes()).hexdigest() if candidate.exists() else None
    final = {'candidate_sha256': final_sha, 'author_finalized': summary.get('ok') is True,
             'author_gates': summary.get('gates'), 'machine_duration_ms': summary.get('durationMs'),
             'html_available': html.exists(), 'hash_bound': final_sha is not None and summary.get('specification', {}).get('sha256') == final_sha,
             'visual_capture_exit': None}
    final['eligible_delivery'] = protocol['eligible'] and final['author_finalized'] and final['hash_bound'] and html.exists()
    if final['eligible_delivery']:
        code, _ = command(['node', str(cli), 'visual-check', str(html), '--require-provenance',
                            '--out-dir', str(evidence / 'visual'), '--json'], evidence / 'visual-receipt')
        final['visual_capture_exit'] = code
    first = snapshots[0] if snapshots else None
    first_visual = {'available': False}
    if first and first['sha256'] == final_sha and final['visual_capture_exit'] == 0:
        first_visual = {'available': True, 'reused_final': True}
    elif first and first['validation_exit'] == 0:
        first_path = evidence / f"snapshot-{first['index']:03}.json"
        first_html = evidence / 'postrun-first.html'
        code, _ = command(['node', str(cli), 'finalize', 'architecture', str(first_path), str(first_html),
                            '--repo-root', str(repo), '--quality', 'showcase', '--json'], evidence / 'postrun-first-finalize')
        first_visual = {'postrun_finalize_exit': code, 'available': False, 'postrun_only': True}
        if code == 0:
            capture_code, _ = command(['node', str(cli), 'visual-check', str(first_html), '--require-provenance',
                                        '--out-dir', str(evidence / 'first-visual'), '--json'], evidence / 'postrun-first-visual')
            first_visual.update({'available': capture_code == 0, 'capture_exit': capture_code})
    result = {'protocol': protocol, 'snapshots': snapshots, 'final': final, 'first_visual': first_visual,
              'note': 'Post-run validation/captures are separate from native author time. Machine gates do not establish source entailment or perceptual quality.'}
    write(evidence / 'evaluation.json', result)
    print(json.dumps({'run': name, 'snapshots': len(snapshots), 'final': final, 'first_visual': first_visual}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True, type=pathlib.Path)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    parser.add_argument('runs', nargs='+')
    args = parser.parse_args()
    for name in args.runs:
        evaluate(args.scratch, args.out, name)
