// Deterministic repository scan: Python and JavaScript/TypeScript import graphs
// become a draft Archify architecture document.
//
// The scan reads static imports only. It never executes project code, never
// infers runtime causality beyond "module A imports module B", and labels the
// result as a draft for an author to refine. Identical input trees always
// produce identical JSON, so drafts can be compared across revisions.

import fs from 'node:fs';
import path from 'node:path';

const PYTHON_EXTENSIONS = new Set(['.py']);
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache',
  '.pytest_cache', 'dist', 'build', 'coverage', '.next', '.nuxt', 'out', 'vendor', 'site-packages',
  'test', 'tests', '__tests__', 'spec', 'fixtures', 'storage', 'data', '.archify',
]);
const FRONTEND_DIRECTORIES = new Set(['static', 'public', 'templates', 'frontend', 'web', 'client']);
const TEST_FILE = /(^test_.*\.py$|_test\.py$|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$)/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 5000;

export const MAX_MODULE_NODES = 20;
export const HUB_THRESHOLD = 3;

// Library → service node. Keys match a Python module root or an npm package name.
export const SERVICE_LIBRARIES = {
  chromadb: ['svc-chroma', 'database', 'Chroma', 'vector DB'],
  sqlmodel: ['svc-sql', 'database', 'SQL database', 'SQLModel'],
  sqlalchemy: ['svc-sql', 'database', 'SQL database', 'SQLAlchemy'],
  sqlite3: ['svc-sql', 'database', 'SQL database', 'sqlite3'],
  'better-sqlite3': ['svc-sql', 'database', 'SQL database', 'better-sqlite3'],
  psycopg: ['svc-postgres', 'database', 'PostgreSQL', 'psycopg'],
  psycopg2: ['svc-postgres', 'database', 'PostgreSQL', 'psycopg2'],
  asyncpg: ['svc-postgres', 'database', 'PostgreSQL', 'asyncpg'],
  pg: ['svc-postgres', 'database', 'PostgreSQL', 'pg'],
  postgres: ['svc-postgres', 'database', 'PostgreSQL', 'postgres'],
  '@prisma/client': ['svc-sql', 'database', 'SQL database', 'Prisma'],
  'drizzle-orm': ['svc-sql', 'database', 'SQL database', 'Drizzle'],
  mysql2: ['svc-mysql', 'database', 'MySQL', 'mysql2'],
  pymysql: ['svc-mysql', 'database', 'MySQL', 'PyMySQL'],
  pymongo: ['svc-mongo', 'database', 'MongoDB', 'pymongo'],
  motor: ['svc-mongo', 'database', 'MongoDB', 'motor'],
  mongodb: ['svc-mongo', 'database', 'MongoDB', 'mongodb'],
  mongoose: ['svc-mongo', 'database', 'MongoDB', 'mongoose'],
  redis: ['svc-redis', 'database', 'Redis', 'cache'],
  ioredis: ['svc-redis', 'database', 'Redis', 'cache'],
  elasticsearch: ['svc-search', 'database', 'Elasticsearch', 'search'],
  '@elastic/elasticsearch': ['svc-search', 'database', 'Elasticsearch', 'search'],
  openai: ['svc-openai', 'external', 'OpenAI-compatible API', 'openai'],
  anthropic: ['svc-claude', 'external', 'Claude API', 'anthropic'],
  '@anthropic-ai/sdk': ['svc-claude', 'external', 'Claude API', '@anthropic-ai/sdk'],
  'google.genai': ['svc-gemini', 'external', 'Gemini API', 'google-genai'],
  'google.generativeai': ['svc-gemini', 'external', 'Gemini API', 'google-generativeai'],
  '@google/genai': ['svc-gemini', 'external', 'Gemini API', '@google/genai'],
  '@google/generative-ai': ['svc-gemini', 'external', 'Gemini API', '@google/generative-ai'],
  duckduckgo_search: ['svc-websearch', 'external', 'DuckDuckGo', 'web search'],
  ddgs: ['svc-websearch', 'external', 'DuckDuckGo', 'web search'],
  sentence_transformers: ['svc-local-model', 'external', 'Local embedding model', 'sentence-transformers'],
  stripe: ['svc-stripe', 'external', 'Stripe', 'payments'],
  boto3: ['svc-aws', 'cloud', 'AWS', 'boto3'],
  '@aws-sdk/client-s3': ['svc-aws', 'cloud', 'AWS', 'S3 client'],
  'firebase-admin': ['svc-firebase', 'cloud', 'Firebase', 'firebase-admin'],
  '@supabase/supabase-js': ['svc-supabase', 'cloud', 'Supabase', 'supabase-js'],
  kafka: ['svc-kafka', 'messagebus', 'Kafka', 'events'],
  kafkajs: ['svc-kafka', 'messagebus', 'Kafka', 'events'],
  confluent_kafka: ['svc-kafka', 'messagebus', 'Kafka', 'events'],
  pika: ['svc-rabbitmq', 'messagebus', 'RabbitMQ', 'pika'],
  amqplib: ['svc-rabbitmq', 'messagebus', 'RabbitMQ', 'amqplib'],
  celery: ['svc-queue', 'messagebus', 'Task queue', 'Celery'],
  bullmq: ['svc-queue', 'messagebus', 'Task queue', 'BullMQ'],
};

