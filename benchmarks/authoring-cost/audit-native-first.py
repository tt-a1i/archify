#!/usr/bin/env python3
"""Supplement legacy first-draft evidence, without rerunning or changing authors.

Run after every registered author terminates. A failed native validation proves
first-draft failure; a pass does not establish semantic/browser acceptance.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import zipfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--manifest', type=pathlib.Path, required=True)
    p.add_argument('--evidence', type=pathlib.Path, required=True)
    p.add_argument('--sessions', type=pathlib.Path, required=True)
    p.add_argument('--output', type=pathlib.Path, required=True)
    p.add_argument('--node', default='/opt/homebrew/opt/node@22/bin/node')
    a = p.parse_args()
    m = json.loads(a.manifest.read_text())
    pending = []
    for run in m['runs']:
        path = a.evidence / run['run_id'] / 'summary.json'
        summary = json.loads(path.read_text()) if path.exists() else {}
        if summary.get('status') not in {'completed', 'timeout', 'failed', 'error', 'interrupted'} or not summary.get('finished_at'):
            pending.append(run['run_id'])
    if pending:
        raise SystemExit('Wait for terminal author summaries: ' + ', '.join(pending))
    if a.output.exists():
        raise SystemExit('Keep prior audits; choose a new output directory')
    package = pathlib.Path(m['variants']['A']['package_path'])
    if digest(package) != m['variants']['A']['package_sha256']:
        raise SystemExit('Frozen A package drift')
    a.output.mkdir(parents=True)
    with zipfile.ZipFile(package) as archive:
        archive.extractall(a.output / 'package')
    cli = a.output / 'package/archify/bin/archify.mjs'
    cases = {case['id']: case for case in m['tasks']}
    rows = []
    started = time.monotonic()
    for run in m['runs']:
        if run['variant'] != 'A':
            continue
        run_id = run['run_id']
        summary = json.loads((a.evidence / run_id / 'summary.json').read_text())
        first = next((x for x in summary['candidate_snapshots'] if x.get('complete') is True), None)
        row = {'run_id': run_id, 'status': 'unknown', 'variant_sha': m['variants']['A']['sha']}
        if first:
            candidate = a.evidence / run_id / 'candidate-snapshots' / f"{first['index']:06d}.json"
            source = a.sessions / run_id / 'source'
            target_sha = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
            if digest(candidate) != first['sha256'] or target_sha != cases[run['case_id']]['target_repo_sha']:
                raise SystemExit('Candidate or source identity mismatch')
            command = [a.node, str(cli), 'validate', 'architecture', str(candidate), '--repo-root', str(source), '--quality', 'showcase', '--json']
            t0 = time.monotonic()
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=90)
                code, stdout, stderr = result.returncode, result.stdout, result.stderr
            except subprocess.TimeoutExpired as error:
                code, stdout, stderr = 124, error.stdout or '', error.stderr or ''
                if isinstance(stdout, bytes): stdout = stdout.decode(errors='replace')
                if isinstance(stderr, bytes): stderr = stderr.decode(errors='replace')
            duration = 1000 * (time.monotonic() - t0)
            folder = a.output / run_id
            folder.mkdir()
            (folder / 'stdout.txt').write_text(stdout)
            (folder / 'stderr.txt').write_text(stderr)
            try:
                native = json.loads(stdout)
            except (ValueError, TypeError):
                native = {}
            hard_failure = code == 1 and native.get('command') == 'validate' and native.get('ok') is False and native.get('stage') in ('schema', 'input', 'source', 'render', 'check')
            row.update(status='failed' if hard_failure else 'unknown', native_validation='passed' if code == 0 and native.get('ok') is True else 'timeout' if code == 124 else 'failed' if hard_failure else 'unknown', candidate_sha256=first['sha256'], target_repo_sha=target_sha, duration_ms=duration, exit_code=code, command=command)
        rows.append(row)
        print(json.dumps({k: row.get(k) for k in ('run_id', 'status', 'exit_code', 'duration_ms')}), flush=True)
    receipt = {'purpose': 'Post-hoc uniform native A first-snapshot audit; not an author retry or a latency sample', 'acceptance_rule': 'Only native hard failure proves first failure; native validation success alone remains unknown', 'package_sha256': digest(package), 'duration_ms': 1000 * (time.monotonic() - started), 'rows': rows}
    (a.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
