#!/usr/bin/env python3
"""Re-run the preserved analyst projection with explicit fresh output path."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
if args.output.exists():
    parser.error('output must be a fresh path')
script = Path(__file__).with_name('analyze.py').read_text()
for old, new in [('ARCHIVED_SOURCE/sqlite.coz', args.input.resolve()),
                 ('ARCHIVED_SOURCE/analysis.json', args.output.resolve())]:
    needle = repr(old)
    if script.count(needle) != 1:
        parser.error('preserved script path contract changed')
    script = script.replace(needle, repr(str(new)))
exec(compile(script, 'preserved-analyze.py', 'exec'), {'__name__': '__main__'})
