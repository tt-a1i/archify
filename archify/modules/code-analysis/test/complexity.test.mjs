// complexity/function: Python function measurements and the threshold rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { buildGraph, evaluateGraph, extractFacts, loadConfig } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const SAMPLE = `def simple():
    return 1

def branches(x, items):
    if x > 1 and x < 5 or x == 9:
        return 1
    elif x == 2:
        for i in items:
            if i:
                while i:
                    i -= 1
    else:
        try:
            pass
        except ValueError:
            pass
        except KeyError:
            pass
    y = [a for a in items if a if a > 2]
    return 2 if y else 3

class K:
    def method(self):
        def inner(z):
            if z:
                return z
        return inner

def lam(v):
    f = lambda q: 1 if q else 2
    return f(v)
`;

function pyTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-complexity-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('python extraction: functions carry complexity, nesting and location; nested functions stand alone', () => {
  const dir = pyTree({ 'pkg/__init__.py': '', 'pkg/sample.py': SAMPLE });
  try {
    const { facts } = extractFacts(dir, { language: 'py', config: loadConfig(null) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    const byName = Object.fromEntries(facts.functions.map((f) => [f.qualname, f]));
    assert.deepEqual(Object.keys(byName).sort(), ['K.method', 'K.method.<locals>.inner', 'branches', 'lam', 'simple']);
    const { sourceRange: _range, ...simpleMetrics } = byName.simple;
    assert.deepEqual(simpleMetrics, { file: 'pkg/sample.py', name: 'simple', qualname: 'simple', line: 1, endLine: 2, complexity: 1, nesting: 0, deepestLine: 1 });
    // 1 + if + (or, and) + elif + for + if + while + 2 except + comprehension (1 for + 2 ifs) + conditional expression
    assert.equal(byName.branches.complexity, 14);
    assert.equal(byName.branches.nesting, 4, 'elif stays at its if\'s depth: if/elif > for > if > while');
    assert.equal(byName.branches.deepestLine, 10);
    assert.equal(byName['K.method'].complexity, 1, 'the nested function is not added to its parent');
    assert.equal(byName['K.method.<locals>.inner'].complexity, 2);
    assert.equal(byName.lam.complexity, 2, 'a lambda belongs to the function that contains it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const graph = {
  schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'py', adapter: 'python@test' },
  grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: ['test'], files: 0 },
  modules: [], edges: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
};
const fn = (file, qualname, complexity, nesting, line = 1, endLine = line + 20) => ({ file, name: qualname.split('.').pop(), qualname, line, endLine, complexity, nesting, deepestLine: line + 1 });
function factsOf(functions, roles = {}, texts = {}) {
  const paths = [...new Set(functions.map((f) => f.file))].sort();
  return {
    schema_version: 1, repository: graph.repository, symbols: [], calls: [], imports: [], unresolved: graph.unresolved,
    files: paths.map((p) => ({ path: p, loc: 40, role: roles[p] || 'source', sourceText: texts[p] ?? Array.from({ length: 40 }, (_, i) => `line ${i + 1} of ${p}`).join('\n') })),
    functions,
  };
}

test('complexity: warning at the warning thresholds, info below them, nothing under info', () => {
  const out = evaluate(graph, {}, factsOf([
    fn('a.py', 'tangled', 26, 2), fn('a.py', 'deep', 6, 6), fn('a.py', 'busy', 16, 1), fn('a.py', 'fine', 14, 4),
    fn('tests/test_a.py', 'test_huge', 40, 6),
  ], { 'tests/test_a.py': 'test' }));
  assert.deepEqual(schemaErrors('findings', out), []);
  assert.ok(out.rules.includes('complexity/function'));
  const found = Object.fromEntries(out.diagnostics.filter((d) => d.code === 'complexity/function').map((d) => [d.subject.function, d]));
  assert.deepEqual(Object.keys(found).sort(), ['busy', 'deep', 'tangled'], 'test files are excluded; complexity 14 / nesting 4 is under both info thresholds');
  assert.equal(found.tangled.severity, 'warning');
  assert.equal(found.deep.severity, 'warning', 'nesting alone can reach the warning level');
  assert.equal(found.busy.severity, 'info');
  assert.deepEqual(found.busy.evidence.threshold, { complexity: 15, nesting: 5 });
  assert.equal(found.tangled.evidence.length, 21);
  assert.match(found.tangled.message, /maintenance signal, not a defect/);
  assert.match(found.tangled.id, /^COMP-[0-9a-f]{12}$/);
  assert.deepEqual(found.tangled.subject, { file: 'a.py', function: 'tangled', line: 1, endLine: 21 });
});

test('complexity: thresholds come from the config, level by level', () => {
  const config = { rules: { complexity: { function: { warning: { complexity: 30 } } } } };
  const d = evaluate(graph, config, factsOf([fn('a.py', 'tangled', 26, 2)])).diagnostics[0];
  assert.equal(d.severity, 'info', 'the raised warning threshold is not reached');
  assert.deepEqual(d.evidence.threshold, { complexity: 15, nesting: 5 }, 'unconfigured values keep their defaults');
});

test('complexity: a warning threshold set below the info threshold still reports the function', () => {
  const config = { rules: { complexity: { function: { info: { complexity: 30, nesting: 9 }, warning: { complexity: 20, nesting: 9 } } } } };
  const found = evaluate(graph, config, factsOf([fn('a.py', 'mid', 22, 1), fn('a.py', 'low', 10, 1)])).diagnostics.filter((d) => d.code === 'complexity/function');
  assert.deepEqual(found.map((d) => [d.subject.function, d.severity]), [['mid', 'warning']], 'reaching only the warning level is reported, not dropped');
  assert.match(found[0].message, /cyclomatic complexity 22/);
});

test('complexity: not run, and not listed as checked, when functions were not measured', () => {
  const facts = factsOf([fn('a.ts', 'x', 50, 9)]);
  delete facts.functions;
  const out = evaluate(graph, {}, facts);
  assert.ok(!out.rules.includes('complexity/function'));
  assert.ok(!out.diagnostics.some((d) => d.code === 'complexity/function'));
});

test('complexity: the id follows the function, and the digest only its own lines', () => {
  const body = (extra) => ['def other():', `    return ${extra}`, '', 'def tangled():', '    pass'].join('\n');
  const run = (text, line) => evaluate(graph, {}, factsOf([fn('a.py', 'tangled', 26, 2, line, line + 1)], {}, { 'a.py': text })).diagnostics[0];
  const before = run(body(1), 4);
  const elsewhere = run(body(2), 4);
  assert.equal(elsewhere.id, before.id);
  assert.equal(elsewhere.evidenceDigest.sha256, before.evidenceDigest.sha256, 'editing another function keeps the evidence current');
  assert.deepEqual(before.evidenceDigest.lines, [4, 5]);
  const moved = run(['# a new comment', body(1)].join('\n'), 5);
  assert.equal(moved.id, before.id, 'lines above it moved; same function, same id');
  assert.equal(moved.evidenceDigest.sha256, before.evidenceDigest.sha256, 'unchanged body, unchanged digest');
  const edited = run(body(1).replace('    pass', '    return 0'), 4);
  assert.notEqual(edited.evidenceDigest.sha256, before.evidenceDigest.sha256);
});

test('complexity: the overlay ties a function to its component and adds an indicator there only', () => {
  const g = { ...graph,
    modules: [
      { id: 'core', label: 'core', path: 'core', files: 1, loc: 40, fanIn: 0, fanOut: 0, instability: null, entry: [] },
      { id: 'web', label: 'web', path: 'web', files: 1, loc: 40, fanIn: 0, fanOut: 0, instability: null, entry: [] },
    ],
    fileModules: { 'core/engine.py': 'core', 'web/app.py': 'web' } };
  const facts = factsOf([fn('core/engine.py', 'Engine.step', 22, 6), fn('core/engine.py', 'Engine.load', 16, 1), fn('web/app.py', 'index', 3, 1)]);
  const findings = evaluate(g, {}, facts).diagnostics;
  const ir = { components: [{ id: 'engine', label: 'Engine' }, { id: 'site', label: 'Site' }] };
  const html = '<body><div class="toolbar"></div><svg><g data-node-id="engine"></g><g data-node-id="site"></g></svg></body>';
  const data = JSON.parse(buildOverlay({ ir, graph: g, html, facts, findings, map: { engine: ['core'], site: ['web'] } }).html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
  const step = data.findings.find((f) => f.subject.function === 'Engine.step');
  assert.deepEqual(step.componentIds, ['engine']);
  assert.deepEqual(step.moduleIds, ['core']);
  const indicator = (id) => data.components.find((c) => c.id === id).indicators.items.find((i) => i.key === 'complexity');
  assert.equal(indicator('engine').status, 'amber');
  assert.match(indicator('engine').value, /^2 functions over the threshold; highest Engine\.step \(complexity 22, nesting 6\)/);
  assert.equal(indicator('site'), undefined);
});

test('complexity: end to end on a Python tree', () => {
  const dir = pyTree({ 'app/__init__.py': '', 'app/flow.py': SAMPLE.replace('def branches', 'def flow') });
  try {
    const config = { ...loadConfig(null), rules: { complexity: { function: { info: { complexity: 10, nesting: 4 } } } } };
    const { facts } = extractFacts(dir, { language: 'py', config });
    const findings = evaluateGraph(buildGraph(facts, config), config, facts);
    assert.ok(findings.diagnostics.every((d) => d.code !== 'complexity/function' || d.subject.function === 'flow'));
    const f = findings.diagnostics.find((d) => d.code === 'complexity/function');
    assert.equal(f.subject.function, 'flow');
    assert.equal(f.severity, 'info', 'complexity 14 and nesting 4 reach the lowered info thresholds, not warning');
    assert.equal(f.evidence.deepestLine, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const TS_SAMPLE = `export function branches(x: number, items: any[], flag?: boolean) {
  if ((x > 1 && x < 5) || x === 9) {
    return 1;
  } else if (x === 2) {
    for (const i of items) {
      if (i) {
        while (i.n) {
          i.n -= 1;
        }
      }
    }
  } else {
    try {
      run();
    } catch (e) {
      log(e);
    }
  }
  const y = items.filter((a) => a && a.ok);
  return flag ?? (y.length ? 2 : 3);
}

