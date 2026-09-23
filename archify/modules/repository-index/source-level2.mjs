import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { safeSourceLine } from './source-redaction.mjs';

// Level 2 builds a whole-repository import graph from bounded line scanning.
// It deliberately avoids per-file AST subprocesses: import statements are the
// only facts a module graph needs, and a line scanner covers the entire
// repository in the time an AST pass spends on a fraction of it. Whatever the
// scanner cannot see (other languages, dynamic imports, unresolved names) is
// counted and surfaced instead of silently dropped, so downstream consumers
// can treat missing evidence as a boundary to confirm rather than absence.
export const LEVEL2_DEFAULT_LIMITS = Object.freeze({
  maximumFiles: 4000,
  maximumBytesPerFile: 512 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
  maximumEdgeEvidence: 5,
  maximumUnknownImports: 20,
});

const SCANNABLE_LANGUAGES = new Set(['python', 'javascript', 'typescript']);

// Standard-library imports are expected and never a finding. They are counted
// separately so that external-name rankings only surface third-party names.
// The Python list is sys.stdlib_module_names (CPython 3.12, public names plus
// __future__ and _thread), embedded so the result never depends on which
// interpreter happens to be installed.
const PYTHON_STDLIB = new Set([
  '__future__ _thread abc aifc antigravity argparse array ast asyncio atexit audioop base64 bdb ',
  'binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop ',
  'collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg ',
  'crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings ',
  'ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc ',
  'genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib ',
  'imaplib imghdr importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale ',
  'logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt ',
  'multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ',
  'ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix ',
  'posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri ',
  'random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve ',
  'shlex shutil signal site smtplib sndhdr socket socketserver spwd sqlite3 sre_compile ',
  'sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable ',
  'sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time ',
  'timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types ',
  'typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg ',
  'winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo',
].join('').split(' '));
const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '').split('/')[0]));
const JS_EXTENSIONS = ['.mjs', '.js', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'];

function posixDirname(value) {
  const dir = path.posix.dirname(value);
  return dir === '.' ? '' : dir;
}

function readPrefix(absolutePath, maximumBytes) {
  const descriptor = fs.openSync(absolutePath, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    const buffer = Buffer.allocUnsafe(Math.min(size, maximumBytes));
    const read = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, read).toString('utf8'), bytes: read, truncated: size > maximumBytes };
  } finally {
    fs.closeSync(descriptor);
  }
}

// --- Python -----------------------------------------------------------------