export const WEB_FRAMEWORKS = {
  fastapi: 'FastAPI',
  flask: 'Flask',
  django: 'Django',
  starlette: 'Starlette',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  hono: 'Hono',
  '@nestjs/core': 'NestJS',
};

const NODE_W = 170;
const NODE_H = 60;
const COL_GAP = 130;
const ROW_GAP = 48;
const LANE_STEP = 10;
const ORIGIN_X = 40;
const ORIGIN_Y = 90;
const MAX_NODE_W = 300;
const LABEL_CHAR_W = 7.4;
const SUBLABEL_CHAR_W = 5.8;
const MAX_LABEL_CHARS = 36;

function fitText(text, limit = MAX_LABEL_CHARS) {
  const value = String(text);
  return value.length > limit ? `…${value.slice(value.length - limit + 1)}` : value;
}

function nodeWidth(node) {
  const label = Math.ceil(String(node.label).length * LABEL_CHAR_W) + 32;
  const sublabel = Math.ceil(String(node.sublabel || '').length * SUBLABEL_CHAR_W) + 32;
  const tag = Math.ceil(String(node.tag || '').length * SUBLABEL_CHAR_W) + 32;
  return Math.min(MAX_NODE_W, Math.max(NODE_W, label, sublabel, tag));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function listSourceFiles(root) {
  const python = [];
  const scripts = [];
  const frontend = [];
  const stack = [''];
  while (stack.length) {
    const relative = stack.pop();
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) stack.push(child);
        continue;
      }
      if (!entry.isFile() || TEST_FILE.test(entry.name)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const inFrontend = child.split('/').slice(0, -1).some((segment) => FRONTEND_DIRECTORIES.has(segment));
      if (inFrontend && (SCRIPT_EXTENSIONS.has(extension) || extension === '.html')) frontend.push(child);
      else if (PYTHON_EXTENSIONS.has(extension)) python.push(child);
      else if (SCRIPT_EXTENSIONS.has(extension)) scripts.push(child);
      if (python.length + scripts.length + frontend.length > MAX_FILES) {
        throw new Error(`scan stops at ${MAX_FILES} source files; point it at a smaller folder`);
      }
    }
  }
  return { python: python.sort(), scripts: scripts.sort(), frontend: frontend.sort() };
}

function readSource(root, relative) {
  const absolute = path.join(root, relative);
  if (fs.statSync(absolute).size > MAX_FILE_BYTES) return '';
  return fs.readFileSync(absolute, 'utf8');
}

// ---------------------------------------------------------------- Python

function pythonModuleName(relative) {
  const parts = relative.replace(/\.py$/, '').split('/');
  if (parts[parts.length - 1] === '__init__') parts.pop();
  return parts.join('.');
}

