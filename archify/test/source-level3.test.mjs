import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRepositoryEvidence } from '../modules/repository-index/index.mjs';
import { buildEvidencePack, PACK_DEFAULT_LIMITS } from '../modules/repository-index/source-level3.mjs';

function workspace(t, prefix = 'archify-source-level3-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function mixedFixture(t) {
  const root = workspace(t);
  // A cross-language module the import scan cannot see into.
  write(root, 'native/CMakeLists.txt', 'project(native)\n');
  for (let index = 0; index < 6; index += 1) write(root, `native/kernel${index}.cu`, '__global__ void k() {}\n');
  write(root, 'native/host.py', 'VALUE = 1\n');
  // A python package with a console script whose target is not mapped by path.
  write(root, 'pyproject.toml', '[project]\nname = "svc"\ndependencies = ["requests"]\n[project.scripts]\nsvc-worker = "svc.worker:main"\n');
  write(root, 'svc/__init__.py', '');
  write(root, 'svc/api.py', 'import svc.store\nimport ghost_lib\n');
  write(root, 'svc/store.py', 'VALUE = 1\n');
  // A compose service built from a directory no module matches.
  write(root, 'docker-compose.yml', 'services:\n  edge:\n    build: ./missing-dir\n');
  // Enough unknown import sites to form a hub.
  for (let index = 0; index < 6; index += 1) write(root, `plugins/p${index}.py`, 'import ghost_lib.core\n');
  // An isolated module with no edges in either direction.
  for (let index = 0; index < 12; index += 1) write(root, `island/tools/i${index}.py`, 'VALUE = 1\n');
  return root;
}

test('The evidence pack asks module-level boundary questions with source anchors, in priority order', (t) => {
  const root = mixedFixture(t);
  const result = buildRepositoryEvidence(root);
  const pack = result.pack;

  assert.equal(result.mode, 'evidence-pack');
  assert.ok(pack.questions.length <= PACK_DEFAULT_LIMITS.maximumQuestions);
  const kinds = pack.questions.map((question) => question.kind);

  const crossLanguage = pack.questions.find((question) => question.kind === 'cross-language-boundary');
  assert.ok(crossLanguage, 'six unscanned CUDA files in a nine-file module raise a boundary question');
  assert.equal(crossLanguage.subject, 'native');
  assert.ok(crossLanguage.anchors.includes('native/CMakeLists.txt'), 'the build file anchors the question');

  const entrypoint = pack.questions.find((question) => question.kind === 'entrypoint-process');
  assert.ok(entrypoint, 'a console script without a file mapping asks for its owning module');
  assert.deepEqual(entrypoint.anchors, ['pyproject.toml']);

  const service = pack.questions.find((question) => question.kind === 'service-module-unmapped');
  assert.equal(service.subject, 'edge');
  assert.deepEqual(service.anchors, ['docker-compose.yml']);

  const hub = pack.questions.find((question) => question.kind === 'undeclared-import');
  assert.ok(hub.question.includes('ghost_lib'), 'repeated undeclared imports form one aggregated question');
  assert.match(hub.anchors[0], /^plugins\/p0\.py:1$|^svc\/api\.py:2$/);

  const island = pack.questions.find((question) => question.kind === 'isolated-module');
  assert.equal(island.subject, 'island');

  const order = ['cross-language-boundary', 'entrypoint-process', 'service-module-unmapped', 'unknown-import-hub', 'isolated-module', 'undeclared-import'];
  const seen = kinds.map((kind) => order.indexOf(kind));
  assert.deepEqual(seen, [...seen].sort((left, right) => left - right), 'questions are grouped by priority');

  for (const question of pack.questions) {
    assert.ok(question.anchors.length >= 1 && question.anchors.length <= 2, `${question.id} has 1-2 anchors`);
  }
});

test('The evidence pack keeps facts, coverage, and boundaries from both levels', (t) => {
  const root = mixedFixture(t);
  const pack = buildRepositoryEvidence(root).pack;

  assert.ok(pack.boundaries.entrypoints.items.some((entry) => entry.name === 'svc-worker'));
  assert.ok(pack.boundaries.services.items.some((entry) => entry.name === 'edge'));
  const modulePaths = pack.modules.items.map((module) => module.path);
  assert.ok(modulePaths.includes('svc') && modulePaths.includes('native'));
  assert.ok(pack.edges.items.every((edge) => edge.from !== edge.to));
  assert.equal(pack.coverage.unscanned.byLanguage.cuda, 6);
  assert.ok(pack.coverage.unresolved.external >= 7, 'ghost_lib sites are counted');
  assert.ok(!JSON.stringify(pack).includes('fileEdges'), 'per-file edges stay out of the pack');
});

