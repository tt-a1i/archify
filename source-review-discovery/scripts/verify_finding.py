#!/usr/bin/env python3
"""Run a reviewer-authored, isolated verification and bind its transcript to source hashes.

This is a recorder, not a sandbox or a semantic proof engine. Inspect the command first.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import review_report as rr


def run(report, finding_id, spec, timeout=60):
    rr.validate(report)
    finding = next(f for f in report['findings'] if f['id'] == finding_id)
    rr.require(spec['claim'].strip() and spec['limitations'] and spec['isolation'], 'claim, isolation and limits required')
    rr.references(spec['input_basis'], {e['id']:e for e in report['evidence']}, 'verification input contract')
    source_run = next(r for r in report['runs'] if r['id'] == finding['run'])
    targets = []
    for target in spec['targets']:
        data = rr.source_path(source_run, target).read_bytes()
        hashed = {**target, 'sha256':rr.digest(data)}
        matches = [e for e in report['evidence'] if e['run'] == finding['run'] and e['repository'] == target['repository'] and e['path'] == target['path']]
        rr.require(all(e['sha256'] == hashed['sha256'] for e in matches), 'verification source differs from discovery; use a new review run')
        targets.append(hashed)
    rr.require(targets, 'verification must name original source files')
    scripts = []
    for filename in spec['scripts']:
        p = Path(filename).resolve(); data = p.read_bytes()
        scripts.append({'path':str(p), 'sha256':rr.digest(data), 'content':data.decode()})
    rr.require(scripts and all(isinstance(s,str) for s in spec['command']), 'script and argv required')
    started = rr.now(); begin = time.monotonic()
    try:
        cp = subprocess.run(spec['command'], cwd=spec.get('cwd'), capture_output=True, text=True, timeout=timeout)
        exit_code, stdout, stderr = cp.returncode, cp.stdout, cp.stderr
    except subprocess.TimeoutExpired as e:
        exit_code, stdout, stderr = None, (e.stdout or b'').decode() if isinstance(e.stdout,bytes) else (e.stdout or ''), 'verification timed out'
    output = {}
    try:
        output = json.loads(stdout)
    except (ValueError, TypeError):
        pass
    if not isinstance(output, dict):
        output = {}
    stable = all(rr.digest(rr.source_path(source_run,t).read_bytes()) == t['sha256'] for t in targets)
    outcome = output.get('outcome', 'inconclusive')
    cases = output.get('cases', [])
    adequate = (exit_code == 0 and stable and isinstance(cases,list) and cases
                and all(isinstance(c,dict) for c in cases)
                and any(c.get('kind')=='trigger' for c in cases)
                and any(c.get('kind')=='control' for c in cases)
                and all(c.get('passed') is True and all(k in c for k in ('name','expected','actual')) for c in cases))
    if not adequate or outcome not in ('reproduced','not_reproduced','inconclusive'):
        outcome = 'inconclusive'
    result = {**spec, 'finding':finding_id, 'run':finding['run'], 'outcome':outcome,
              'baseline_digest':rr.report_digest(report), 'at':started, 'duration_seconds':round(time.monotonic()-begin,3),
              'targets':targets, 'scripts':scripts, 'source_unchanged':stable,
              'execution':{'exit_code':exit_code,'stdout':stdout,'stderr':stderr}, 'cases':cases if isinstance(cases,list) and all(isinstance(c,dict) for c in cases) else []}
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report',required=True);p.add_argument('--finding',required=True)
    p.add_argument('--spec',required=True);p.add_argument('--out',required=True)
    p.add_argument('--timeout',type=int,default=60)
    a=p.parse_args()
    result=run(rr.read(a.report),a.finding,rr.read(a.spec),a.timeout)
    rr.write_new(a.out,result)
    print(json.dumps({'finding':a.finding,'outcome':result['outcome'],'cases':len(result['cases'])}))
