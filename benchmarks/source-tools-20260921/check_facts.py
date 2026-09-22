"""Structural/source-range gate only. Source entailment requires separate review."""

import argparse
import json
from pathlib import Path
import subprocess


def check(value, source):
    source = source.resolve()
    errors = []
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if value.get('repository', {}).get('revision') != revision:
        errors.append('repository revision mismatch')
    nodes = value.get('components', [])
    edges = value.get('relationships', [])
    ids = [x.get('id') for x in nodes]
    if not nodes or len(ids) != len(set(ids)) or any(not x for x in ids):
        errors.append('missing/duplicate component identifiers')
    if not edges:
        errors.append('missing relationships')
    for i, edge in enumerate(edges):
        if edge.get('from') not in ids or edge.get('to') not in ids:
            errors.append(f'relationship {i} references an unknown component')
    references = 0
    for group, items in [('component', nodes), ('relationship', edges)]:
        for i, item in enumerate(items):
            if not item.get('sources'):
                errors.append(f'{group} {i} has no source references')
            for ref in item.get('sources', []):
                path = source / ref.get('path', '')
                if Path(ref.get('path', '')).is_absolute() or not path.resolve().is_relative_to(source):
                    errors.append(f'{group} {i} has non-relative or escaping source path')
                    continue
                if not path.is_file():
                    errors.append(f'{group} {i} has missing source file')
                    continue
                lines = len(path.read_text().splitlines())
                start, end = ref.get('line'), ref.get('end_line', ref.get('line'))
                if type(start) is not int or type(end) is not int or not 1 <= start <= end <= lines:
                    errors.append(f'{group} {i} has invalid source range')
                references += 1
    return {'structural_source_range_pass': not errors, 'errors': errors,
            'components': len(nodes), 'relationships': len(edges), 'references': references,
            'semantic_entailment': 'not evaluated by this checker'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--facts', required=True, type=Path)
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    a = p.parse_args()
    result = check(json.loads(a.facts.read_text()), a.source)
    a.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['structural_source_range_pass'] else 1)


if __name__ == '__main__':
    main()
