"""Directory-grounded overview with links to evidence scenes; no new findings."""
import json
import math
import re
from pathlib import Path

import review_native
import review_report as rr


def model(report, links):
    architecture = report.get('architecture')
    rr.require(architecture is not None, 'bundle needs an extracted architecture; use render for a finding-only report')
    by_id = {n['id']: n for n in architecture['nodes']}
    children = {}
    for node in by_id.values():
        children.setdefault(node['parent'], []).append(node['id'])
    def files(key):
        node = by_id[key]
        return [node] if node['kind'] == 'file' else [f for child in children.get(key, []) for f in files(child)]

    evidence = {e['id']: e for e in report['evidence']}
    findings = []
    for f in report['findings']:
        used = set(e for c in f['checks'].values() for e in c['evidence'])
        used.update(e for c in f['counterevidence'] for e in c['evidence'])
        used.update(e for n in f['graph'].get('nodes', []) for e in n['evidence'])
        locations = {(evidence[e]['repository'], evidence[e]['path']) for e in used}
        faults = {(evidence[e]['repository'], evidence[e]['path']) for e in f['checks']['violation']['evidence']}
        records = [v for v in report.get('verifications', []) if v['finding'] == f['id']]
        latest = records[-1] if records else None
        fresh = False
        if latest and latest.get('targets'):
            run = next(r for r in report['runs'] if r['id'] == latest['run'])
            try:
                fresh = all(rr.digest(rr.source_path(run, t).read_bytes()) == t['sha256'] for t in latest['targets'])
            except (OSError, ValueError):
                pass
        findings.append({**f, 'state': rr.status(report, f), 'href': links[f['id']],
            'verified': bool(latest and latest['outcome'] == 'reproduced' and fresh
                             and f['verdict'] == 'static_confirmed'
                             and rr.status(report, f) in ('open', 'reopened')),
            'verification': latest['outcome'] if latest else 'unverified',
            'locations': [list(p) for p in sorted(locations)], 'faults': [list(p) for p in sorted(faults)]})

    modules, groups = [], []
    for source in architecture['sources']:
        root = source['id'] + ':'
        entry = root + source.get('entry', '')
        if entry not in by_id:
            entry = root
        rr.require(root in by_id, 'architecture source root is missing')
        inside = files(entry)
        entries = [(by_id[key], files(key)) for key in children.get(entry, [])]
        if not entries and inside:
            entries = [(by_id[entry], inside)]
        included = {f['id'] for f in inside}
        outside = [f for f in files(root) if f['id'] not in included]
        if outside:
            entries.append(({'id': root+'outside', 'label': '其他源码', 'path': '', 'kind': 'group'}, outside))
        group_ids = []
        for node, members in entries:
            paths = {(f['repository'], f['repository_path']) for f in members}
            related = [f['id'] for f in findings if paths.intersection(map(tuple, f['locations']))]
            faulty = [f['id'] for f in findings if f['state'] not in ('resolved', 'withdrawn') and paths.intersection(map(tuple, f['faults']))]
            key = 'm' + str(len(modules))
            modules.append({'id': key, 'source': source['id'], 'key': node['id'], 'label': node['label'],
                'path': node['path'], 'kind': node['kind'], 'files': members,
                'findings': related, 'faults': faulty, 'loc': sum(f.get('loc', 0) for f in members)})
            group_ids.append(key)
        groups.append({'source': source, 'modules': group_ids})
    owner = {f['id']: m['id'] for m in modules for f in m['files']}
    dependencies = {}
    for edge in architecture['edges']:
        a, b = owner.get(edge['from']), owner.get(edge['to'])
        if a is None or b is None or a == b:
            continue
        key = (a, b)
        dependencies.setdefault(key, []).append(edge)
    return {'project': report['project'], 'digest': rr.report_digest(report),
        'groups': groups, 'modules': modules, 'findings': findings,
        'dependencies': [{'from': a, 'to': b, 'references': refs} for (a, b), refs in dependencies.items()],
        'coverage': architecture['coverage'], 'runs': report['runs'],
        'file_count': sum(n['kind'] == 'file' for n in by_id.values()),
        'import_count': len(architecture['edges'])}


def diagram(payload):
    modules = {m['id']: m for m in payload['modules']}
    findings = {f['id']: f for f in payload['findings']}
    components, boundaries = [], []
    y = 74
    for group in payload['groups']:
        for i, key in enumerate(group['modules']):
            m = modules[key]
            confirmed = any(findings[f]['verdict'] == 'static_confirmed' for f in m['faults'])
            color = 'security' if confirmed else 'cloud' if m['faults'] else 'frontend' if m['findings'] else 'external'
            components.append({'id': key, 'type': color, 'label': m['label'],
                'sublabel': f"{len(m['files'])} 个文件 · {m['loc']:,} 行", 'tag': '点击查看模块',
                'icon': 'none', 'pos': [48 + (i % 4) * 294, y + (i // 4) * 160], 'size': [264, 128]})
        if group['modules']:
            boundaries.append({'kind': 'region', 'label': group['source']['title'], 'wraps': group['modules'], 'pad': 26})
            y += math.ceil(len(group['modules']) / 4) * 160 + 78
    rr.require(components, 'architecture contains no source files')
    # This is a directory map. Imports remain exact, queryable facts in the inspector;
    # connecting every tile would incorrectly turn directory layout into runtime flow.
    return {'schema_version': 1, 'diagram_type': 'architecture',
        'meta': {'title': '系统全景', 'subtitle': payload['project'], 'locale': 'zh-CN',
            'output': 'overview.html', 'visual_preset': 'signal-flow', 'animation': 'none',
            'legend': {'mode': 'hidden'}},
        'components': components, 'boundaries': boundaries, 'connections': [], 'cards': []}


def render(report, links, assets):
    payload = model(report, links)
    output = review_native.render_document(diagram(payload), assets)
    output = re.sub(r'(data-node-kind=")[^"]+', r'\1源码模块', output)
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    output = output.replace('</head>', '<style>' + (assets/'panorama.css').read_text() + '</style></head>')
    script = '<script id="panorama-payload" type="application/json">' + data + '</script><script>' + (assets/'panorama.js').read_text() + '</script>'
    return output.replace('</body>', script + '</body>')