function stripPythonNoise(source) {
  // Drop comments and triple-quoted strings so docstrings mentioning "import" are ignored.
  return source
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .replace(/(^|[^\\])#.*$/gm, '$1');
}

function parsePython(relative, source, known) {
  const name = pythonModuleName(relative);
  const isPackage = relative.endsWith('/__init__.py') || relative === '__init__.py';
  const internal = new Set();
  const external = new Set();
  const text = stripPythonNoise(source);
  const resolveRelative = (level, target) => {
    const base = name.split('.');
    if (!isPackage) base.pop();
    for (let step = 1; step < level; step += 1) base.pop();
    return [...base, ...(target ? [target] : [])].filter(Boolean).join('.');
  };
  const add = (target) => {
    const candidates = [target, target.split('.').slice(0, -1).join('.')];
    const hit = candidates.find((candidate) => candidate && known.has(candidate));
    if (hit) {
      if (hit !== name) internal.add(hit);
    } else {
      external.add(target);
    }
  };
  for (const match of text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm)) {
    const level = match[1].length;
    const module = level ? resolveRelative(level, match[2]) : match[2];
    const names = match[3].replace(/[()\\]/g, ' ').split(/[,\n]/).map((item) => item.trim().split(/\s+as\s+/)[0].trim()).filter((item) => /^\w+$/.test(item));
    if (module) add(module);
    for (const item of names) {
      const target = module ? `${module}.${item}` : item;
      if (known.has(target) && target !== name) internal.add(target);
    }
  }
  for (const match of text.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)$/gm)) {
    for (const item of match[1].split(',')) {
      const target = item.trim().split(/\s+as\s+/)[0].trim();
      if (target) add(target);
    }
  }
  const routes = [...text.matchAll(/^[ \t]*@\w+\.(?:get|post|put|patch|delete|route|api_route|websocket)\(/gm)].length;
  return { name, internal, external, routes };
}

// ---------------------------------------------------------------- JavaScript / TypeScript

function scriptSpecifiers(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const found = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[\w*{}\s,$]+\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return { specifiers: [...found].sort(), text };
}

function packageName(specifier) {
  if (specifier.startsWith('node:')) return '';
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveScript(fromRelative, specifier, known) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), specifier));
  const stripped = base.replace(/\.(m|c)?js$/, '');
  const candidates = [base];
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${stripped}${extension}`);
  for (const extension of SCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find((candidate) => known.has(candidate)) || null;
}

function parseScript(relative, source, known) {
  const internal = new Set();
  const external = new Set();
  const { specifiers, text } = scriptSpecifiers(source);
  for (const specifier of specifiers) {
    if (specifier.startsWith('.')) {
      const target = resolveScript(relative, specifier, known);
      if (target && target !== relative) internal.add(target);
    } else {
      const name = packageName(specifier);
      if (name) external.add(name);
    }
  }
  const routes = [...text.matchAll(/\b(?:app|router|server|api)\.(?:get|post|put|patch|delete|all|route)\(\s*['"`]/g)].length;
  return { name: relative, internal, external, routes };
}

// ---------------------------------------------------------------- graph

function serviceFor(library) {
  for (const [key, spec] of Object.entries(SERVICE_LIBRARIES)) {
    if (library === key || library.startsWith(`${key}.`) || library.startsWith(`${key}/`)) return spec;
  }
  return null;
}

function frameworkFor(library) {
  for (const [key, label] of Object.entries(WEB_FRAMEWORKS)) {
    if (library === key || library.startsWith(`${key}.`)) return label;
  }
  return null;
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}

