// architecture/boundary: opt-in layer rules over file-level imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { buildOverview } from '../overlay/overview.mjs';
import { buildGraph, evaluateGraph, extractFacts, loadConfig } from '../lib/analysis.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const graph = {
  schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'ts', adapter: 't' },
  grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: ['test'], files: 0 },
  modules: [], edges: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
};
function factsOf(imports, roles = {}) {
  const paths = [...new Set(imports.flatMap((i) => [i.from, i.to]))].sort();
  return {
    schema_version: 1, repository: graph.repository, symbols: [], calls: [], unresolved: graph.unresolved,
    files: paths.map((p) => ({ path: p, loc: 1, role: roles[p] || 'source', sourceText: `// ${p}` })),
    imports: imports.map((i) => ({ from: i.from, to: i.to, specifier: i.to, kind: 'static', line: i.line || 1, resolved: true, ...(i.typeOnly ? { typeOnly: true } : {}) })),
  };
}
const layers = { domain: ['src/domain/**'], ui: ['src/ui/**'], shared: ['src/shared/**'] };
const imports = [
  { from: 'src/domain/order.ts', to: 'src/ui/button.ts', line: 3 },
  { from: 'src/domain/price.ts', to: 'src/ui/format.ts', line: 7, typeOnly: true },
  { from: 'src/domain/order.ts', to: 'src/shared/money.ts', line: 2 },
  { from: 'src/ui/button.ts', to: 'src/domain/order.ts', line: 1 },
  { from: 'src/domain/order.ts', to: 'scripts/seed.ts', line: 9 },
  { from: 'tests/order.test.ts', to: 'src/ui/button.ts', line: 1 },
];
const roles = { 'tests/order.test.ts': 'test' };

test('boundary: one finding per crossed layer pair, citing every import that crosses it', () => {
  const config = { boundaries: { layers: { ...layers, tests: ['tests/**'] }, rules: [{ from: 'domain', disallow: ['ui'], reason: 'domain stays UI-free' }, { from: 'tests', disallow: ['ui'] }] } };
  const out = evaluate(graph, config, factsOf(imports, roles));
  assert.deepEqual(schemaErrors('findings', out), []);
  assert.ok(out.rules.includes('architecture/boundary'));
  const found = out.diagnostics.filter((d) => d.code === 'architecture/boundary');
  assert.equal(found.length, 1, 'ui -> domain, domain -> shared and files in no layer are allowed; test files are excluded');
  const f = found[0];
  assert.deepEqual(f.subject, { boundary: { from: 'domain', to: 'ui' } });
  assert.equal(f.severity, 'warning');
  assert.equal(f.dimension, 'architecture');
  assert.match(f.id, /^ARCH-[0-9a-f]{12}$/);
  assert.equal(f.evidence.totalImports, 2);
  assert.deepEqual(f.evidence.files, ['src/domain/order.ts', 'src/domain/price.ts']);
  assert.deepEqual(f.evidence.imports, [
    { file: 'src/domain/order.ts', line: 3, to: 'src/ui/button.ts' },
    { file: 'src/domain/price.ts', line: 7, to: 'src/ui/format.ts', typeOnly: true },
  ]);
  assert.deepEqual(f.evidence.rule, { from: 'domain', disallow: ['ui'], reason: 'domain stays UI-free' });
  assert.match(f.message, /domain stays UI-free/);
  assert.deepEqual(f.evidenceDigest.files, ['src/domain/order.ts', 'src/domain/price.ts', 'src/ui/button.ts', 'src/ui/format.ts'], 'both ends of each crossing import');
});

test('boundary: an allow list forbids every other declared layer', () => {
  const config = { boundaries: { layers: { ...layers, infra: ['src/infra/**'] }, rules: [{ from: 'domain', allow: ['shared'] }] } };
  const out = evaluate(graph, config, factsOf([...imports, { from: 'src/domain/order.ts', to: 'src/infra/db.ts', line: 4 }], roles));
  assert.deepEqual(out.diagnostics.filter((d) => d.code === 'architecture/boundary').map((d) => d.subject.boundary), [{ from: 'domain', to: 'infra' }, { from: 'domain', to: 'ui' }]);
});

test('boundary: without configuration the rule does not run and is not listed as checked', () => {
  const out = evaluate(graph, {}, factsOf(imports, roles));
  assert.ok(!out.rules.includes('architecture/boundary'), 'not configured is not the same as clean');
  assert.ok(!out.diagnostics.some((d) => d.code === 'architecture/boundary'));
  const ignored = evaluate(graph, { ignore: ['architecture/boundary'], boundaries: { layers, rules: [{ from: 'domain', disallow: ['ui'] }] } }, factsOf(imports, roles));
  assert.equal(ignored.summary.suppressed, 1, 'a configured rule can still be switched off');
});

test('boundary: the first declared layer wins when globs overlap', () => {
  const config = { boundaries: { layers: { ui: ['src/ui/**'], everything: ['src/**'] }, rules: [{ from: 'everything', disallow: ['ui'] }] } };
  const out = evaluate(graph, config, factsOf([{ from: 'src/domain/order.ts', to: 'src/ui/button.ts' }]));
  assert.deepEqual(out.diagnostics[0].subject.boundary, { from: 'everything', to: 'ui' });
});

