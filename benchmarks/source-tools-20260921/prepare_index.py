"""Generate an offline structural index and retain its actual preprocessing cost."""

import argparse
import hashlib
import json
import pathlib
import subprocess
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary', required=True, type=pathlib.Path)
    p.add_argument('--source', required=True, type=pathlib.Path)
    p.add_argument('--language', required=True)
    p.add_argument('--out', required=True, type=pathlib.Path)
    a = p.parse_args()
    if a.out.exists():
        raise ValueError('Retain previous index receipts; choose a new output directory')
    a.out.mkdir(parents=True)
    start = time.monotonic()
    result = subprocess.run(
        [str(a.binary.resolve()), 'outline', '.', '--items', 'all', '--view',
         'digest', '--lang', a.language, '--color', 'never'],
        cwd=a.source, capture_output=True, text=True, timeout=30,
    )
    duration = time.monotonic() - start
    (a.out / 'index.txt').write_text(result.stdout)
    (a.out / 'stderr.txt').write_text(result.stderr)
    receipt = {
        'duration_seconds': duration, 'exit_code': result.returncode,
        'bytes': len(result.stdout.encode()), 'lines': len(result.stdout.splitlines()),
        'source_revision': subprocess.check_output(['git', '-C', str(a.source), 'rev-parse', 'HEAD'], text=True).strip(),
        'binary_sha256': hashlib.sha256(a.binary.read_bytes()).hexdigest(),
        'index_sha256': hashlib.sha256(result.stdout.encode()).hexdigest(),
        'scope': 'all files recognized as requested language; static navigation only',
        'cache': 'fresh CLI process, no persistent index; OS caches uncontrolled',
    }
    (a.out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