function collectModules(root) {
  const files = listSourceFiles(root);
  const modules = new Map();
  const knownPython = new Set(files.python.map(pythonModuleName));
  const knownScripts = new Set(files.scripts);
  for (const relative of files.python) {
    const parsed = parsePython(relative, readSource(root, relative), knownPython);
    modules.set(parsed.name, { ...parsed, path: relative });
  }
  for (const relative of files.scripts) {
    const parsed = parseScript(relative, readSource(root, relative), knownScripts);
    modules.set(parsed.name, { ...parsed, path: relative });
  }
  for (const module of modules.values()) {
    module.services = new Set();
    module.framework = null;
    for (const library of module.external) {
      const spec = serviceFor(library);
      if (spec) module.services.add(spec[0]);
      module.framework ||= frameworkFor(library);
    }
  }
  let frontendCalls = 0;
  let frontendPath = null;
  for (const relative of files.frontend) {
    const calls = [...readSource(root, relative).matchAll(/\bfetch\(|\baxios\b|\bEventSource\(|\bnew WebSocket\(/g)].length;
    if (calls && !frontendPath) frontendPath = relative;
    frontendCalls += calls;
  }
  return { modules, frontend: frontendCalls ? { path: frontendPath, calls: frontendCalls } : null };
}

function reachableServices(modules, start) {
  const found = new Set();
  const seen = new Set();
  const stack = [...modules.get(start).internal];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current) || !modules.has(current)) continue;
    seen.add(current);
    for (const service of modules.get(current).services) found.add(service);
    stack.push(...modules.get(current).internal);
  }
  return found;
}

function groupKey(modulePath, depth) {
  const directory = path.posix.dirname(modulePath);
  if (directory === '.') return '(root)';
  return directory.split('/').slice(0, depth).join('/');
}

// Collapse modules into folders when a repository is too large for one readable map.
function aggregate(visible, modules) {
  const maxDepth = Math.max(1, ...[...visible].map((name) => modules.get(name).path.split('/').length - 1));
  for (let depth = maxDepth; depth >= 1; depth -= 1) {
    const groups = new Map();
    for (const name of visible) {
      const key = groupKey(modules.get(name).path, depth);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(name);
    }
    if (groups.size <= MAX_MODULE_NODES || depth === 1) return groups;
  }
  return null;
}

