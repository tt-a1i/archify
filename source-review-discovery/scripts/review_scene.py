"""Validate and compile an evidence-flow view against an immutable review report.

Uses only the standard library. Scene values never substitute for recorded outputs.
"""
import hashlib
import json
import math


def fail(path, message):
    raise ValueError(f'scene {path}: {message}')


def obj(value, path, required, optional=()):
    if not isinstance(value, dict):
        fail(path, 'expected object')
    missing, extra = set(required) - value.keys(), value.keys() - set(required) - set(optional)
    if missing or extra:
        fail(path, f'missing={sorted(missing)}, unsupported={sorted(extra)}')


def text(value, path):
    if not isinstance(value, str) or not value.strip():
        fail(path, 'expected non-empty text')


def items(value, path, minimum=0):
    if not isinstance(value, list) or len(value) < minimum:
        fail(path, f'expected array with at least {minimum} item(s)')


def compile_scene(report, scene, freshness):
    obj(scene, '/', ['schema_version', 'report_digest', 'finding_id', 'input_node',
                     'lanes', 'scenarios', 'default_scenario', 'focus'])
    if type(scene['schema_version']) is not int or scene['schema_version'] not in (1, 2):
        fail('/schema_version', 'supported versions are 1 and 2')
    digest = hashlib.sha256(json.dumps(report, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if scene['report_digest'] != digest:
        fail('/report_digest', 'view targets a different report; rebind after reviewing changes')
    finding = next((f for f in report['findings'] if f['id'] == scene['finding_id']), None)
    if finding is None:
        fail('/finding_id', 'finding not found')
    nodes = {n['id']: n for n in finding['graph'].get('nodes', [])}
    evidence = {e['id']: e for e in report['evidence']}
    attached = set(ref for entry in [*finding['checks'].values(), *finding['counterevidence'],
                                    *nodes.values(), *finding['graph'].get('edges', [])]
                   for ref in entry['evidence'])

    def refs(value, path, required=True):
        items(value, path, int(required))
        for ref in value:
            if not isinstance(ref, str) or ref not in evidence or evidence[ref]['run'] != finding['run']:
                fail(path, 'evidence missing or belongs to a different discovery run')
            if ref not in attached:
                fail(path, 'attach evidence to the finding before using it in the view')

    def node_id(value, path):
        if not isinstance(value, str) or value not in nodes:
            fail(path, 'graph node not found')

    node_id(scene['input_node'], '/input_node')
    items(scene['lanes'], '/lanes', 1)
    used, lane_ids, lanes = [scene['input_node']], set(), []
    graph_edges = {(e['from'], e['to']) for e in finding['graph'].get('edges', [])}
    rendered_edges = set()
    for i, lane in enumerate(scene['lanes']):
        path = f'/lanes/{i}'
        members_key = 'process_node' if scene['schema_version'] == 1 else 'nodes'
        obj(lane, path, ['id', 'title', members_key, 'output_node', 'measure'])
        for name in ['id', 'title']:
            text(lane[name], path + '/' + name)
        if lane['id'] in lane_ids:
            fail(path + '/id', 'duplicate lane id')
        lane_ids.add(lane['id'])
        members = [lane['process_node'], lane['output_node']] if scene['schema_version'] == 1 else lane['nodes']
        items(members, path + '/nodes', 1)
        for node in members:
            node_id(node, path + '/nodes')
            used.append(node)
        node_id(lane['output_node'], path + '/output_node')
        if lane['output_node'] not in members:
            fail(path + '/output_node', 'output must belong to this lane')
        lanes.append({**lane, 'nodes': members})
        obj(lane['measure'], path + '/measure', ['label', 'unit', 'actual_key'])
        for name in ['label', 'actual_key']:
            text(lane['measure'][name], path + '/measure/' + name)
        if not isinstance(lane['measure']['unit'], str):
            fail(path + '/measure/unit', 'unit must be text (empty is allowed)')
        if scene['schema_version'] == 1:
            rendered_edges.update([(scene['input_node'], lane['process_node']),
                                   (lane['process_node'], lane['output_node'])])
    if len(set(used)) != len(used) or set(used) != nodes.keys():
        fail('/lanes', 'each graph node must appear exactly once across input and lanes')
    if scene['schema_version'] == 1 and (rendered_edges != graph_edges or len(graph_edges) != len(finding['graph'].get('edges', []))):
        fail('/lanes', 'layout must preserve every graph relationship without inventing or hiding edges')

    if not isinstance(scene['focus'], dict):
        fail('/focus', 'expected node-to-source focus map')
    for node, focus in scene['focus'].items():
        node_id(node, '/focus/' + node)
        obj(focus, '/focus/' + node, ['evidence', 'start', 'end', 'highlight'])
        if focus['evidence'] not in nodes[node]['evidence']:
            fail('/focus/' + node, 'focus must cite evidence attached to this node')
        e = evidence[focus['evidence']]
        if not (type(focus['start']) is int and type(focus['end']) is int and
                e['start'] <= focus['start'] <= focus['end'] <= e['end']):
            fail('/focus/' + node, 'source range outside the captured evidence')
        items(focus['highlight'], '/focus/' + node + '/highlight')
        if any(type(line) is not int or not focus['start'] <= line <= focus['end'] for line in focus['highlight']):
            fail('/focus/' + node, 'highlight outside the selected range')

    items(scene['scenarios'], '/scenarios', 1)
    scenario_ids, compiled = set(), []
    for i, case in enumerate(scene['scenarios']):
        path = f'/scenarios/{i}'
        obj(case, path, ['id', 'title', 'kind', 'input', 'states'], ['verification_case'])
        text(case['id'], path + '/id'); text(case['title'], path + '/title')
        if case['id'] in scenario_ids:
            fail(path, 'duplicate scenario id')
        scenario_ids.add(case['id'])
        if case['kind'] not in ('control', 'trigger', 'exploratory'):
            fail(path + '/kind', 'expected control, trigger or exploratory')
        inp = case['input']
        obj(inp, path + '/input', ['origin', 'groups', 'evidence'])
        if inp['origin'] not in ('synthetic', 'observed', 'hypothetical'):
            fail(path + '/input/origin', 'expected synthetic, observed or hypothetical')
        refs(inp['evidence'], path + '/input/evidence', inp['origin'] != 'hypothetical')
        items(inp['groups'], path + '/input/groups', 1)
        for j, group in enumerate(inp['groups']):
            gp = path + f'/input/groups/{j}'
            obj(group, gp, ['label', 'fields']); text(group['label'], gp + '/label')
            items(group['fields'], gp + '/fields', 1)
            for field in group['fields']:
                obj(field, gp + '/fields', ['label', 'value', 'unit'])
                text(field['label'], gp + '/fields/label')
                if not isinstance(field['unit'], str) or not (field['value'] is None or type(field['value']) in (str, int, float, bool)):
                    fail(gp, 'field needs a scalar value and a text unit')
                if type(field['value']) is float and not math.isfinite(field['value']):
                    fail(gp, 'field value must be finite JSON')
        items(case['states'], path + '/states')
        seen_nodes = set()
        for j, state in enumerate(case['states']):
            sp = path + f'/states/{j}'
            obj(state, sp, ['node', 'summary', 'basis', 'evidence'])
            node_id(state['node'], sp + '/node'); text(state['summary'], sp + '/summary')
            if state['node'] in seen_nodes:
                fail(sp, 'duplicate node state')
            seen_nodes.add(state['node'])
            if state['basis'] not in ('source', 'inference', 'unknown'):
                fail(sp + '/basis', 'observed results must reference verification_case, not a handwritten value')
            refs(state['evidence'], sp + '/evidence', state['basis'] != 'unknown')
        outputs, record = {}, None
        if 'verification_case' in case:
            ref = case['verification_case']
            obj(ref, path + '/verification_case', ['run', 'name'])
            matches = [(v, c) for v in report.get('verifications', [])
                       if v['finding'] == finding['id'] and v['run'] == ref['run']
                       for c in v.get('cases', []) if c['name'] == ref['name']]
            if len(matches) != 1:
                fail(path + '/verification_case', 'verification case missing or ambiguous')
            v, c = matches[0]
            if c['kind'] != case['kind'] or v['run'] != finding['run']:
                fail(path + '/verification_case', 'case kind or source run differs')
            if v['outcome'] not in ('reproduced', 'not_reproduced'):
                fail(path + '/verification_case', 'record is not a completed behavioral check')
            for lane in scene['lanes']:
                key = lane['measure']['actual_key']
                if not isinstance(c['actual'], dict) or key not in c['actual']:
                    fail(path + '/verification_case', 'actual output field missing: ' + key)
                try:
                    json.dumps(c['actual'][key], allow_nan=False)
                except (ValueError, TypeError):
                    fail(path + '/verification_case', 'actual output is not finite JSON: ' + key)
                outputs[lane['output_node']] = c['actual'][key]
            record = {'run': v['run'], 'name': c['name'], 'outcome': v['outcome'],
                      'fresh': freshness.get('verification', {}).get(finding['id'], False)
                               and sum(vv['finding'] == finding['id'] for vv in report.get('verifications', [])) == 1,
                      'limitations': v['limitations']}
        compiled.append({**case, 'outputs': outputs, 'record': record})
    if scene['default_scenario'] not in scenario_ids:
        fail('/default_scenario', 'scenario not found')
    # Preserve underlying findings, protections, gaps and task identity; scene is presentation only.
    source_ids = {ref for node in nodes.values() for ref in node['evidence']}
    source_ids.update(ref for edge in finding['graph'].get('edges', []) for ref in edge['evidence'])
    source_ids.update(ref for case in scene['scenarios'] for ref in case['input']['evidence'])
    source_ids.update(ref for case in scene['scenarios'] for state in case['states'] for ref in state['evidence'])
    return {'scene': {**scene, 'lanes': lanes, 'scenarios': compiled}, 'finding': finding,
            'evidence': {ref: evidence[ref] for ref in sorted(source_ids)},
            'freshness': freshness, 'project': report['project'],
            'sources': next(r['sources'] for r in report['runs'] if r['id'] == finding['run'])}