test('The evidence pack enforces its byte budget by trimming detail before facts', (t) => {
  const root = workspace(t);
  for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
    write(root, `packages/m${String(moduleIndex).padStart(2, '0')}/lib/one.py`, moduleIndex > 0
      ? `import sys\nsys.path.append('.')\n`
      : 'VALUE = 1\n');
    write(root, `packages/m${String(moduleIndex).padStart(2, '0')}/lib/two.py`,
      `from importlib import import_module\n`);
  }
  // Dense internal edges: every module imports the shared hub package.
  write(root, 'hub/__init__.py', '');
  write(root, 'hub/core.py', 'VALUE = 1\n');
  for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
    write(root, `packages/m${String(moduleIndex).padStart(2, '0')}/lib/uses_hub.py`, 'import hub.core\n');
  }

  const budget = 6 * 1024;
  const result = buildRepositoryEvidence(root, { packLimits: { maximumBytes: budget } });
  const pack = result.pack;
  assert.ok(pack.budget.bytes <= budget, `pack is ${pack.budget.bytes} bytes for a ${budget} byte budget`);
  assert.ok(pack.budget.trimmed.length > 0, 'the trims are recorded');
  assert.ok(pack.modules.items.length >= 10, 'modules survive trimming longest');
  assert.equal(Buffer.byteLength(JSON.stringify(pack)), pack.budget.bytes, 'the recorded size matches the serialized pack');
});

test('The evidence pack writes full per-file detail to disk and points at it', (t) => {
  const root = mixedFixture(t);
  const detailDirectory = workspace(t, 'archify-source-level3-detail-');
  const result = buildRepositoryEvidence(root, { detailDirectory });
  const detailPath = result.pack.detail.path;
  assert.equal(detailPath, path.join(detailDirectory, 'source-graph.json'));
  const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
  assert.ok(Array.isArray(detail.level2.fileEdges) && detail.level2.fileEdges.length > 0);
  assert.ok(detail.level1.boundaries.services.length >= 1);
});

test('The evidence pack is deterministic across runs apart from measured duration', (t) => {
  const root = mixedFixture(t);
  const first = buildRepositoryEvidence(root);
  const second = buildRepositoryEvidence(root);
  for (const result of [first, second]) {
    delete result.summary.durationMs;
    delete result.summary.timingsMs;
  }
  assert.deepEqual(first, second);
});

function syntheticModule(pathName, scannedFiles) {
  return { path: pathName, files: scannedFiles, scannedFiles, languages: { python: scannedFiles }, roles: { source: scannedFiles }, unscannedLanguages: {}, fanIn: 0, fanOut: 0, entrypoints: [] };
}

test('The evidence pack picks a backbone edge for every shown module before filling by weight', () => {
  // A heavy hub would take the whole edge budget under weight-only selection,
  // leaving x and y with no edge: two disconnected components in a diagram.
  const edge = (from, to, weight) => ({ from, to, weight, evidence: [] });
  const level2 = {
    scannedFiles: 50, candidateFiles: 50, truncated: false,
    unscanned: { files: 0, byLanguage: {} },
    unresolved: { stdlib: 0, external: 0, dynamic: 0, unknown: 0, topUnknown: [], topExternal: [] },
    modules: ['hub', 'a', 'b', 'x', 'y'].map((name) => syntheticModule(name, 10)),
    edges: [edge('a', 'hub', 100), edge('b', 'hub', 90), edge('a', 'b', 50), edge('x', 'y', 1)],
  };
  const pack = buildEvidencePack({
    repositoryState: {}, summary: { retainedFiles: 50, languages: {} }, records: [],
    boundaries: {}, level2, detailPath: null, declaredDependencies: new Set(),
  }, { limits: { maximumEdges: 3 } });

  const shown = pack.modules.items.map((module) => module.path);
  for (const module of shown) {
    assert.ok(pack.edges.items.some((entry) => entry.from === module || entry.to === module), `${module} keeps an edge`);
  }
  assert.equal(pack.edges.items.length, 3);
  assert.equal(pack.edges.omitted, 1);
});

