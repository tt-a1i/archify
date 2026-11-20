#!/usr/bin/env python3
"""Reproduce the three final task-view commands using local, trusted inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

BINARY_SHA256 = '4b4d5b7076db29c31ca70c6693ec88d7ed57b30f39a7e2e1c4b090413b6d9f1a'
REVISION = 'ed62bfefaf490e831259261fdc12f985267590fb'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path, help='existing task-view Darwin ARM64 binary')
    parser.add_argument('repository', type=Path, help='trusted local Archify repository containing the revision')
    parser.add_argument('output', type=Path, help='new output directory, which must not exist')
    args = parser.parse_args()
    binary, repository, output = (p.resolve() for p in (args.binary, args.repository, args.output))
    if hashlib.sha256(binary.read_bytes()).hexdigest() != BINARY_SHA256:
        parser.error('binary SHA-256 does not match the archived release')
    output.mkdir(parents=False, exist_ok=False)
    records = []

    def run(name, argv):
        result = subprocess.run([str(x) for x in argv], cwd=output, capture_output=True)
        (output / (name + '.stdout')).write_bytes(result.stdout)
        (output / (name + '.stderr')).write_bytes(result.stderr)
        records.append({'name': name, 'argv': [str(x) for x in argv], 'exitCode': result.returncode})
        (output / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
        return result

    def require_clean(name):
        result = run(name, ['git', '-C', 'repos/archify', 'status', '--porcelain'])
        if result.returncode or result.stdout:
            raise RuntimeError(name + ': clone is not clean; see saved output')

    (output / 'repos').mkdir()
    if run('clone', ['git', 'clone', '--shared', '--no-checkout', repository, 'repos/archify']).returncode:
        raise RuntimeError('clone failed; see saved output')
    if run('checkout', ['git', '-C', 'repos/archify', 'checkout', '--detach', REVISION]).returncode:
        raise RuntimeError('checkout failed; see saved output')
    require_clean('status-before')
    try:
        inputs = Path(__file__).resolve().parent / 'inputs'
        for name in ('shared-review', 'shared-review-invalid-range'):
            template = (inputs / (name + '.json')).read_text()
            if template.count('<REPOSITORY_ROOT>') != 1:
                raise RuntimeError('expected one repository placeholder in ' + name)
            (output / (name + '.json')).write_text(template.replace('<REPOSITORY_ROOT>', 'repos/archify'))
        run('shared-review-validate', [binary, 'validate', 'shared-review.json', '--format', 'json'])
        run('shared-review-invalid-range-validate', [binary, 'validate', 'shared-review-invalid-range.json', '--format', 'json'])
        run('shared-review-open', [binary, 'open', 'shared-review.json', '--out', 'native.html', '--no-browser'])
    finally:
        require_clean('status-after')
    print('Saved commands, exit codes, stdout, stderr, and any generated HTML to', output)


if __name__ == '__main__':
    main()
