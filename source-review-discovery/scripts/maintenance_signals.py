"""Bounded, read-only adapters for clone candidates and function metrics."""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import subprocess
import sys
import time

EXTENSIONS = dict(zip(
    ('.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.rb', '.php', '.java',
     '.kt', '.scala', '.cs', '.c', '.cpp', '.cc', '.swift', '.dart'),
    ('javascript', 'jsx', 'typescript', 'tsx', 'python', 'go', 'rust', 'ruby', 'php',
     'java', 'kotlin', 'scala', 'csharp', 'c', 'cpp', 'cpp', 'swift', 'dart')))
EXCLUDES = ['.git/**', '**/node_modules/**', '**/.venv/**', '**/venv/**',
            '**/vendor/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/__pycache__/**']
# Conservative restrictions on this tested release; native values remain in raw output.
ISSUES = {
    'ruby': {'location': 'A validated Ruby sample ends early inside the function.',
             'cyclomatic_complexity': 'Branch count failed the branch-removal control.',
             'nloc': 'Depends on the unreliable function boundary.',
             'tokens': 'Depends on the unreliable function boundary.'},
    'php': {'parameters': 'Two explicit parameters were counted as one in validated samples.'},
    'scala': {'location': 'Function end lines exceeded the actual definition in validated samples.'},
}