test('Undeclared-import questions match distribution tokens and are withheld when a manifest was truncated', (t) => {
  const covered = workspace(t);
  write(covered, 'pyproject.toml', '[project]\nname = "svc"\ndependencies = ["flashinfer_python[cu13]==0.6", "nvidia-cutlass-dsl"]\n');
  for (let index = 0; index < 6; index += 1) write(covered, `svc/m${index}.py`, 'import flashinfer\nimport cutlass\n');
  const coveredKinds = buildRepositoryEvidence(covered).pack.questions.map((question) => question.kind);
  assert.ok(!coveredKinds.includes('undeclared-import'), 'flashinfer and cutlass are provided by declared distributions');

  const capped = workspace(t);
  const many = Array.from({ length: 60 }, (_, index) => `"dep${index}"`).join(', ');
  write(capped, 'pyproject.toml', `[project]\nname = "svc"\ndependencies = [${many}]\n`);
  for (let index = 0; index < 6; index += 1) write(capped, `svc/m${index}.py`, 'import past_the_cap\n');
  const cappedKinds = buildRepositoryEvidence(capped).pack.questions.map((question) => question.kind);
  assert.ok(!cappedKinds.includes('undeclared-import'), 'a truncated dependency list cannot prove a name undeclared');
});

function voiceAssistantFixture(t) {
  const root = workspace(t);
  write(root, 'main.py', 'import config\nfrom asr import manager\nfrom llm import client\nfrom tools import registry\nfrom tts import speak\n');
  write(root, 'config.py', 'VALUE = 1\n');
  write(root, 'README.md', '# assistant\n');
  write(root, 'asr/manager.py', 'import config\n');
  write(root, 'llm/client.py', 'import config\nfrom tools import registry\nimport requests\n');
  write(root, 'tts/speak.py', 'import config\n');
  // tools/ looks like a support directory by name, but runtime modules import
  // it: it is the assistant's tool-calling layer.
  write(root, 'tools/registry.py', 'import config\n');
  write(root, 'tools/weather/impl.py', 'import config\n');
  // scripts/ only consumes the runtime and imports test helpers.
  for (let index = 0; index < 3; index += 1) write(root, `scripts/s${index}.py`, 'import config\nfrom tools import registry\nfrom tests import helpers\n');
  write(root, 'tests/helpers.py', 'X = 1\n');
  for (let index = 0; index < 4; index += 1) write(root, `tests/test_${index}.py`, 'import config\n');
  write(root, 'characters/default.json', '{}\n');
  return root;
}

test('The evidence pack folds tests, scripts, and data folders out of the components, keeping an imported tools/ as runtime', (t) => {
  const pack = buildRepositoryEvidence(voiceAssistantFixture(t)).pack;
  const runtime = pack.modules.items.map((module) => module.path).sort();
  assert.deepEqual(runtime, ['asr', 'config.py', 'llm', 'main.py', 'tools', 'tts']);
  const support = Object.fromEntries(pack.supportModules.items.map((module) => [module.path, module.role]));
  assert.deepEqual(support, { '.': 'non-source', characters: 'non-source', scripts: 'tooling', tests: 'test' });
  for (const edge of pack.edges.items) {
    assert.ok(runtime.includes(edge.from) && runtime.includes(edge.to), `${edge.from} -> ${edge.to} joins runtime modules only`);
  }
  assert.ok(pack.edges.supportEdges > 0, 'edges touching support modules are counted, not shown');
});

test('A small root splits into per-file modules so an orchestrator and a shared config do not form a false cycle', (t) => {
  const pack = buildRepositoryEvidence(voiceAssistantFixture(t)).pack;
  const byPath = new Map(pack.modules.items.map((module) => [module.path, module]));
  assert.equal(byPath.get('main.py').fanIn, 0);
  assert.equal(byPath.get('config.py').fanOut, 0);
  const pairs = new Set(pack.edges.items.map((edge) => `${edge.from}->${edge.to}`));
  for (const edge of pack.edges.items) {
    assert.ok(!pairs.has(`${edge.to}->${edge.from}`) || edge.from === 'llm' || edge.to === 'llm',
      `${edge.from} and ${edge.to} are not joined both ways through the root`);
  }
});

test('Undeclared-import questions are withheld when the repository has no dependency manifest', (t) => {
  const root = voiceAssistantFixture(t);
  for (let index = 0; index < 6; index += 1) write(root, `llm/extra${index}.py`, 'import requests\n');
  const kinds = buildRepositoryEvidence(root).pack.questions.map((question) => question.kind);
  assert.ok(!kinds.includes('undeclared-import'));
});

