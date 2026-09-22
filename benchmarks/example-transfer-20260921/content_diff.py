"""Compare preserved initial/final content, removing only declared geometry fields."""
import argparse
import hashlib
import json
import pathlib


def project(value):
    value = json.loads(json.dumps(value))
    for key in ('layout', 'viewBox'):
        value.pop(key, None)
    if isinstance(value.get('meta'), dict):
        value['meta'].pop('viewBox', None)
    for component in value.get('components', []):
        for key in ('pos', 'size', 'row', 'col'):
            component.pop(key, None)
    for edge in value.get('connections', []):
        for key in ('fromSide', 'toSide', 'fromOffset', 'toOffset', 'labelOffset', 'labelPos', 'labelAt', 'labelDx', 'labelDy', 'labelSegment', 'channelX', 'channelY', 'waypoints', 'route', 'via'):
            edge.pop(key, None)
    for boundary in value.get('boundaries', []):
        boundary.pop('padding', None)
        boundary.pop('pad', None)
    return value


def differences(a, b, path=''):
    if isinstance(a, dict) and isinstance(b, dict):
        result = []
        for key in sorted(a.keys() | b.keys()):
            p = path + '/' + key
            if key not in a or key not in b:
                result.append({'path': p, 'before': a.get(key), 'after': b.get(key)})
            else:
                result += differences(a[key], b[key], p)
        return result
    if a != b:
        return [{'path': path, 'before': a, 'after': b}]
    return []


def summarize(out):
    read = lambda p: json.loads(p.read_text())
    rows = []
    for name in read(out / 'freeze.json')['initial_order']:
        directory = out / name
        first = next(s for s in read(directory / 'receipt.json')['snapshots'] if s['structurally_complete'])
        original = directory / f"snapshot-{first['index']:03}.json"
        final = directory / 'artifacts/diagram.architecture.json'
        a, b = read(original), read(final)
        rows.append({'run': name, 'first_sha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                     'final_sha256': hashlib.sha256(final.read_bytes()).hexdigest(),
                     'non_geometry_changes': differences(project(a), project(b)),
                     'removed_connection_ids': sorted({e['id'] for e in a['connections']} - {e['id'] for e in b['connections']})})
    return {'limits': 'Geometry projection is not semantic adjudication. Changes in wording/topology require source review; unchanged content may still be incorrect.', 'rows': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    result = summarize(args.out)
    (args.out / 'first-final-content-diff.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps([{'run': r['run'], 'changes': len(r['non_geometry_changes']), 'removed_connections': r['removed_connection_ids']} for r in result['rows']]))
