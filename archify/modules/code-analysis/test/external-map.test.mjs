import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOverlay, findingModules } from '../overlay/inject.mjs';
import { buildAtlas } from '../overlay/atlas.mjs';

const graph = {
  schema_version: 1, repository: { root: '.', language: 'py' },
  grouping: { depth: 1, packageBoundaries: true, groups: [] }, excluded: { roles: [], files: 0 },
  modules: ['app', 'lib'].map(id => ({ id, label: id, path: id, files: 1, loc: 1, fanIn: 0, fanOut: 0, instability: null, entry: [] })),
  edges: [], fileModules: { 'app/a.py': 'app', 'lib/b.py': 'lib' }, unresolved: {},
};
const facts = { repository: graph.repository, files: Object.keys(graph.fileModules).map(path => ({ path, loc: 1, role: 'source', sourceText: 'pass\n' })), imports: [], functions: [], unresolved: {} };
const ir = { components: ['app', 'lib'].map(id => ({ id, label: id, sources: [{ path: id === 'app' ? 'app/a.py' : 'lib/b.py' }] })) };
const html = '<body><div class="toolbar"></div><svg><g data-node-id="app"></g><g data-node-id="lib"></g></svg></body>';
function finding({ id = 'CONV-aaaaaaaaaaaa', file = 'app/a.py', severity = 'error', ai = false, locations = [{ file, line: 1 }] } = {}) {
  return { id, code: ai ? 'external/coderabbit' : 'conventions/ruff', dimension: ai ? 'external-review' : 'conventions', confidence: null, severity, message: 'Source diagnostic', subject: { file, line: 1 }, evidence: {}, supportedFixes: [], external: { sourceId: ai ? 'review' : 'lint', tool: ai ? 'CodeRabbit' : 'Ruff', ruleId: ai ? null : 'F821', locations } };
}
function overlay(findings, statuses = {}) {
  const result = buildOverlay({ ir, graph, facts, findings, html, run: { review: { findings: Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status, reason: 'Reviewed source behavior' }])) } } });
  return JSON.parse(result.html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
}

test('external map: source findings drive component severity and discoverable indicator ids', () => {
  const lint = finding();
  const review = finding({ id: 'EXT-bbbbbbbbbbbb', ai: true, severity: 'warning' });
  const data = overlay([lint, review]);
  const app = data.components.find(component => component.id === 'app');
  assert.equal(app.indicators.status, 'red');
  assert.deepEqual(app.indicators.items.find(item => item.key === 'conventions').findings, [lint.id]);
  assert.equal(app.indicators.items.find(item => item.key === 'conventions').status, 'red');
  assert.deepEqual(app.indicators.items.find(item => item.key === 'external-review').findings, [review.id]);
  assert.equal(app.indicators.items.find(item => item.key === 'external-review').status, 'amber');
  assert.deepEqual(app.findings.map(item => item.id), [lint.id, review.id]);
  assert.equal(data.components.find(component => component.id === 'lib').indicators.status, 'green');
});

test('external map: accepted warnings clear their count/glow but accepted errors stay red', () => {
  const warning = finding({ severity: 'warning' });
  const acceptedWarning = overlay([warning], { [warning.id]: 'accepted' }).components[0];
  assert.equal(acceptedWarning.indicators.status, 'green');
  assert.equal(acceptedWarning.indicators.items.some(item => item.findings.includes(warning.id)), false);
  assert.equal(acceptedWarning.findings.length, 1, 'accepted source finding remains available for inspection');
  const error = finding();
  const acceptedError = overlay([error], { [error.id]: 'accepted' }).components[0];
  assert.equal(acceptedError.indicators.status, 'red');
  assert.deepEqual(acceptedError.indicators.items.find(item => item.key === 'conventions').findings, [error.id]);
  const reopened = overlay([warning], { [warning.id]: 'accepted-changed' }).components[0];
  assert.equal(reopened.indicators.status, 'amber');
});

test('external map: related source locations attach to each true file owner and supplemental files stay unmapped', () => {
  const across = finding({ locations: [{ file: 'app/a.py', line: 1 }, { file: 'lib/b.py', line: 1 }, { file: 'foreign/extra.py', line: 1 }] });
  const outside = finding({ id: 'CONV-cccccccccccc', file: 'foreign/extra.py' });
  const data = overlay([across, outside]);
  assert.deepEqual(findingModules(across, new Map(Object.entries(graph.fileModules))), ['app', 'lib']);
  assert.deepEqual(data.findings[0].componentIds, ['app', 'lib']);
  assert.deepEqual(data.findings[0].moduleIds, ['app', 'lib']);
  assert.ok(data.components.every(component => component.indicators.status === 'red'));
  assert.ok(data.components.every(component => component.findings.length === 1));
  assert.deepEqual(data.findings[1].componentIds, []);
  assert.deepEqual(data.findings[1].moduleIds, []);
  assert.equal(data.findings.length, 2, 'global result still retains the unmapped source finding');
});

test('external atlas: all mapped related files are projected without inventing supplemental nodes or import edges', () => {
  const across = finding({ locations: [{ file: 'app/a.py', line: 1 }, { file: 'lib/b.py', line: 1 }, { file: 'foreign/extra.py' }] });
  const secondary = finding({ id: 'CONV-bbbbbbbbbbbb', file: 'foreign/extra.py', locations: [{ file: 'foreign/extra.py' }, { file: 'lib/b.py', line: 1 }] });
  const outside = finding({ id: 'EXT-cccccccccccc', ai: true, severity: 'warning', file: 'foreign/extra.py' });
  const atlas = buildAtlas({ graph, facts, findings: [across, secondary, outside], review: { findings: { [secondary.id]: { status: 'accepted' } } } });
  const paths = atlas.files.map(file => file[0]);
  assert.deepEqual(atlas.findings[0].files.map(file => paths[file]), ['app/a.py', 'lib/b.py']);
  assert.equal(paths[atlas.findings[0].file], 'app/a.py');
  assert.equal(atlas.findings[1].kind, 'file');
  assert.equal(paths[atlas.findings[1].file], 'lib/b.py');
  assert.equal(atlas.findings[1].accepted, true);
  assert.equal(atlas.findings[2].kind, 'other');
  assert.equal(atlas.findings[2].file, undefined);
  assert.deepEqual(paths, ['app/a.py', 'lib/b.py']);
  assert.deepEqual(atlas.edges, []);
  assert.equal(atlas.findings.length, 3);
});
