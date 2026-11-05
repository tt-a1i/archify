#!/usr/bin/env python3
"""Thin local clients. Provider-native results are evidence, not defect verdicts."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time

SKILL = Path(__file__).resolve().parents[1]
CONFIG = json.loads((SKILL / 'toolchain.json').read_text())
RUNTIME = Path(os.environ.get('SOURCE_REVIEW_RUNTIME', CONFIG['runtime'])).expanduser()
if not RUNTIME.is_absolute():
    RUNTIME = SKILL / RUNTIME
INTERPRETER = RUNTIME / 'venv/bin/python'
if INTERPRETER.exists() and Path(sys.prefix).resolve() != (RUNTIME / 'venv').resolve():
    os.execv(str(INTERPRETER), [str(INTERPRETER), str(Path(__file__).resolve()), *sys.argv[1:]])
GRAMMARS = {
    'python': ('python', 'language'), 'javascript': ('javascript', 'language'),
    'typescript': ('typescript', 'language_typescript'), 'tsx': ('typescript', 'language_tsx'),
    'go': ('go', 'language'), 'rust': ('rust', 'language'), 'java': ('java', 'language'),
    'c': ('c', 'language'), 'cpp': ('cpp', 'language'),
}
EXTENSIONS = {'.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript',
              '.tsx': 'tsx', '.go': 'go', '.rs': 'rust', '.java': 'java', '.c': 'c',
              '.cpp': 'cpp', '.cc': 'cpp'}
DECLARATIONS = {'function_definition', 'function_declaration', 'method_definition',
                'method_declaration', 'class_definition', 'class_declaration',
                'interface_declaration', 'function_item', 'struct_item', 'impl_item',
                'type_alias_declaration', 'type_declaration', 'struct_specifier',
                'class_specifier', 'lexical_declaration'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def result(provider, data, *, limitations=(), **meta):
    return dict(provider=provider, data=data, limitations=list(limitations), **meta)


def run(command, *, timeout=120, cwd=None, extra_env=None):
    env = dict(os.environ, SEMGREP_SEND_METRICS='off', SEMGREP_ENABLE_VERSION_CHECK='0')
    env.pop('SEMGREP_APP_TOKEN', None)
    env.update(extra_env or {})
    return subprocess.run([str(x) for x in command], cwd=cwd, env=env,
                          text=True, capture_output=True, timeout=timeout)


def syntax(args):
    from tree_sitter import Language, Parser, Query, QueryCursor
    path = Path(args.file).resolve()
    lang = args.language or EXTENSIONS.get(path.suffix)
    if lang not in GRAMMARS:
        raise ValueError('Unsupported/ambiguous language; specify --language explicitly')
    package, factory = GRAMMARS[lang]
    language = Language(getattr(importlib.import_module('tree_sitter_' + package), factory)())
    data = path.read_bytes()
    tree = Parser(language).parse(data)

    def visit(node):
        yield node
        for child in node.named_children:
            yield from visit(child)

    def location(node):
        return {'kind': node.type, 'start_line': node.start_point.row + 1,
                'end_line': node.end_point.row + 1, 'start_byte': node.start_byte,
                'end_byte': node.end_byte, 'text': data[node.start_byte:node.end_byte].decode('utf8')}

    if args.query_file:
        captures = QueryCursor(Query(language, Path(args.query_file).read_text())).captures(tree.root_node)
        nodes = [(name, node) for name, group in captures.items() for node in group]
    else:
        nodes = [('declaration', n) for n in visit(tree.root_node) if n.type in DECLARATIONS]
        if args.line:
            nodes = [(name, n) for name, n in nodes if n.start_point.row < args.line <= n.end_point.row + 1]
            nodes.sort(key=lambda item: item[1].end_byte - item[1].start_byte)
            nodes = nodes[:1]
    output = [{'capture': name, **location(n)} for name, n in nodes[:args.limit]]
    return result('tree-sitter', output, language=lang, file=str(path), sha256=digest(path),
                  parse_errors=tree.root_node.has_error, truncated=len(nodes) > args.limit,
                  version=importlib.metadata.version('tree-sitter'),
                  limitations=['Syntax only; declarations are not resolved symbols or executable control flow.',
                               'C/C++ headers require an explicit language; TSX is a TypeScript grammar.'])


class LSP:
    def __init__(self, command, root, settings, timeout):
        self.root, self.settings, self.timeout = root, settings, timeout
        self.seq = 0
        self.messages = queue.Queue()
        self.errors = []
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, cwd=root)
        threading.Thread(target=self.reader, daemon=True).start()
        threading.Thread(target=self.stderr, daemon=True).start()

    def stderr(self):
        for line in self.process.stderr:
            self.errors.append(line.decode('utf8', errors='replace').rstrip())

    def reader(self):
        try:
            while True:
                headers = {}
                while True:
                    line = self.process.stdout.readline()
                    if not line:
                        raise EOFError('language server exited')
                    if line in (b'\r\n', b'\n'):
                        break
                    key, value = line.decode().split(':', 1)
                    headers[key.lower()] = value.strip()
                size = int(headers['content-length'])
                payload = self.process.stdout.read(size)
                self.messages.put(json.loads(payload))
        except Exception as error:
            self.messages.put(error)

    def send(self, body):
        payload = json.dumps({'jsonrpc': '2.0', **body}).encode()
        self.process.stdin.write(f'Content-Length: {len(payload)}\r\n\r\n'.encode() + payload)
        self.process.stdin.flush()

    def notify(self, method, params):
        self.send({'method': method, 'params': params})

    def request(self, method, params):
        self.seq += 1
        request_id = self.seq
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(method)
            message = self.messages.get(timeout=remaining)
            if isinstance(message, Exception):
                raise message
            if 'method' in message and 'id' in message:
                if message['method'] == 'workspace/configuration':
                    values = []
                    for item in message.get('params', {}).get('items', []):
                        value = self.settings
                        for part in (item.get('section') or '').split('.'):
                            if part:
                                value = value.get(part, {}) if isinstance(value, dict) else {}
                        values.append(value)
                elif message['method'] == 'workspace/workspaceFolders':
                    values = [{'uri': self.root.as_uri(), 'name': self.root.name}]
                else:
                    self.send({'id': message['id'], 'error': {'code': -32601, 'message': 'Not supported'}})
                    continue
                self.send({'id': message['id'], 'result': values})
            elif message.get('id') == request_id:
                if 'error' in message:
                    raise RuntimeError(json.dumps(message['error']))
                return message.get('result')

    def close(self):
        # One-shot server: terminate and reap even after a failed/unsupported request.
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def lsp(args):
    root, path = Path(args.root).resolve(), Path(args.file).resolve()
    if not args.server and args.language != 'python':
        return result('lsp', None, status='unsupported',
                      limitations=['Only Python/Pyright is configured; select an installed language server explicitly.'])
    command = json.loads(args.server) if args.server else [str(RUNTIME/'node/node_modules/.bin/pyright-langserver'), '--stdio']
    settings = {'python': {'analysis': {'extraPaths': args.extra_path, 'autoSearchPaths': True}}}
    client = LSP(command, root, settings, args.timeout)
    try:
        init = client.request('initialize', {'processId': os.getpid(), 'rootUri': root.as_uri(),
                 'workspaceFolders': [{'uri': root.as_uri(), 'name': root.name}],
                 'capabilities': {'workspace': {'configuration': True},
                                  'textDocument': {'callHierarchy': {'dynamicRegistration': False}}}})
        client.notify('initialized', {})
        client.notify('workspace/didChangeConfiguration', {'settings': settings})
        text = path.read_text()
        client.notify('textDocument/didOpen', {'textDocument': {'uri': path.as_uri(),
                       'languageId': args.language, 'version': 1, 'text': text}})
        line = text.splitlines()[args.line - 1]
        if args.column < 1 or args.column > len(line) + 1:
            raise ValueError('column must be a one-based Unicode character position')
        column = len(line[:args.column - 1].encode('utf-16-le')) // 2
        params = {'textDocument': {'uri': path.as_uri()},
                  'position': {'line': args.line - 1, 'character': column}}
        capabilities = init.get('capabilities', {})
        hierarchy = None
        def query(operation):
            nonlocal hierarchy
            if operation in ('callers', 'callees'):
                if not capabilities.get('callHierarchyProvider'):
                    return {'status': 'unsupported', 'data': None, 'reason': 'Server does not advertise call hierarchy'}
                if hierarchy is None: hierarchy = client.request('textDocument/prepareCallHierarchy', params) or []
                method = 'callHierarchy/' + ('incomingCalls' if operation == 'callers' else 'outgoingCalls')
                data = [{'item': item, 'calls': client.request(method, {'item': item})} for item in hierarchy]
            else:
                method = {'definition': 'textDocument/definition', 'references': 'textDocument/references',
                          'symbols': 'textDocument/documentSymbol'}[operation]
                request = dict(params)
                if operation == 'references': request['context'] = {'includeDeclaration': True}
                data = client.request(method, request)
            return {'status': 'ok', 'data': data}
        if args.operation == 'context':
            facets = {}
            for operation in args.lsp_facets:
                try: facets[operation] = query(operation)
                except Exception as error: facets[operation] = {'status': 'error', 'data': None, 'reason': str(error)}
            answer = {'status': 'ok' if all(f['status'] == 'ok' for f in facets.values()) else 'partial', 'data': facets}
        else: answer = query(args.operation)
        server_version = (init.get('serverInfo') or {}).get('version')
        if not args.server:
            server_version = json.loads((RUNTIME/'node/node_modules/pyright/package.json').read_text())['version']
        return result('lsp', answer['data'], status=answer['status'], reason=answer.get('reason'), server=command, server_info=init.get('serverInfo'), version=server_version,
                      capabilities=capabilities, file=str(path), sha256=digest(path),
                      limitations=['Native LSP ranges are zero-based UTF-16; CLI positions are one-based characters.',
                                   'Resolution depends on project configuration and available dependency source.',
                                   'Empty results do not establish absence, especially for dynamic dispatch.'])
    finally:
        client.close()


def scan(args):
    command = [RUNTIME/'venv/bin/semgrep', 'scan', '--oss-only', '--metrics=off', '--disable-version-check',
               '--json', '--no-git-ignore', '--timeout', '15']
    if args.config:
        config = Path(args.config).resolve(strict=True)
        command += ['--config', config]
    else:
        if not args.language:
            raise ValueError('--language is required for --pattern')
        command += ['--pattern', args.pattern, '--lang', args.language]
    command += [Path(args.target).resolve()]
    completed = run(command, timeout=args.timeout)
    if completed.returncode not in (0, 1):
        raise RuntimeError(completed.stderr[-6000:] + completed.stdout[-6000:])
    return result('semgrep-ce', json.loads(completed.stdout), returncode=completed.returncode,
                  version=importlib.metadata.version('semgrep'),
                  limitations=['Pattern matches are investigation leads, not confirmed bugs.',
                               'CE does not provide Pro cross-file analysis; inspect errors and skipped targets.'])


def joern(args):
    home = RUNTIME/'joern/joern-cli'
    jdk = list((RUNTIME/'jdk').glob('*/Contents/Home'))
    java_env = {'JAVA_HOME': str(jdk[0]), 'JAVA_OPTS': '-Xmx4g -XX:ActiveProcessorCount=4'} if len(jdk) == 1 else {}
    java_env['PATH'] = str(RUNTIME/'bin') + os.pathsep + os.environ.get('PATH', '')
    if args.operation == 'build':
        target, output = Path(args.target).resolve(), Path(args.output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            raise ValueError('Choose a new CPG output; existing graph will not be overwritten')
        command = [home/'joern-parse', target, '--language', args.language, '--output', output]
    else:
        command = [home/'joern', '--script', Path(args.script).resolve()]
        for parameter in args.param:
            command += ['--param', parameter]
    # Joern importCpg creates a workspace beneath cwd. Keep that disposable
    # copy out of both the reviewed repository and the shared installation.
    with tempfile.TemporaryDirectory(prefix='source-review-joern-') as workspace:
        completed = run(command, timeout=args.timeout, cwd=workspace, extra_env=java_env)
    if completed.returncode:
        raise RuntimeError(completed.stderr[-8000:] + completed.stdout[-8000:])
    return result('joern', {'stdout': completed.stdout, 'stderr': completed.stderr},
                  version=CONFIG['joern_version'],
                  limitations=['Native CPG queries; frontend/call resolution/exception/data-flow coverage is incomplete.',
                               'Rebuild after source changes; query outputs alone do not establish business correctness.'])


def context(args):
    path = Path(args.file).resolve(strict=True)
    if not path.is_relative_to(Path(args.root).resolve()): raise ValueError('Context file must be inside --root')
    language = args.language or EXTENSIONS.get(path.suffix)
    facets = args.facet or ['syntax']
    observations = {}
    if 'syntax' in facets:
        if language in GRAMMARS:
            syntax_args = argparse.Namespace(file=str(path), language=language, line=args.line, query_file=None, limit=1)
            try:
                observation = syntax(syntax_args)
                observation['status'] = 'partial' if observation['parse_errors'] else 'ok'
                observations['syntax'] = observation
            except Exception as error: observations['syntax'] = {'status': 'error', 'data': None, 'reason': str(error)}
        else: observations['syntax'] = {'status': 'unsupported', 'data': None, 'reason': 'No configured grammar for this extension/language'}
    requested = [f for f in facets if f != 'syntax']
    if requested:
        lsp_args = argparse.Namespace(**vars(args))
        lsp_args.operation, lsp_args.lsp_facets, lsp_args.language = 'context', requested, language
        try:
            answer = lsp(lsp_args)
            if answer['status'] in ('ok', 'partial'):
                observations.update({f: {**answer['data'][f], 'provider': 'lsp', 'version': answer.get('version'),
                                         'server': answer['server'], 'limitations': answer['limitations']} for f in requested})
            else:
                observations.update({f: {'status': answer['status'], 'data': None, 'reason': answer.get('limitations')} for f in requested})
        except Exception as error:
            observations.update({f: {'status': 'error', 'data': None, 'reason': str(error)} for f in requested})
    return result('source-context', observations, status='ok' if all(v['status'] == 'ok' for v in observations.values()) else 'partial',
                  version='1', file=str(path), sha256=digest(path),
                  selection={'line': args.line, 'column': args.column, 'language': language},
                  limitations=['Only requested facets run. LSP facets share one server session.',
                               'Syntax contains the selected line; LSP resolves the selected token. At use sites these may describe different objects.',
                               'Reference/call ranges retain native zero-based UTF-16 coordinates. Empty results do not prove no callers.',
                               'This composes configured providers; it is not a cross-language semantic engine.'])


def capabilities(args):
    import maintenance_signals
    languages = args.language or sorted(set(maintenance_signals.EXTENSIONS.values()))
    def installed(package):
        try: return importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError: return None
    jscpd, lizard = installed('jscpd'), installed('lizard')
    pyright = RUNTIME/'node/node_modules/.bin/pyright-langserver'
    rows = []
    for language in languages:
        grammar = 'javascript' if language == 'jsx' else language
        grammar_package = GRAMMARS.get(grammar, (None, None))[0]
        grammar_version = installed('tree-sitter-' + grammar_package) if grammar_package else None
        base = {'language': language, 'capabilities': {
            'syntax': {'provider': 'tree-sitter', 'installed': grammar_version is not None,
                       'available': bool(grammar_version), 'version': grammar_version,
                       'validation': 'basic syntax fixtures' if grammar_version else 'not configured'},
            'duplicates': {'provider': 'jscpd', 'installed': jscpd is not None,
                           'available': jscpd == CONFIG['maintenance_versions']['jscpd'] and (RUNTIME/'venv/bin/jscpd').exists(),
                           'version': jscpd, 'validated_version': CONFIG['maintenance_versions']['jscpd'],
                           'validation': 'exact/renamed fixtures; no full-language guarantee'},
            'metrics': {'provider': 'lizard', 'installed': lizard is not None,
                        'available': lizard == CONFIG['maintenance_versions']['lizard'], 'version': lizard,
                        'validated_version': CONFIG['maintenance_versions']['lizard'], 'validation': 'basic fixtures with field limitations',
                        'unverified_fields': maintenance_signals.ISSUES.get(language, {})},
            'references_and_calls': {'provider': 'pyright' if language == 'python' else None,
                'installed': pyright.exists() if language == 'python' else False,
                'available': pyright.exists() if language == 'python' else False,
                'validation': 'Python sample; method capabilities checked on actual server' if language == 'python' else 'no language server configured'},
            'patterns': {'provider': 'semgrep-ce', 'installed': installed('semgrep') is not None,
                'available': None, 'validation': 'basic pattern smoke check; rule support checked at query time' if language in
                    ('python', 'javascript', 'typescript', 'java', 'go', 'rust', 'c', 'cpp') else 'not validated for this language'},
            'cfg_and_value_flow': {'provider': 'joern', 'installed': (RUNTIME/'joern/joern-cli/joern').exists(),
                'available': None, 'validation': 'Python frontend sample' if language == 'python' else 'frontend not validated in this skill',
                'reason': 'Requires an appropriate frontend, a source-bound CPG and a selected native query'}
        }}
        rows.append(base)
    return result('local-capability-inventory', rows, status='ok', version='1',
                  limitations=['Read-only installation/configuration inventory; no engines or language servers are launched.',
                               'installed, available and fixture validation are distinct. available=null means query-dependent.',
                               'Pattern/graph support is not inferred from the multilingual duplicate/metric registry.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', help='Retain this observation in an initialized review workspace; print its summary')
    sub = parser.add_subparsers(dest='tool', required=True)
    p = sub.add_parser('syntax', help='Tree-sitter declarations or native query; read_symbol')
    p.add_argument('file'); p.add_argument('--language', choices=GRAMMARS)
    p.add_argument('--line', type=int); p.add_argument('--query-file'); p.add_argument('--limit', type=int, default=50)
    p = sub.add_parser('lsp', help='Definition/references/call hierarchy through a real language server')
    p.add_argument('operation', choices=['definition', 'references', 'symbols', 'callers', 'callees'])
    p.add_argument('--root', required=True); p.add_argument('--file', required=True)
    p.add_argument('--line', type=int, default=1); p.add_argument('--column', type=int, default=1)
    p.add_argument('--language', default='python'); p.add_argument('--server', help='JSON argv; defaults to Pyright')
    p.add_argument('--extra-path', action='append', default=[]); p.add_argument('--timeout', type=int, default=90)
    p = sub.add_parser('scan', help='Run a local Semgrep rule or an explicit code pattern')
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--config'); group.add_argument('--pattern')
    p.add_argument('--language'); p.add_argument('--target', required=True); p.add_argument('--timeout', type=int, default=180)
    p = sub.add_parser('joern', help='Build a graph or run a native Scala query file')
    ss = p.add_subparsers(dest='operation', required=True)
    q = ss.add_parser('build'); q.add_argument('--target', required=True)
    q.add_argument('--language', required=True); q.add_argument('--output', required=True)
    q.add_argument('--timeout', type=int, default=600)
    q = ss.add_parser('query'); q.add_argument('--script', required=True)
    q.add_argument('--param', action='append', default=[], help='Native Joern key=value, repeat for each script parameter')
    q.add_argument('--timeout', type=int, default=300)
    import maintenance_signals
    maintenance_signals.register(sub)
    p = sub.add_parser('context', help='Selected syntax and LSP facets for one source location')
    p.add_argument('--root', required=True); p.add_argument('--file', required=True)
    p.add_argument('--line', type=int, required=True); p.add_argument('--column', type=int, default=1)
    p.add_argument('--language'); p.add_argument('--server'); p.add_argument('--extra-path', action='append', default=[])
    p.add_argument('--facet', choices=['syntax', 'definition', 'references', 'callers', 'callees'], action='append')
    p.add_argument('--timeout', type=int, default=60)
    p = sub.add_parser('capabilities', help='Installed, available and validated capabilities by language')
    p.add_argument('--language', action='append', choices=sorted(set(maintenance_signals.EXTENSIONS.values())))
    args = parser.parse_args()
    try:
        execute = lambda a: maintenance_signals.run(a, RUNTIME, CONFIG) if a.tool in ('duplicates', 'metrics') else globals()[a.tool](a)
        if args.workspace:
            import review_workspace
            value = review_workspace.capture_tool(args.workspace, args, execute)
        else: value = execute(args)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        if value.get('status') in ('error', 'empty_scope', 'stale'):
            return 2
    except Exception as error:
        print(json.dumps({'status': 'error', 'provider': args.tool,
                          'error': type(error).__name__ + ': ' + str(error)}, ensure_ascii=False))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
