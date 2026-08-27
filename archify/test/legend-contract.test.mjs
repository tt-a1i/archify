import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-legend-contract-'));
let sequence = 0;

const FIXTURES = {
  architecture: {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Legend architecture', viewBox: [720, 420] },
    components: [
      { id: 'ui', type: 'frontend', label: 'UI', pos: [60, 90] },
      { id: 'store', type: 'database', label: 'Store', pos: [300, 90] },
    ],
    connections: [],
  },
  workflow: {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Legend workflow', viewBox: [720, 360] },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'ui', lane: 'main', col: 0, type: 'frontend', label: 'UI' },
      { id: 'agent', lane: 'main', col: 2, type: 'backend', label: 'Agent' },
    ],
    edges: [],
  },
  sequence: {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Legend sequence', viewBox: [720, 560] },
    participants: [
      { id: 'client', type: 'frontend', label: 'Client' },
      { id: 'api', type: 'backend', label: 'API' },
    ],
    messages: [
      { from: 'client', to: 'api', y: 220, label: 'request', variant: 'emphasis' },
      { from: 'api', to: 'client', y: 280, label: 'response', variant: 'return' },
    ],
  },
  dataflow: {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Default Flow Only' },
    stages: [{ label: 'Input' }, { label: 'Output' }],
    nodes: [
      { id: 'input', type: 'backend', label: 'Input', stage: 0, row: 0 },
      { id: 'output', type: 'backend', label: 'Output', stage: 1, row: 0 },
    ],
    flows: [
      { from: 'input', to: 'output', label: 'request', route: 'straight' },
    ],
  },
  lifecycle: {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'No Waiting or Failure', viewBox: [720, 566] },
    lanes: [{ id: 'main', label: 'Lifecycle' }],
    states: [
      { id: 'started', type: 'start', label: 'Started', lane: 'main', col: 0 },
      { id: 'running', type: 'active', label: 'Running', lane: 'main', col: 1 },
      { id: 'completed', type: 'success', label: 'Completed', lane: 'main', col: 2 },
    ],
    transitions: [
      { from: 'started', to: 'running' },
      { from: 'running', to: 'completed' },
    ],
  },
};

const CATALOGS = {
  architecture: ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'],
  workflow: ['frontend', 'backend', 'security', 'messagebus', 'database', 'cloud', 'external'],
  sequence: ['emphasis', 'return', 'security', 'dashed', 'default'],
  dataflow: ['emphasis', 'security', 'dashed', 'database', 'default'],
  lifecycle: ['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external'],
};

const AUTO_KINDS = {
  architecture: ['frontend', 'database'],
  workflow: ['frontend', 'backend'],
  sequence: ['emphasis', 'return'],
  dataflow: ['default'],
  lifecycle: ['start', 'active', 'success'],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withLegend(type, legend) {
  const doc = clone(FIXTURES[type]);
  if (legend !== undefined) doc.meta.legend = legend;
  return doc;
}

function run(type, doc, command = 'render') {
  const id = sequence++;
  const input = path.join(tmp, `${id}-${type}.json`);
  const output = path.join(tmp, `${id}-${type}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const args = command === 'render'
    ? [cli, 'render', type, input, output]
    : [cli, 'validate', type, input, '--json'];
  const result = spawnSync(process.execPath, args, { cwd: skillRoot, encoding: 'utf8' });
  return {
    ...result,
    html: result.status === 0 && command === 'render' ? fs.readFileSync(output, 'utf8') : '',
  };
}

function render(type, doc) {
  const result = run(type, doc);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.html;
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function attrValues(source, attribute) {
  const pattern = new RegExp(`${attribute}="([^"]+)"`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function legendKinds(html) {
  return attrValues(canonicalSvg(html), 'data-legend-semantic-kind');
}

