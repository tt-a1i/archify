"""Observe output artifacts without collecting model reasoning or tool payloads."""

import argparse
import hashlib
import json
import pathlib
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=pathlib.Path)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    parser.add_argument('--artifact', default='facts.json')
    parser.add_argument('--cap', type=float, default=630)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    start_epoch = time.time()
    previous = started
    max_gap = 0
    records = []
    sidecars = []
    sidecar_hashes = {}
    last_hash = None
    source = args.workspace / 'output' / args.artifact
    (args.out / 'ready.json').write_text(json.dumps({'epoch': start_epoch}))
    while True:
        now = time.monotonic()
        max_gap = max(max_gap, now - previous)
        previous = now
        if source.exists():
            raw = source.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != last_hash:
                last_hash = digest
                parsed = False
                complete = False
                try:
                    value = json.loads(raw)
                    parsed = True
                    if args.artifact == 'facts.json':
                        complete = bool(value.get('components')) and bool(value.get('relationships')) and isinstance(value.get('repository'), dict)
                    else:
                        complete = bool(value.get('components')) and isinstance(value.get('connections'), list) and isinstance(value.get('meta'), dict)
                except (ValueError, AttributeError):
                    pass
                index = len(records) + 1
                (args.out / f'snapshot-{index:03}.json').write_bytes(raw)
                records.append({'index': index, 'elapsed_seconds': now - started,
                                'sha256': digest, 'bytes': len(raw),
                                'parseable': parsed, 'structurally_complete': complete})
        for filename in ['initial-plan.json', 'preparation.json', 'diagram.finalize-summary.json']:
            candidate = args.workspace / 'output' / filename
            if not candidate.exists():
                continue
            raw = candidate.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if sidecar_hashes.get(filename) == digest:
                continue
            sidecar_hashes[filename] = digest
            index = len(sidecars) + 1
            saved = f'sidecar-{index:03}-{filename}'
            (args.out / saved).write_bytes(raw)
            sidecars.append({'filename': filename, 'snapshot': saved, 'sha256': digest,
                             'epoch': time.time(), 'elapsed_seconds': now - started})
        done = args.out / 'done.json'
        expired = now - started >= args.cap
        if done.exists() or expired:
            result = {'start_epoch': start_epoch, 'observed_seconds': now - started,
                      'max_poll_gap_seconds': max_gap, 'expired': expired,
                      'snapshots': records, 'sidecars': sidecars,
                      'first_complete_seconds': next((r['elapsed_seconds'] for r in records if r['structurally_complete']), None),
                      'completion': json.loads(done.read_text()) if done.exists() else None,
                      'limits': 'Observed from before dispatch; scheduling included. Structural completeness is not factual acceptance. Hidden model/HTTP timing unavailable.'}
            (args.out / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result), flush=True)
            return
        time.sleep(0.1)


if __name__ == '__main__':
    main()
