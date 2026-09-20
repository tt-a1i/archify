import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { walkClock } from '../renderers/shared/clock-walk.mjs';

// The artifact's clock is not a picture of numbers: it is a derivation, and a
// derivation can be recomputed. This suite recomputes every time the renderer
// drew, from the document alone, so a drift between what the generator drew and
// what the reader's browser will replay fails here instead of in review.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-clock-arithmetic-'));

const RULE = {
  id: 'day_clock',
  kind: 'accumulate',
  seeds: { l1: { start: 'a', base: '23:00' }, l2: { start: 'd', base: '09:00' }, l3: { start: 'e', base: '08:00' } },
  add: { node: 'stay', edge: 'ride' },
  render: { edge: '{value} ', lane: '· {value} 出发' },
  wrap: { at: 1440, label: 'next ' },
};

const DOCUMENT = {
  schema_version: 2,
  diagram_type: 'workflow',
  meta: {
    title: 'Clock fixture',
    quality_profile: 'showcase',
    rules: [RULE],
    reader: {
      slots: [
        { id: 'here', kind: 'point', label: 'Here' },
        { id: 'at', kind: 'time', label: 'At' },
        { id: 'stay', kind: 'minutes', label: 'Stay' },
      ],
      view: { dim: [{ slot: 'here', reach: 'before' }], stow: [{ slot: 'here', reach: 'before' }] },
      clock: { rule: 'day_clock', anchor: 'here', at: 'at', dwell: 'stay' },
    },
  },
  lanes: [{ id: 'l1', label: 'Night' }, { id: 'l2', label: 'Day' }, { id: 'l3', label: 'Loop' }],
  nodes: [
    { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'A', width: 120, facts: { stay: 20 } },
    { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'B', width: 120, facts: { stay: 45 } },
    { id: 'c', lane: 'l1', col: 2, type: 'database', label: 'C', width: 120, facts: { stay: 30 } },
    { id: 'd', lane: 'l2', col: 1, type: 'cloud', label: 'D', width: 120, facts: { stay: 10 } },
    { id: 'e', lane: 'l3', col: 0, type: 'frontend', label: 'E', width: 120, facts: { stay: 10 } },
    { id: 'f', lane: 'l3', col: 1, type: 'backend', label: 'F', width: 120, facts: { stay: 10 } },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', label: 'ride', facts: { ride: 25 } },
    { id: 'bc', from: 'b', to: 'c', label: 'ride', facts: { ride: 35 } },
    { id: 'cd', from: 'c', to: 'd', label: 'ride', facts: { ride: 5 } },
    { id: 'da', from: 'd', to: 'a', label: 'ride', facts: { ride: 0 } },
    { id: 'ef', from: 'e', to: 'f', label: 'ride', facts: { ride: 10 } },
    { id: 'fe', from: 'f', to: 'e', label: 'ride', facts: { ride: 10 } },
  ],
  cards: [],
};

test('a node named after an inherited member is still just a node', () => {
  const result = walkClock({
    // The host parses a clock string before the walk; this case feeds it minutes.
    lanes: { l1: { start: 'constructor', base: 9 * 60 } },
    nodes: { constructor: 10, toString: 5 },
    edges: { 'constructor toString': 20 },
    laneId: 'l1',
  });
  assert.equal(result.stop, 'end', 'a plain object would read Object.prototype.constructor as already seen');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].node, 'constructor');
  assert.equal(result.rows[0].to, 'toString');
  assert.equal(result.rows[1].node, 'toString');
  assert.equal(result.end, 9 * 60 + 10 + 20 + 5);
});

test('a chain longer than any fixed guard still reports every stop', () => {
  const nodes = {};
  const edges = {};
  const count = 80;
  for (let index = 0; index < count; index += 1) nodes['n' + index] = 1;
  for (let index = 0; index < count - 1; index += 1) edges['n' + index + ' n' + (index + 1)] = 2;
  const result = walkClock({ lanes: { l1: { start: 'n0', base: 0 } }, nodes, edges, laneId: 'l1' });
  assert.equal(result.stop, 'end', 'a fixed cap would report a normal end for a truncated walk');
  assert.equal(result.rows.length, count);
  assert.equal(result.end, count * 1 + (count - 1) * 2);
});