function validateFailure(type, doc) {
  const result = run(type, doc, 'validate');
  assert.notEqual(result.status, 0, `expected ${type} validation to fail`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  return payload;
}

test('public typed renderers default to auto and expose only authored semantic kinds', () => {
  for (const type of Object.keys(FIXTURES)) {
    const html = render(type, FIXTURES[type]);
    assert.deepEqual(legendKinds(html), AUTO_KINDS[type], type);
  }
});

test('Dataflow database node facts are interactive while flow variants stay visual-only', () => {
  const withDatabase = clone(FIXTURES.dataflow);
  withDatabase.nodes[1].type = 'database';
  const databaseSvg = canonicalSvg(render('dataflow', withDatabase));
  assert.deepEqual(attrValues(databaseSvg, 'data-legend-semantic-kind'), ['database', 'default']);
  assert.deepEqual(attrValues(databaseSvg, 'data-legend-kind'), ['database']);
  assert.equal((databaseSvg.match(/data-legend-bridge=""/g) || []).length, 1);
  assert.ok(attrValues(databaseSvg, 'data-node-kind').includes('database'));

  const forcedWithoutFact = canonicalSvg(render('dataflow', withLegend('dataflow', {
    entries: { database: { visible: true } },
  })));
  assert.deepEqual(attrValues(forcedWithoutFact, 'data-legend-semantic-kind'), ['database', 'default']);
  assert.deepEqual(attrValues(forcedWithoutFact, 'data-legend-kind'), []);
  assert.doesNotMatch(forcedWithoutFact, /data-legend-bridge/);
});

test('Issue #52 dataflow and lifecycle reproductions publish truthful default legends', () => {
  const dataflow = canonicalSvg(render('dataflow', FIXTURES.dataflow));
  assert.deepEqual(attrValues(dataflow, 'data-legend-semantic-kind'), ['default']);
  assert.doesNotMatch(dataflow, /policy \/ PII|async batch|primary data|data store/i);
  assert.doesNotMatch(dataflow, /data-legend-bridge|data-legend-kind=/);

  const lifecycle = canonicalSvg(render('lifecycle', FIXTURES.lifecycle));
  const lifecycleLegend = lifecycle.slice(lifecycle.indexOf('<!-- Legend -->'));
  assert.deepEqual(attrValues(lifecycleLegend, 'data-legend-semantic-kind'), ['start', 'active', 'success']);
  assert.doesNotMatch(lifecycleLegend, /waiting|failure \/ exit/i);
  assert.deepEqual(attrValues(lifecycleLegend, 'data-legend-kind'), ['start', 'active', 'success']);
});

test('all mode follows each renderer-owned stable catalog order', () => {
  for (const type of Object.keys(FIXTURES)) {
    const html = render(type, withLegend(type, { mode: 'all' }));
    assert.deepEqual(legendKinds(html), CATALOGS[type], type);
  }
});

test('hidden mode removes the complete legend and overrides visible true', () => {
  for (const type of Object.keys(FIXTURES)) {
    const forcedKind = CATALOGS[type].at(-1);
    const html = render(type, withLegend(type, {
      mode: 'hidden',
      entries: { [forcedKind]: { label: 'Must stay hidden', visible: true } },
    }));
    const svg = canonicalSvg(html);
    assert.doesNotMatch(svg, />Legend</);
    assert.doesNotMatch(svg, /data-legend(?:-semantic-kind|-kind|-bridge)?=/);
    assert.doesNotMatch(svg, /Must stay hidden/);
  }
});

test('visibility overrides apply after auto/all and empty legends leave no chrome', () => {
  const cases = {
    architecture: { hidden: 'frontend', forced: 'external' },
    workflow: { hidden: 'frontend', forced: 'security' },
    sequence: { hidden: 'emphasis', forced: 'dashed' },
    dataflow: { hidden: 'default', forced: 'database' },
    lifecycle: { hidden: 'active', forced: 'waiting' },
  };
  for (const [type, kinds] of Object.entries(cases)) {
    const html = render(type, withLegend(type, {
      entries: {
        [kinds.hidden]: { visible: false },
        [kinds.forced]: { visible: true },
      },
    }));
    const expected = AUTO_KINDS[type]
      .filter((kind) => kind !== kinds.hidden)
      .concat(kinds.forced)
      .sort((left, right) => CATALOGS[type].indexOf(left) - CATALOGS[type].indexOf(right));
    assert.deepEqual(legendKinds(html), expected, type);
  }

  const allMinusSecurity = render('sequence', withLegend('sequence', {
    mode: 'all',
    entries: { security: { visible: false } },
  }));
  assert.deepEqual(
    legendKinds(allMinusSecurity),
    CATALOGS.sequence.filter((kind) => kind !== 'security'),
  );

  for (const type of Object.keys(FIXTURES)) {
    const entries = Object.fromEntries(AUTO_KINDS[type].map((kind) => [kind, { visible: false }]));
    const empty = canonicalSvg(render(type, withLegend(type, { entries })));
    assert.doesNotMatch(empty, />Legend</, type);
    assert.doesNotMatch(empty, /data-legend/, type);
  }
});

test('label overrides round-trip through all five public renderers', () => {
  for (const type of Object.keys(FIXTURES)) {
    const kind = AUTO_KINDS[type][0];
    const label = `Custom ${type} label`;
    const svg = canonicalSvg(render(type, withLegend(type, {
      entries: { [kind]: { label } },
    })));
    assert.match(svg, new RegExp(`data-legend-semantic-kind="${kind}"`), type);
    assert.match(svg, new RegExp(`>${label}<`), type);
    if (['architecture', 'workflow', 'lifecycle'].includes(type)) {
      assert.match(svg, new RegExp(`data-legend-kind="${kind}"[^>]+data-legend-label="${label}"`), type);
    } else {
      assert.doesNotMatch(svg, /data-legend-kind=/, type);
    }
  }
});

test('label overrides preserve stable kinds and exact Semantic Legend boundaries', () => {
  const architecture = render('architecture', withLegend('architecture', {
    entries: {
      frontend: { label: 'Reader <UI> & "ops"' },
      external: { label: 'Future integration', visible: true },
    },
  }));
  const svg = canonicalSvg(architecture);
  const baselineSvg = canonicalSvg(render('architecture', FIXTURES.architecture));
  assert.deepEqual(attrValues(svg, 'data-node-id'), attrValues(baselineSvg, 'data-node-id'));
  assert.deepEqual(attrValues(svg, 'data-node-kind'), attrValues(baselineSvg, 'data-node-kind'));
  assert.deepEqual(attrValues(svg, 'data-edge-from'), attrValues(baselineSvg, 'data-edge-from'));
  assert.match(svg, />Reader &lt;UI&gt; &amp; &quot;ops&quot;</);
  assert.doesNotMatch(svg, /<UI>/);
  assert.match(svg, />Future integration</);
  assert.deepEqual(attrValues(svg, 'data-legend-semantic-kind'), ['frontend', 'database', 'external']);
  assert.deepEqual(attrValues(svg, 'data-legend-kind'), ['frontend', 'database']);
  assert.match(svg, /data-legend-kind="frontend"[^>]+data-legend-label="Reader &lt;UI&gt; &amp; &quot;ops&quot;"/);
  assert.match(architecture, /entry\.getAttribute\('data-legend-label'\)/);

  for (const type of ['sequence', 'dataflow']) {
    const kind = type === 'sequence' ? 'emphasis' : 'default';
    const html = canonicalSvg(render(type, withLegend(type, {
      entries: { [kind]: { label: 'Visible only' } },
    })));
    assert.match(html, />Visible only</);
    assert.doesNotMatch(html, /data-legend-bridge|data-legend-kind=/);
  }
});

test('strict per-renderer schemas reject malformed legend contracts with path-prefixed errors', () => {
  const known = {
    architecture: 'frontend', workflow: 'frontend', sequence: 'default', dataflow: 'default', lifecycle: 'start',
  };
  const cases = [
    [{ mode: 'sometimes' }, '/meta/legend/mode'],
    [{ entries: { unknown_kind: { visible: true } } }, '/meta/legend/entries'],
    [(type) => ({ entries: { [known[type]]: { label: '' } } }), '/meta/legend/entries/'],
    [(type) => ({ entries: { [known[type]]: { visible: 'yes' } } }), '/meta/legend/entries/'],
    [(type) => ({ entries: { [known[type]]: { color: '#fff' } } }), '/meta/legend/entries/'],
    [{ mode: 'auto', extra: true }, '/meta/legend'],
  ];
  for (const type of Object.keys(FIXTURES)) {
    for (const [legendOrFactory, pathPrefix] of cases) {
      const legend = typeof legendOrFactory === 'function' ? legendOrFactory(type) : legendOrFactory;
      const failure = validateFailure(type, withLegend(type, legend));
      assert.ok(
        failure.diagnostics.some((diagnostic) => diagnostic.subject.path.startsWith(pathPrefix)),
        `${type}: expected a diagnostic under ${pathPrefix}: ${JSON.stringify(failure.diagnostics)}`,
      );
    }
  }
});

test('measured legends fail explicitly instead of wrapping into diagram content', () => {
  const label = '界'.repeat(40);
  const entries = Object.fromEntries(CATALOGS.workflow.map((kind) => [kind, { label }]));
  const failure = validateFailure('workflow', withLegend('workflow', { mode: 'all', entries }));
  const diagnostic = failure.diagnostics.find((entry) => entry.code === 'legend/vertical-overflow');
  assert.ok(diagnostic, JSON.stringify(failure.diagnostics));
  assert.equal(diagnostic.subject.path, '/meta/legend');
  assert.ok(diagnostic.evidence.rowCount > 1);

  const routedEntries = Object.fromEntries(CATALOGS.architecture.map((kind) => [
    kind,
    { label: `Long ${kind} convention` },
  ]));
  const routed = withLegend('architecture', { mode: 'all', entries: routedEntries });
  routed.connections = [{
    from: 'ui',
    to: 'store',
    label: 'bottom route',
    fromSide: 'bottom',
    toSide: 'bottom',
    via: [[120, 382], [360, 382]],
    labelAt: [240, 370],
  }];
  const renderFailure = run('architecture', routed);
  assert.notEqual(renderFailure.status, 0);
  assert.match(renderFailure.stderr, /legend\/content-overlap/);
  assert.equal(renderFailure.html, '');
});

test('explicit Architecture viewBox rejects legend title rectangles that overlap content', () => {
  const doc = clone(FIXTURES.architecture);
  doc.meta.viewBox = [320, 320];
  doc.meta.legend = { mode: 'auto' };
  doc.components = [
    { id: 'ui', type: 'frontend', label: 'UI', pos: [40, 216], size: [120, 60] },
  ];
  const failure = validateFailure('architecture', doc);
  const diagnostic = failure.diagnostics.find((entry) => entry.code === 'legend/vertical-overflow');
  assert.ok(diagnostic, JSON.stringify(failure.diagnostics));
  assert.equal(diagnostic.subject.path, '/meta/legend');
  assert.ok(diagnostic.evidence.requiredTopY < diagnostic.evidence.availableTopY);
});

test('a single unfit label fails with a path-specific width diagnostic', () => {
  const failure = validateFailure('architecture', withLegend('architecture', {
    entries: { frontend: { label: '界'.repeat(80) } },
  }));
  const diagnostic = failure.diagnostics.find((entry) => entry.code === 'legend/label-too-wide');
  assert.ok(diagnostic, JSON.stringify(failure.diagnostics));
  assert.equal(diagnostic.subject.path, '/meta/legend/entries/frontend/label');
  assert.ok(diagnostic.evidence.measuredWidthPx > diagnostic.evidence.availableWidthPx);
});

test('measured legend rows share baselines and stay within the viewBox for localized labels', () => {
  const doc = withLegend('lifecycle', {
    mode: 'all',
    entries: {
      start: { label: '开始 / Start of the complete lifecycle' },
      active: { label: '正在执行 active processing' },
      waiting: { label: '等待人工输入' },
      decision: { label: 'Decision gate with deterministic wrapping' },
      success: { label: '成功完成' },
      failure: { label: 'Failure / 失败' },
      neutral: { label: 'Neutral state' },
      external: { label: 'External system' },
    },
  });
  const svg = canonicalSvg(render('lifecycle', doc));
  const viewBox = attrValues(svg.match(/<svg\b[^>]*>/)?.[0] || '', 'viewBox')[0].split(/\s+/).map(Number);
  const tags = [...svg.matchAll(/<g\b[^>]*data-legend-semantic-kind="[^"]+"[^>]*>/g)].map((match) => match[0]);
  assert.equal(tags.length, CATALOGS.lifecycle.length);
  const boxes = tags.map((tag) => ({
    x: Number(attrValues(tag, 'data-legend-x')[0]),
    y: Number(attrValues(tag, 'data-legend-baseline')[0]),
    width: Number(attrValues(tag, 'data-legend-width')[0]),
  }));
  assert.ok(boxes.every((box) => Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width)));
  assert.ok(boxes.every((box) => box.x >= 0 && box.x + box.width <= viewBox[2]));
  const rows = new Map();
  for (const box of boxes) rows.set(box.y, [...(rows.get(box.y) || []), box]);
  for (const row of rows.values()) {
    const sorted = [...row].sort((left, right) => left.x - right.x);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(sorted[index - 1].x + sorted[index - 1].width <= sorted[index].x);
    }
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
