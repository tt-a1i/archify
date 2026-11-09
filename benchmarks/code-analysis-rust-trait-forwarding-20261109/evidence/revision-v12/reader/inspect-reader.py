#!/usr/bin/env python3
"""Reproduce this reader's focused JSON inspection and sample-source checks.
Reads only this reader's two raw queries and explicitly named sample source roots.
Does not read Archify implementation, other evidence, or benchmark definitions.
"""
import hashlib
import json
from pathlib import Path

OUT = Path('/private/tmp/archify-bytes-20261109/benchmarks/code-analysis-rust-trait-forwarding-20261109/evidence/revision-v12/reader')
SAMPLES = Path('/private/tmp/archify-batch-20261108/samples')

for label, method in [('bytes', 'try_get_int'), ('futures', 'poll_vectored_read')]:
    path = OUT / (label + '-task.json')
    data = json.loads(path.read_text())
    print('\nRAW QUERY:', path)
    print('sha256:', hashlib.sha256(path.read_bytes()).hexdigest())
    print('status:', data['status'], 'stage:', data['stage'])
    print('comparison:', json.dumps(data['comparison'], indent=2))
    for side, capture in data['sides'].items():
        scope = capture['languageScope']
        print(side, json.dumps({
            'snapshotId': capture['snapshot']['snapshotId'],
            'callModel': capture['callModel'],
            'capturedFiles': capture['capturedFiles'],
            'sourceIdentity': capture['sourceIdentity'],
            'unavailableFiles': capture['unavailableFiles'],
            'parseErrors': capture['parseErrors'],
            'tests': scope['build']['tests'],
            'splitSelected': 'futures-util/src/io/split.rs' in scope['selectedFiles'],
        }, indent=2))
    changed = data['changedDefinitions']
    print('changedDefinitions:', {k: v for k, v in changed.items() if k != 'items'})
    for pair in changed['items']:
        if any(pair.get(side, {}).get('definition', {}).get('name') == method for side in ['base', 'head']):
            print(json.dumps(pair, indent=2))

ranges = [
    ('bytes-try-get-int', 'src/buf/buf_impl.rs', [(118, 125), (2083, 2088), (2153, 2162), (2459, 2465), (2833, 2837), (2883, 2892)]),
    ('futures-io-waker-vectored-read', 'futures-io/src/lib.rs', [(75, 83), (130, 146), (244, 270), (378, 383)]),
    ('futures-io-waker-vectored-read', 'futures-util/src/io/split.rs', [(1, 51)]),
]
for sample, relative, spans in ranges:
    for side in ['base', 'head']:
        path = SAMPLES / (sample + '-' + side) / relative
        content = path.read_bytes()
        print('\nSOURCE:', path, 'sha256:', hashlib.sha256(content).hexdigest())
        lines = content.decode().splitlines()
        for start, end in spans:
            print('LINES', start, '-', end)
            for line in range(start, min(end, len(lines)) + 1):
                print(f'{line}: {lines[line - 1]}')