test('boundary: invalid configuration stops with a diagnostic instead of checking less', () => {
  const bad = [
    {},
    { layers: {}, rules: [{ from: 'a', disallow: [] }] },
    { layers, rules: [] },
    { layers, rules: [{ from: 'nope', disallow: ['ui'] }] },
    { layers, rules: [{ from: 'domain', disallow: ['nope'] }] },
    { layers, rules: [{ from: 'domain', disallow: ['ui'], allow: ['shared'] }] },
    { layers, rules: [{ from: 'domain' }] },
    { layers: { ui: [] }, rules: [{ from: 'ui', disallow: [] }] },
  ];
  for (const boundaries of bad) {
    assert.throws(() => evaluate(graph, { boundaries }, factsOf(imports)), (e) => e instanceof DiagnosticError && e.diagnostics[0].code === 'config/boundaries-invalid', JSON.stringify(boundaries));
  }
});

test('boundary: ids name the layer pair, so new crossing imports keep the same problem', () => {
  const config = { boundaries: { layers, rules: [{ from: 'domain', disallow: ['ui'] }] } };
  const one = evaluate(graph, config, factsOf(imports.slice(0, 1))).diagnostics[0];
  const two = evaluate(graph, config, factsOf(imports.slice(0, 2))).diagnostics[0];
  assert.equal(one.id, two.id);
  assert.notEqual(one.evidenceDigest.sha256, two.evidenceDigest.sha256, 'but the evidence changed');
});

test('boundary: coverage lists layers with their file counts, including layers that match nothing', () => {
  const boundaries = { layers: { ...layers, legacy: ['old/**'] }, rules: [{ from: 'domain', disallow: ['ui'] }] };
  const c = buildOverview({ findings: [], graph, facts: factsOf(imports, roles), run: { boundaries } }).coverage;
  assert.deepEqual(c.boundaries, { layers: [{ name: 'domain', files: 2 }, { name: 'ui', files: 2 }, { name: 'shared', files: 1 }, { name: 'legacy', files: 0 }], rules: 1 });
  assert.equal(buildOverview({ findings: [], graph, facts: factsOf(imports) }).coverage.boundaries, null);
});

test('boundary: the overlay ties a crossing to the components on both ends', () => {
  const g = { ...graph, modules: [
    { id: 'src-domain', label: 'src/domain', path: 'src/domain', files: 2, loc: 2, fanIn: 1, fanOut: 1, instability: 0.5, entry: [] },
    { id: 'src-ui', label: 'src/ui', path: 'src/ui', files: 2, loc: 2, fanIn: 1, fanOut: 1, instability: 0.5, entry: [] },
  ], fileModules: { 'src/domain/order.ts': 'src-domain', 'src/domain/price.ts': 'src-domain', 'src/ui/button.ts': 'src-ui', 'src/ui/format.ts': 'src-ui' } };
  const ir = { components: [{ id: 'core', label: 'Core', sources: [{ path: 'src/domain/order.ts' }] }, { id: 'web', label: 'Web', sources: [{ path: 'src/ui/button.ts' }] }, { id: 'db', label: 'DB' }] };
  const facts = factsOf(imports.slice(0, 2));
  const findings = evaluate(g, { boundaries: { layers, rules: [{ from: 'domain', disallow: ['ui'] }] } }, facts).diagnostics;
  const html = '<body><div class="toolbar"></div><svg><g data-node-id="core"></g><g data-node-id="web"></g><g data-node-id="db"></g></svg></body>';
  const data = JSON.parse(buildOverlay({ ir, graph: g, html, facts, findings }).html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
  assert.deepEqual(data.findings[0].componentIds, ['core', 'web']);
  assert.deepEqual(data.findings[0].moduleIds, ['src-domain', 'src-ui']);
  const indicator = (id) => data.components.find((c) => c.id === id).indicators.items.find((i) => i.key === 'boundary');
  assert.equal(indicator('core').status, 'amber');
  assert.match(indicator('core').value, /domain → ui \(2 imports\)/);
  assert.equal(indicator('db'), undefined, 'no indicator where nothing crosses');
  const clean = JSON.parse(buildOverlay({ ir, graph: g, html, facts, findings: [] }).html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
  assert.ok(!clean.components.some((c) => c.indicators.items.some((i) => i.key === 'boundary')), 'no green "boundary" claim when nothing was checked');
});

test('boundary: end to end on a real TypeScript tree with a config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-'));
  try {
    fs.mkdirSync(path.join(dir, 'src/domain'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/domain/order.ts'), "import { label } from '../ui/label.js';\nexport const order = label('x');\n");
    fs.writeFileSync(path.join(dir, 'src/ui/label.ts'), 'export const label = (s: string) => s;\n');
    const configPath = path.join(dir, 'analysis.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ boundaries: { layers: { domain: 'src/domain/**', ui: ['src/ui/**'] }, rules: [{ from: 'domain', disallow: ['ui'] }] } }));
    const config = loadConfig(configPath);
    const { facts } = extractFacts(dir, { language: 'ts', config });
    const findings = evaluateGraph(buildGraph(facts, config), config, facts);
    const f = findings.diagnostics.find((d) => d.code === 'architecture/boundary');
    assert.ok(f, 'the crossing import is found');
    assert.deepEqual(f.evidence.imports.map((i) => [i.file, i.line, i.to]), [['src/domain/order.ts', 1, 'src/ui/label.ts']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
