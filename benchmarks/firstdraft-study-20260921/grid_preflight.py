"""Falsify default-grid-first; never infer model latency from local commands."""

import argparse
import copy
import json
import pathlib
import subprocess
import time

GEOMETRY = {'pos', 'size', 'row', 'col'}
ROUTES = {
    'via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY',
    'labelAt', 'labelDx', 'labelDy', 'labelSegment',
}


def semantics(value):
    """Ignore only the geometry deliberately changed by the experiment."""
    result = copy.deepcopy(value)
    result.pop('layout', None)
    result['meta'].pop('viewBox', None)
    for node in result['components']:
        for key in GEOMETRY:
            node.pop(key, None)
    for edge in result.get('connections', []):
        for key in ROUTES:
            edge.pop(key, None)
    return result


def grid(value):
    """Reuse fixture coordinate ordering, not inferred semantic layout."""
    result = copy.deepcopy(value)
    xs = sorted({node['pos'][0] for node in result['components']})
    ys = sorted({node['pos'][1] for node in result['components']})
    result['layout'] = {'mode': 'grid', 'cols': len(xs)}
    result['meta'].pop('viewBox', None)
    for node in result['components']:
        px, py = node.pop('pos')
        node.pop('size', None)
        node['row'], node['col'] = ys.index(py), xs.index(px)
    for edge in result.get('connections', []):
        for key in ROUTES:
            edge.pop(key, None)
    if semantics(value) != semantics(result):
        raise ValueError('Transformation changed non-geometry fields')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    records = []
    for fixture in ['starter', 'web-app', 'production-deployment']:
        original = json.loads(
            (args.skill / 'examples' / f'{fixture}.architecture.json').read_text()
        )
        for variant, data in [('baseline', original), ('default-grid', grid(original))]:
            stem = args.out / f'{fixture}-{variant}'
            path = stem.with_suffix('.json')
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
            cmd = [
                args.node, str(args.skill / 'bin/archify.mjs'), 'validate',
                'architecture', str(path), '--quality', 'showcase', '--json',
            ]
            start = time.monotonic()
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            elapsed = 1000 * (time.monotonic() - start)
            stem.with_suffix('.stdout.json').write_text(result.stdout)
            stem.with_suffix('.stderr.txt').write_text(result.stderr)
            # Invalid or missing JSON is a harness failure, never a passing check.
            receipt = json.loads(result.stdout)
            if not isinstance(receipt.get('ok'), bool):
                raise ValueError('Missing boolean ok receipt')
            record = {
                'fixture': fixture, 'variant': variant,
                'exit_code': result.returncode, 'ok': receipt['ok'],
                'local_command_ms': elapsed,
                'same_semantics': semantics(original) == semantics(data),
                'nodes': len(data['components']),
                'edges': len(data.get('connections', [])),
                'diagnostics': receipt.get('diagnostics', []),
                'schema_errors': receipt.get('errors', []),
            }
            records.append(record)
            print(json.dumps(record, ensure_ascii=False), flush=True)
    (args.out / 'results.json').write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + '\n'
    )


if __name__ == '__main__':
    main()