class Engine {
  constructor(private n: number) { if (n) this.n = n; }
  get size() { return this.n; }
  step() {
    const inner = (z: number) => { if (z) return z; return 0; };
    return inner(this.n);
  }
}

const api = {
  load(id?: string) { return id?.trim(); },
  save: async (v: number) => v > 0 ? v : 0,
};

server.on('request', (req: any, res: any) => {
  if (req.url === '/') res.end('ok');
});
server.on('close', () => {});

declare function overload(a: string): void;
`;

function tsTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-complexity-ts-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('ts extraction: functions, methods, named arrows and module-scope callbacks; inner callbacks fold in', () => {
  const dir = tsTree({ 'src/sample.ts': TS_SAMPLE });
  try {
    const { facts } = extractFacts(dir, { language: 'ts', config: loadConfig(null) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    const byName = Object.fromEntries(facts.functions.map((f) => [f.qualname, f]));
    assert.deepEqual(Object.keys(byName).sort(), [
      '<callback of server.on("close")>', '<callback of server.on("request")>', 'Engine.constructor', 'Engine.get size', 'Engine.step',
      'Engine.step.<locals>.inner', 'api.load', 'api.save', 'branches',
    ], 'the overload signature has no body and is skipped');
    // 1 + if + || + && + else-if + for-of + if + while + catch + && in the folded callback + ?? + ?:
    assert.equal(byName.branches.complexity, 12);
    assert.equal(byName.branches.nesting, 4, 'else-if stays at its if\'s depth: if/else-if > for > if > while');
    assert.equal(byName.branches.deepestLine, 7);
    assert.equal(byName['Engine.step'].complexity, 1, 'a named arrow is measured on its own, not added to its parent');
    assert.equal(byName['Engine.step.<locals>.inner'].complexity, 2);
    assert.equal(byName['api.load'].complexity, 1, 'optional chaining is not a branch');
    assert.equal(byName['api.save'].complexity, 2);
    assert.equal(byName['<callback of server.on("request")>'].complexity, 2);
    assert.equal(byName['<callback of server.on("request")>'].line, 37);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ts and python: the same logic gets the same complexity and nesting', () => {
  const py = `def route(kind, items, flag):
    if kind == 1 and flag or kind == 9:
        return 1
    elif kind == 2:
        for item in items:
            if item.ready:
                while item.pending:
                    item.pending -= 1
    else:
        try:
            go()
        except ValueError:
            pass
    return 2 if flag else 3