export function scanRepository(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`scan folder does not exist: ${root}`);
  }
  const { modules, frontend } = collectModules(absoluteRoot);
  if (!modules.size) throw new Error('no Python or JavaScript/TypeScript modules found');

  // Hide configuration-like hubs imported from many places, and empty package markers.
  const importers = new Map([...modules.keys()].map((name) => [name, 0]));
  for (const module of modules.values()) {
    for (const dependency of module.internal) importers.set(dependency, (importers.get(dependency) || 0) + 1);
  }
  const hidden = new Set();
  for (const [name, module] of modules) {
    const hub = importers.get(name) >= HUB_THRESHOLD && !module.services.size && !module.framework && module.internal.size === 0;
    const emptyMarker = /(^|\/)__init__\.py$/.test(module.path) && !module.internal.size && !module.services.size;
    if (hub || emptyMarker) hidden.add(name);
  }
  const visible = new Set([...modules.keys()].filter((name) => !hidden.has(name)));

  // Node identity: one node per module, or per folder for large repositories.
  const nodeOf = new Map();
  const nodes = new Map();
  let aggregated = false;
  if (visible.size > MAX_MODULE_NODES) {
    aggregated = true;
    for (const [key, members] of aggregate(visible, modules)) {
      const id = `dir-${slug(key)}`;
      const framework = members.map((name) => modules.get(name).framework).find(Boolean);
      const routes = members.reduce((total, name) => total + modules.get(name).routes, 0);
      nodes.set(id, {
        id,
        type: 'backend',
        label: key === '(root)' ? '(root)' : `${key}/`,
        sublabel: `${members.length} module${members.length === 1 ? '' : 's'}`,
        ...(framework ? { tag: `${framework} · ${routes} route${routes === 1 ? '' : 's'}` } : {}),
        source: modules.get(members[0]).path,
        framework,
      });
      for (const name of members) nodeOf.set(name, id);
    }
  } else {
    const basenames = new Map();
    for (const name of visible) {
      const base = path.posix.basename(modules.get(name).path);
      basenames.set(base, (basenames.get(base) || 0) + 1);
    }
    for (const name of [...visible].sort()) {
      const module = modules.get(name);
      const base = path.posix.basename(module.path);
      const directory = path.posix.dirname(module.path);
      const id = `mod-${slug(module.path.replace(/\.[^.]+$/, ''))}`;
      nodes.set(id, {
        id,
        type: 'backend',
        label: basenames.get(base) > 1 && directory !== '.' ? `${path.posix.basename(directory)}/${base}` : base,
        sublabel: directory === '.' ? '(root)' : directory,
        ...(module.framework ? { tag: `${module.framework} · ${module.routes} route${module.routes === 1 ? '' : 's'}` } : {}),
        source: module.path,
        framework: module.framework,
      });
      nodeOf.set(name, id);
    }
  }

  const edges = new Map();
  const addEdge = (from, to, label = '') => {
    if (from === to) return;
    const id = `${from}--${to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, label });
  };
  const serviceNodes = new Map();
  for (const name of [...visible].sort()) {
    const module = modules.get(name);
    for (const dependency of [...module.internal].sort()) {
      if (visible.has(dependency)) addEdge(nodeOf.get(name), nodeOf.get(dependency));
    }
    const indirect = reachableServices(modules, name);
    for (const service of [...module.services].sort()) {
      if (indirect.has(service)) continue;
      addEdge(nodeOf.get(name), service);
      const spec = Object.values(SERVICE_LIBRARIES).find((entry) => entry[0] === service);
      serviceNodes.set(service, { id: service, type: spec[1], label: spec[2], sublabel: spec[3] });
    }
  }
  // Folder aggregation can re-create redundant folder → service edges; keep the transitive path only.
  for (const edge of [...edges.values()]) {
    if (!serviceNodes.has(edge.to)) continue;
    const viaOther = [...edges.values()].some((candidate) => candidate.from === edge.from && !serviceNodes.has(candidate.to)
      && edges.has(`${candidate.to}--${edge.to}`));
    if (viaOther) edges.delete(edge.id);
  }
  for (const service of serviceNodes.keys()) {
    if (![...edges.values()].some((edge) => edge.to === service)) serviceNodes.delete(service);
  }
  for (const [id, service] of serviceNodes) nodes.set(id, service);

  const entries = [...nodes.values()].filter((node) => node.framework).map((node) => node.id).sort();
  if (frontend && entries.length) {
    nodes.set('frontend', {
      id: 'frontend',
      type: 'frontend',
      label: 'Web UI',
      sublabel: frontend.path,
      tag: `${frontend.calls} request site${frontend.calls === 1 ? '' : 's'}`,
      source: frontend.path,
    });
    for (const entry of entries) addEdge('frontend', entry, 'HTTP');
  }

  const document = layout({
    nodes,
    edges: [...edges.values()],
    services: new Set(serviceNodes.keys()),
    title: options.title || `${path.basename(absoluteRoot)} architecture draft`,
    evidence: options.evidence || null,
    sourcePrefix: options.sourcePrefix || '',
  });
  const hiddenNames = [...hidden].map((name) => path.posix.basename(modules.get(name).path)).sort();
  document.cards = [
    {
      dot: 'cyan',
      title: 'Scan draft',
      items: [
        `${visible.size} module${visible.size === 1 ? '' : 's'}${aggregated ? ` in ${nodes.size - serviceNodes.size - (frontend && entries.length ? 1 : 0)} folders` : ''} · ${serviceNodes.size} service${serviceNodes.size === 1 ? '' : 's'}`,
        'Static imports only; refine before sharing',
      ],
    },
    {
      dot: 'amber',
      title: 'Hidden modules',
      items: [hiddenNames.length ? hiddenNames.join(', ') : 'none', `Shared leaves imported by ${HUB_THRESHOLD}+ modules`],
    },
  ];
  return {
    document,
    stats: {
      modules: modules.size,
      visibleModules: visible.size,
      hiddenModules: hiddenNames,
      aggregated,
      components: document.components.length,
      connections: document.connections.length,
      services: [...serviceNodes.keys()].sort(),
    },
  };
}

function layout({ nodes: allNodes, edges, services, title, evidence, sourcePrefix }) {
  // Modules without any drawn relationship would stack into one tall column; they are
  // laid out afterwards in a compact grid below the connected graph instead.
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const isolated = [...allNodes.keys()].filter((id) => !connected.has(id)).sort();
  const nodes = new Map([...allNodes].filter(([id]) => connected.has(id)));

  // Columns: longest import chain from an entry; services take the rightmost column.
  const depth = new Map([...nodes.keys()].filter((id) => !services.has(id)).map((id) => [id, 0]));
  for (let round = 0; round < nodes.size; round += 1) {
    let changed = false;
    for (const edge of edges) {
      if (services.has(edge.to) || services.has(edge.from)) continue;
      const next = depth.get(edge.from) + 1;
      if (next > depth.get(edge.to) && next < nodes.size) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const lastColumn = depth.size ? Math.max(...depth.values()) + (services.size ? 1 : 0) : 0;
  for (const id of services) depth.set(id, lastColumn);

  // Rows: barycenter ordering within each column reduces crossings deterministically.
  const columns = new Map();
  for (const id of [...nodes.keys()].sort()) {
    const column = depth.get(id);
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(id);
  }
  const neighbours = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of edges) {
    neighbours.get(edge.from).push(edge.to);
    neighbours.get(edge.to).push(edge.from);
  }
  for (let round = 0; round < 6; round += 1) {
    const order = new Map();
    for (const column of columns.values()) column.forEach((id, index) => order.set(id, index));
    for (const key of [...columns.keys()].sort((a, b) => a - b)) {
      columns.get(key).sort((a, b) => {
        const score = (id) => (neighbours.get(id).length
          ? neighbours.get(id).reduce((total, other) => total + order.get(other), 0) / neighbours.get(id).length
          : order.get(id));
        return score(a) - score(b) || a.localeCompare(b);
      });
    }
  }

  // Every column shares one row grid, so gaps between rows line up across columns.
  for (const node of nodes.values()) {
    node.label = fitText(node.label);
    if (node.sublabel) node.sublabel = fitText(node.sublabel, 44);
  }
  // Each column is as wide as its widest node; columns start after the previous one.
  const columnKeys = [...columns.keys()].sort((a, b) => a - b);
  const columnWidth = new Map(columnKeys.map((key) => [key, Math.max(...columns.get(key).map((id) => nodeWidth(nodes.get(id))))]));
  const columnX = new Map();
  let cursor = ORIGIN_X;
  for (let key = 0; key <= lastColumn; key += 1) {
    columnX.set(key, cursor);
    cursor += (columnWidth.get(key) || NODE_W) + COL_GAP;
  }

  const tallest = columns.size ? Math.max(...[...columns.values()].map((column) => column.length)) : 0;
  const row = new Map();
  for (const column of columns.values()) {
    const start = Math.floor((tallest - column.length) / 2);
    column.forEach((id, index) => row.set(id, start + index));
  }
  const xOf = (id) => columnX.get(depth.get(id));
  const widthOf = (id) => columnWidth.get(depth.get(id));
  const yOf = (id) => ORIGIN_Y + row.get(id) * (NODE_H + ROW_GAP);

  const components = [];
  for (const key of [...columns.keys()].sort((a, b) => a - b)) {
    for (const id of columns.get(key)) {
      const { source, framework, ...node } = nodes.get(id);
      void framework;
      const component = { ...node, pos: [xOf(id), yOf(id)], size: [widthOf(id), NODE_H] };
      if (evidence && source) component.sources = [{ path: `${sourcePrefix}${source}`, line: 1 }];
      components.push(component);
    }
  }

  // Edges that skip columns travel through the shared row gaps via explicit waypoints,
  // so they never cross an unrelated node. Parallel lines in one gap are offset.
  const laneUse = new Map();
  const laneOffset = (key) => {
    const used = laneUse.get(key) || 0;
    laneUse.set(key, used + 1);
    return Math.ceil(used / 2) * LANE_STEP * (used % 2 === 0 ? 1 : -1);
  };
  const connections = [];
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const connection = { id: edge.id, from: edge.from, to: edge.to };
    if (edge.label) connection.label = edge.label;
    if (edge.from === 'frontend') connection.variant = 'emphasis';
    if (depth.get(edge.to) - depth.get(edge.from) >= 2) {
      const sourceY = yOf(edge.from) + NODE_H / 2;
      const targetY = yOf(edge.to) + NODE_H / 2;
      const gapRow = row.get(edge.to) >= row.get(edge.from) ? row.get(edge.from) : row.get(edge.from) - 1;
      const channelY = ORIGIN_Y + gapRow * (NODE_H + ROW_GAP) + NODE_H + ROW_GAP / 2 + laneOffset(`row:${gapRow}:${depth.get(edge.from)}`);
      const leaveX = xOf(edge.from) + widthOf(edge.from) + COL_GAP / 2 + laneOffset(`col:${depth.get(edge.from)}`);
      const enterX = xOf(edge.to) - COL_GAP / 2 + laneOffset(`col:${depth.get(edge.to) - 1}`);
      Object.assign(connection, {
        fromSide: 'right',
        toSide: 'left',
        via: [[leaveX, sourceY], [leaveX, channelY], [enterX, channelY], [enterX, targetY]],
      });
    }
    connections.push(connection);
  }

  // Unconnected modules: a grid under the graph, wrapped to the graph's width.
  let width = nodes.size ? cursor - COL_GAP + ORIGIN_X : 0;
  let height = ORIGIN_Y + tallest * (NODE_H + ROW_GAP) + 40;
  if (isolated.length) {
    for (const id of isolated) {
      const node = allNodes.get(id);
      node.label = fitText(node.label);
      if (node.sublabel) node.sublabel = fitText(node.sublabel, 44);
    }
    const cellW = Math.max(...isolated.map((id) => nodeWidth(allNodes.get(id))));
    const byWidth = Math.floor((Math.max(width, 0) - ORIGIN_X + COL_GAP) / (cellW + COL_GAP / 2));
    const perRow = Math.max(1, nodes.size ? byWidth : Math.ceil(Math.sqrt(isolated.length * 2)), nodes.size ? 3 : 1);
    const top = nodes.size ? ORIGIN_Y + tallest * (NODE_H + ROW_GAP) + ROW_GAP : ORIGIN_Y;
    isolated.forEach((id, index) => {
      const { source, framework, ...node } = allNodes.get(id);
      void framework;
      const component = {
        ...node,
        pos: [ORIGIN_X + (index % perRow) * (cellW + COL_GAP / 2), top + Math.floor(index / perRow) * (NODE_H + ROW_GAP / 2)],
        size: [cellW, NODE_H],
      };
      if (evidence && source) component.sources = [{ path: `${sourcePrefix}${source}`, line: 1 }];
      components.push(component);
    });
    const rows = Math.ceil(isolated.length / perRow);
    width = Math.max(width, ORIGIN_X * 2 + perRow * cellW + (perRow - 1) * (COL_GAP / 2));
    height = top + rows * (NODE_H + ROW_GAP / 2) + 40;
  }
  const meta = { title, quality_profile: 'standard', viewBox: [Math.max(width, 640), Math.max(height, 420)] };
  if (evidence) meta.repository = evidence;
  return { schema_version: 1, diagram_type: 'architecture', meta, components, connections };
}

export function normalizeRemote(url) {
  const trimmed = String(url || '').trim().replace(/\.git$/, '');
  const ssh = trimmed.match(/^git@(github\.com|gitee\.com):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = trimmed.match(/^https:\/\/(?:[^@/]+@)?(github\.com|gitee\.com)\/(.+)$/);
  return https ? `https://${https[1]}/${https[2]}` : null;
}

export function toPosixPath(value) {
  return toPosix(value);
}