// Removes comments and string bodies from one line while tracking open
// triple-quoted strings across lines, so docstring examples never register
// as imports. Python module specifiers are bare tokens, never inside string
// literals, so dropping string bodies loses nothing the scanner needs.
function stripPythonLine(line, state) {
  let out = '';
  let index = 0;
  while (index < line.length) {
    if (state.triple) {
      const close = line.indexOf(state.triple, index);
      if (close === -1) return out;
      index = close + 3;
      state.triple = null;
      continue;
    }
    const character = line[index];
    if (character === '#') break;
    if (character === '"' || character === "'") {
      const triple = line.slice(index, index + 3);
      if (triple === '"""' || triple === "'''") {
        state.triple = triple;
        index += 3;
        continue;
      }
      const close = line.indexOf(character, index + 1);
      if (close === -1) break;
      index = close + 1;
      out += ' ';
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

function scanPython(text) {
  const statements = [];
  let dynamic = 0;
  const state = { triple: null };
  const lines = text.split(/\r?\n/);
  for (let number = 0; number < lines.length; number += 1) {
    const stripped = stripPythonLine(lines[number], state);
    if (!stripped.trim()) continue;
    if (/(?:^|[^\w.])(?:importlib|__import__)\b/.test(stripped)) dynamic += 1;
    const plain = stripped.match(/^\s*import\s+([\w.][\w.,\s]*?)(?:\s*$)/);
    if (plain) {
      for (const part of plain[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(name)) statements.push({ line: number + 1, spec: name, relativeLevel: 0 });
      }
      continue;
    }
    const from = stripped.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/);
    if (from) {
      const names = from[3].includes('(') || from[3].includes('*') ? []
        : from[3].split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter((name) => /^\w+$/.test(name));
      statements.push({ line: number + 1, spec: from[2] || '', relativeLevel: from[1].length, names });
    }
  }
  return { statements, dynamic };
}

// Python import names are relative to a source root, not to the repository.
// A source root is the parent of an outermost regular package (a directory
// with __init__.py and no package above it), plus the repository root. Every
// file below a root is importable relative to it, whether or not the
// directories in between have __init__.py: PEP 420 namespace subpackages
// (for example sglang/srt/ without __init__.py) are importable too, so
// walking only the __init__.py chain would stop at the first namespace
// directory and misattribute every deeper import to the package root.
function pythonSourceRoots(packages) {
  const roots = new Set(['']);
  for (const directory of packages) {
    let ancestor = posixDirname(directory);
    let nested = false;
    while (ancestor) {
      if (packages.has(ancestor)) { nested = true; break; }
      ancestor = posixDirname(ancestor);
    }
    if (!nested) roots.add(posixDirname(directory));
  }
  // Deepest roots first: a name relative to a package root is the canonical
  // import name and wins collisions with repository-relative names.
  return [...roots].sort((left, right) => right.split('/').length - left.split('/').length
    || (right.length - left.length) || left.localeCompare(right));
}

function dottedFromRoot(filePath, root) {
  const relative = (root ? filePath.slice(root.length + 1) : filePath).replace(/\.pyw?$/, '');
  return relative.split('/').join('.').replace(/(?:^|\.)__init__$/, '');
}

function isUnder(filePath, root) {
  return !root || filePath.startsWith(`${root}/`);
}

function pythonDottedName(filePath, python) {
  const root = python.roots.find((candidate) => isUnder(filePath, candidate)) ?? '';
  return dottedFromRoot(filePath, root);
}

function buildPythonIndex(records) {
  const packages = new Set(records
    .filter((record) => path.posix.basename(record.path) === '__init__.py')
    .map((record) => posixDirname(record.path)));
  const roots = pythonSourceRoots(packages);
  const index = new Map();
  const topLevel = new Set();
  const pythonRecords = records.filter((record) => record.language === 'python')
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const root of roots) {
    for (const record of pythonRecords) {
      if (!isUnder(record.path, root)) continue;
      const dotted = dottedFromRoot(record.path, root);
      if (!dotted) continue;
      if (!index.has(dotted)) index.set(dotted, record.path);
      // Namespace directories are importable names even without a file.
      const segments = dotted.split('.');
      topLevel.add(segments[0]);
    }
  }
  return { index, packages, roots, topLevel };
}

function resolvePython(statement, fromPath, python) {
  let spec = statement.spec;
  if (statement.relativeLevel > 0) {
    const fromDotted = pythonDottedName(fromPath, python);
    const segments = fromDotted.split('.');
    const isInit = path.posix.basename(fromPath).startsWith('__init__.');
    const packageSegments = isInit ? segments : segments.slice(0, -1);
    const base = packageSegments.slice(0, packageSegments.length - (statement.relativeLevel - 1));
    if (!base.length) return [{ kind: 'unknown', name: `${'.'.repeat(statement.relativeLevel)}${spec}` }];
    spec = spec ? `${base.join('.')}.${spec}` : base.join('.');
  }
  // "from X import a, b" imports the submodules X.a and X.b when they exist;
  // names that are plain symbols fall back to one resolution of X itself.
  if (statement.names?.length) {
    const hits = statement.names
      .map((name) => python.index.get(`${spec}.${name}`))
      .filter(Boolean)
      .map((hit) => ({ kind: 'internal', path: hit }));
    if (hits.length) return hits;
  }
  const segments = spec.split('.');
  // A script's own directory is on sys.path, so `import utils` next to a
  // sibling utils.py resolves locally. Try that exact name first for
  // absolute imports, before falling back to shorter package prefixes.
  if (statement.relativeLevel === 0) {
    const directory = posixDirname(fromPath);
    const sibling = python.index.get(dottedFromRoot(`${directory ? `${directory}/` : ''}${segments.join('/')}.py`, ''));
    const isStdlib = PYTHON_STDLIB.has(segments[0]);
    if (sibling && (isStdlib || !python.index.has(spec))) return [{ kind: 'internal', path: sibling }];
    // A stdlib name only resolves locally when it shadows a sibling; a
    // same-named package elsewhere is not on this file's import path.
    if (isStdlib) return [{ kind: 'stdlib', name: segments[0] }];
  }
  for (let take = segments.length; take >= 1; take -= 1) {
    const candidate = segments.slice(0, take).join('.');
    const hit = python.index.get(candidate);
    if (hit) return [{ kind: 'internal', path: hit }];
  }
  // Unresolved standard-library names stay stdlib even if some directory in
  // the repository happens to share the name.
  if (statement.relativeLevel === 0 && PYTHON_STDLIB.has(segments[0])) return [{ kind: 'stdlib', name: segments[0] }];
  if (statement.relativeLevel > 0 || python.topLevel.has(segments[0])) return [{ kind: 'unknown', name: spec }];
  return [{ kind: 'external', name: segments[0] }];
}

// --- JavaScript / TypeScript ------------------------------------------------

// Removes // and /* */ comments while tracking open block comments and open
// template literals across lines. String contents are kept: the specifier the
// scanner needs lives inside quotes.
function stripJsLine(line, state) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < line.length) {
    const character = line[index];
    if (state.block) {
      const close = line.indexOf('*/', index);
      if (close === -1) return out;
      index = close + 2;
      state.block = false;
      continue;
    }
    if (state.template) {
      if (character === '\\') { out += line.slice(index, index + 2); index += 2; continue; }
      if (character === '`') state.template = false;
      out += character;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === '\\') { out += line.slice(index, index + 2); index += 2; continue; }
      if (character === quote) quote = null;
      out += character;
      index += 1;
      continue;
    }
    if (character === '/' && line[index + 1] === '/') break;
    if (character === '/' && line[index + 1] === '*') { state.block = true; index += 2; continue; }
    if (character === '`') { state.template = true; out += character; index += 1; continue; }
    if (character === '"' || character === "'") { quote = character; out += character; index += 1; continue; }
    out += character;
    index += 1;
  }
  return out;
}