function fixtureFile(document) {
  const file = path.join(tmp, 'clock-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify(document, null, 2));
  return file;
}

function render(document) {
  const file = fixtureFile(document);
  const output = path.join(tmp, path.basename(file) + '.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'workflow', 'render-workflow.mjs'), file, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, 'render must succeed:\n' + (result.stdout || result.stderr));
  return fs.readFileSync(output, 'utf8');
}

function clockInput(document, laneId) {
  const rule = document.meta.rules[0];
  const nodes = {};
  // Absent facts are no contribution, exactly as the compiler reads them.
  document.nodes.forEach((node) => {
    const bag = node.facts || {};
    if (typeof bag[rule.add.node] === 'number') nodes[node.id] = bag[rule.add.node];
  });
  // A lane walk stays inside its lane unless the rule declares scope "chain",
  // which is the same restriction the compiler applies when it derives.
  const inLane = new Set(document.nodes.filter((node) => node.lane === laneId).map((node) => node.id));
  const edges = {};
  document.edges.forEach((edge) => {
    if (!inLane.has(edge.from) || !inLane.has(edge.to)) return;
    edges[edge.from + ' ' + edge.to] = edge.facts[rule.add.edge];
  });
  return {
    lanes: Object.fromEntries(Object.entries(rule.seeds).map(([id, seed]) => [id, { start: seed.start, base: minutes(seed.base) }])),
    nodes,
    edges,
    laneId,
  };
}

function minutes(value) {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(value));
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number(value);
}

// Independent formatting, mirroring the rule's declared render templates.
function format(document, value) {
  const wrap = document.meta.rules[0].wrap;
  if (wrap && value >= wrap.at) {
    const rest = value - wrap.at;
    return wrap.label + String(Math.floor(rest / 60)).padStart(2, '0') + ':' + String(rest % 60).padStart(2, '0');
  }
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
}

function drawnLabels(html) {
  const labels = {};
  for (const match of html.matchAll(/<g [^>]*data-edge-from="([^"]+)"[^>]*data-edge-to="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const text = match[3].match(/<text[^>]*>([^<]*)<\/text>/);
    if (text) labels[match[1] + ' ' + match[2]] = text[1];
  }
  return labels;
}

test('every time the renderer drew equals a fresh derivation from the document', () => {
  const html = render(DOCUMENT);
  const labels = drawnLabels(html);
  // An edge the rule never reached is still drawn, with its authored label and
  // no derived time; a reached one carries the rule's own template.
  const expected = {};
  for (const edge of DOCUMENT.edges) expected[edge.from + ' ' + edge.to] = edge.label;
  for (const laneId of ['l1', 'l2', 'l3']) {
    const walk = walkClock(clockInput(DOCUMENT, laneId));
    assert.ok(walk && walk.rows.length, laneId + ' must walk');
    for (const row of walk.rows) {
      if (!row.key) continue;
      const edge = DOCUMENT.edges.find((candidate) => candidate.from + ' ' + candidate.to === row.key);
      expected[row.key] = RULE.render.edge.replace('{value}', format(DOCUMENT, row.value)) + edge.label;
    }
  }
  assert.deepEqual(labels, expected);
  // A day that walks back to its own base stops where the generator stopped,
  // and a lane whose chain leaves the lane simply ends.
  assert.equal(walkClock(clockInput(DOCUMENT, 'l3')).stop, 'cycle');
  assert.equal(walkClock(clockInput(DOCUMENT, 'l1')).stop, 'end');
  assert.equal(walkClock(clockInput(DOCUMENT, 'l1')).last, 'c');
  assert.equal(walkClock(clockInput(DOCUMENT, 'l2')).last, 'd');
});

