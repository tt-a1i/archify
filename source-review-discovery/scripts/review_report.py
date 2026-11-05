#!/usr/bin/env python3
"""Versioned, source-grounded review artifacts. Python standard library only."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone

VERSION = 1
CHECKS = ('contract', 'reachability', 'violation', 'impact', 'protections')
VERDICTS = ('static_confirmed', 'conditional', 'design_question', 'withdrawn')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def read(path):
    return json.loads(Path(path).read_text())


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    with path.open('x', encoding='utf-8') as stream:
        stream.write(text)


def report_digest(report):
    return digest(json.dumps(report, sort_keys=True, ensure_ascii=False).encode())


def stable_id(key):
    require(set(key) == {'repository', 'subject', 'concern'}, 'key needs repository, subject, concern')
    require(all(isinstance(v, str) and v.strip() for v in key.values()), 'empty identity')
    return 'SR-' + digest(json.dumps(key, sort_keys=True, ensure_ascii=False).encode())[:12]


def validate_run(run):
    require(re.fullmatch(r'[A-Za-z0-9_.-]+', run['id']) is not None, 'invalid run id')
    require(run['mode'] in ('source', 'runtime'), 'mode must be source or runtime')
    require(run['coverage']['status'] in ('complete', 'partial'), 'invalid coverage status')
    for field in ('checked', 'excluded', 'limitations'):
        require(isinstance(run['coverage'][field], list), 'coverage.' + field + ' must be a list')
    ids = [s['id'] for s in run['sources']]
    require(ids and len(ids) == len(set(ids)), 'duplicate or empty sources')
    for s in run['sources']:
        require(Path(s['root']).is_absolute() and s['revision'].strip(), 'absolute root and revision required')
    require(isinstance(run['tools'], list) and run['reviewer'].strip(), 'tools and reviewer required')


def source_path(run, e, overrides=None):
    s = next((s for s in run['sources'] if s['id'] == e['repository']), None)
    require(s is not None, 'unknown repository: ' + e['repository'])
    root = Path((overrides or {}).get(s['id'], s['root'])).resolve()
    rel = Path(e['path'])
    require(not rel.is_absolute() and '..' not in rel.parts, 'evidence path must stay in repository')
    path = (root / rel).resolve()
    require(path.is_relative_to(root), 'evidence symlink escapes repository')
    return path


def capture(run, declarations):
    validate_run(run)
    result = []
    for declaration in declarations:
        e = copy.deepcopy(declaration)
        e['run'] = run['id']
        data = source_path(run, e).read_bytes()
        lines = data.decode('utf-8').splitlines()
        require(type(e['start']) is int and type(e['end']) is int and
                1 <= e['start'] <= e['end'] <= len(lines), 'invalid evidence range: ' + e['id'])
        e['excerpt'] = '\n'.join(lines[e['start'] - 1:e['end']])
        e['sha256'] = digest(data)
        e['excerpt_sha256'] = digest(e['excerpt'].encode())
        e['captured_at'] = now()
        result.append(e)
    return result


def references(ids, evidence, context, required=True):
    require(isinstance(ids, list), context + ': evidence must be a list')
    require(not required or bool(ids), context + ': evidence required')
    require(all(i in evidence for i in ids), context + ': unknown evidence reference')


def validate(report):
    require(report['schema_version'] == VERSION, 'unsupported report schema version')
    require(report['project'].strip(), 'project required')
    runs = {r['id']: r for r in report['runs']}
    require(runs and len(runs) == len(report['runs']), 'duplicate or empty runs')
    for run in runs.values():
        validate_run(run)
    evidence = {e['id']: e for e in report['evidence']}
    require(len(evidence) == len(report['evidence']), 'duplicate evidence id')
    for e in evidence.values():
        require(e['run'] in runs and e['kind'] in ('source', 'document', 'tool'), 'invalid evidence origin')
        source_path(runs[e['run']], e)
        require(type(e['start']) is int and type(e['end']) is int and 1 <= e['start'] <= e['end'], 'invalid range')
        require(re.fullmatch('[a-f0-9]{64}', e['sha256']) is not None, 'invalid file hash')
        require(digest(e['excerpt'].encode()) == e['excerpt_sha256'], 'corrupt evidence excerpt')
    ids = set()
    for f in report['findings']:
        require(f['id'] == stable_id(f['key']) and f['id'] not in ids, 'invalid or duplicate finding identity')
        ids.add(f['id'])
        require(f['verdict'] in VERDICTS and f['severity'] in ('P0', 'P1', 'P2', 'P3'), 'invalid finding grade')
        require(f['run'] in runs and f['scope'], 'finding needs run and scope')
        for name in ('title', 'trigger', 'impact', 'recommendation', 'next_query'):
            require(isinstance(f[name], str) and f[name].strip(), 'finding missing ' + name)
        require(set(f['checks']) == set(CHECKS), 'five evidence checks required')
        for name, check in f['checks'].items():
            require(check['state'] in ('supported', 'open', 'contradicted') and check['reason'].strip(), 'invalid evidence check')
            references(check['evidence'], evidence, name, check['state'] != 'open')
            require(all(evidence[i]['run'] == f['run'] for i in check['evidence']), 'discovery check mixes runs')
        if f['verdict'] == 'static_confirmed':
            require(all(c['state'] == 'supported' for c in f['checks'].values()), 'static_confirmed has an unresolved proof obligation')
        if f['verdict'] == 'withdrawn':
            require(any(c['state'] == 'contradicted' for c in f['checks'].values()), 'withdrawal needs counterevidence')
        require(isinstance(f['gaps'], list) and isinstance(f['counterevidence'], list), 'gaps/counterevidence must be lists')
        for c in f['counterevidence']:
            require(c['reason'].strip(), 'counterevidence needs explanation')
            references(c['evidence'], evidence, 'counterevidence')
        graph = f['graph']
        nodes = {n['id']: n for n in graph.get('nodes', [])}
        require((nodes or graph.get('comparison')) and len(nodes) == len(graph.get('nodes', [])), 'invalid graph nodes')
        for n in nodes.values():
            require(n['role'] in ('step', 'failure', 'guard', 'unknown'), 'invalid node role')
            references(n['evidence'], evidence, 'node', n['role'] != 'unknown')
        for edge in graph.get('edges', []):
            require(edge['from'] in nodes and edge['to'] in nodes and edge['basis'] in ('source', 'inference', 'unknown'), 'invalid graph edge')
            references(edge['evidence'], evidence, 'edge', edge['basis'] != 'unknown')
            require(edge['label'].strip(), 'edge needs meaning')
        comparison = f['graph'].get('comparison')
        if comparison:
            require(len(comparison['columns']) >= 2 and comparison['rows'], 'comparison needs columns and rows')
            for row in comparison['rows']:
                require(len(row['cells']) == len(comparison['columns']), 'comparison row width mismatch')
                references(row['evidence'], evidence, 'comparison row')
        acceptance = f['acceptance']
        require(acceptance and len({a['id'] for a in acceptance}) == len(acceptance), 'acceptance criteria required/unique')
        require(all(a['text'].strip() for a in acceptance), 'empty acceptance criterion')
    seen = set()
    for event in report['events']:
        require(event['finding'] in ids and event['run'] in runs, 'event target not found')
        if event['outcome'] == 'discovered':
            require(event['finding'] not in seen, 'duplicate discovery event')
            seen.add(event['finding'])
        else:
            require(event['finding'] in seen, 'recheck before discovery')
            check_recheck(event, report, evidence)
    require(seen == ids, 'every finding needs discovery event')
    validate_supplements(report)
    return report


def validate_supplements(report):
    findings = {f['id']: f for f in report['findings']}
    evidence = {e['id']: e for e in report['evidence']}
    runs = {r['id']: r for r in report['runs']}
    architecture = report.get('architecture')
    if architecture:
        nodes = {n['id']: n for n in architecture['nodes']}
        require(len(nodes) == len(architecture['nodes']), 'duplicate architecture node')
        sources = {s['id']: s for s in architecture['sources']}
        for s in sources.values():
            require(any(s['repository'] == r['id'] and s['revision'] == r['revision']
                        for run in runs.values() for r in run['sources']), 'architecture revision differs from review')
        for n in nodes.values():
            require(n['source'] in sources and (n['parent'] is None or n['parent'] in nodes), 'invalid architecture parent/source')
            require(n['kind'] in ('source','directory','file'), 'invalid architecture node kind')
            parents = {n['id']}; parent = n['parent']
            while parent:
                require(parent not in parents, 'cyclic architecture hierarchy')
                parents.add(parent); parent = nodes[parent]['parent']
            if n['kind'] == 'file':
                require(re.fullmatch('[a-f0-9]{64}', n['sha256']) is not None, 'architecture file hash required')
                for e in evidence.values():
                    matching_run = runs[e['run']]
                    same_version = any(s['id'] == n['repository'] and s['revision'] == sources[n['source']]['revision'] for s in matching_run['sources'])
                    if e['repository'] == n['repository'] and e['path'] == n['repository_path'] and same_version:
                        require(e['sha256'] == n['sha256'], 'architecture source differs from evidence')
        for e in architecture['edges']:
            require(e['from'] in nodes and e['to'] in nodes and e['kind'] == 'import' and
                    type(e['line']) is int and e['line'] > 0, 'invalid architecture edge')
    for v in report.get('verifications', []):
        require(v['finding'] in findings and v['run'] in runs, 'invalid verification target')
        require(v['outcome'] in ('reproduced','not_reproduced','inconclusive','deferred'), 'invalid verification outcome')
        require(v['claim'].strip() and v['limitations'], 'verification claim/limits required')
        if v['outcome'] == 'deferred':
            require(v['reason'].strip(), 'deferred verification needs reason'); continue
        references(v['input_basis'], evidence, 'verification input')
        require(v['targets'] and v['scripts'], 'original targets and verification scripts required')
        for target in v['targets']:
            source_path(runs[v['run']], target)
            require(re.fullmatch('[a-f0-9]{64}', target['sha256']) is not None, 'invalid verification source hash')
            require(all(e['sha256'] == target['sha256'] for e in evidence.values() if e['run'] == v['run'] and e['repository'] == target['repository'] and e['path'] == target['path']), 'verification differs from referenced source')
        for script in v['scripts']:
            require(digest(script['content'].encode()) == script['sha256'], 'verification script hash mismatch')
        if v['outcome'] in ('reproduced','not_reproduced'):
            require(v['source_unchanged'] and v['execution']['exit_code'] == 0, 'failed execution cannot confirm behavior')
            require({'trigger','control'} <= {c['kind'] for c in v['cases']} and all(c['passed'] is True for c in v['cases']), 'verification needs trigger and passing control')


def enrich(report, architecture=None, verifications=None):
    result = copy.deepcopy(report)
    result['artifact_parent_digest'] = report_digest(report)
    if architecture is not None:
        result['architecture'] = architecture
    if verifications is not None:
        for item in verifications:
            require(item['baseline_digest'] == report_digest(report), 'verification targets a different report baseline')
        result.setdefault('verifications', []).extend(verifications)
    return validate(result)


def check_recheck(event, report, evidence):
    require(event['outcome'] in ('resolved', 'present', 'inconclusive', 'withdrawn'), 'invalid recheck outcome')
    require(event['reason'].strip() and event['reviewer'].strip(), 'recheck reason/reviewer required')
    require(event['basis'] in ('source', 'runtime'), 'recheck basis required')
    f = next(f for f in report['findings'] if f['id'] == event['finding'])
    run = next(r for r in report['runs'] if r['id'] == event['run'])
    require(event['run'] != f['run'], 'recheck must be a new run')
    require(event['basis'] == run['mode'], 'recheck basis differs from run')
    references(event['evidence'], evidence, 'recheck', event['outcome'] != 'inconclusive')
    require(all(evidence[i]['run'] == run['id'] for i in event['evidence']), 'recheck needs current-run evidence')
    criteria = {a['id'] for a in f['acceptance']}
    require(len({a['id'] for a in event['acceptance']}) == len(event['acceptance']), 'duplicate acceptance result')
    for a in event['acceptance']:
        require(a['id'] in criteria and a['status'] in ('passed', 'failed', 'unknown') and a['reason'].strip(), 'invalid acceptance result')
        references(a['evidence'], evidence, 'acceptance', a['status'] != 'unknown')
        require(all(evidence[i]['run'] == run['id'] for i in a['evidence']), 'acceptance needs current-run evidence')
    if event['outcome'] in ('resolved', 'withdrawn'):
        require(run['coverage']['status'] == 'complete' and set(f['scope']) <= set(run['coverage']['checked']), 'cannot close with incomplete coverage')
    if event['outcome'] == 'resolved':
        require({a['id'] for a in event['acceptance']} == criteria and all(a['status'] == 'passed' for a in event['acceptance']), 'resolution needs every acceptance criterion passed')


def freshness(report, overrides=None):
    runs = {r['id']: r for r in report['runs']}
    values = {}
    for e in report['evidence']:
        try:
            data = source_path(runs[e['run']], e, overrides).read_bytes()
            state = 'current' if digest(data) == e['sha256'] else 'changed'
        except FileNotFoundError:
            state = 'missing'
        except (OSError, ValueError):
            state = 'unavailable'
        values[e['id']] = state
    verification = {}
    for v in report.get('verifications', []):
        try:
            verification[v['finding']] = bool(v.get('targets')) and all(
                digest(source_path(runs[v['run']], t, overrides).read_bytes()) == t['sha256'] for t in v.get('targets', []))
        except (OSError, ValueError):
            verification[v['finding']] = False
    return {'checked_at': now(), 'evidence': values, 'verification': verification,
            'note': '仅校验引用文件与采集时一致；不证明推理正确，不覆盖未引用文件或当前部署。'}


def status(report, finding):
    events = [e for e in report['events'] if e['finding'] == finding['id']]
    latest = events[-1]
    if latest['outcome'] == 'resolved':
        return 'resolved'
    if latest['outcome'] == 'withdrawn' or (latest['outcome'] == 'discovered' and finding['verdict'] == 'withdrawn'):
        return 'withdrawn'
    if latest['outcome'] == 'inconclusive':
        return 'pending_recheck'
    if latest['outcome'] == 'present' and any(e['outcome'] == 'resolved' for e in events[:-1]):
        return 'reopened'
    return 'open' if finding['verdict'] == 'static_confirmed' else 'needs_evidence'


def make_task(report, finding, check):
    evidence_ids = set(i for c in finding['checks'].values() for i in c['evidence'])
    evidence_ids.update(i for c in finding['counterevidence'] for i in c['evidence'])
    evidence_ids.update(i for n in finding['graph'].get('nodes', []) for i in n['evidence'])
    evidence_ids.update(i for e in finding['graph'].get('edges', []) for i in e['evidence'])
    evidence_ids.update(i for row in finding['graph'].get('comparison', {}).get('rows', []) for i in row['evidence'])
    latest = [e for e in report['events'] if e['finding'] == finding['id']][-1]
    if latest['outcome'] != 'discovered':
        evidence_ids = set(latest['evidence']) | {i for a in latest['acceptance'] for i in a['evidence']}
    fresh = bool(evidence_ids) and all(check['evidence'][i] == 'current' for i in evidence_ids)
    kind = 'repair' if fresh and status(report, finding) in ('open', 'reopened') else 'investigate'
    return {'schema_version': VERSION, 'kind': kind, 'finding_id': finding['id'],
            'report_digest': report_digest(report), 'title': finding['title'],
            'finding': finding, 'evidence': [e for e in report['evidence'] if e['id'] in evidence_ids],
            'runs': report['runs'], 'freshness': check, 'latest_recheck': latest,
            'verifications': [v for v in report.get('verifications', []) if v['finding'] == finding['id']],
            'authorization': '导出任务不授权修改产品。执行修改遵循用户在会话中的授权。',
            'instructions': ['先核对当前版本及引用证据；证据过期则重新调查。',
                             '按触发条件和反证收窄结论；不要把图或检查项通过当作语义证明。',
                             '授权修复后保留最小变更，以原验收条目复查；写新 run，不能覆盖基线。',
                             '复查调用 review_report.py recheck；未观察到或工具失败必须用 inconclusive。']}


def publish(draft):
    report = {'schema_version': VERSION, 'project': draft['project'], 'runs': [draft['run']],
              'evidence': capture(draft['run'], draft['evidence']), 'findings': copy.deepcopy(draft['findings']), 'events': []}
    for f in report['findings']:
        f['id'] = stable_id(f['key'])
        f['run'] = draft['run']['id']
        report['events'].append({'finding': f['id'], 'run': f['run'], 'outcome': 'discovered', 'at': now()})
    return validate(report)


def recheck(report, draft):
    validate(report)
    require(draft['baseline_digest'] == report_digest(report), 'recheck targets a different baseline')
    require(draft['run']['id'] not in {r['id'] for r in report['runs']}, 'run id already exists')
    result = copy.deepcopy(report)
    run = copy.deepcopy(draft['run'])
    run['parent_digest'] = draft['baseline_digest']
    result['runs'].append(run)
    # The previous report keeps its map. A new source version needs a new extraction.
    if result.get('architecture') and any(not any(s['id'] == a['repository'] and s['revision'] == a['revision'] for s in run['sources']) for a in result['architecture']['sources']):
        result.pop('architecture')
    fresh_evidence = capture(draft['run'], draft['evidence'])
    result['evidence'].extend(fresh_evidence)
    by_id = {i['finding']: i for i in draft['items']}
    require(len(by_id) == len(draft['items']), 'duplicate recheck item')
    require(set(by_id) <= {f['id'] for f in report['findings']}, 'unknown recheck finding')
    for f in report['findings']:
        item = copy.deepcopy(by_id.get(f['id'], {'finding': f['id'], 'outcome': 'inconclusive',
            'reason': '本轮未覆盖此问题，不能推断已经修复。', 'reviewer': draft['run']['reviewer'],
            'basis': draft['run']['mode'], 'evidence': [], 'acceptance': []}))
        item.update(run=draft['run']['id'], at=now())
        result['events'].append(item)
    return validate(result)


def compile_scene(report, scene, check=None):
    validate(report)
    path = Path(__file__).with_name('review_scene.py')
    spec = importlib.util.spec_from_file_location('source_review_scene', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.compile_scene(report, scene, check if check is not None else freshness(report))


def render(report, scene=None):
    validate(report)
    check = freshness(report)
    if scene is not None:
        payload = compile_scene(report, scene, check)
        finding = payload['finding']
        payload['task'] = make_task(report, finding, check)
        payload['status_label'] = {'open': '待处理', 'needs_evidence': '待补证',
            'pending_recheck': '待复查', 'resolved': '已修复（原问题留档）',
            'withdrawn': '已撤回（原问题留档）', 'reopened': '重新打开'}[status(report, finding)]
        assets = Path(__file__).resolve().parent.parent / 'assets'
        native_path = Path(__file__).with_name('review_native.py')
        native_spec = importlib.util.spec_from_file_location('source_review_native', native_path)
        native_module = importlib.util.module_from_spec(native_spec)
        native_spec.loader.exec_module(native_module)
        return native_module.render(payload, assets)
    payload = {'report': report, 'freshness': check,
               'states': {f['id']: status(report, f) for f in report['findings']},
               'tasks': {f['id']: make_task(report, f, check) for f in report['findings']}}
    # Never allow a source excerpt or title to terminate the inert JSON script element.
    data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    assets = Path(__file__).resolve().parent.parent / 'assets'
    page = (assets / 'report.html').read_text()
    license_text = (assets / 'Geist-LICENSE.txt').read_text().replace('*/', '* /')
    css = '/* Embedded Geist font license:\n' + license_text + '\n*/\n'
    css += (assets / 'report.css').read_text().replace('FONT_DATA', base64.b64encode((assets / 'geist-latin.woff2').read_bytes()).decode())
    css += '\n' + (assets / 'architecture.css').read_text()
    js = (assets / 'report.js').read_text().replace('/* ARCHITECTURE_JS */', (assets / 'architecture.js').read_text())
    return page.replace('/* REPORT_CSS */', css).replace('/* REPORT_JS */', js).replace('REVIEW_PAYLOAD', data)


def bundle(report, scenes, output):
    """Publish one local, offline overview + details package after all validation."""
    import review_panorama
    validate(report)
    output = Path(output)
    require(not output.exists(), 'output directory exists; preserve the earlier report')
    assets = Path(__file__).resolve().parent.parent / 'assets'
    prepared = {}
    for scene in scenes:
        compile_scene(report, scene)
        finding = scene['finding_id']
        require(finding not in prepared, 'duplicate scene for finding: ' + finding)
        prepared[finding] = render(report, scene)
    links = {f['id']: 'findings/' + f['id'] + '.html' if f['id'] in prepared
             else 'findings.html#finding=' + f['id'] for f in report['findings']}
    panorama = review_panorama.render(report, links, assets)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.source-review-build-', dir=output.parent) as temp:
        staging = Path(temp)
        write_new(staging/'index.html', panorama)
        write_new(staging/'review.json', report)
        fallback = render(report).replace('<body>', '<body><a class="report-home" href="index.html">返回系统全景</a>')
        write_new(staging/'findings.html', fallback)
        for key, page in prepared.items():
            # Generated relative target; never accept navigation URLs from a report.
            back = '<a class="sr-back" href="../index.html#finding=' + key + '">返回系统全景</a>'
            page = page.replace('</body>', '<script>document.querySelector(".sr-context").insertAdjacentHTML("beforebegin",' + json.dumps(back) + ');</script></body>')
            write_new(staging/'findings'/ (key + '.html'), page)
        # copytree rejects an existing destination. No product source is executed.
        shutil.copytree(staging, output)
    return links


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('publish'); p.add_argument('--input', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('recheck'); p.add_argument('--report', required=True); p.add_argument('--input', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('enrich'); p.add_argument('--report', required=True); p.add_argument('--architecture'); p.add_argument('--verifications'); p.add_argument('--out', required=True)
    p = sub.add_parser('bundle'); p.add_argument('--report', required=True); p.add_argument('--scene', action='append', default=[]); p.add_argument('--out', required=True)
    for command in ('validate', 'verify', 'render', 'task', 'digest'):
        p = sub.add_parser(command); p.add_argument('--report', required=True)
        if command in ('render', 'task'): p.add_argument('--out', required=True)
        if command in ('render', 'validate'): p.add_argument('--scene', help='Optional evidence-flow scene bound to this report')
        if command == 'task': p.add_argument('--finding', required=True)
        if command == 'verify': p.add_argument('--root', action='append', default=[], metavar='REPOSITORY=PATH')
    args = parser.parse_args()
    if args.command == 'publish':
        report = publish(read(args.input)); write_new(args.out, report)
    else:
        report = validate(read(args.report))
        if args.command == 'recheck':
            report = recheck(report, read(args.input)); write_new(args.out, report)
        elif args.command == 'enrich':
            report = enrich(report, read(args.architecture) if args.architecture else None,
                            read(args.verifications) if args.verifications else None)
            write_new(args.out, report)
        elif args.command == 'render': write_new(args.out, render(report, read(args.scene) if args.scene else None))
        elif args.command == 'bundle': bundle(report, [read(s) for s in args.scene], args.out)
        elif args.command == 'validate' and args.scene: compile_scene(report, read(args.scene))
        elif args.command == 'task':
            f = next((f for f in report['findings'] if f['id'] == args.finding), None)
            require(f is not None, 'finding not found')
            write_new(args.out, make_task(report, f, freshness(report)))
        elif args.command == 'verify':
            print(json.dumps(freshness(report, dict(x.split('=', 1) for x in args.root)), ensure_ascii=False, indent=2)); return
        elif args.command == 'digest': print(report_digest(report)); return
    print(json.dumps({'status': 'ok', 'command': args.command, 'findings': len(report['findings']),
                      'report_digest': report_digest(report)}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as exc:
        print(json.dumps({'status': 'error', 'message': str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