const JS_IMPORT_PATTERNS = [
  /\bimport\s+[^'"();]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function scanJs(text) {
  const statements = [];
  let dynamic = 0;
  const state = { block: false, template: false };
  const lines = text.split(/\r?\n/);
  const strippedLines = lines.map((line) => stripJsLine(line, state));
  for (let number = 0; number < strippedLines.length; number += 1) {
    const stripped = strippedLines[number];
    if (!stripped.trim()) continue;
    const seen = new Set();
    // Named imports and re-exports often put the `from` clause on a later
    // line. Bound the window so an unfinished statement cannot consume the
    // rest of a large source file.
    const multiline = /\b(?:import|export)\s+(?:type\s+)?(?:\{|\*(?:\s+as\b)?)/.test(stripped)
      && !/\bfrom\s*['"]/.test(stripped);
    let candidate = multiline ? strippedLines.slice(number, number + 12).join('\n').slice(0, 2048) : stripped;
    if (multiline) {
      const from = /\bfrom\s*['"][^'"]+['"]/.exec(candidate);
      if (from) candidate = candidate.slice(0, from.index + from[0].length);
      const semicolon = candidate.indexOf(';');
      if (semicolon !== -1) candidate = candidate.slice(0, semicolon + 1);
    }
    for (const pattern of JS_IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of candidate.matchAll(pattern)) {
        const spec = match[1];
        if (!seen.has(spec)) {
          seen.add(spec);
          statements.push({ line: number + 1, spec });
        }
      }
    }
    if (/\bimport\s*\(\s*[^'")\s]/.test(stripped) || /\brequire\s*\(\s*[^'")\s]/.test(stripped)) dynamic += 1;
  }
  return { statements, dynamic };
}

function resolveJs(statement, fromPath, fileSet) {
  const spec = statement.spec;
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    const base = path.posix.normalize(path.posix.join(posixDirname(fromPath), spec));
    if (base.startsWith('..')) return { kind: 'unknown', name: spec };
    const typescriptCounterparts = /\.jsx?$/.test(base)
      ? [base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx')]
      : /\.mjs$/.test(base) ? [base.replace(/\.mjs$/, '.mts')]
        : /\.cjs$/.test(base) ? [base.replace(/\.cjs$/, '.cts')] : [];
    const candidates = [base,
      ...typescriptCounterparts,
      ...JS_EXTENSIONS.map((extension) => base + extension),
      ...JS_EXTENSIONS.map((extension) => `${base}/index${extension}`)];
    for (const candidate of candidates) {
      if (fileSet.has(candidate)) return { kind: 'internal', path: candidate };
    }
    return { kind: 'unknown', name: spec };
  }
  if (/^[#@~]/.test(spec) && !/^@[\w-]+\//.test(spec)) return { kind: 'unknown', name: spec };
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0])) return { kind: 'stdlib', name: spec.replace(/^node:/, '').split('/')[0] };
  const bare = spec.split('/');
  return { kind: 'external', name: spec.startsWith('@') ? bare.slice(0, 2).join('/') : bare[0] };
}

// --- HTTP route contracts ------------------------------------------------------
// Services in different languages connect over HTTP, not imports: a Rust
// gateway forwards to "/generate", which a Python server declares with
// @app.post("/generate"). Route declarations in scanned languages and route
// strings in every source file give a static, file:line-evidenced link that
// the import graph cannot see. Generic health/metrics routes are ignored, and
// a module pair needs several distinct shared routes before it counts.
const GENERIC_ROUTES = new Set(['/', '/health', '/healthz', '/health_check', '/ready', '/readyz', '/readiness',
  '/live', '/livez', '/liveness', '/metrics', '/status', '/ping', '/version', '/docs', '/redoc', '/openapi.json',
  '/favicon.ico', '/login', '/logout', '/api', '/v1', '/v2', '/index.html', '/static']);
const PYTHON_ROUTE = /@\w+(?:\.\w+)*\.(?:get|post|put|delete|patch|api_route|route|websocket)\(\s*["'](\/[^"'\s]*)["']/g;
const JS_ROUTE = /\b\w+\.(?:get|post|put|delete|patch|all|route)\(\s*['"`](\/[^'"`\s]*)['"`]/g;
const MINIMUM_SHARED_ROUTES = 2;

function usableRoute(route) {
  const normalized = route.length > 1 ? route.replace(/\/+$/, '') : route;
  if (GENERIC_ROUTES.has(normalized) || /[{}:<>*]/.test(normalized)) return null;
  return normalized.length > 2 ? normalized : null;
}

function routeDeclarations(text, language) {
  const pattern = language === 'python' ? PYTHON_ROUTE : JS_ROUTE;
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let number = 0; number < lines.length; number += 1) {
    pattern.lastIndex = 0;
    for (const match of lines[number].matchAll(pattern)) {
      const route = usableRoute(match[1]);
      if (route) found.push({ route, line: number + 1 });
    }
  }
  return found;
}

// The path part of a string literal: "/generate", "{}/generate",
// f"{base}/generate", "http://host:30000/generate?x=1" all yield /generate.
function routeLiterals(text) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let number = 0; number < lines.length; number += 1) {
    const line = lines[number];
    if (!line.includes('/')) continue;
    for (const match of line.matchAll(/["'`]([^"'`\n]{2,200})["'`]/g)) {
      let value = match[1];
      const scheme = value.indexOf('://');
      if (scheme !== -1) {
        const slash = value.indexOf('/', scheme + 3);
        if (slash === -1) continue;
        value = value.slice(slash);
      } else if (value.includes('}')) {
        value = value.slice(value.lastIndexOf('}') + 1);
      }
      value = value.split('?')[0];
      if (!value.startsWith('/')) continue;
      const route = usableRoute(value);
      if (route) found.push({ route, line: number + 1 });
    }
  }
  return found;
}

// --- Runtime channels ---------------------------------------------------------
// Imports show which code depends on which; they cannot show a process that
// spawns another, a browser that opens a WebSocket, or a CLI that calls an HTTP
// API. These call sites are the runtime links a diagram of the system needs, so
// Level 2 records where each module opens one. Comment lines and lines that
// look like credentials are skipped; only one trimmed line is kept per channel.
const RUNTIME_CHANNELS = [
  ['process-spawn', {
    javascript: /(?:^|[^.\w$])(?:spawn|spawnSync|exec|execFile|execFileSync|execSync|fork)\s*\(|\b(?:child_process|childProcess|cp|pty|nodePty)\.(?:spawn|spawnSync|exec|execSync|execFile|fork)\s*\(/,
    python: /\bsubprocess\.(?:Popen|run|call|check_call|check_output)\s*\(|\bos\.(?:system|popen|exec\w*)\s*\(|\basyncio\.create_subprocess_(?:exec|shell)\s*\(|\b(?:multiprocessing|mp|ctx|mp_ctx)\.Process\s*\(|\.get_context\([^)]*\)\.Process\s*\(|(?:^|[^.\w])Process\s*\(\s*target\s*=/,
  }],
  // Processes that talk through a broker or socket library instead of HTTP:
  // ZeroMQ socket types, multiprocessing queues and pipes, Redis, Kafka,
  // AMQP and NATS clients.
  ['message-queue', {
    javascript: /\bzmq\.(?:PUSH|PULL|PUB|SUB|XPUB|XSUB|REQ|REP|DEALER|ROUTER|PAIR)\b|\bnew\s+zmq\.(?:Push|Pull|Publisher|Subscriber|Request|Reply|Dealer|Router|Pair)\s*\(|\bnew\s+(?:Redis|IORedis)\s*\(|\bkafka\.(?:producer|consumer)\s*\(|\bamqp\.connect\s*\(|\bnats\.connect\s*\(/,
    python: /\bzmq\.(?:PUSH|PULL|PUB|SUB|XPUB|XSUB|REQ|REP|DEALER|ROUTER|PAIR)\b|\b(?:multiprocessing|mp|ctx|mp_ctx)\.(?:Queue|SimpleQueue|JoinableQueue|Pipe)\s*\(|\bredis\.(?:asyncio\.)?(?:Redis|StrictRedis|from_url)\s*\(|\bKafka(?:Producer|Consumer)\s*\(|\bpika\.(?:Blocking|Select)Connection\s*\(|\bnats\.connect\s*\(/,
  }],
  ['grpc-server', {
    javascript: /\bnew\s+grpc\.Server\s*\(/,
    python: /\bgrpc\.(?:aio\.)?server\s*\(/,
  }],
  ['grpc-client', {
    javascript: /\bnew\s+\w+\s*\([^)]*grpc\.credentials\.|\bgrpc\.(?:makeGenericClientConstructor|loadPackageDefinition)\s*\(/,
    python: /\bgrpc\.(?:aio\.)?(?:insecure|secure)_channel\s*\(/,
  }],
  ['websocket-server', {
    javascript: /\bnew\s+(?:WebSocketServer|WebSocket\.Server)\s*\(|\.handleUpgrade\s*\(/,
    python: /@\w+(?:\.\w+)*\.websocket\s*\(|\bwebsockets\.serve\s*\(/,
  }],
  ['websocket-client', {
    javascript: /\bnew\s+WebSocket\s*\(/,
    python: /\bwebsockets\.connect\s*\(|\bws_connect\s*\(/,
  }],
  ['http-server', {
    javascript: /\b(?:https?|http2|net)\.createServer\s*\(|(?:^|[^.\w$])createServer\s*\(|\b(?:app|server|fastify)\.listen\s*\(/,
    python: /\buvicorn\.run\s*\(|\bapp\.run\s*\(|\bweb\.run_app\s*\(|\b(?:ThreadingHTTPServer|HTTPServer)\s*\(/,
  }],
  ['http-client', {
    javascript: /(?:^|[^.\w$])fetch\s*\(|\baxios(?:\.\w+)?\s*\(|\bhttps?\.(?:request|get)\s*\(/,
    python: /\brequests\.(?:get|post|put|delete|patch|request)\s*\(|\bhttpx\.(?:get|post|put|delete|request|AsyncClient|Client)\b|\baiohttp\.ClientSession\s*\(|\burlopen\s*\(/,
  }],
  ['worker-thread', {
    javascript: /\bnew\s+Worker\s*\(/,
    python: /\bProcessPoolExecutor\s*\(/,
  }],
];
const MAXIMUM_CHANNEL_LINE = 120;
const CHANNEL_EXCERPT_LINES = 3;
const CHANNEL_TARGETS = 4;

function runtimeChannels(text, language) {
  const family = language === 'python' ? 'python' : 'javascript';
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let number = 0; number < lines.length; number += 1) {
    const line = lines[number];
    const trimmed = line.trim();
    if (!trimmed || /^(?:#|\/\/|\*|\/\*)/.test(trimmed) || safeSourceLine(line) === null) continue;
    for (const [kind, patterns] of RUNTIME_CHANNELS) {
      if (!patterns[family].test(line)) continue;
      // The call and the lines right after it usually name the peer: the
      // command, URL or path an argument list carries on the next lines.
      const excerpt = [];
      for (let next = number; next < lines.length && excerpt.length < CHANNEL_EXCERPT_LINES; next += 1) {
        const text = lines[next].trim();
        const safe = safeSourceLine(text);
        if (!text || /^(?:#|\/\/|\*|\/\*)/.test(text) || safe === null) continue;
        excerpt.push(`${next + 1}: ${safe.length > MAXIMUM_CHANNEL_LINE ? `${safe.slice(0, MAXIMUM_CHANNEL_LINE)}...` : safe}`);
      }
      const window = lines.slice(number, number + CHANNEL_EXCERPT_LINES + 1).join(' ');
      const processTarget = kind === 'process-spawn' ? /\btarget\s*=\s*([\w.]+)/.exec(window) : null;
      const target = (kind === 'process-spawn' && (processTarget
          || /(?:spawn\w*|fork|execFile\w*|exec\w*|Popen|run|check_output|check_call|call)\s*\(\s*\[?\s*['"\x60]([^'"\x60\s]{1,80})/.exec(window)))
        || (kind === 'message-queue' && /\bzmq\.(PUSH|PULL|PUB|SUB|XPUB|XSUB|REQ|REP|DEALER|ROUTER|PAIR)\s*,\s*([\w.]{1,80})/.exec(window))
        || (kind === 'grpc-client' && /_channel\s*\(\s*([^),]{1,80})/.exec(window));
      const named = target ? target.slice(1).filter(Boolean).join(' ') : null;
      const safeTarget = named ? safeSourceLine(named) : null;
      found.push({ kind, line: number + 1, excerpt, ...(safeTarget ? { target: safeTarget } : {}), ...(processTarget ? { processTarget: true } : {}) });
    }
  }
  return found;
}

// --- Graph assembly ---------------------------------------------------------

// A repository whose source lives under one package (for example
// python/<package>/...) collapses into a single directory module, which makes
// an import graph useless exactly where it matters. When one module dominates
// the source inventory it is split one directory deeper, up to three rounds,
// so subsystem edges become visible without changing global module naming.
function refineModuleMap(sourceRecords) {
  const effective = new Map(sourceRecords.map((record) => [record.path, record.modulePath]));
  for (let round = 0; round < 3; round += 1) {
    const counts = new Map();
    for (const record of sourceRecords) {
      const module = effective.get(record.path);
      counts.set(module, (counts.get(module) || 0) + 1);
    }
    let changed = false;
    for (const record of sourceRecords) {
      const module = effective.get(record.path);
      const count = counts.get(module);
      if (count < 30 || count < sourceRecords.length * 0.4) continue;
      const rest = record.path.slice(module === '.' ? 0 : module.length + 1);
      const segments = rest.split('/');
      if (segments.length >= 2) {
        effective.set(record.path, `${module === '.' ? '' : `${module}/`}${segments[0]}`);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return effective;
}

function roundRobinByModule(records) {
  const byModule = new Map();
  for (const record of records) {
    const queue = byModule.get(record.modulePath) || [];
    queue.push(record);
    byModule.set(record.modulePath, queue);
  }
  const queues = [...byModule.keys()].sort().map((key) => byModule.get(key).sort((left, right) => left.path.localeCompare(right.path)));
  const ordered = [];
  for (let offset = 0; ; offset += 1) {
    let appended = false;
    for (const queue of queues) {
      if (offset < queue.length) { ordered.push(queue[offset]); appended = true; }
    }
    if (!appended) return ordered;
  }
}

export function buildSourceLevel2(root, records, options = {}) {
  const limits = { ...LEVEL2_DEFAULT_LIMITS, ...(options.limits || {}) };
  const sourceRecords = records.filter((record) => record.role === 'source');
  const scannable = sourceRecords.filter((record) => SCANNABLE_LANGUAGES.has(record.language));
  const testRecords = records.filter((record) => record.role === 'test' && SCANNABLE_LANGUAGES.has(record.language));

  const effectiveModule = refineModuleMap(sourceRecords);
  const unscannedByLanguage = {};
  const unscannedByModule = new Map();
  for (const record of sourceRecords) {
    if (SCANNABLE_LANGUAGES.has(record.language)) continue;
    unscannedByLanguage[record.language] = (unscannedByLanguage[record.language] || 0) + 1;
    const module = effectiveModule.get(record.path) || record.modulePath;
    const perModule = unscannedByModule.get(module) || {};
    perModule[record.language] = (perModule[record.language] || 0) + 1;
    unscannedByModule.set(module, perModule);
  }

  const python = buildPythonIndex(records.filter((record) => record.role === 'source' || record.role === 'test'));
  const fileSet = new Set(records.map((record) => record.path));
  // Root-level source files usually mix an orchestrator (main.py) with
  // files everything imports (config.py). One "." module merges a pure
  // consumer and a shared provider and shows every module in a false two-way
  // cycle with the root, so a small root is split into one module per file.
  const rootSources = scannable.filter((record) => (effectiveModule.get(record.path) || record.modulePath) === '.');
  const splitRoot = rootSources.length > 1 && rootSources.length <= 8;
  const splitRootPaths = new Set(splitRoot ? rootSources.map((record) => record.path) : []);
  // Refinement is computed from source files, but tests and other files under
  // a refined subpackage belong to it too; otherwise a package root collects
  // every nested test file and looks like a test module.
  const refinedModules = new Set(effectiveModule.values());
  const refinedModuleOf = (record) => {
    const direct = effectiveModule.get(record.path);
    if (direct) return direct;
    for (let directory = posixDirname(record.path); directory && directory !== record.modulePath; directory = posixDirname(directory)) {
      if (refinedModules.has(directory)) return directory;
    }
    return record.modulePath;
  };
  const moduleOf = new Map(records.map((record) => [record.path,
    splitRootPaths.has(record.path) ? record.path : refinedModuleOf(record)]));

  const ordered = roundRobinByModule(scannable.map((record) => ({ ...record, modulePath: moduleOf.get(record.path) || record.modulePath })));
  const page = ordered.slice(0, limits.maximumFiles);
  const truncated = ordered.length > page.length;

  let scannedFiles = 0;
  let scannedBytes = 0;
  const scannedRecords = [];
  const routeProviders = [];
  const routeLiteralSites = [];
  const channelSites = [];
  let stoppedByTotalBytes = false;
  let oversized = 0;
  let unreadable = 0;
  const unresolved = { stdlib: 0, external: 0, dynamic: 0, unknown: 0 };
  const unknownCounts = new Map();
  const externalCounts = new Map();
  const fileEdges = [];
  const moduleEdges = new Map();

  const recordEdge = (fromRecord, statement, resolution) => {
    if (resolution.kind === 'stdlib') { unresolved.stdlib += 1; return; }
    if (resolution.kind === 'external') {
      unresolved.external += 1;
      const entry = externalCounts.get(resolution.name) || { count: 0, example: { file: fromRecord.path, line: statement.line } };
      entry.count += 1;
      externalCounts.set(resolution.name, entry);
      return;
    }
    if (resolution.kind === 'unknown') {
      unresolved.unknown += 1;
      const entry = unknownCounts.get(resolution.name) || { count: 0, example: { file: fromRecord.path, line: statement.line } };
      entry.count += 1;
      unknownCounts.set(resolution.name, entry);
      return;
    }
    fileEdges.push({ from: fromRecord.path, to: resolution.path, line: statement.line });
    const fromModule = moduleOf.get(fromRecord.path) || fromRecord.modulePath;
    const toModule = moduleOf.get(resolution.path);
    if (!toModule || toModule === fromModule) return;
    const key = `${fromModule}\u0000${toModule}`;
    const edge = moduleEdges.get(key) || { from: fromModule, to: toModule, weight: 0, evidence: [] };
    edge.weight += 1;
    if (edge.evidence.length < limits.maximumEdgeEvidence) {
      edge.evidence.push({ file: fromRecord.path, line: statement.line, to: resolution.path });
    }
    moduleEdges.set(key, edge);
  };

  for (const record of page) {
    if (record.size > limits.maximumBytesPerFile) { oversized += 1; continue; }
    if (scannedBytes + record.size > limits.maximumTotalBytes) { stoppedByTotalBytes = true; break; }
    let content;
    try {
      content = readPrefix(path.resolve(root, ...record.path.split('/')), limits.maximumBytesPerFile);
    } catch {
      unreadable += 1;
      continue;
    }
    scannedFiles += 1;
    scannedBytes += content.bytes;
    scannedRecords.push(record);
    for (const declaration of routeDeclarations(content.text, record.language)) {
      routeProviders.push({ ...declaration, file: record.path, module: moduleOf.get(record.path) || record.modulePath });
    }
    routeLiteralSites.push(...routeLiterals(content.text).map((site) => ({ ...site, file: record.path })));
    for (const channel of record.role === 'test' || record.role === 'documentation' ? [] : runtimeChannels(content.text, record.language)) {
      channelSites.push({ ...channel, file: record.path, module: moduleOf.get(record.path) || record.modulePath });
    }
    const scan = record.language === 'python' ? scanPython(content.text) : scanJs(content.text);
    unresolved.dynamic += scan.dynamic;
    for (const statement of scan.statements) {
      const resolutions = record.language === 'python'
        ? resolvePython(statement, record.path, python)
        : [resolveJs(statement, record.path, fileSet)];
      for (const resolution of resolutions) recordEdge(record, statement, resolution);
    }
  }

  // Route strings in languages the import scan cannot read (Rust, Go, ...)
  // are the only static trace of their HTTP clients, so those files are read
  // too, within the same byte budget.
  let contractBytes = 0;
  if (routeProviders.length) {
    for (const record of sourceRecords) {
      if (SCANNABLE_LANGUAGES.has(record.language) || record.size > limits.maximumBytesPerFile) continue;
      if (scannedBytes + contractBytes + record.size > limits.maximumTotalBytes) break;
      try {
        const content = readPrefix(path.resolve(root, ...record.path.split('/')), limits.maximumBytesPerFile);
        contractBytes += content.bytes;
        routeLiteralSites.push(...routeLiterals(content.text).map((site) => ({ ...site, file: record.path })));
      } catch { /* unreadable files only lose optional contract evidence */ }
    }
  }
  const providerByRoute = new Map();
  for (const provider of routeProviders.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)) {
    const list = providerByRoute.get(provider.route) || [];
    list.push(provider);
    providerByRoute.set(provider.route, list);
  }
  const declaredAt = new Set(routeProviders.map((provider) => `${provider.file}\u0000${provider.line}`));
  const contractPairs = new Map();
  for (const site of routeLiteralSites.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)) {
    const providers = providerByRoute.get(site.route);
    if (!providers || declaredAt.has(`${site.file}\u0000${site.line}`)) continue;
    const fromModule = moduleOf.get(site.file);
    for (const provider of providers) {
      if (!fromModule || fromModule === provider.module) continue;
      const key = `${fromModule}\u0000${provider.module}`;
      const pair = contractPairs.get(key) || { from: fromModule, to: provider.module, routes: new Map() };
      if (!pair.routes.has(site.route)) pair.routes.set(site.route, { file: site.file, line: site.line, to: `${provider.file}:${provider.line}` });
      contractPairs.set(key, pair);
    }
  }
  // Route references are candidates, not edges: a string match shows that a
  // module names a route another module serves, not that it calls it. A route
  // many modules mention (/generate) says little about any one pair, so each
  // shared route counts 1/spread, where spread is how many modules reference
  // it. The consumer of these facts (the diagram author) judges them.
  const spread = new Map();
  for (const pair of contractPairs.values()) {
    for (const route of pair.routes.keys()) {
      const modules = spread.get(route) || new Set();
      modules.add(pair.from);
      spread.set(route, modules);
    }
  }
  const routeReferences = [...contractPairs.values()]
    .filter((pair) => pair.routes.size >= MINIMUM_SHARED_ROUTES)
    .map((pair) => {
      const routes = [...pair.routes.entries()]
        .sort(([left], [right]) => spread.get(left).size - spread.get(right).size || left.localeCompare(right));
      const specificity = routes.reduce((total, [route]) => total + 1 / spread.get(route).size, 0);
      return {
        from: pair.from,
        to: pair.to,
        shared: routes.length,
        specificity: Math.round(specificity * 100) / 100,
        routes: routes.slice(0, limits.maximumEdgeEvidence).map(([route]) => route),
        evidence: routes.slice(0, limits.maximumEdgeEvidence).map(([, site]) => ({ file: site.file, line: site.line, to: site.to })),
      };
    })
    .sort((left, right) => right.specificity - left.specificity || right.shared - left.shared
      || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  const routeProviderSummary = [...routeProviders.reduce((byModule, provider) => {
    const entry = byModule.get(provider.module) || { module: provider.module, routes: new Set(), anchor: `${provider.file}:${provider.line}` };
    entry.routes.add(provider.route);
    return byModule.set(provider.module, entry);
  }, new Map()).values()]
    .map((entry) => ({ module: entry.module, routes: entry.routes.size, sample: [...entry.routes].sort().slice(0, 3), anchor: entry.anchor }))
    .sort((left, right) => right.routes - left.routes || left.module.localeCompare(right.module));

  // One entry per module and channel kind: how often the module opens that kind
  // of channel and the first site, so the author can read one anchor.
  const channelSummary = [...channelSites
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
    .reduce((byKey, site) => {
      const key = `${site.module}\u0000${site.kind}`;
      const entry = byKey.get(key) || { module: site.module, kind: site.kind, count: 0, processTargets: 0, files: new Set(), targets: new Set(), anchor: `${site.file}:${site.line}`, excerpt: site.excerpt };
      entry.count += 1;
      if (site.processTarget) entry.processTargets += 1;
      entry.files.add(site.file);
      if (site.target && entry.targets.size < CHANNEL_TARGETS) entry.targets.add(site.target);
      return byKey.set(key, entry);
    }, new Map()).values()]
    .map(({ files, targets, ...entry }) => ({ ...entry, files: files.size, ...(targets.size ? { targets: [...targets] } : {}) }))
    .sort((left, right) => left.module.localeCompare(right.module) || left.kind.localeCompare(right.kind));

  const edges = [...moduleEdges.values()]
    .sort((left, right) => right.weight - left.weight
      || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  for (const edge of edges) edge.evidence.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

  const fanIn = new Map();
  const fanOut = new Map();
  for (const edge of edges) {
    fanOut.set(edge.from, (fanOut.get(edge.from) || 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) || 0) + 1);
  }

  const moduleStats = new Map();
  for (const record of records) {
    const modulePath = moduleOf.get(record.path) || record.modulePath;
    const stats = moduleStats.get(modulePath) || {
      path: modulePath, files: 0, scannedFiles: 0, bytes: 0, languages: {}, roles: {}, entrypoints: [],
    };
    stats.files += 1;
    stats.roles[record.role] = (stats.roles[record.role] || 0) + 1;
    if (record.language) stats.languages[record.language] = (stats.languages[record.language] || 0) + 1;
    if (record.entrypoint && stats.entrypoints.length < 3) stats.entrypoints.push(record.path);
    moduleStats.set(modulePath, stats);
  }
  for (const record of scannedRecords) {
    const stats = moduleStats.get(moduleOf.get(record.path) || record.modulePath);

    if (stats) {
      stats.scannedFiles += 1;
      stats.bytes += record.size;
    }
  }
  const modules = [...moduleStats.values()]
    .map((stats) => ({
      ...stats,
      languages: Object.fromEntries(Object.entries(stats.languages).sort(([left], [right]) => left.localeCompare(right))),
      roles: Object.fromEntries(Object.entries(stats.roles).sort(([left], [right]) => left.localeCompare(right))),
      entrypoints: stats.entrypoints.sort(),
      unscannedLanguages: unscannedByModule.get(stats.path) || {},
      fanIn: fanIn.get(stats.path) || 0,
      fanOut: fanOut.get(stats.path) || 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const rankCounts = (counts) => [...counts.entries()]
    .map(([name, entry]) => ({ name, count: entry.count, example: entry.example }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limits.maximumUnknownImports);
  const topUnknown = rankCounts(unknownCounts);
  const topExternal = rankCounts(externalCounts);

  fileEdges.sort((left, right) => left.from.localeCompare(right.from) || left.line - right.line || left.to.localeCompare(right.to));

  return {
    name: 'source-import-graph',
    sourceBodiesIncluded: true,
    limits,
    scannedFiles,
    scannedBytes,
    candidateFiles: scannable.length,
    truncated: truncated || stoppedByTotalBytes,
    skipped: { tests: testRecords.length, oversized, unreadable },
    unscanned: {
      files: sourceRecords.length - scannable.length,
      byLanguage: Object.fromEntries(Object.entries(unscannedByLanguage).sort(([left], [right]) => left.localeCompare(right))),
    },
    unresolved: { ...unresolved, topUnknown, topExternal },
    modules,
    edges,
    routeProviders: routeProviderSummary,
    routeReferences,
    runtimeChannels: channelSummary,
    fileEdges,
  };
}