test('Only a configuration-declared entrypoint keeps an unimported support-named module in the runtime', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ name: 'cli', bin: { cli: 'tools/cli.mjs' } }));
  write(root, 'tools/cli.mjs', "import { run } from '../core/run.mjs';\n");
  write(root, 'core/run.mjs', 'export const run = 1;\n');
  // examples/ holds a file whose name looks like an entrypoint, but nothing
  // declares it, so it stays support.
  write(root, 'examples/demo/src/cli.mjs', "import { run } from '../../../core/run.mjs';\n");
  const pack = buildRepositoryEvidence(root).pack;
  assert.ok(pack.modules.items.some((module) => module.path === 'tools'), 'the declared npm bin keeps tools/ in the runtime');
  assert.deepEqual(pack.supportModules.items.filter((module) => module.path === 'examples').map((module) => module.role), ['tooling']);
});

test('Colocated tests do not turn a runtime module into a test module', (t) => {
  const root = workspace(t);
  write(root, 'service/handler.py', 'from service import store\n');
  write(root, 'service/store.py', 'VALUE = 1\n');
  for (let index = 0; index < 5; index += 1) write(root, `service/test_handler_${index}.py`, 'from service import handler\n');
  write(root, 'main.py', 'from service import handler\n');
  const pack = buildRepositoryEvidence(root).pack;
  assert.ok(pack.modules.items.some((module) => module.path === 'service'));
});

