// Atlas payload: a projection of raw facts, the module graph and findings.
// The page draws whatever this returns, so a dependency, function or finding
// lost or misattributed here is drawn wrong without any other check noticing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { buildGraph, evaluateGraph, extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildAtlas, moduleLabels } from '../overlay/atlas.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { copySource, SOURCE } from './task-fixtures.mjs';
import path from 'node:path';

function analyze(t) {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(path.join(SOURCE, 'analysis.config.json'));
  const { facts } = extractFacts(dir, { language: 'py', config });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts).diagnostics;
  return { facts, graph, findings, atlas: buildAtlas({ graph, facts, findings }) };
}

test('atlas: every in-tree dependency between analyzed files is drawn once, between the right files', (t) => {
  const { facts, graph, atlas } = analyze(t);
  const paths = atlas.files.map((f) => f[0]);
  assert.deepEqual([...paths].sort(), Object.keys(graph.fileModules).sort(), 'exactly the files the module graph owns');
  const expected = new Set(facts.imports.filter((i) => i.resolved && i.from !== i.to && graph.fileModules[i.from] && graph.fileModules[i.to]).map((i) => `${i.from}>${i.to}`));
  const drawn = atlas.edges.map(([a, b]) => `${paths[a]}>${paths[b]}`);
  assert.equal(new Set(drawn).size, drawn.length, 'no duplicate curves');
  assert.deepEqual(new Set(drawn), expected);
  // Files of one module are contiguous, in module order, so each module is one arc.
  const order = atlas.files.map((f) => f[1]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const [file, module] of atlas.files) assert.equal(atlas.modules[module].id, graph.fileModules[file]);
});

test('atlas: functions keep their measurements and reported ones point at their finding', (t) => {
  const { facts, graph, findings, atlas } = analyze(t);
  const owned = facts.functions.filter((fn) => graph.fileModules[fn.file]);
  assert.equal(atlas.functions.length, owned.length, 'every measured function in an analyzed file');
  const complex = findings.filter((f) => f.code === 'complexity/function');
  assert.ok(complex.length, 'the fixture reports a complex function');
  for (const f of complex) {
    const entry = atlas.findings.find((x) => x.id === f.id);
    assert.equal(entry.kind, 'function');
    const fn = atlas.functions[entry.fn];
    assert.deepEqual([atlas.files[fn[0]][0], fn[1], fn[3], fn[4]], [f.subject.file, f.subject.function, f.evidence.complexity, f.evidence.nesting]);
    assert.equal(atlas.findings[fn[6]].id, f.id, 'the function points back at its finding');
  }
  assert.ok(atlas.functions.every((fn) => fn[6] === -1 || atlas.findings[fn[6]].kind === 'function'));
});

test('atlas: cycles, module cycles and boundary imports select the files and modules they name', (t) => {
  const { findings, atlas } = analyze(t);
  const paths = atlas.files.map((f) => f[0]);
  const byId = new Map(atlas.findings.map((f) => [f.id, f]));
  assert.equal(atlas.findings.length, findings.length, 'every finding is listed');
  for (const f of findings) {
    const entry = byId.get(f.id);
    if (f.code === 'coupling/import-cycle') {
      assert.deepEqual(entry.files.map((i) => paths[i]).sort(), [...f.subject.files].sort());
      assert.deepEqual(entry.path.map((i) => paths[i]), f.evidence.path);
    }
    if (f.code === 'coupling/cycle') assert.deepEqual(entry.modules.map((i) => atlas.modules[i].id).sort(), [...f.subject.modules].sort());
    if (f.code === 'architecture/boundary') assert.deepEqual(entry.edges.map(([a, b]) => `${paths[a]}>${paths[b]}`), f.evidence.imports.map((i) => `${i.file}>${i.to}`));
  }
  for (const code of ['coupling/import-cycle', 'coupling/cycle', 'architecture/boundary']) assert.ok(findings.some((f) => f.code === code), `fixture covers ${code}`);
});

test('atlas: a hub selects its module; accepted findings are marked; without raw facts there is no atlas', (t) => {
  const { facts, graph, findings } = analyze(t);
  const module = graph.modules[0].id;
  const hub = { id: 'COUP-hub', code: 'coupling/hub', severity: 'warning', subject: { module }, evidence: { fanIn: 5, fanOut: 5 } };
  const atlas = buildAtlas({ graph, facts, findings: [...findings, hub], review: { findings: { 'COUP-hub': { status: 'accepted' } } } });
  const entry = atlas.findings.find((f) => f.id === 'COUP-hub');
  assert.equal(atlas.modules[entry.module].id, module);
  assert.equal(entry.accepted, true);
  assert.ok(atlas.findings.filter((f) => f.id !== 'COUP-hub').every((f) => !f.accepted));
  assert.equal(buildAtlas({ graph, facts: null, findings }), null);
});

test('atlas: coverage reports what draws no curve', (t) => {
  const { facts, atlas } = analyze(t);
  const c = atlas.coverage;
  assert.equal(c.records, facts.imports.length);
  assert.equal(c.resolved, facts.imports.filter((i) => i.resolved).length);
  assert.equal(c.resolved + c.external + c.unknown + c.outside, c.records, 'every dependency record is counted once');
});

test('atlas: module labels are the shortest path tails that stay unique', () => {
  assert.deepEqual(
    moduleLabels(['src/main/java/org/a', 'src/main/java/org/a/b', '.mvn/wrapper', 'x/util', 'y/util', '']),
    ['a', 'b', 'wrapper', 'x/util', 'y/util', '.'],
  );
});

test('atlas: the overlay embeds the atlas before the Classic script only when raw facts are given', (t) => {
  const { facts, graph, findings } = analyze(t);
  const html = '<html><body><div class="toolbar"></div><svg><g data-node-id="app"></g></svg></body></html>';
  const ir = { schema_version: 1, diagram_type: 'architecture', meta: { title: 't', output: 'a.html' }, components: [{ id: 'app', type: 'backend', label: 'App', pos: [0, 0], size: [100, 40] }], connections: [] };
  const withFacts = buildOverlay({ ir, graph, html, facts, findings }).html;
  const order = ['bauify-analysis', 'bauify-atlas-data', 'bauify-script', 'bauify-atlas-script'].map((id) => withFacts.indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i > 0), 'all parts present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'atlas data precedes the Classic script; the atlas script follows it');
  const without = buildOverlay({ ir, graph, html, facts: null, findings }).html;
  assert.ok(!without.includes('id="bauify-atlas-data"') && !without.includes('id="bauify-atlas-script"'), 'no atlas without raw facts');
});
