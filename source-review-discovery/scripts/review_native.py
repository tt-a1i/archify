"""Adapt validated review scenes to the pinned Archify renderer.

Archify owns routing, camera, focus, search and motion. Review owns evidence,
scenario values, freshness, and task identity. Rendering never executes sources.
"""
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile


def graph_columns(nodes, edges, input_node):
    """Layer the condensation graph; keep every original node and relationship."""
    index, low, stack, active, components = {}, {}, [], set(), []
    outgoing = {n['id']: [] for n in nodes}
    for edge in edges:
        outgoing[edge['from']].append(edge['to'])
    def visit(node):
        index[node] = low[node] = len(index)
        stack.append(node); active.add(node)
        for target in outgoing[node]:
            if target not in index:
                visit(target); low[node] = min(low[node], low[target])
            elif target in active:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            members = []
            while True:
                target = stack.pop(); active.remove(target); members.append(target)
                if target == node: break
            components.append(members)
    for node in outgoing:
        if node not in index: visit(node)
    component = {n: i for i, members in enumerate(components) for n in members}
    dag = {i: set() for i in range(len(components))}
    for edge in edges:
        a, b = component[edge['from']], component[edge['to']]
        if a != b: dag[a].add(b)
    indegree = {i: sum(i in children for children in dag.values()) for i in dag}
    queue = [i for i in dag if not indegree[i]]; rank = {i: 0 for i in dag}
    for item in queue:
        for target in dag[item]:
            rank[target] = max(rank[target], rank[item] + 1)
            indegree[target] -= 1
            if not indegree[target]: queue.append(target)
    return {n: 0 if n == input_node else max(1, rank[component[n]]) for n in outgoing}


def diagram(payload):
    scene, finding = payload['scene'], payload['finding']
    source_nodes = finding['graph']['nodes']
    by_id = {n['id']: n for n in source_nodes}
    ids = {n['id']: f'n{i}' for i, n in enumerate(source_nodes)}
    payload['native_ids'] = ids
    columns = graph_columns(source_nodes, finding['graph']['edges'], scene['input_node'])
    positions, boundaries = {}, []
    width, height, pitch = 286, 210, 430
    top = 78
    for lane in scene['lanes']:
        buckets = {}
        for node_id in lane['nodes']:
            col = columns[node_id]
            buckets.setdefault(col, []).append(node_id)
        span = max(len(v) for v in buckets.values()) * 270 - 60
        for col, members in buckets.items():
            for row, node_id in enumerate(members):
                positions[node_id] = [36 + col * pitch, top + row * 270]
        boundaries.append({'kind': 'region', 'label': lane['title'],
                           'wraps': [ids[n] for n in lane['nodes']], 'pad': 30})
        top += span + 100
    positions[scene['input_node']] = [36, 78 + (top - 178 - height) / 2]
    roles = {'step': '处理环节', 'failure': '偏差位置', 'guard': '已有保护', 'unknown': '待核定'}
    components = []
    for node in source_nodes:
        node_id = node['id']
        lane = next((l for l in scene['lanes'] if node_id in l['nodes']), None)
        label = node['title']
        if lane and label.startswith(lane['title'] + '：'):
            label = label[len(lane['title']) + 1:]
        output = lane and lane['output_node'] == node_id
        is_input = node_id == scene['input_node']
        color = 'frontend' if is_input else {'guard': 'backend', 'failure': 'security', 'unknown': 'external'}.get(node['role'], 'cloud')
        if output:
            label = lane['title'] + '输出'
            color = 'backend' if any(by_id[n]['role'] == 'guard' for n in lane['nodes']) else 'security' if any(by_id[n]['role'] == 'failure' for n in lane['nodes']) else 'cloud'
        components.append({'id': ids[node_id], 'type': color, 'label': label,
            'sublabel': '共享输入' if is_input else lane['measure']['label'] if output else roles[node['role']],
            'tag': '场景数据' if is_input or output else '点击查看源码',
            'icon': 'none', 'pos': positions[node_id], 'size': [width, height]})
    connections = []
    for i, edge in enumerate(finding['graph']['edges']):
        a, b = positions[edge['from']], positions[edge['to']]
        failure_path = by_id[edge['from']]['role'] == 'failure'
        connection = {'id': f'e{i}', 'from': ids[edge['from']], 'to': ids[edge['to']],
                      'label': edge['label'], 'variant': 'dashed' if edge['basis'] != 'source' else 'security' if failure_path else 'emphasis'}
        if b[0] > a[0]:
            channel = (a[0] + width + b[0]) / 2
            connection.update(fromSide='right', toSide='left',
                via=[[channel, a[1] + height / 2], [channel, b[1] + height / 2]],
                labelAt=[channel, (a[1] + b[1] + height) / 2 - 14])
        elif b[0] == a[0]:
            # Distinct outside channels keep return/parallel edges inspectable.
            earlier = sum(positions[e['from']][0] == a[0] and positions[e['to']][0] == a[0]
                          for e in finding['graph']['edges'][:i])
            channel = a[0] + width + 42 + earlier * 48
            connection.update(fromSide='right', toSide='right',
                via=[[channel, a[1] + height / 2], [channel, b[1] + height / 2]],
                labelAt=[channel, (a[1] + b[1] + height) / 2 + earlier * 20])
        connections.append(connection)
    return {'schema_version': 1, 'diagram_type': 'architecture',
        'meta': {'title': finding['title'], 'subtitle': finding.get('presentation', {}).get('summary', finding['impact']),
            'output': 'native.html', 'locale': 'zh-CN', 'visual_preset': 'signal-flow',
            'animation': 'trace', 'legend': {'mode': 'hidden'}},
        'components': components, 'boundaries': boundaries,
        'connections': connections, 'cards': []}


