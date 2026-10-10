// Lifecycle v3: geometry follows from mainPath and transitions alone. These
// checks render small public inputs and inspect the artifact, so they hold the
// layout contract (rows, arcs, shared exits) rather than exact coordinates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeLabelLayout } from '../archify/renderers/shared/text-fit.mjs';
import { SOURCE_BADGE_FOOTPRINT } from '../archify/renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function render(doc) {
  counter += 1;
  const input = path.join(tmp, `case-${counter}.json`);
  const output = path.join(tmp, `case-${counter}.html`);
  fs.writeFileSync(input, JSON.stringify({ ...doc, meta: { ...doc.meta, output: `case-${counter}.html` } }));
  try {
    execFileSync('node', [path.join(skillRoot, 'renderers/lifecycle/render-lifecycle.mjs'), input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    return { code: error.status ?? 1, stderr: String(error.stderr || '') };
  }
  const html = fs.readFileSync(output, 'utf8');
  const check = JSON.parse(execFileSync('node', [path.join(skillRoot, 'scripts/check-render-output.mjs'), output], { encoding: 'utf8' }));
  return { code: 0, html, svg: html.match(/<svg\b[\s\S]*?<\/svg>/)[0], check };
}

const state = (id, type = 'active', label = id) => ({ id, type, label });
const base = (overrides) => ({
  schema_version: 3,
  diagram_type: 'lifecycle',
  meta: { title: 'Lifecycle', quality_profile: 'showcase' },
  ...overrides,
});

function points(svg, from, to) {
  const tag = [...svg.matchAll(/<path [^>]*data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .find((match) => match[1] === from && match[2] === to);
  assert.ok(tag, `route ${from} -> ${to}`);
  return tag[3].split(';').map((pair) => pair.split(',').map(Number));
}
function allPoints(svg, from, to) {
  return [...svg.matchAll(/<path [^>]*data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .filter((match) => match[1] === from && match[2] === to)
    .map((match) => match[3].split(';').map((pair) => pair.split(',').map(Number)));
}
function box(svg, id) {
  const group = svg.match(new RegExp(`data-node-id="${id}"[\\s\\S]*?<rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`));
  return { x: Number(group[1]), y: Number(group[2]), width: Number(group[3]), height: Number(group[4]) };
}

function edgePath(svg, id) {
  const tags = [...svg.matchAll(new RegExp(`<path [^>]*data-edge-id="${id}"[^>]*>`, 'g'))];
  assert.equal(tags.length, 1, `one visible route for ${id}`);
  return tags[0][0];
}
function edgeLabels(svg) {
  return [...svg.matchAll(/<g data-detail="(?:context|fine)" [^>]*data-edge-id="([^"]+)"[^>]*>[\s\S]*?<\/g>/g)]
    .map((match) => ({ id: match[1], markup: match[0] }));
}

test('bundled examples pass the showcase artifact check without crossings', () => {
  for (const name of ['agent-run.lifecycle.json', 'deployment-release.lifecycle.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name), 'utf8'));
    const result = render(doc);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
    assert.equal(result.check.composition.metrics.properCrossings, 0, name);
    assert.equal(result.check.composition.metrics.resolvedCrossovers, 0, name);
  }
});

test('main path is one row, loops arc above it and other states sit one row per step below', () => {
  const result = render(base({
    mainPath: ['draft', 'review', 'done'],
    states: [state('draft', 'start'), state('review', 'decision'), state('done', 'success'), state('hold', 'waiting'), state('archived', 'neutral')],
    transitions: [
      { from: 'draft', to: 'review', label: 'submit' },
      { from: 'review', to: 'done', label: 'approve' },
      { from: 'review', to: 'draft', label: 'changes' },
      { from: 'review', to: 'hold', label: 'needs info' },
      { from: 'hold', to: 'review', label: 'info added' },
      { from: 'hold', to: 'archived', label: 'expired' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  const [draft, review, done, hold, archived] = ['draft', 'review', 'done', 'hold', 'archived'].map((id) => box(result.svg, id));
  assert.equal(draft.y, review.y);
  assert.equal(review.y, done.y);
  assert.ok(draft.x < review.x && review.x < done.x);
  assert.ok(hold.y > review.y + review.height, 'branch state sits below the main path');
  assert.ok(archived.y > hold.y + hold.height, 'a state reached from a branch sits one row deeper');
  const loop = points(result.svg, 'review', 'draft');
  assert.ok(Math.min(...loop.map(([, y]) => y)) < review.y, 'a return to an earlier phase arcs above the row');
  assert.match(result.svg, /data-lifecycle-initial-marker/);
  assert.equal((result.svg.match(/style="fill: none" stroke-width="1"/g) || []).length, 2, 'done and archived are final');
});

test('an exit shared by consecutive phases leaves one composite frame', () => {
  const result = render(base({
    mainPath: ['queued', 'starting', 'running', 'success'],
    states: [state('queued', 'start'), state('starting'), state('running'), state('success', 'success'), state('cancelled', 'failure')],
    transitions: [
      { from: 'queued', to: 'starting' },
      { from: 'starting', to: 'running' },
      { from: 'running', to: 'success' },
      { from: 'starting', to: 'cancelled', label: 'cancel' },
      { from: 'running', to: 'cancelled', label: 'cancel' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.equal((result.svg.match(/data-lifecycle-frame=""/g) || []).length, 1);
  assert.deepEqual(points(result.svg, 'starting', 'cancelled'), points(result.svg, 'running', 'cancelled'));
  assert.equal((result.svg.match(/>cancel<\/text>/g) || []).length, 1, 'one label for the shared exit');
});

test('an exit shared by non-consecutive phases uses a declared bus that passes the corridor gate', () => {
  const result = render(base({
    mainPath: ['a', 'b', 'c'],
    states: [state('a', 'start'), state('b'), state('c', 'success'), state('void', 'failure')],
    transitions: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'void', label: 'abort' },
      { from: 'c', to: 'void', label: 'abort' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.svg, /data-composition-junction="a\+c"/);
  assert.equal(result.check.composition.metrics.ambiguousCorridors, 0);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.equal((result.svg.match(/>abort<\/text>/g) || []).length, 1, 'one label for the shared exit');
});

// Two waits and a failure on one lower row give transitions between neighbours
// something to spread across.
const neighbourCase = (extra) => base({
  mainPath: ['a', 'b', 'c'],
  states: [state('a', 'start'), state('b'), state('c', 'success'), state('w', 'waiting'), state('f', 'failure')],
  transitions: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'b', to: 'w' },
    { from: 'b', to: 'f' },
    ...extra,
  ],
});

test('parallel transitions between two neighbours each get their own lane', () => {
  const two = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
  ]));
  assert.equal(two.code, 0, two.stderr);
  assert.equal(two.check.ok, true, JSON.stringify(two.check.composition.issues));
  const ys = allPoints(two.svg, 'w', 'f').map((route) => route[0][1]);
  assert.equal(ys.length, 2);
  assert.equal(new Set(ys).size, 2, 'parallel strokes need distinct y values');

  const three = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
    { from: 'w', to: 'f', label: 'skip' },
  ]));
  assert.equal(three.code, 0, three.stderr);
  assert.equal(three.check.ok, true, JSON.stringify(three.check.composition.issues));
  const ys3 = allPoints(three.svg, 'w', 'f').map((route) => route[0][1]);
  assert.equal(new Set(ys3).size, 3, 'three parallel strokes need three distinct y values');
});

test('a reciprocal pair still lands just above and below the shared edge', () => {
  const result = render(neighbourCase([
    { from: 'w', to: 'f', label: 'fail' },
    { from: 'f', to: 'w', label: 'recover' },
  ]));
  assert.equal(result.code, 0, result.stderr);
  const cy = box(result.svg, 'w').y + box(result.svg, 'w').height / 2;
  assert.deepEqual(points(result.svg, 'w', 'f').map((point) => point[1]), [cy - 10, cy - 10]);
  assert.deepEqual(points(result.svg, 'f', 'w').map((point) => point[1]), [cy + 10, cy + 10]);
});

test('dense neighbour transitions keep every label and note clear in its own lane', () => {
  const cases = [
    ['five short labels', 'abcde'.split('').map((label) => ({ from: 'w', to: 'f', label }))],
    ['four labels with notes', Array.from({ length: 4 }, (_, index) => ({ from: 'w', to: 'f', label: `way ${index}`, note: `note ${index}` }))],
    ['five mixed directions and label heights', [
      { from: 'w', to: 'f', label: 'one', note: 'first note' },
      { from: 'f', to: 'w', label: 'two' },
      { from: 'w', to: 'f', note: 'third note' },
      { from: 'f', to: 'w', label: 'four', note: 'fourth note' },
      { from: 'w', to: 'f', label: 'five' },
    ]],
    ['five unlabelled transitions', Array.from({ length: 5 }, () => ({ from: 'w', to: 'f' }))],
  ];
  for (const [name, extra] of cases) {
    const doc = neighbourCase(extra);
    // A following row must move down with the enlarged neighbour row.
    doc.states.push(state('next', 'success'));
    doc.transitions.push({ from: 'f', to: 'next' });
    const result = render(doc);
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    assert.equal(result.check.ok, true, `${name}: ${JSON.stringify(result.check.composition.issues)}`);
    const routes = [...allPoints(result.svg, 'w', 'f'), ...allPoints(result.svg, 'f', 'w')];
    assert.equal(routes.length, extra.length, name);
    assert.equal(new Set(routes.map((route) => route[0][1])).size, extra.length, name);
    const lower = box(result.svg, 'w');
    const partner = box(result.svg, 'f');
    assert.equal(box(result.svg, 'a').height, 64, `${name}: main path retains its height`);
    assert.equal(box(result.svg, 'next').height, 64, `${name}: following row retains its height`);
    if (extra.every((transition) => !transition.label && !transition.note)) {
      assert.equal(lower.height, 64, `${name}: no label footprint needs extra height`);
    }
    assert.equal(lower.height, partner.height, `${name}: one lower row keeps aligned bounds`);
    assert.ok(routes.every((route) => route.every(([, y]) => y > lower.y && y < lower.y + lower.height)),
      `${name}: every arrow attaches inside the state side`);
    assert.ok(box(result.svg, 'next').y > lower.y + lower.height, `${name}: following row clears the full state height`);
    const edgeLabels = [...result.svg.matchAll(/<g data-detail="(?:context|fine)" [^>]*data-edge-from="(?:w|f)" data-edge-to="(?:w|f)"[^>]*>[\s\S]*?<\/g>/g)]
      .map((match) => match[0]).join('');
    for (const transition of extra) {
      for (const text of [transition.label, transition.note].filter(Boolean)) {
        assert.equal(edgeLabels.split(`>${text}</text>`).length - 1, 1, `${name}: preserves ${text}`);
      }
    }
  }
});

test('one lower row accommodates the tallest of several parallel neighbour groups', () => {
  const doc = neighbourCase('abcde'.split('').map((label) => ({ from: 'w', to: 'f', label })));
  doc.states.push(state('g', 'waiting'));
  doc.transitions.push({ from: 'b', to: 'g' }, ...Array.from({ length: 4 }, (_, index) => ({
    from: 'f', to: 'g', label: `way ${index}`, note: `note ${index}`,
  })));
  const result = render(doc);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  const boxes = ['w', 'f', 'g'].map((id) => box(result.svg, id));
  assert.equal(new Set(boxes.map((state) => state.y)).size, 1, 'all partners stay in one row');
  assert.equal(new Set(boxes.map((state) => state.height)).size, 1, 'all partners retain the same centre and bottom');
  const centre = boxes[0].y + boxes[0].height / 2;
  for (const [from, to, count] of [['w', 'f', 5], ['f', 'g', 4]]) {
    const routes = allPoints(result.svg, from, to);
    assert.equal(routes.length, count);
    assert.equal((routes[0][0][1] + routes.at(-1)[0][1]) / 2, centre, 'each group fans around the common row centre');
  }
});

test('more than five parallel transitions between neighbours are a typed error', () => {
  const result = render(neighbourCase(Array.from({ length: 6 }, (_, index) => ({ from: 'w', to: 'f', label: `way ${index}` }))));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /\[lifecycle\/crowded-side-transitions\]/);
  assert.match(result.stderr, /merge the triggers into one transition label/);
});

test('exits to one target with different labels or variants stay separate connectors', () => {
  const result = render(base({
    mainPath: ['a', 'b', 'c', 'd'],
    states: [state('a', 'start'), state('b'), state('c'), state('d', 'success'), state('x', 'failure', 'Cancelled')],
    transitions: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'b', to: 'x', label: 'user cancels', variant: 'dashed' },
      { from: 'c', to: 'x', label: 'timeout', note: 'after 24h', variant: 'security' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.notDeepEqual(points(result.svg, 'b', 'x'), points(result.svg, 'c', 'x'), 'different semantics draw separate routes');
  assert.doesNotMatch(result.svg, /data-composition-junction/);
  assert.doesNotMatch(result.svg, /data-edge-label="[^"]* \/ [^"]*"/, 'no merged edge label');
  assert.doesNotMatch(result.svg, />user cancels \/ timeout</);
  assert.match(result.svg, />user cancels<\/text>/);
  assert.match(result.svg, />timeout<\/text>/);
  assert.match(result.svg, />after 24h<\/text>/);
});

test('one eligible shared-exit subgroup preserves the independent note and every relationship', () => {
  const fixture = path.join(__dirname, 'fixtures/lifecycle-shared-exit-subgroup.json');
  const bytes = fs.readFileSync(fixture, 'utf8');
  const doc = JSON.parse(bytes);
  const result = render(doc);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  for (const transition of doc.transitions) {
    assert.match(edgePath(result.svg, transition.id), new RegExp(`data-edge-from="${transition.from}" data-edge-to="${transition.to}"`));
  }
  for (const item of doc.states) assert.match(result.svg, new RegExp(`data-node-id="${item.id}"`));
  const first = edgePath(result.svg, 'hold-first');
  const second = edgePath(result.svg, 'hold-second');
  const junction = first.match(/data-composition-junction="([^"]+)"/)?.[1];
  assert.ok(junction, 'equivalent exits declare their shared junction');
  assert.equal(second.match(/data-composition-junction="([^"]+)"/)?.[1], junction);
  assert.equal(first.match(/data-composition-points="([^"]+)"/)[1], second.match(/data-composition-points="([^"]+)"/)[1]);
  assert.doesNotMatch(edgePath(result.svg, 'hold-third'), /data-composition-junction/);
  const labels = edgeLabels(result.svg);
  const team = labels.filter(({ markup }) => markup.includes('>Team check</text>'));
  const owner = labels.filter(({ markup }) => markup.includes('>Owner check</text>'));
  assert.equal(team.length, 1, 'the shared note has one visible owner');
  assert.ok(['hold-first', 'hold-second'].includes(team[0].id));
  assert.deepEqual(owner.map(({ id }) => id), ['hold-third'], 'the distinct note belongs only to its original relationship');
  assert.equal((result.svg.match(/>hold<\/text>/g) || []).length, 2);
  assert.equal(fs.readFileSync(fixture, 'utf8'), bytes);
});

test('multiple eligible shared-exit signatures fall back to complete independent connectors', () => {
  const fixture = path.join(__dirname, 'fixtures/lifecycle-shared-exit-fallback.json');
  const doc = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(doc);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.doesNotMatch(result.svg, /data-composition-junction/);
  const labels = edgeLabels(result.svg);
  for (const transition of doc.transitions) {
    assert.match(edgePath(result.svg, transition.id), new RegExp(`data-edge-from="${transition.from}" data-edge-to="${transition.to}"`));
    if (!transition.note) continue;
    const owned = labels.filter(({ id }) => id === transition.id);
    assert.equal(owned.length, 1, `one label owner for ${transition.id}`);
    assert.ok(owned[0].markup.includes(`>${transition.label}</text>`) && owned[0].markup.includes(`>${transition.note}</text>`));
  }
  assert.equal((result.svg.match(/>Team check<\/text>/g) || []).length, 2);
  assert.equal((result.svg.match(/>Owner check<\/text>/g) || []).length, 2);
});

test('the artifact checker flags identical overlapping lifecycle routes', () => {
  const result = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
  ]));
  assert.equal(result.code, 0, result.stderr);
  const groups = [...result.html.matchAll(/<g data-graph-role="automatic-crossover"[^>]*>\s*<path data-graph-role="automatic-crossover-underlay" d="[^"]*"[^>]*\/>\s*<path [^>]*data-edge-from="w" data-edge-to="f"[^>]*\/>/g)];
  assert.equal(groups.length, 2, 'two w -> f route groups');
  const d = groups[0][0].match(/<path [^>]*data-edge-from="w"[^>]*\bd="([^"]+)"/)[1];
  const routePoints = groups[0][0].match(/data-composition-points="([^"]+)"/)[1];
  const duplicated = groups[1][0]
    .replace(/\bd="[^"]*"/g, `d="${d}"`)
    .replace(/data-composition-points="[^"]*"/, `data-composition-points="${routePoints}"`);
  const file = path.join(tmp, 'overlapping-routes.html');
  fs.writeFileSync(file, result.html.replace(groups[1][0], duplicated));
  const checked = spawnSync('node', [path.join(skillRoot, 'scripts/check-render-output.mjs'), file], { encoding: 'utf8' });
  const receipt = JSON.parse(checked.stdout);
  assert.ok(receipt.composition.issues.some((issue) => issue.code === 'composition/ambiguous-corridor'),
    JSON.stringify(receipt.composition.issues));
});

test('note-only transitions keep their text', () => {
  const result = render(base({
    mainPath: ['a', 'b'],
    states: [state('a', 'start'), state('b', 'success')],
    transitions: [{ from: 'a', to: 'b', note: '审批 <通过> & "复核"' }],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.svg, /data-detail="fine"[^>]*>审批 &lt;通过&gt; &amp; &quot;复核&quot;<\/text>/);
});

test('structure errors are typed diagnostics with fixes', () => {
  const gap = render(base({
    mainPath: ['a', 'b'],
    states: [state('a', 'start'), state('b')],
    transitions: [{ from: 'b', to: 'a' }],
  }));
  assert.notEqual(gap.code, 0);
  assert.match(gap.stderr, /\[lifecycle\/main-path-gap\] mainPath step "a" -> "b" has no transition/);
  const wide = render(base({
    mainPath: Array.from({ length: 10 }, (_, index) => `s${index}`),
    states: Array.from({ length: 10 }, (_, index) => state(`s${index}`, index ? 'active' : 'start', `Phase number ${index}`)),
    transitions: Array.from({ length: 9 }, (_, index) => ({ from: `s${index}`, to: `s${index + 1}`, label: 'continue' })),
  }));
  assert.notEqual(wide.code, 0);
  assert.match(wide.stderr, /\[lifecycle\/too-wide\]/);
});

test('only states a reader should notice get a default corner sigil', () => {
  const types = ['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external'];
  const states = types.map((type) => ({ ...state(type, type), step: '01' }));
  states.push({ ...state('flagged', 'active'), icon: 'flag' }, state('parked', 'neutral'));
  const result = render(base({
    mainPath: ['start', 'active', 'decision', 'success'],
    states,
    transitions: [
      { from: 'start', to: 'active' }, { from: 'active', to: 'decision' }, { from: 'decision', to: 'success' },
      { from: 'active', to: 'waiting' }, { from: 'decision', to: 'failure' }, { from: 'active', to: 'neutral' },
      { from: 'waiting', to: 'external' }, { from: 'start', to: 'flagged' },
      { from: 'decision', to: 'parked' }, { from: 'parked', to: 'decision' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  const group = (id) => result.svg.match(new RegExp(`data-node-id="${id}"[\\s\\S]*?<text data-node-label`))[0];
  const sigilOf = (id) => group(id).match(/data-semantic-sigil="([^"]+)"/)?.[1] ?? null;
  // A final ordinary state is an outcome and gets the stop sigil.
  assert.deepEqual(Object.fromEntries([...types, 'flagged', 'parked'].map((id) => [id, sigilOf(id)])), {
    start: null, active: null, waiting: 'waiting', decision: 'decision', success: 'success',
    failure: 'failure', neutral: 'stop', external: 'external', flagged: 'flag', parked: null,
  });
});

test('nodeLabelLayout reserves the source badge footprint on the right rail', () => {
  const rows = [{ text: 'Offline mode', font: 10, y: 21 }];
  const without = nodeLabelLayout({ width: 144, height: 64, rows });
  assert.deepEqual([without.x, without.ys[0]], [72, 21]);
  const withSource = nodeLabelLayout({ width: 144, height: 64, rows, source: true });
  const labelRight = withSource.x + (rows[0].text.length * 10 * 0.6) / 2;
  assert.ok(withSource.ys[0] > rows[0].y || labelRight <= 144 - 4 - SOURCE_BADGE_FOOTPRINT);
  const both = nodeLabelLayout({ width: 120, height: 64, rows, brand: true, source: true });
  assert.ok(both.ys[0] >= 19 + 2);
});

test('dense automatic exit notes pass public readability validation without losing authored content', () => {
  const fixture = path.join(__dirname, 'fixtures/lifecycle-dense-exit-notes.json');
  const bytes = fs.readFileSync(fixture, 'utf8');
  const doc = JSON.parse(bytes);
  const validated = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'validate', 'lifecycle', fixture,
    '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const receipt = JSON.parse(validated.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.checks.length && receipt.checks.every((entry) => entry.ok));
  const result = render(doc);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  for (const item of doc.states) {
    assert.match(result.svg, new RegExp(`data-node-id="${item.id}"`));
    assert.ok(result.svg.includes(`>${item.label}</text>`));
    if (item.sublabel) assert.ok(result.svg.includes(`>${item.sublabel}</text>`));
  }
  const labels = edgeLabels(result.svg);
  for (const transition of doc.transitions) {
    assert.match(edgePath(result.svg, transition.id), new RegExp(`data-edge-from="${transition.from}" data-edge-to="${transition.to}"`));
    assert.ok(result.svg.includes(`>${transition.label}</text>`));
    if (!transition.note) continue;
    const owned = labels.filter(({ id }) => id === transition.id);
    assert.equal(owned.length, 1, `one note owner for ${transition.id}`);
    assert.ok(owned[0].markup.includes(`>${transition.note}</text>`));
  }
  assert.equal(fs.readFileSync(fixture, 'utf8'), bytes);
});

test('long transition notes are identified in width and placement diagnostics without discarding conditions', () => {
  const condition = 'Only proceed when the request is confirmed and the worker owns the active lease. ';
  const spine = { from: 'ready', to: 'done', label: 'go', note: condition.repeat(5) };
  const exit = { from: 'ready', to: 'stopped', label: 'stop', note: condition.repeat(15) };
  const doc = base({
    meta: { title: 'Transition note diagnostics', output: 'note-diagnostics.html', quality_profile: 'showcase' },
    mainPath: ['ready', 'done'],
    states: [state('ready', 'start', 'Ready'), state('done', 'success', 'Done'), state('stopped', 'failure', 'Stopped')],
    transitions: [spine, exit],
  });
  const input = path.join(tmp, 'long-note-diagnostics.json');
  const source = JSON.stringify(doc);
  fs.writeFileSync(input, source);
  const cli = path.join(skillRoot, 'bin/archify.mjs');
  const result = spawnSync(process.execPath, [cli, 'validate', 'lifecycle', input, '--json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the diagnostic change does not make this layout valid');
  const receipt = JSON.parse(result.stdout);
  const wide = receipt.diagnostics.find(entry => entry.code === 'lifecycle/too-wide');
  const unplaced = receipt.diagnostics.find(entry => entry.code === 'lifecycle/label-unplaced' && entry.subject.to === exit.to);
  assert.ok(wide && unplaced, result.stdout);
  assert.deepEqual(wide.subject, { diagramType: 'lifecycle', path: '/mainPath' });
  const step = wide.evidence.wideStepLabels.find(entry => entry.from === spine.from && entry.to === spine.to);
  assert.equal(step.label, spine.label, 'the existing label evidence remains compatible');
  assert.ok(step.excessPx > 0);
  assert.equal(step.widthDriver, 'note');
  assert.deepEqual(unplaced.subject, { diagramType: 'lifecycle', collection: 'transitions', index: 1, from: exit.from, to: exit.to });
  assert.equal(unplaced.evidence.widthDriver, 'note');
  for (const diagnostic of [wide, unplaced]) {
    const advice = diagnostic.supportedFixes.join('\n');
    assert.match(advice, /note/);
    assert.match(advice, /preserve.*condition|without removing conditions/);
    assert.match(advice, /detail.*same transition/);
    assert.match(advice, /may not.*(?:constraints|placement)/);
  }
  assert.equal(fs.readFileSync(input, 'utf8'), source, 'diagnosis preserves every authored condition');
});

test('an inherently too-wide lifecycle reports its budget and bounded spacing advice', () => {
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/lifecycle-crowded-wide.json', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'validate', 'lifecycle', fixture, '--json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const diagnostic = JSON.parse(result.stdout).diagnostics.find((entry) => entry.code === 'lifecycle/too-wide');
  assert.ok(diagnostic, result.stdout);
  assert.ok(diagnostic.evidence.viewBoxWidth > diagnostic.evidence.budgetPx);
  assert.ok(diagnostic.evidence.spacingWideners.length > 0);
  assert.match(diagnostic.supportedFixes[0], /main-path gap growth is bounded by the text readability budget/);
  assert.match(diagnostic.supportedFixes[0], /identical labels, notes and variants/);
  assert.doesNotMatch(diagnostic.supportedFixes[0], /every gap widened/);
});
