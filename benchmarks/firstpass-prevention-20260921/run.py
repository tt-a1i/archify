"""Coordinate frozen, independent author trials and retain public evidence only."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
WORKTREE = HERE.parents[1]
PREVIOUS = WORKTREE / 'benchmarks/source-tools-20260921'


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(path):
    return {str(p.relative_to(path)): sha(p) for p in sorted(path.rglob('*'))
            if p.is_file() and '.git' not in p.relative_to(path).parts}


def git(path, *args):
    return subprocess.check_output(['git', *args], cwd=path, text=True).strip()


def ledger(out, event, **fields):
    with (out / 'ledger.jsonl').open('a') as stream:
        stream.write(json.dumps({'event': event, 'epoch': time.time(), **fields}) + '\n')


def freeze(args):
    assert not (args.out / 'freeze.json').exists(), 'Use a new evidence directory; never replace a frozen experiment'
    args.out.mkdir(parents=True, exist_ok=True)
    tasks = read(HERE / 'tasks.json')
    sources = {}
    for task in tasks['tasks']:
        root = args.scratch / 'repos' / task['id']
        assert git(root, 'rev-parse', 'HEAD') == task['revision']
        assert not git(root, 'status', '--porcelain=v1')
        sources[task['id']] = {'commit': task['revision'], 'files': tree(root)}
    result = {
        'epoch': time.time(), 'base': git(WORKTREE, 'rev-parse', 'HEAD'),
        'package': tree(WORKTREE / 'archify'), 'sources': sources,
        'intervention': {p.name: sha(p) for p in [HERE / 'firstpass.mjs',
                         HERE / 'prevention.md', HERE / 'tasks.json', HERE / 'protocol.json',
                         HERE / 'run.py', HERE / 'watch.py', HERE / 'evaluate.py']},
        'tasks': tasks,
        'author': {'model': 'gpt-5.6-terra', 'effort': 'medium', 'native_cap_seconds': 600,
                   'repairs_cap': 3, 'fresh_context': True, 'execution': 'serial'},
        'screening': {'all_candidates_quality_pass': True, 'minimum_qualified_pairs': 2,
                      'median_full_saving_fraction': 0.15, 'median_full_saving_seconds': 20,
                      'maximum_pair_slowdown_fraction': 0.10},
        'confirmation': 'Only if screening passes: one fresh opposite-order pair per original task. No defaults promotion from initial triad alone.',
        'quality': 'Author-visible clauses only, no source contradiction, evidence entailment, original showcase finalize, independent common-viewport readability; normal vertical document scrolling allowed.',
        'timing': 'T_full begins before per-run copying/dispatch and ends at native task_complete; common remote clone/research/review costs reported separately. Preparation helper time and first structural JSON are diagnostic only.',
        'limits': 'No guarantee of empty provider/model/OS caches; native public events do not expose HTTP retries, server latency or hidden reasoning.',
    }
    result['protocol'] = read(HERE / 'protocol.json')
    result['initial_order'] = result['protocol']['authors']['order']
    result['experiment'] = result['protocol']['condition']
    write(args.out / 'freeze.json', result)
    ledger(args.out, 'frozen', base=result['base'])
    print(json.dumps({'frozen': str(args.out / 'freeze.json'), 'tasks': len(sources)}))


def begin(args):
    started = time.time()
    frozen = read(args.out / 'freeze.json')
    for name, expected in frozen['intervention'].items():
        assert sha(HERE / name) == expected, f'Frozen intervention changed: {name}'
    assert tree(WORKTREE / 'archify') == frozen['package'], 'Package changed'
    task_id, condition = args.run.rsplit('-', 1)
    assert condition in ('B1', 'P1', 'B2', 'P2')
    package = WORKTREE / 'archify'
    task = next(x for x in frozen['tasks']['tasks'] if x['id'] == task_id)
    source = args.scratch / 'repos' / task_id
    assert tree(source) == frozen['sources'][task_id]['files']
    workspace = args.scratch / 'runs' / args.run
    workspace.mkdir(parents=True, exist_ok=False)
    shutil.copytree(source, workspace / 'repo')
    shutil.copytree(package, workspace / 'archify')
    if condition.startswith('P'):
        (workspace / 'tools').mkdir()
        shutil.copy2(HERE / 'firstpass.mjs', workspace / 'tools/firstpass.mjs')
        shutil.copy2(HERE / 'prevention.md', workspace / 'PREVENTION.md')
    common = f'''You are an independent timed Archify author. Work only in {workspace}.
You are not alone in the filesystem: do not modify another worker's files. You own only this workspace's build.mjs and output/ artifacts.
Read your local archify/SKILL.md and applicable references. Use only the local repo/ source and the packaged archify/ Skill; do not inspect other trials, research reports, prior diagrams, installed Skills, hidden rubrics or parent context. Do not delegate or use network. Do not modify source, Skill, renderer, validator or tools. Ordinary local shell/text inspection is available.

TASK: {task['prompt']}

Required visible acceptance criteria (these exact clauses will be used in independent review):
''' + '\n'.join(f'{i + 1}. {x}' for i, x in enumerate(task['required']))
    common += '''

Deliver an English source-backed Architecture showcase in output/diagram.architecture.json and output/diagram.html. Keep exact repository metadata and source evidence. Use the complete normal finalize command with --repo-root ./repo --quality showcase --json. All authoring, helper execution, repairs and final response count toward time. Allow at most three focused repairs after the first finalize; if still blocked, report the failure without changing meaning or quality. Stop within 600 seconds. Do not claim machine success is semantic/visual human acceptance.
Do not create a separate report or screenshots during authoring. Final response should identify the artifact and actual gate status concisely. Every visible role and material explanation must be grounded in source; no node/edge/evidence/card/view quotas.
'''
    if condition.startswith('P'):
        common += '''
Controlled condition: read PREVENTION.md and use tools/firstpass.mjs for the initial candidate. Retain the normal Skill and reference reads. Author the source-backed content, map every visible task clause to actual explanatory strings, then choose rows/columns; the helper measures preferred text sizes and writes normal automatic-route JSON. Save initial-plan.json and preparation.json under output/ as the guide shows. After first finalize, repair ordinary JSON under the same limits. Coverage anchors are structural checks, not semantic acceptance.
'''
    else:
        common += '\nControlled condition: follow the ordinary packaged Skill authoring path. No additional helper is provided.\n'
    write(workspace / 'task.json', task)
    (workspace / 'TASK.md').write_text(common)
    result = args.out / args.run
    stdout = (workspace / 'observer.stdout').open('w')
    stderr = (workspace / 'observer.stderr').open('w')
    observer = subprocess.Popen([sys.executable, str(HERE / 'watch.py'),
                                '--workspace', str(workspace), '--out', str(result),
                                '--artifact', 'diagram.architecture.json', '--cap', '660'],
                               stdout=stdout, stderr=stderr, start_new_session=True)
    for _ in range(100):
        if (result / 'ready.json').exists():
            break
        if observer.poll() is not None:
            raise RuntimeError('Observer failed before ready')
        time.sleep(.05)
    assert (result / 'ready.json').exists()
    shutil.copy2(workspace / 'TASK.md', result / 'TASK.md')
    write(result / 'start.json', {'full_start_epoch': started, 'workspace': str(workspace),
                                'prepared_epoch': time.time(), 'observer_pid': observer.pid,
                                'condition': condition, 'task_id': task_id})
    ledger(args.out, 'prepared', run=args.run, workspace=str(workspace))
    print(json.dumps({'run': args.run, 'task': str(workspace / 'TASK.md'),
                      'full_start_epoch': started, 'setup_seconds': time.time() - started}))


def finish(args):
    result = args.out / args.run
    start = read(result / 'start.json')
    workspace = pathlib.Path(start['workspace'])
    write(result / 'done.json', {'epoch': time.time(), 'task_status': args.state,
                               'delivery_status': 'See exact artifact receipts; not implied by task completion.'})
    for _ in range(50):
        if (result / 'receipt.json').exists():
            break
        time.sleep(.1)
    if (workspace / 'output').exists():
        shutil.copytree(workspace / 'output', result / 'artifacts', dirs_exist_ok=True)
    shutil.copy2(workspace / 'task.json', result / 'task.json')
    if (workspace / 'build.mjs').exists():
        shutil.copy2(workspace / 'build.mjs', result / 'build.mjs')
    # Only the first session metadata record is read during discovery.
    sessions = []
    day = datetime.datetime.fromtimestamp(start['full_start_epoch']).strftime('%Y/%m/%d')
    for session in (pathlib.Path.home() / '.codex/sessions' / day).glob('*.jsonl'):
        with session.open() as stream:
            meta = json.loads(stream.readline()).get('payload', {})
        origin = meta.get('source', {})
        if isinstance(origin, dict) and origin.get('subagent', {}).get('thread_spawn', {}).get('agent_path') == args.agent:
            sessions.append(session)
    assert len(sessions) == 1, f'Expected one native session, found {len(sessions)}'
    spec = importlib.util.spec_from_file_location('public_trace', PREVIOUS / 'trace_extract.py')
    trace = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trace)
    base_categories = trace.categories
    def categories(command):
        values = base_categories(command)
        if 'build.mjs' in command:
            values.append('author-script')
        if 'PREVENTION.md' in command:
            values.append('prevention-guide')
        return sorted(set(values))
    trace.categories = categories
    native = None
    if args.state == 'completed':
        for attempt in range(20):
            try:
                native = trace.extract(sessions[0], read(result / 'receipt.json'))
                break
            except ValueError:
                if attempt == 19:
                    raise
                time.sleep(.25)
        native['full_task_seconds'] = trace.epoch(native['task_completed_at']) - start['full_start_epoch']
    else:
        native = {'censored': True, 'state': args.state, 'full_task_seconds': None,
                  'note': 'No successful latency from an aborted or timed-out author.'}
    write(result / 'native-trace.json', native)
    frozen = read(args.out / 'freeze.json')
    expected_package = frozen['package']
    integrity = {'source_unchanged': tree(workspace / 'repo') == frozen['sources'][start['task_id']]['files'],
                 'package_unchanged': tree(workspace / 'archify') == expected_package,
                 'task_unchanged': read(workspace / 'task.json') == next(x for x in frozen['tasks']['tasks'] if x['id'] == start['task_id'])}
    if start['condition'].startswith('P'):
        integrity['helper_unchanged'] = sha(workspace / 'tools/firstpass.mjs') == frozen['intervention']['firstpass.mjs']
        integrity['guide_unchanged'] = sha(workspace / 'PREVENTION.md') == frozen['intervention']['prevention.md']
    integrity['outcome_eligible'] = all(integrity.values())
    write(result / 'integrity.json', integrity)
    ledger(args.out, args.state, run=args.run, agent=args.agent,
           artifact_integrity_eligible=integrity['outcome_eligible'])
    print(json.dumps({'run': args.run, 'integrity': integrity,
                      **{k: native.get(k) for k in ['identity', 'native_task_seconds',
                         'full_task_seconds', 'first_complete_from_native_start_seconds', 'surfaced_faults']}}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['freeze', 'begin', 'finish'])
    parser.add_argument('--scratch', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--run')
    parser.add_argument('--agent')
    parser.add_argument('--state', choices=['completed', 'aborted'], default='completed')
    args = parser.parse_args()
    {'freeze': freeze, 'begin': begin, 'finish': finish}[args.action](args)


if __name__ == '__main__':
    main()