test('the artifact replays the very same walk, not a second implementation', () => {
  const html = render(DOCUMENT);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const reader = scripts.find((script) => script.includes('archify-reader:'));
  assert.ok(reader, 'the reader runtime must be emitted');
  const embedded = reader.match(/var walkClock = (function walkClock[\s\S]*?);\n/);
  assert.ok(embedded, 'the runtime must embed the shared walk');
  assert.match(embedded[1], /function walkClock\(input\)/);
  assert.match(reader, /walkClock\(\{/);
  assert.match(reader, /anchorLane: anchor \? laneOf\(anchor\) : null/);
});

test('a reader moment moves the plan and leaves everything upstream alone', () => {
  const document = JSON.parse(JSON.stringify(DOCUMENT));
  const lane = clockInput(document, 'l1');
  const anchored = walkClock({
    ...lane,
    anchor: 'b',
    anchorLane: 'l1',
    anchorTime: minutes('21:10'),
  });
  assert.equal(anchored.anchored, true);
  // Upstream of the anchor nothing is recomputed; the anchor's own stay counts
  // from the moment the reader arrived.
  const rows = anchored.rows.filter((row) => row.key);
  // From the anchor the walk continues to the end of its own lane, which is
  // where the generated drawing stopped too.
  assert.deepEqual(rows.map((row) => row.key), ['b c']);
  assert.equal(rows[0].value, minutes('21:10') + 45 + 35);
  assert.equal(format(document, rows[0].value), '22:30');
  // A chain that leaves its lane ends there; the second lane's own seed is its
  // only origin, so it draws no derived time at all.
  assert.equal(walkClock(clockInput(document, 'l2')).rows.filter((row) => row.key).length, 0);
  // The plan keeps its own numbers, which is what the shadow shows.
  const plan = walkClock(lane);
  assert.equal(plan.rows.find((row) => row.key === 'b c').value, minutes('23:00') + 20 + 25 + 45 + 35);
  assert.equal(format(document, 1445), 'next 00:05');
});

test('a reader reserve overrides the authored stay without editing the document', () => {
  const lane = clockInput(DOCUMENT, 'l1');
  const plan = walkClock(lane);
  const changed = walkClock({ ...lane, dwells: { b: 10 } });
  const planArrival = plan.rows.find((row) => row.key === 'b c').value;
  const changedArrival = changed.rows.find((row) => row.key === 'b c').value;
  assert.equal(planArrival - changedArrival, 35);
  // The document itself is untouched: only the reader's value moved.
  assert.equal(DOCUMENT.nodes.find((node) => node.id === 'b').facts.stay, 45);
});

test('renaming the fields changes nothing: the operator is upstream, the names are not', () => {
  const original = render(DOCUMENT);
  const renamed = JSON.parse(JSON.stringify(DOCUMENT));
  const rule = renamed.meta.rules[0];
  rule.add = { node: 'dwell', edge: 'travel' };
  renamed.nodes.forEach((node) => { node.facts = { dwell: node.facts.stay }; });
  renamed.edges.forEach((edge) => { edge.facts = { travel: edge.facts.ride }; });
  assert.deepEqual(drawnLabels(render(renamed)), drawnLabels(original));
});

test('the Shanghai demo re-derives every time it drew, from its own document', () => {
  const spec = path.resolve(skillRoot, '..', 'out', 'shanghai-citywalk', 'shanghai-citywalk.itinerary.workflow.json');
  if (!fs.existsSync(spec)) return;
  const document = JSON.parse(fs.readFileSync(spec, 'utf8'));
  const html = fs.readFileSync(path.resolve(spec, '..', 'shanghai-citywalk.workflow.html'), 'utf8');
  const labels = drawnLabels(html);
  assert.ok(Object.keys(labels).length >= document.edges.length, 'every leg must be drawn before it can be checked');
  const expected = {};
  for (const edge of document.edges) expected[edge.from + ' ' + edge.to] = edge.label || '';
  for (const lane of document.lanes) {
    const walk = walkClock(clockInput(document, lane.id));
    assert.ok(walk, lane.id + ' must walk');
    for (const row of walk.rows) {
      if (!row.key) continue;
      const edge = document.edges.find((candidate) => candidate.from + ' ' + candidate.to === row.key);
      expected[row.key] = document.meta.rules[0].render.edge.replace('{value}', format(document, row.value)) + (edge.label || '');
    }
  }
  assert.deepEqual(labels, expected);
  // A leg may state its own duration in words; whenever it does, the number is
  // the declared fact, so what the picture says cannot drift from the sum.
  for (const edge of document.edges) {
    const stated = /(\d+)\s*分/.exec(edge.label || '');
    if (!stated) continue;
    assert.equal(Number(stated[1]), edge.facts.minutes, edge.from + '→' + edge.to + ' states ' + stated[1] + ' 分');
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
