#!/usr/bin/env python3
"""Retained observations, bounded views, and revisioned investigation questions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

SCHEMA = 1
MAX_JSON = 64 * 1024 * 1024
EXCLUDES = ['.git/**', '**/node_modules/**', '**/.venv/**', '**/venv/**',
            '**/vendor/**', '**/dist/**', '**/build/**', '**/__pycache__/**']


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def read(path):
    path = Path(path)
    if path.stat().st_size > MAX_JSON: raise ValueError('JSON exceeds 64 MiB; select a smaller analysis scope.')
    return json.loads(path.read_text(encoding='utf8'))


def write_new(path, value):
    """Publish a complete file without replacing an existing revision."""
    encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode() + b'\n'
    if len(encoded) > MAX_JSON: raise ValueError('JSON exceeds 64 MiB; select a smaller analysis scope.')
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
            temp = Path(f.name)
            f.write(encoded)
            f.flush(); os.fsync(f.fileno())
        os.link(temp, path)
    finally:
        if temp is not None: temp.unlink(missing_ok=True)


def config(workspace):
    workspace = Path(workspace).resolve(strict=True)
    value = read(workspace / 'workspace.json')
    if value['schema_version'] != SCHEMA: raise ValueError('Unsupported workspace schema')
    for source in value['sources']:
        root = Path(source['root']).resolve()
        if workspace.is_relative_to(root): raise ValueError('Workspace must remain outside source roots')
    return workspace, value


def init(workspace, sources, revision=None):
    workspace = Path(workspace).resolve()
    entries = []
    for item in sources:
        name, path = item.split('=', 1)
        root = Path(path).resolve(strict=True)
        if not re.fullmatch(r'[\w.-]+', name) or not root.is_dir(): raise ValueError('Invalid source ID or directory')
        if workspace.is_relative_to(root): raise ValueError('Workspace must be outside source roots')
        entries.append({'id': name, 'root': str(root)})
    if not entries or len({s['id'] for s in entries}) != len(entries): raise ValueError('Unique sources required')
    workspace.mkdir(parents=True, exist_ok=False)
    write_new(workspace / 'workspace.json', {'schema_version': SCHEMA, 'sources': entries, 'revision_label': revision})
    return {'workspace': str(workspace), 'sources': entries}


def source_allowed(path, cfg):
    path = Path(path).resolve()
    return any(path.is_relative_to(Path(s['root']).resolve()) for s in cfg['sources'])


def enumerate_files(root, scopes, excludes):
    command = ['rg', '--files', '--hidden', '--null']
    for pattern in excludes: command += ['--glob', '!' + pattern]
    command += ['--', *scopes]
    cp = subprocess.run(command, cwd=root, capture_output=True, timeout=30)
    if cp.returncode not in (0, 1): raise ValueError(cp.stderr.decode(errors='replace'))
    return sorted({str(Path(name)) for name in cp.stdout.decode().split('\0') if name})


def snapshot(paths, cfg):
    files, inventories, gaps = {}, [], []
    for path, role in paths:
        path = Path(path).resolve(strict=True)
        if role == 'source' and not source_allowed(path, cfg):
            raise ValueError('Register source root before analysis: ' + str(path))
        if path.is_dir():
            names = enumerate_files(path, ['.'], EXCLUDES)
            if len(names) > 10000: raise ValueError('Input inventory exceeds 10000 files; narrow the source root')
            inventories.append({'root': str(path), 'scopes': ['.'], 'exclude': EXCLUDES, 'paths': names})
            candidates = [path / name for name in names]
        else: candidates = [path]
        for candidate in candidates:
            if candidate.is_symlink() or not candidate.resolve().is_relative_to(path if path.is_dir() else path.parent):
                gaps.append({'path': str(candidate), 'reason': 'symlink/outside input'}); continue
            if candidate.stat().st_size > 1048576 and role == 'source':
                gaps.append({'path': str(candidate), 'reason': 'over 1 MiB identity limit'}); continue
            files[str(candidate)] = {'path': str(candidate), 'sha256': file_hash(candidate), 'role': role}
    return {'files': sorted(files.values(), key=lambda f: f['path']), 'inventories': inventories, 'gaps': gaps,
            'limitations': ['Hashes cover declared inputs and enumerated files, not every possible engine/framework dependency.',
                            'Ignore/glob exclusions remain outside the captured source identity.']}


def freshness(identity):
    changed, inaccessible, inventory_changes = [], [], []
    for entry in identity['files']:
        try:
            if file_hash(entry['path']) != entry['sha256']: changed.append(entry['path'])
        except OSError: inaccessible.append(entry['path'])
    for inventory in identity.get('inventories', []):
        try:
            actual = enumerate_files(inventory['root'], inventory['scopes'], inventory['exclude'])
            if actual != inventory['paths']:
                inventory_changes.append({'root': inventory['root'],
                    'added': sorted(set(actual) - set(inventory['paths'])),
                    'removed': sorted(set(inventory['paths']) - set(actual))})
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            inaccessible.append(str(error))
    return {'status': 'changed' if changed or inventory_changes else 'unavailable' if inaccessible else 'checked_inputs_unchanged',
            'changed_files': changed, 'inventory_changes': inventory_changes, 'inaccessible': inaccessible,
            'identity_gaps': identity.get('gaps', []), 'limitations': identity.get('limitations', [])}


def load_evidence(workspace, evidence_id):
    if not re.fullmatch(r'ev_[a-f0-9]{64}', evidence_id): raise ValueError('Invalid evidence ID')
    value = read(Path(workspace) / 'evidence' / (evidence_id + '.json'))
    body = {k: v for k, v in value.items() if k != 'evidence_id'}
    if value['evidence_id'] != evidence_id or 'ev_' + digest(body) != evidence_id:
        raise ValueError('Evidence content does not match its ID')
    return value


def retain(workspace, *, operation, provider, version, parameters, identity, coverage, status,
           limitations, records, native, artifacts=None):
    workspace, _ = config(workspace)
    parameters = {**parameters, 'retention_adapter_sha256': file_hash(__file__)}
    numbered = []
    for i, record in enumerate(records):
        numbered.append({**record, 'record_id': 'rec_' + digest([i, record])})
    body = {'schema_version': SCHEMA, 'operation': operation, 'provider': provider, 'version': version,
            'parameters': parameters, 'analysis_profile_digest': digest([provider, version, parameters]),
            'input_identity': identity, 'input_digest': digest(identity), 'coverage': coverage, 'status': status,
            'evidence_type': 'tool_observation', 'limitations': limitations, 'records': numbered,
            'native': native, 'artifacts': artifacts or {}}
    evidence_id = 'ev_' + digest(body)
    value = {'evidence_id': evidence_id, **body}
    try: write_new(workspace / 'evidence' / (evidence_id + '.json'), value)
    except FileExistsError: load_evidence(workspace, evidence_id)
    return summary(value)


def summary(value):
    native = value['native'] if isinstance(value['native'], dict) else {}
    return {k: value[k] for k in ['evidence_id', 'operation', 'provider', 'version', 'status', 'coverage', 'limitations']} | {
        'record_count': len(value['records']), 'analysis_profile_digest': value['analysis_profile_digest'],
        'input_digest': value['input_digest'], 'freshness': freshness(value['input_identity']),
        'error': native.get('error') or value.get('artifacts', {}).get('result', {}).get('error')}


def maintenance_payload(workspace, input_path):
    import maintenance_signals as maintenance
    _, cfg = config(workspace)
    path = Path(input_path).resolve(strict=True)
    value = read(path)
    if value.get('provider') not in ('jscpd', 'lizard'): raise ValueError('Import accepts duplicates/metrics result.json only')
    expected = read(Path(__file__).parents[1] / 'toolchain.json')['maintenance_versions'][value['provider']]
    if value.get('version') != expected: raise ValueError('No validated normalization for this provider version')
    def local_artifact(name):
        p = Path(value[name]).resolve(strict=True)
        if not p.is_relative_to(path.parent): raise ValueError('Artifact link escapes input directory')
        return p
    manifest_path = local_artifact('manifest')
    manifest = read(manifest_path)
    root = Path(manifest['root']).resolve()
    if not source_allowed(root, cfg): raise ValueError('Register the manifest source root first')
    identity = {'files': [], 'inventories': [], 'gaps': manifest['skipped'],
                'limitations': ['Identity follows the recorded scan selection; excluded files and unsupported fields are not verified.']}
    for entry in manifest['files']:
        p = (root / entry['path']).resolve()
        if not p.is_relative_to(root): raise ValueError('Manifest file escapes source root')
        identity['files'].append({'path': str(p), 'sha256': entry['sha256'], 'role': 'source'})
    selection = manifest['selection']
    names = sorted(set(str(Path(f['path'])) for f in manifest['files'] + manifest['skipped']))
    identity['inventories'].append({'root': str(root), 'scopes': selection['scopes'], 'exclude': selection['exclude'], 'paths': names})
    state = freshness(identity)
    if state['status'] != 'checked_inputs_unchanged':
        raise ValueError('Cannot newly normalize historical artifacts against changed/missing source: ' + json.dumps(state))
    records, native, errors = [], None, []
    artifacts = {'result': value, 'manifest': manifest, 'input_result_sha256': file_hash(path)}
    for name in ('execution.json', 'jscpd-config.json'):
        p = path.parent / name
        if p.is_file(): artifacts[name] = read(p)
    for name in ('stdout.txt', 'stderr.txt'):
        p = path.parent / name
        if p.is_file():
            if p.stat().st_size > MAX_JSON: raise ValueError('Log exceeds retention budget; narrow the scan')
            artifacts[name] = p.read_text(errors='replace')
    if value.get('raw') and value['status'] in ('ok', 'partial'):
        raw_path = local_artifact('raw'); native = read(raw_path)
        artifacts['raw_sha256'] = file_hash(raw_path)
        if value['provider'] == 'jscpd': records, errors = maintenance.normalize_clones(native, manifest)
        else: records, errors = maintenance.normalize_metrics(native, manifest, maintenance.ISSUES)
        if errors: raise ValueError('Normalization errors: ' + json.dumps(errors))
        if len(records) != value['total_records']: raise ValueError('Full record count differs from saved result')
    identity['files'] = sorted(identity['files'], key=lambda f: f['path'])
    return dict(operation='duplicates' if value['provider'] == 'jscpd' else 'metrics', provider=value['provider'],
                version=value['version'], parameters={'selection': selection, 'configuration': value.get('configuration', {}),
                    'normalizer_sha256': file_hash(maintenance.__file__)},
                identity=identity, coverage=value['coverage'], status=value['status'], limitations=value['limitations'],
                records=records, native=native, artifacts=artifacts)


def import_maintenance(workspace, input_path):
    return retain(workspace, **maintenance_payload(workspace, input_path))


def declared_inputs(args):
    paths = []
    if args.tool in ('syntax',): paths.append((args.file, 'source'))
    elif args.tool in ('lsp', 'context'):
        paths.append((args.root, 'source'))
        paths.extend((p, 'source') for p in args.extra_path)
    elif args.tool == 'scan': paths.append((args.target, 'source'))
    elif args.tool == 'joern' and args.operation == 'build': paths.append((args.target, 'source'))
    for key in ('query_file', 'config', 'script'):
        if getattr(args, key, None): paths.append((getattr(args, key), 'configuration'))
    return paths


def native_records(args, value):
    rows = []
    def add(collection, data, raw_prefix):
        values = data if isinstance(data, list) else [data] if data is not None else []
        for i, item in enumerate(values):
            row = {'collection': collection, 'raw_pointer': raw_prefix + (f'/{i}' if isinstance(data, list) else ''), 'value': item}
            if isinstance(item, dict):
                for field in ('name', 'path', 'file', 'uri', 'targetUri'):
                    if field in item: row[field] = item[field]
            if args.tool == 'syntax': row['path'] = value['file']
            rows.append(row)
    if args.tool == 'context':
        for facet, observation in value.get('data', {}).items():
            add(facet, observation.get('data'), '/data/' + facet + '/data')
    elif args.tool == 'scan': add('matches', value.get('data', {}).get('results', []), '/data/results')
    elif args.tool == 'joern':
        if 'query_result' in value: add('query', value['query_result'], '/query_result')
    else: add(getattr(args, 'operation', args.tool), value.get('data'), '/data')
    return rows


def capture_tool(workspace, args, execute):
    """Retain a CLI observation; queries of retained evidence never call execute."""
    workspace, cfg = config(workspace)
    if args.tool in ('duplicates', 'metrics'):
        if not source_allowed(args.root, cfg): raise ValueError('Register the source root before analysis')
        value = execute(args)
        if value.get('manifest'):
            return import_maintenance(workspace, Path(args.out) / 'result.json')
        identity = {'files': [], 'inventories': [], 'gaps': ['Producer failed before input identity capture']}
    else:
        identity = snapshot(declared_inputs(args), cfg)
        if args.tool == 'capabilities': identity['gaps'].append('Installation availability is a point-in-time inventory; query again after environment changes.')
        params = dict(p.split('=', 1) for p in getattr(args, 'param', []))
        if args.tool == 'joern':
            output = getattr(args, 'output', None) or params.get('out')
            if output and source_allowed(output, cfg): raise ValueError('Analysis output must be outside source roots')
            if output and Path(output).exists(): raise ValueError('Use a new analysis output; retained observations must not read an old result')
            cpg = params.get('cpgFile')
            if cpg:
                identity['files'].append({'path': str(Path(cpg).resolve()), 'sha256': file_hash(cpg), 'role': 'analysis_graph'})
                binding = Path(str(Path(cpg).resolve()) + '.source-review.json')
                if binding.exists():
                    bound = read(binding)
                    if bound['cpg_sha256'] != file_hash(cpg): raise ValueError('CPG identity differs from its source binding')
                    identity['files'].extend(bound['input_identity']['files'])
                    identity['inventories'].extend(bound['input_identity']['inventories'])
                    identity['gaps'].extend(bound['input_identity'].get('gaps', []))
                else: identity['gaps'].append({'path': cpg, 'reason': 'No source binding; graph source version unknown'})
            elif args.operation == 'query': identity['gaps'].append('Custom query does not declare a recognized cpgFile input; source identity unknown.')
        try:
            if freshness(identity)['status'] != 'checked_inputs_unchanged':
                value = {'provider': args.tool, 'status': 'stale', 'data': None,
                         'error': 'Declared input/CPG source binding is stale; rebuild before analysis'}
            else: value = execute(args)
            if args.tool == 'joern' and value.get('status') not in ('error', 'stale'):
                if args.operation == 'build':
                    cpg_path = Path(args.output).resolve()
                    write_new(str(cpg_path) + '.source-review.json',
                              {'cpg_sha256': file_hash(cpg_path), 'input_identity': identity})
                elif params.get('out') and Path(params['out']).exists(): value['query_result'] = read(params['out'])
        except Exception as error:
            value = {'provider': args.tool, 'status': 'error', 'data': None,
                     'error': type(error).__name__ + ': ' + str(error)}
    state = freshness(identity)
    status = value.get('status', 'ok')
    if value.get('parse_errors') or value.get('truncated') or identity.get('gaps'):
        if status == 'ok': status = 'partial'
    if args.tool == 'scan' and (value.get('data') or {}).get('errors') and status == 'ok': status = 'partial'
    if state['status'] != 'checked_inputs_unchanged': status = 'stale'
    records = native_records(args, value) if status in ('ok', 'partial') else []
    parameters = {k: v for k, v in vars(args).items() if k not in ('workspace', 'out', 'output')}
    parameters['adapter_sha256'] = file_hash(Path(__file__).with_name('source_tools.py'))
    return retain(workspace, operation=args.tool + ('.' + args.operation if hasattr(args, 'operation') else ''),
                  provider=value.get('provider', args.tool), version=value.get('version'), parameters=parameters,
                  identity=identity, coverage={'scope': 'declared inputs and provider-returned facts',
                      'identity_gaps': identity.get('gaps', []), 'producer_truncated': value.get('truncated', False),
                      'provider_errors': (value.get('data') or {}).get('errors', []) if args.tool == 'scan' else [],
                      'facets': {k: {f: v[f] for f in ('status', 'reason', 'provider', 'version') if f in v}
                                 for k,v in (value.get('data') or {}).items()} if args.tool == 'context' else {},
                      'method_capabilities': value.get('capabilities', {})},
                  status=status, limitations=value.get('limitations', []) + identity.get('limitations', []),
                  records=records, native=value)


def pointer(value, path):
    if path == '': return value
    if not path.startswith('/'): raise ValueError('JSON Pointer must start with /')
    for token in path[1:].split('/'):
        token = token.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            if not re.fullmatch(r'0|[1-9][0-9]*', token): raise ValueError('Invalid array pointer')
            value = value[int(token)]
        else: value = value[token]
    return value


def record_paths(value):
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k in ('path', 'file', 'uri', 'targetUri') and isinstance(v, str): found.append(v)
            elif isinstance(v, (dict, list)): found.extend(record_paths(v))
    elif isinstance(value, list):
        for item in value: found.extend(record_paths(item))
    return found


def view(workspace, evidence_id, *, kind='summary', offset=0, limit=20, path=None, name=None, record_id=None, json_pointer=None):
    if offset < 0 or not 1 <= limit <= 100: raise ValueError('offset >= 0 and limit between 1 and 100 required')
    workspace, _ = config(workspace)
    value = load_evidence(workspace, evidence_id)
    result = summary(value)
    if kind == 'summary': return result
    if kind == 'raw':
        if json_pointer is None: raise ValueError('raw view requires an explicit --pointer (relative to native result)')
        selected = pointer(value['native'], json_pointer)
        if isinstance(selected, list):
            result.update(total=len(selected), data=selected[offset:offset+limit],
                          next_offset=offset+limit if offset+limit < len(selected) else None)
        else: result['data'] = selected
    else:
        selected = value['records']
        if path is not None: selected = [r for r in selected if path in record_paths(r)]
        if name is not None: selected = [r for r in selected if r.get('name') == name]
        if record_id is not None:
            selected = [r for r in selected if r['record_id'] == record_id]
            if not selected: raise ValueError('Unknown record ID in this observation')
        result.update(total=len(selected), data=selected[offset:offset+limit],
                      next_offset=offset+limit if offset+limit < len(selected) else None)
    if len(canonical(result)) > 128 * 1024:
        return {**summary(value), 'view_status': 'too_large',
                'remedy': 'Select fewer records or a deeper native JSON Pointer. Producer results are retained; do not rescan.'}
    result['historical_only'] = result['freshness']['status'] != 'checked_inputs_unchanged'
    return result


def question_load(workspace, question_id):
    if not re.fullmatch(r'q_[a-f0-9]{32}', question_id): raise ValueError('Invalid question ID')
    paths = sorted((Path(workspace) / 'questions' / question_id).glob('*.json'))
    if not paths: raise ValueError('Unknown question')
    previous = None
    for number, path in enumerate(paths, 1):
        value = read(path)
        body = {k: v for k, v in value.items() if k != 'revision_digest'}
        if value['id'] != question_id or value['revision'] != number or value['previous_digest'] != previous or digest(body) != value['revision_digest']:
            raise ValueError('Question revision chain is invalid')
        previous = value['revision_digest']
    return value


def question_write(workspace, incoming, question_id=None, expected_revision=None):
    workspace, cfg = config(workspace)
    fields = {'question', 'hypothesis', 'scope', 'status', 'support', 'counterevidence', 'unknowns', 'next_query', 'conclusion', 'finding_id'}
    if set(incoming) - fields: raise ValueError('Unknown question fields: ' + str(set(incoming) - fields))
    if question_id:
        previous = question_load(workspace, question_id)
        if previous['revision'] != expected_revision: raise ValueError('Stale question revision; reread before updating')
        body = {k: previous[k] for k in fields if k in previous} | incoming
        revision, parent = previous['revision'] + 1, previous['revision_digest']
    else:
        body = {'hypothesis': '', 'status': 'open', 'support': [], 'counterevidence': [],
                'unknowns': [], 'next_query': '', 'conclusion': '', 'finding_id': None} | incoming
        question_id, revision, parent = 'q_' + uuid.uuid4().hex, 1, None
    if not isinstance(body.get('question'), str) or not body['question'].strip(): raise ValueError('A concrete question is required')
    if not isinstance(body.get('scope'), str) or not body['scope'].strip(): raise ValueError('Question scope is required')
    if body['status'] not in ('open', 'investigating', 'blocked', 'resolved', 'withdrawn'): raise ValueError('Invalid question status')
    for key in ('hypothesis', 'next_query', 'conclusion'):
        if not isinstance(body[key], str): raise ValueError(key + ' must be text')
    if not isinstance(body['unknowns'], list) or any(not isinstance(s, str) or not s.strip() for s in body['unknowns']):
        raise ValueError('unknowns must be nonempty text entries')
    refs = []
    for key in ('support', 'counterevidence'):
        if not isinstance(body[key], list): raise ValueError(key + ' must be a list')
        for ref in body[key]:
            if not isinstance(ref, dict) or set(ref) - {'evidence_id', 'record_id'} or 'evidence_id' not in ref:
                raise ValueError('Reference needs evidence_id and optional record_id')
            evidence = load_evidence(workspace, ref['evidence_id'])
            if ref.get('record_id') and not any(r['record_id'] == ref['record_id'] for r in evidence['records']):
                raise ValueError('Record does not belong to referenced observation')
            refs.append((key, ref, evidence))
        if len({canonical(r) for r in body[key]}) != len(body[key]): raise ValueError('Duplicate evidence reference')
    if {canonical(r) for r in body['support']} & {canonical(r) for r in body['counterevidence']}:
        raise ValueError('Same reference cannot both support and contradict')
    closing = body['status'] in ('resolved', 'withdrawn')
    if closing:
        required = 'support' if body['status'] == 'resolved' else 'counterevidence'
        if not body[required] or not body['conclusion'].strip(): raise ValueError('Closing needs a conclusion and appropriate evidence')
        if body['unknowns']: raise ValueError('Resolve or rescope remaining unknowns before closing')
        for _, _, evidence in refs:
            if evidence['status'] not in ('ok', 'partial') or freshness(evidence['input_identity'])['status'] != 'checked_inputs_unchanged':
                raise ValueError('Closing requires current, usable observations; failed or stale results cannot close questions')
    elif not body['next_query'].strip(): raise ValueError('Open questions need a next query or blocker recovery step')
    if body['finding_id'] is not None and not re.fullmatch(r'SR-[a-f0-9]{12}', body['finding_id']):
        raise ValueError('finding_id must use the existing report finding identity')
    value = {'id': question_id, 'revision': revision, 'previous_digest': parent,
             'sources': cfg['sources'], 'judgment': 'analyst supplied; references validated, semantic conclusion not machine-proved', **body}
    value['revision_digest'] = digest(value)
    write_new(workspace / 'questions' / question_id / f'{revision:06d}.json', value)
    return value


def question_view(workspace, question_id):
    value = question_load(workspace, question_id)
    ids = sorted({r['evidence_id'] for k in ('support', 'counterevidence') for r in value[k]})
    return {**value, 'current_evidence': {i: summary(load_evidence(workspace, i)) for i in ids}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', required=True)
    sub = p.add_subparsers(dest='op', required=True)
    s = sub.add_parser('init'); s.add_argument('--source', action='append', required=True); s.add_argument('--revision')
    s = sub.add_parser('import'); s.add_argument('--input', required=True)
    s = sub.add_parser('list'); s.add_argument('--provider'); s.add_argument('--operation')
    s.add_argument('--offset', type=int, default=0); s.add_argument('--limit', type=int, default=20)
    s = sub.add_parser('view'); s.add_argument('--id', required=True)
    s.add_argument('--kind', choices=['summary', 'records', 'raw'], default='summary')
    s.add_argument('--path'); s.add_argument('--name'); s.add_argument('--record'); s.add_argument('--pointer')
    s.add_argument('--offset', type=int, default=0); s.add_argument('--limit', type=int, default=20)
    s = sub.add_parser('question'); ss = s.add_subparsers(dest='action', required=True)
    t = ss.add_parser('create'); t.add_argument('--input', required=True)
    t = ss.add_parser('update'); t.add_argument('--id', required=True); t.add_argument('--expected-revision', required=True, type=int); t.add_argument('--input', required=True)
    t = ss.add_parser('show'); t.add_argument('--id', required=True)
    t = ss.add_parser('list'); t.add_argument('--status', choices=['open', 'investigating', 'blocked', 'resolved', 'withdrawn'])
    t.add_argument('--offset', type=int, default=0); t.add_argument('--limit', type=int, default=20)
    args = p.parse_args()
    try:
        if args.op == 'init': result = init(args.workspace, args.source, args.revision)
        elif args.op == 'import': result = import_maintenance(args.workspace, args.input)
        elif args.op == 'view': result = view(args.workspace, args.id, kind=args.kind, offset=args.offset, limit=args.limit, path=args.path, name=args.name, record_id=args.record, json_pointer=args.pointer)
        else:
            workspace, _ = config(args.workspace)
            if args.op == 'list':
                if args.offset < 0 or not 1 <= args.limit <= 100: raise ValueError('Invalid page')
                rows = [load_evidence(workspace, f.stem) for f in sorted((workspace / 'evidence').glob('ev_*.json'))]
                rows = [r for r in rows if (not args.provider or r['provider'] == args.provider) and (not args.operation or r['operation'] == args.operation)]
                result = {'total': len(rows), 'data': [summary(r) for r in rows[args.offset:args.offset+args.limit]],
                          'next_offset': args.offset+args.limit if args.offset+args.limit < len(rows) else None}
            elif args.action == 'create': result = question_write(workspace, read(args.input))
            elif args.action == 'update': result = question_write(workspace, read(args.input), args.id, args.expected_revision)
            elif args.action == 'show': result = question_view(workspace, args.id)
            else:
                if args.offset < 0 or not 1 <= args.limit <= 100: raise ValueError('Invalid page')
                rows = [question_load(workspace, d.name) for d in sorted((workspace / 'questions').glob('q_*'))]
                rows = [r for r in rows if not args.status or r['status'] == args.status]
                result = {'total': len(rows), 'questions': [{k: r[k] for k in
                          ('id','revision','question','scope','status','unknowns','next_query','conclusion','finding_id')}
                          for r in rows[args.offset:args.offset+args.limit]],
                          'next_offset': args.offset+args.limit if args.offset+args.limit < len(rows) else None}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, IndexError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'error', 'error': str(error)}, ensure_ascii=False))
        return 2
    return 0


if __name__ == '__main__': raise SystemExit(main())