test('Edge selection keeps the shown graph connected where the import graph is, instead of stranding a covered pair', () => {
  // Per-module coverage let two modules cover each other with one edge and
  // form an island while heavy edges elsewhere took the budget.
  const edge = (from, to, weight) => ({ from, to, weight, evidence: [] });
  const level2 = {
    scannedFiles: 60, candidateFiles: 60, truncated: false,
    unscanned: { files: 0, byLanguage: {} },
    unresolved: { stdlib: 0, external: 0, dynamic: 0, unknown: 0, topUnknown: [], topExternal: [] },
    modules: ['a', 'b', 'c', 'd', 'e', 'g'].map((name) => syntheticModule(name, 10)),
    edges: [edge('a', 'b', 100), edge('a', 'c', 90), edge('b', 'c', 80), edge('a', 'd', 70), edge('b', 'd', 60),
      edge('c', 'd', 50), edge('e', 'a', 3), edge('g', 'e', 2)],
  };
  const pack = buildEvidencePack({
    repositoryState: {}, summary: { retainedFiles: 60, languages: {} }, records: [],
    boundaries: {}, level2, detailPath: null, declaredDependencies: new Set(),
  }, { limits: { maximumEdges: 5 } });

  const adjacency = new Map(pack.modules.items.map((module) => [module.path, new Set()]));
  for (const entry of pack.edges.items) {
    adjacency.get(entry.from).add(entry.to);
    adjacency.get(entry.to).add(entry.from);
  }
  const reached = new Set(['a']);
  for (const queue = ['a']; queue.length;) {
    for (const next of adjacency.get(queue.shift())) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
  assert.equal(reached.size, 6, 'all six shown modules are reachable with five edges');
});

function gatewayFixture(t) {
  const root = workspace(t);
  write(root, 'server/http_server.py', [
    'from fastapi import FastAPI',
    'app = FastAPI()',
    '@app.post("/generate")',
    'def generate(): pass',
    '@app.get("/get_server_info")',
    'def info(): pass',
    '@app.post("/flush_cache")',
    'def flush(): pass',
    '@app.get("/health")',
    'def health(): pass',
  ].join('\n'));
  write(root, 'server/engine.py', 'VALUE = 1\n');
  write(root, 'gateway/src/router.rs', [
    'let url = format!("{}/generate", worker);',
    'client.get("/get_server_info");',
    'client.post("http://worker:30000/flush_cache?force=1");',
    'client.get("/health");',
  ].join('\n'));
  for (let index = 0; index < 5; index += 1) write(root, `gateway/src/policy${index}.rs`, 'fn policy() {}\n');
  write(root, 'gateway/Cargo.toml', '[package]\nname = "gateway"\n');
  write(root, 'tests/test_http.py', 'requests.post("/generate")\nrequests.get("/get_server_info")\n');
  return root;
}

test('Route references link a Rust gateway to the Python server that declares its routes, as a judged fact rather than an edge', (t) => {
  const pack = buildRepositoryEvidence(gatewayFixture(t)).pack;
  const [reference] = pack.crossLanguage.routeReferences.items;
  assert.equal(reference.from, 'gateway');
  assert.equal(reference.to, 'server');
  assert.equal(reference.shared, 3, 'generate, get_server_info, and flush_cache match; /health is generic');
  assert.match(reference.anchor, /^gateway\/src\/router\.rs:\d+$/);
  assert.match(pack.crossLanguage.note, /candidate/);
  assert.ok(!pack.edges.items.some((entry) => entry.from === 'gateway'), 'route matches are not asserted as edges');
  const question = pack.questions.find((entry) => entry.kind === 'cross-language-boundary' && entry.subject === 'gateway');
  assert.match(question.question, /gateway -> server over 3 HTTP routes/);
  assert.match(question.anchors[0], /^gateway\/src\/router\.rs:\d+$/);
  assert.ok(pack.modules.items.some((entry) => entry.path === 'gateway'), 'unscanned code keeps the gateway in the module list');
});

test('Hidden tool directories are tooling, not runtime components', (t) => {
  const root = workspace(t);
  write(root, 'app/main.py', 'VALUE = 1\n');
  write(root, '.claude/skills/triage/tool.py', 'from app import main\n');
  const pack = buildRepositoryEvidence(root).pack;
  assert.ok(!pack.modules.items.some((entry) => entry.path.startsWith('.')));
  assert.ok(pack.supportModules.items.some((entry) => entry.path === '.claude' && entry.role === 'tooling'));
});

test('A small route provider stays shown, and a gateway keeps its only runtime edge with a citable sample file', (t) => {
  // big1..big3 outrank the server by size; the server declares the routes a
  // gateway calls, and the gateway's nested e2e suite imports a test harness.
  const root = workspace(t);
  for (const name of ['big1', 'big2', 'big3']) {
    for (let index = 0; index < 20; index += 1) write(root, `${name}/m${index}.py`, 'VALUE = 1\n');
  }
  write(root, 'server/__init__.py', '');
  write(root, 'server/http.py', '@app.post("/generate")\ndef generate(): pass\n@app.get("/get_server_info")\ndef info(): pass\n');
  write(root, 'gateway/launch.py', 'import server.http\n');
  write(root, 'gateway/e2e_test/conftest.py', 'import harness.infra\n');
  write(root, 'gateway/bench/run_bench.py', 'import harness.infra\n');
  write(root, 'harness/infra.py', 'VALUE = 1\n');
  const pack = buildRepositoryEvidence(root, { packLimits: { maximumModules: 3 } }).pack;

  const shown = pack.modules.items.map((module) => module.path);
  assert.ok(shown.includes('server'), 'route provider is pinned');
  assert.ok(!pack.edges.items.some((entry) => entry.to === 'harness'), 'e2e and bench imports are not runtime edges');
  if (shown.includes('gateway')) {
    assert.ok(pack.edges.items.some((entry) => entry.from === 'gateway' && entry.to === 'server'));
  }
  const server = pack.modules.items.find((module) => module.path === 'server');
  assert.match(server.sample, /^server\/.+\.py$/);
});

test('Console scripts resolve onto files without a question, and anchors carry numbered excerpts without credentials', (t) => {
  const root = workspace(t);
  write(root, 'pyproject.toml', '[project]\nname = "svc"\n[project.scripts]\nsvc-cli = "svc.cli:main"\n');
  write(root, 'svc/__init__.py', '');
  write(root, 'svc/cli.py', 'import svc.server\n');
  write(root, 'svc/server.py', '@app.post("/generate")\ndef generate(): pass\n@app.get("/get_server_info")\ndef info(): pass\n');
  write(root, 'gateway/Cargo.toml', '[package]\nname = "gateway"\n');
  write(root, 'gateway/build.rs', '// protoc comment is skipped\nfn main() { tonic_build::compile_protos("a.proto").unwrap(); }\nlet api_key = "compile_protos-secret";\n');
  for (let index = 0; index < 6; index += 1) {
    write(root, `gateway/src/r${index}.rs`, `fn call() {\n  let token = "x";\n  client.post("/generate");\n  client.get("/get_server_info");\n}\n`);
  }
  const pack = buildRepositoryEvidence(root).pack;

  const script = pack.boundaries.entrypoints.items.find((entry) => entry.name === 'svc-cli');
  assert.deepEqual(script.files, ['svc/cli.py']);
  assert.ok(!pack.questions.some((question) => question.subject === 'svc-cli'), 'a resolved console script asks nothing');

  const gateway = pack.questions.find((question) => question.subject === 'gateway');
  assert.ok(gateway, 'unscanned Rust raises a cross-language question');
  const lines = Object.values(gateway.excerpts || {}).flat();
  assert.ok(lines.length > 0, 'the question carries excerpts');
  assert.ok(lines.every((line) => /^\d+: /.test(line)), 'excerpt lines are numbered');
  assert.ok(lines.some((line) => line.includes('tonic_build')), 'the build file keeps its binding line');
  assert.ok(!lines.some((line) => /token|api_key|protoc comment/.test(line)), 'credentials and comments are not copied');
});