def render_document(native, assets):
    """One upstream renderer shared by the overview and the evidence scene."""
    node = shutil.which('node')
    if not node:
        raise ValueError('Archify scene rendering requires Node.js; the ordinary report renderer remains available without --scene.')
    with tempfile.TemporaryDirectory(prefix='source-review-native-') as temp:
        path = Path(temp)
        (path / 'scene.json').write_text(json.dumps(native, ensure_ascii=False))
        command = [node, str(assets / 'vendor/archify/renderers/architecture/render-architecture.mjs'),
                   str(path / 'scene.json'), str(path / 'native.html')]
        result = subprocess.run(command, text=True, capture_output=True, timeout=40, cwd=temp)
        if result.returncode:
            raise ValueError('Archify could not lay out this scene. No relationships were removed.\n' + result.stderr)
        output = (path / 'native.html').read_text()
    return output


def render(payload, assets):
    native = diagram(payload)
    output = render_document(native, assets)
    # Color categories must not turn into false frontend/security assertions.
    for original in payload['finding']['graph']['nodes']:
        is_output = any(l['output_node'] == original['id'] for l in payload['scene']['lanes'])
        role = '共享输入' if original['id'] == payload['scene']['input_node'] else '路径输出' if is_output else {
            'guard': '已有保护', 'failure': '偏差位置', 'step': '处理环节', 'unknown': '待核定'}[original['role']]
        key = payload['native_ids'][original['id']]
        output = re.sub(r'(<g [^>]*data-node-id="' + key + r'"[^>]*data-node-kind=")[^"]+',
                        lambda m: m.group(1) + role, output)
    # One native document: no iframe, duplicate camera, scene reload or runtime fork.
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    output = output.replace('</head>', '<style>' + (assets / 'scene.css').read_text() + '</style>\n</head>')
    insert = '<script id="scene-payload" type="application/json">' + data + '</script>\n<script>' + (assets / 'scene.js').read_text() + '</script>\n'
    output = output.replace('</body>', insert + '</body>')
    return output