`;
  const ts = `export function route(kind: number, items: any[], flag: boolean) {
  if ((kind === 1 && flag) || kind === 9) {
    return 1;
  } else if (kind === 2) {
    for (const item of items) {
      if (item.ready) {
        while (item.pending) {
          item.pending -= 1;
        }
      }
    }
  } else {
    try {
      go();
    } catch (e) {
      // ignored
    }
  }
  return flag ? 2 : 3;
}
`;
  const pyDir = pyTree({ 'app/__init__.py': '', 'app/route.py': py });
  const tsDir = tsTree({ 'src/route.ts': ts });
  try {
    const pick = (dir, language) => extractFacts(dir, { language, config: loadConfig(null) }).facts.functions.find((f) => f.name === 'route');
    const [p, t] = [pick(pyDir, 'py'), pick(tsDir, 'ts')];
    assert.deepEqual([t.complexity, t.nesting], [p.complexity, p.nesting]);
    assert.deepEqual([p.complexity, p.nesting], [10, 4]);
  } finally {
    fs.rmSync(pyDir, { recursive: true, force: true });
    fs.rmSync(tsDir, { recursive: true, force: true });
  }
});

test('complexity: runs for JS/TS projects end to end', () => {
  const body = ['export function dispatch(kind: number) {', '  let out = 0;',
    ...Array.from({ length: 26 }, (_, i) => `  ${i ? 'else if' : 'if'} (kind === ${i}) { out += ${i}; }`), '  return out;', '}', ''].join('\n');
  const dir = tsTree({ 'src/dispatch.ts': body, 'src/other.ts': 'export const x = () => 1;\n' });
  try {
    const config = loadConfig(null);
    const { facts } = extractFacts(dir, { language: 'ts', config });
    const findings = evaluateGraph(buildGraph(facts, config), config, facts);
    assert.ok(findings.rules.includes('complexity/function'));
    const f = findings.diagnostics.find((d) => d.code === 'complexity/function');
    assert.equal(f.subject.function, 'dispatch');
    assert.equal(f.evidence.complexity, 27);
    assert.equal(f.severity, 'warning');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('ts extraction: module-scope callbacks are named by their call and literal, not their position', () => {
  const before = "server.on('request', (req: any) => { if (req) return 1; return 0; });\n";
  const after = "app.use(() => {});\nserver.on('error', () => {});\n" + before;
  const names = (text) => {
    const dir = tsTree({ 'src/s.ts': text });
    try { return extractFacts(dir, { language: 'ts', config: loadConfig(null) }).facts.functions.map((f) => f.qualname); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  assert.deepEqual(names(before), ['<callback of server.on("request")>']);
  assert.ok(names(after).includes('<callback of server.on("request")>'), 'adding other handlers above keeps its name, so its finding id');
  assert.deepEqual(names("emit('x', () => {});\nemit('x', () => {});\n"), ['<callback of emit("x")>', '<callback of emit("x")>#2']);
});

test('ts extraction: syntax errors are recorded as parse_errors', () => {
  const dir = tsTree({ 'src/ok.ts': 'export const a = 1;\n', 'src/broken.ts': 'const s = `unterminated\nimport { a } from "./ok";\n' });
  try {
    const { facts } = extractFacts(dir, { language: 'ts', config: loadConfig(null) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.deepEqual((facts.parse_errors || []).map((e) => e.path), ['src/broken.ts']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