def save(path, value):
    with Path(path).open('x', encoding='utf8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def collect(args, root):
    scopes = args.scope or ['.']
    for scope in scopes:
        path = root / scope
        if not path.exists() or not path.resolve().is_relative_to(root):
            raise ValueError('Scope must exist inside --root: ' + scope)
        if any(p.is_symlink() for p in [path, *path.parents] if p != root and p.is_relative_to(root)):
            raise ValueError('Symbolic-link scopes are not supported: ' + scope)
    excludes = EXCLUDES + args.exclude
    command = ['rg', '--files', '--hidden', '--null']
    for pattern in excludes:
        command += ['--glob', '!' + pattern]
    command += ['--', *scopes]
    cp = subprocess.run(command, cwd=root, capture_output=True, timeout=args.timeout)
    if cp.returncode not in (0, 1):
        raise ValueError(cp.stderr.decode(errors='replace'))
    files, skipped = [], []
    for name in sorted(set(cp.stdout.decode('utf8').split('\0')) - {''}):
        path = root / name
        relative = path.relative_to(root).as_posix()
        language = EXTENSIONS.get(path.suffix.lower())
        reason = None
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            reason = 'symlink_or_outside_root'
        elif not language:
            reason = 'unregistered_extension'
        elif args.language and language not in args.language:
            reason = 'language_filter'
        elif path.stat().st_size > args.max_bytes:
            reason = 'over_max_bytes'
        if reason:
            skipped.append({'path': relative, 'reason': reason})
            continue
        data = path.read_bytes()
        try:
            data.decode('utf8')
        except UnicodeDecodeError:
            skipped.append({'path': relative, 'reason': 'not_utf8'})
            continue
        files.append({'path': relative, 'language': language, 'sha256': sha(data), 'bytes': len(data)})
        if len(files) > args.max_files:
            raise ValueError('Selected files exceed --max-files; narrow --scope or explicitly raise the limit.')
    return {'root': str(root), 'revision_label': args.revision,
            'identity': 'Current file SHA256s identify analyzed contents; a supplied label does not assert a clean checkout.',
            'selection': {'scopes': scopes, 'languages': args.language or sorted(set(EXTENSIONS.values())),
                          'exclude': excludes, 'respects_rg_ignore_files': True,
                          'max_bytes': args.max_bytes, 'max_files': args.max_files},
            'files': files, 'skipped': skipped}


def lizard_worker(manifest_path):
    import lizard
    manifest = json.loads(Path(manifest_path).read_text())
    rows = []
    for entry in manifest['files']:
        path = Path(manifest['root']) / entry['path']
        try:
            data = path.read_bytes()
            if sha(data) != entry['sha256']:
                raise ValueError('Source changed before analysis')
            analysis = lizard.analyze_file.analyze_source_code(str(path), data.decode('utf8'))
            rows.append({'path': entry['path'], 'functions': [
                {'name': f.name, 'start_line': f.start_line, 'end_line': f.end_line,
                 'cyclomatic_complexity': f.cyclomatic_complexity, 'parameters': f.parameter_count,
                 'nloc': f.nloc, 'tokens': f.token_count} for f in analysis.function_list]})
        except Exception as error:
            rows.append({'path': entry['path'], 'error': str(error)})
    print(json.dumps(rows, ensure_ascii=False))


def normalize_metrics(raw, manifest, issues):
    entries = {f['path']: f for f in manifest['files']}
    records, errors = [], []
    for file_index, row in enumerate(raw):
        entry = entries[row['path']]
        if 'error' in row:
            errors.append(row)
            continue
        limitations = issues.get(entry['language'], {})
        for function_index, f in enumerate(row['functions']):
            records.append({'path': entry['path'], 'sha256': entry['sha256'],
                'language': entry['language'], 'name': f['name'],
                'location': None if 'location' in limitations else
                    {'start_line': f['start_line'], 'end_line': f['end_line']},
                'metrics': {key: None if key in limitations else f[key]
                            for key in ('cyclomatic_complexity', 'parameters', 'nloc', 'tokens')},
                'unverified_fields': limitations,
                'raw_pointer': f'/{file_index}/functions/{function_index}'})
    records.sort(key=lambda r: (-(r['metrics']['cyclomatic_complexity'] or 0), r['path'], r['name']))
    return records, errors


def normalize_clones(raw, manifest):
    root = Path(manifest['root'])
    entries = {str(root / f['path']): f for f in manifest['files']}
    records, errors = [], []
    for index, clone in enumerate(raw['duplicates']):
        try:
            locations = []
            for side in ('firstFile', 'secondFile'):
                loc = clone[side]
                entry = entries[loc['name']]
                data = Path(loc['name']).read_bytes()
                start, end = loc['startLoc']['position'], loc['endLoc']['position']
                if not (0 <= start < end <= len(data) and
                        1 <= loc['start'] <= loc['end'] <= len(data.splitlines()) and
                        data[:start].count(b'\n') + 1 == loc['start'] and
                        data[:end].count(b'\n') + 1 == loc['end']):
                    raise ValueError('Invalid source coordinates')
                locations.append({'path': entry['path'], 'sha256': entry['sha256'],
                    'start_line': loc['start'], 'end_line': loc['end'],
                    'start_byte': start, 'end_byte': end})
            records.append({'locations': locations, 'language': clone['format'],
                'matching_kind': clone.get('kind', 'unspecified'),
                'lines': clone['lines'], 'tokens': clone['tokens'], 'raw_pointer': f'/duplicates/{index}'})
        except (KeyError, ValueError, OSError) as error:
            errors.append({'raw_pointer': f'/duplicates/{index}', 'error': str(error)})
    return records, errors


def register(subparsers):
    for operation, help_text in [('duplicates', 'Multilingual clone candidates via jscpd'),
                                 ('metrics', 'Multilingual function metrics via Lizard')]:
        p = subparsers.add_parser(operation, help=help_text)
        p.add_argument('--root', required=True)
        p.add_argument('--scope', action='append', default=[], help='Path within root; repeat to compare selected scopes')
        p.add_argument('--language', action='append', choices=sorted(set(EXTENSIONS.values())), default=[])
        p.add_argument('--exclude', action='append', default=[], help='Additional rg file glob to exclude')
        p.add_argument('--revision', help='Optional commit/snapshot label; actual file hashes always recorded')
        p.add_argument('--out', required=True, help='New artifact directory outside the reviewed root')
        p.add_argument('--max-files', type=int, default=1000)
        p.add_argument('--max-bytes', type=int, default=1048576)
        p.add_argument('--limit', type=int, default=100, help='Limit normalized records; raw output remains complete')
        p.add_argument('--timeout', type=int, default=120)
        if operation == 'duplicates':
            p.add_argument('--matching', choices=['exact', 'renamed'], default='exact')
            p.add_argument('--min-tokens', type=int, default=50)
            p.add_argument('--min-lines', type=int, default=5)


def run(args, runtime, config):
    root, out = Path(args.root).resolve(strict=True), Path(args.out).resolve()
    if not root.is_dir() or out.is_relative_to(root):
        raise ValueError('--root must be a directory; --out must be outside it.')
    if any(getattr(args, k, 1) < 1 for k in
           ('max_files', 'max_bytes', 'limit', 'timeout', 'min_tokens', 'min_lines')):
        raise ValueError('Limits and thresholds must be positive.')
    out.mkdir(parents=True, exist_ok=False)
    provider = 'jscpd' if args.tool == 'duplicates' else 'lizard'
    result = {'provider': provider, 'status': 'error', 'data': [],
              'artifact_directory': str(out), 'record_kind': 'investigation_signal',
              'limitations': ['These are investigation signals, not confirmed defects or business equivalence.',
                              'Language coverage is syntax-dependent; no call graph, type resolution or dataflow.',
                              'Empty results only describe the selected files and configured thresholds.']}
    try:
        result['version'] = version(provider)
        expected = config['maintenance_versions'][provider]
        if result['version'] != expected:
            raise ValueError(f'Expected validated {provider} {expected}; installed {result["version"]}')
        manifest = collect(args, root)
        save(out / 'manifest.json', manifest)
        result['manifest'] = str(out / 'manifest.json')
        result['coverage'] = {'selected_files': len(manifest['files']),
                              'languages': sorted({f['language'] for f in manifest['files']}),
                              'skipped_files': len(manifest['skipped'])}
        if not manifest['files']:
            result.update(status='empty_scope', error='No eligible source files; inspect manifest selection/skips.')
            return result
        if provider == 'jscpd':
            # Explicit config + isolated cwd prevents target-project options enabling extra analyses/output.
            save(out / 'jscpd-config.json', {})
            command = [str(runtime / 'venv/bin/jscpd'),
                *[str(root / f['path']) for f in manifest['files']],
                '--config', str(out / 'jscpd-config.json'), '--output', str(out), '--reporters', 'json',
                '--min-tokens', str(args.min_tokens), '--min-lines', str(args.min_lines), '--mode', 'weak',
                '--max-size', str(args.max_bytes), '--workers', '2',
                '--no-gitignore', '--absolute', '--no-colors', '--no-tips', '--fail-on-empty']
            if args.matching == 'renamed':
                command += ['--ignore-identifiers=consistent']
            result['configuration'] = {'matching': args.matching, 'mode': 'weak',
                'min_tokens': args.min_tokens, 'min_lines': args.min_lines,
                'ignore_identifiers': 'consistent' if args.matching == 'renamed' else False}
            result['limitations'].append('weak mode ignores comments/spacing; renamed mode also normalizes identifiers consistently. No semantic/AST/cross-language mode.')
            raw_path = out / 'jscpd-report.json'
        else:
            command = [sys.executable, str(Path(__file__).resolve()), '--lizard-worker', str(out / 'manifest.json')]
            raw_path = out / 'lizard-raw.json'
            result['limitations'].append('Lizard partially parses syntax; known unreliable fields are null, with native values preserved in raw output.')
        execution = {'command': command, 'cwd': str(out), 'timeout_seconds': args.timeout}
        started = time.monotonic()
        try:
            cp = subprocess.run(command, cwd=out, capture_output=True, timeout=args.timeout)
            execution.update(exit_code=cp.returncode, seconds=time.monotonic() - started)
            (out / 'stdout.txt').write_bytes(cp.stdout)
            (out / 'stderr.txt').write_bytes(cp.stderr)
        except subprocess.TimeoutExpired as error:
            execution.update(timed_out=True, seconds=time.monotonic() - started)
            (out / 'stdout.txt').write_bytes(error.stdout or b'')
            (out / 'stderr.txt').write_bytes(error.stderr or b'')
            raise
        finally:
            save(out / 'execution.json', execution)
        result['execution'] = str(out / 'execution.json')
        if cp.returncode != 0:
            raise ValueError(f'{provider} exited {cp.returncode}; inspect raw stdout/stderr, not an empty-success result.')
        if provider == 'lizard':
            raw = json.loads(cp.stdout)
            save(raw_path, raw)
            records, errors = normalize_metrics(raw, manifest, ISSUES)
            analyzed = len([row for row in raw if 'error' not in row])
        else:
            raw = json.loads(raw_path.read_text())
            records, errors = normalize_clones(raw, manifest)
            analyzed = raw['statistics']['total']['sources']
        result.update(raw=str(raw_path), errors=errors)
        result['coverage'].update(analyzed_files=analyzed,
            file_count_matches=analyzed == len(manifest['files']),
            known_metric_limitations={lang: ISSUES[lang] for lang in result['coverage']['languages']
                                      if provider == 'lizard' and lang in ISSUES})
        result['status'] = 'partial' if errors or analyzed != len(manifest['files']) or \
            result['coverage']['known_metric_limitations'] or manifest['skipped'] else 'ok'
        changed = []
        for entry in manifest['files']:
            try:
                if sha((root / entry['path']).read_bytes()) != entry['sha256']:
                    changed.append(entry['path'])
            except OSError:
                changed.append(entry['path'])
        result.update(total_records=len(records), truncated=len(records) > args.limit, data=records[:args.limit])
        if changed:
            result.update(status='stale', changed_files=changed, data=[],
                          error='Source changed during analysis; rerun before using any records.')
    except Exception as error:
        result.update(status='error', data=[], error=type(error).__name__ + ': ' + str(error))
    finally:
        save(out / 'result.json', result)
    return result


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--lizard-worker':
        lizard_worker(sys.argv[2])
    else:
        sys.exit('Use source_tools.py duplicates / metrics.')
