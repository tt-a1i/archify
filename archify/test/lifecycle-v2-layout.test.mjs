import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeLabelLayout } from '../renderers/shared/text-fit.mjs';
import { SOURCE_BADGE_FOOTPRINT } from '../renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-v2-'));

function render(name, doc) {
  const input = path.join(tmp, `${name}.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, 'renderers/lifecycle/render-lifecycle.mjs'),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    return { code: 0, stderr: '', output };
  } catch (error) {
    return { code: error.status ?? 1, stderr: String(error.stderr || ''), output };
  }
}

function validate(name, doc, extra = []) {
  const input = path.join(tmp, `${name}-validate.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const stdout = execFileSync('node', [
      path.join(skillRoot, 'bin/archify.mjs'),
      'validate', 'lifecycle', input, '--json', ...extra,
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

function svgOf(htmlPath) {
  return fs.readFileSync(htmlPath, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function stateRects(svg) {
  const rects = {};
  for (const match of svg.matchAll(/data-node-id="([^"]+)"[\s\S]*?<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" rx="7" class="c-mask"/g)) {
    rects[match[1]] = {
      x: Number(match[2]), y: Number(match[3]), width: Number(match[4]), height: Number(match[5]),
    };
  }
  return rects;
}

// Redacted after a real media-session lifecycle: one main path, one
// interruption lane sharing columns with the states it branches from, and a
// terminal row.
function v2SessionDocument(overrides = {}) {
  return {
    schema_version: 2,
    diagram_type: 'lifecycle',
    meta: { title: 'Session Lifecycle', output: `${overrides.name || 'session'}-v2.html`, quality_profile: 'showcase' },
    lanes: [
      { id: 'main', label: 'Session phases' },
      { id: 'wait', label: 'Interruptions' },
      ...(overrides.extraLanes || []),
      { id: 'terminal', label: 'Terminal exits' },
    ],
    states: [
      { id: 'playing', type: 'active', label: 'Playing', lane: 'main', col: 0 },
      { id: 'paused', type: 'waiting', label: 'Paused', lane: 'main', col: 1 },
      { id: 'offline', type: 'waiting', label: 'Offline', lane: 'wait', col: 0 },
      { id: 'ended', type: 'success', label: 'Ended', lane: 'terminal', col: 0 },
      { id: 'expired', type: 'failure', label: 'Expired', lane: 'terminal', col: 1 },
      { id: 'replaced', type: 'neutral', label: 'Replaced', lane: 'terminal', col: 2 },
    ],
    transitions: [
      { id: 'pause', from: 'playing', to: 'paused', label: 'PAUSE' },
      { id: 'resume', from: 'paused', to: 'playing', label: 'RESUME' },
      { id: 'drop', from: 'playing', to: 'offline' },
      { id: 'rejoin', from: 'offline', to: 'playing' },
      { id: 'offline-pause', from: 'offline', to: 'paused' },
      { id: 'offline-expire', from: 'offline', to: 'expired' },
      { id: 'stop-playing', from: 'playing', to: 'ended', label: 'STOP / TIMER_END' },
      { id: 'stop-paused', from: 'paused', to: 'ended', label: 'STOP' },
      { id: 'replace', from: 'playing', to: 'replaced' },
    ],
    ...overrides.doc,
  };
}

test('v2 session lifecycle passes showcase validation with no proper crossings', () => {
  const doc = v2SessionDocument();
  const result = validate('session', doc);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout + (result.stderr || ''), /proper-crossing/);

  // Under showcase a proper crossing fails validation, so exit 0 is proof
  // the v2 routes crossed cleanly.
  const rendered = render('session', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
});

test('v2 rows share one column grid and only populated lanes get titles', () => {
  const rendered = render('session-grid', v2SessionDocument({ name: 'session-grid' }));
  assert.equal(rendered.code, 0, rendered.stderr);
  const svg = svgOf(rendered.output);
  const rects = stateRects(svg);
  // Every row shares the same column x: col 0, 1, 2 centers are identical.
  assert.equal(rects.offline.x, rects.playing.x);
  assert.equal(rects.ended.x, rects.playing.x);
  assert.equal(rects.expired.x, rects.paused.x);
  assert.ok(rects.replaced.x > rects.paused.x);
  const titles = [...svg.matchAll(/writing-mode="vertical-rl"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(titles, ['Session phases', 'Interruptions', 'Terminal exits']);

  const withEmpty = render('session-empty-lane', v2SessionDocument({
    name: 'session-empty-lane',
    extraLanes: [{ id: 'recovery', label: 'Recovery loop' }],
  }));
  assert.equal(withEmpty.code, 0, withEmpty.stderr);
  const emptySvg = svgOf(withEmpty.output);
  assert.doesNotMatch(emptySvg, /Recovery loop/, 'empty lanes render no row title');
  assert.equal((emptySvg.match(/writing-mode="vertical-rl"/g) || []).length, 3);
});

test('v2 canvas width tracks the furthest used column', () => {
  const wide = v2SessionDocument({ name: 'session-wide' });
  wide.states.push({ id: 'archived', type: 'neutral', label: 'Archived', lane: 'terminal', col: 4 });
  wide.transitions.push({ from: 'ended', to: 'archived', label: 'ARCHIVE' });
  const renderedWide = render('session-wide', wide);
  assert.equal(renderedWide.code, 0, renderedWide.stderr);
  const wideBox = svgOf(renderedWide.output).match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);

  const narrow = v2SessionDocument({ name: 'session-narrow' });
  narrow.states = narrow.states.filter((s) => s.id !== 'replaced');
  narrow.transitions = narrow.transitions.filter((t) => t.to !== 'replaced');
  const renderedNarrow = render('session-narrow', narrow);
  assert.equal(renderedNarrow.code, 0, renderedNarrow.stderr);
  const narrowBox = svgOf(renderedNarrow.output).match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);
  assert.ok(wideBox[0] > narrowBox[0], `${wideBox[0]} should exceed ${narrowBox[0]}`);
});

test('v2 has no implied rail and forward main transitions render emphasized', () => {
  const rendered = render('session-rail', v2SessionDocument({ name: 'session-rail' }));
  assert.equal(rendered.code, 0, rendered.stderr);
  const html = fs.readFileSync(rendered.output, 'utf8');
  assert.doesNotMatch(html, /<path data-lifecycle-rail/, 'v2 must not render the implied phase rail');
  const svg = svgOf(rendered.output);
  const pauseEdge = svg.match(/data-edge-id="pause"[^>]*class="a-emphasis"/)
    || svg.match(/class="a-emphasis"[^>]*data-edge-id="pause"/)
    || svg.match(/data-edge-id="pause"[\s\S]*?class="a-emphasis"/);
  assert.ok(pauseEdge, 'playing -> paused (col 0 -> 1) must render with the emphasis class');
});

test('v2 grid routes are orthogonal and reciprocal pairs run as parallel lines', () => {
  const rendered = render('session-routes', v2SessionDocument({ name: 'session-routes' }));
  assert.equal(rendered.code, 0, rendered.stderr);
  const svg = svgOf(rendered.output);
  const routes = Object.fromEntries([...svg.matchAll(/data-edge-id="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .map((match) => [match[1], match[2].split(';').map((point) => point.split(',').map(Number))]));
  assert.equal(Object.keys(routes).length, 9);
  for (const [id, points] of Object.entries(routes)) {
    for (let index = 1; index < points.length; index += 1) {
      const [[x1, y1], [x2, y2]] = [points[index - 1], points[index]];
      assert.ok(x1 === x2 || y1 === y2, `${id} segment ${index} must be axis-aligned: ${JSON.stringify(points)}`);
    }
  }
  // Neighbours in one row: two straight horizontal lines, forward on top.
  assert.equal(routes.pause.length, 2);
  assert.equal(routes.resume.length, 2);
  assert.equal(routes.pause[0][1], routes.pause[1][1]);
  assert.ok(routes.pause[0][1] < routes.resume[0][1]);
  // Vertical neighbours in one column: two parallel straight verticals.
  assert.equal(routes.drop.length, 2);
  assert.equal(routes.rejoin.length, 2);
  assert.notEqual(routes.drop[0][0], routes.rejoin[0][0]);
});

for (const [name, sides] of [
  ['both', { fromSide: 'right', toSide: 'left' }],
  ['source-only', { fromSide: 'right' }],
  ['target-only', { toSide: 'left' }],
]) {
  test(`v2 compatible side pins preserve grid routes and parallel pairs: ${name}`, () => {
    const doc = v2SessionDocument();
    const automatic = render(`compatible-${name}-automatic`, doc);
    assert.equal(automatic.code, 0, automatic.stderr);
    Object.assign(doc.transitions.find(transition => transition.id === 'pause'), sides);
    const pinned = render(`compatible-${name}-pinned`, doc);
    assert.equal(pinned.code, 0, pinned.stderr);
    const svg = svgOf(pinned.output);
    const routes = Object.fromEntries([...svg.matchAll(/data-edge-id="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
      .map(match => [match[1], match[2].split(';').map(point => point.split(',').map(Number))]));
    for (const id of ['pause', 'resume', 'drop', 'rejoin']) assert.equal(routes[id].length, 2, `${id} stays straight`);
    assert.notEqual(routes.pause[0][1], routes.resume[0][1], 'horizontal reciprocal routes stay separate');
    assert.notEqual(routes.drop[0][0], routes.rejoin[0][0], 'vertical reciprocal routes stay separate');
    assert.equal(svg, svgOf(automatic.output), 'compatible pins preserve all routes, labels, and row gaps');
    const result = validate(`compatible-${name}`, doc);
    assert.equal(result.code, 0, result.stdout || result.stderr);
  });
}

test('v2 deployment example keeps its grid layout with a compatible cross-row pin', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/deployment-release.lifecycle.json'), 'utf8'));
  const automatic = render('deployment-automatic', doc);
  assert.equal(automatic.code, 0, automatic.stderr);
  Object.assign(doc.transitions.find(transition => transition.from === 'ready' && transition.to === 'rollback'), {
    fromSide: 'bottom', toSide: 'top',
  });
  const pinned = render('deployment-compatible', doc);
  assert.equal(pinned.code, 0, pinned.stderr);
  assert.equal(svgOf(pinned.output), svgOf(automatic.output), 'a redundant pin must not change the diagram');
  const result = validate('deployment-compatible', doc);
  assert.equal(result.code, 0, result.stdout || result.stderr);
});

for (const [name, lane, sides] of [
  ['same-row-bottom', 'main', { fromSide: 'bottom', toSide: 'bottom' }],
  ['cross-row-right', 'wait', { fromSide: 'right', toSide: 'right' }],
  ['source-only', 'main', { fromSide: 'bottom' }],
  ['target-only', 'wait', { toSide: 'left' }],
]) {
  test(`v2 automatic routes honor authored sides: ${name}`, () => {
    const doc = v2SessionDocument({ doc: {
      states: [
        { id: 'a', type: 'active', label: 'A', lane: 'main', col: 0 },
        { id: 'b', type: 'success', label: 'B', lane, col: 1 },
        { id: 'c', type: 'waiting', label: 'C', lane: 'wait', col: 0 },
      ],
      transitions: [
        { id: 'pinned', from: 'a', to: 'b', ...sides },
        { from: 'a', to: 'c' },
      ],
    } });
    const result = validate(name, doc);
    assert.equal(result.code, 0, result.stdout || result.stderr);
    const rendered = render(name, doc);
    assert.equal(rendered.code, 0, rendered.stderr);
    const svg = svgOf(rendered.output);
    const rects = stateRects(svg);
    const points = svg.match(/data-edge-id="pinned"[^>]*data-composition-points="([^"]+)"/)[1]
      .split(';').map(point => point.split(',').map(Number));
    for (const [field, node, point, next] of [
      ['fromSide', rects.a, points[0], points[1]],
      ['toSide', rects.b, points.at(-1), points.at(-2)],
    ]) {
      const side = sides[field];
      if (!side) continue;
      const vertical = side === 'top' || side === 'bottom';
      const axis = vertical ? 1 : 0;
      const positive = side === 'bottom' || side === 'right';
      assert.equal(point[axis], vertical ? node.y + (positive ? node.height : 0) : node.x + (positive ? node.width : 0));
      assert.equal(point[1 - axis], next[1 - axis], `${field}: perpendicular segment`);
      assert.ok(positive ? next[axis] > point[axis] : next[axis] < point[axis], `${field}: outward segment`);
    }
  });
}

test('v2 start states get an initial marker and final states a double border', () => {
  const doc = v2SessionDocument({ name: 'session-markers' });
  doc.states = doc.states.map((s) => (s.lane === 'main' ? { ...s, col: s.col + 1 } : s));
  doc.states.unshift({ id: 'created', type: 'start', label: 'Created', lane: 'main', col: 0, width: 100 });
  doc.transitions.unshift({ id: 'open', from: 'created', to: 'playing', label: 'OPEN' });
  const rendered = render('session-markers', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
  const svg = svgOf(rendered.output);
  assert.match(svg, /data-lifecycle-initial-marker/, 'start state needs the initial pseudo-state marker');
  assert.equal((svg.match(/data-lifecycle-initial-marker/g) || []).length, 1);
  // Final states: ended, expired, replaced (no outgoing transitions).
  const finals = svg.match(/style="fill: none" stroke-width="1"/g) || [];
  assert.equal(finals.length, 3);
  assert.match(svg, /data-legend-semantic-kind="final"/, 'final structural legend entry must be present');
});

test('nodeLabelLayout reserves the source badge footprint on the right rail', () => {
  // 12 units at 10px is ~72px: centred it fits a 144px box, but it would run
  // under a 38px source badge at the right rail.
  const rows = [{ text: 'Offline mode', font: 10, y: 21 }];
  const without = nodeLabelLayout({ width: 144, height: 64, rows });
  assert.deepEqual([without.x, without.ys[0]], [72, 21]);
  const withSource = nodeLabelLayout({ width: 144, height: 64, rows, source: true });
  const labelRight = withSource.x + (rows[0].text.length * 10 * 0.6) / 2;
  assert.ok(withSource.ys[0] > rows[0].y || labelRight <= 144 - 4 - SOURCE_BADGE_FOOTPRINT,
    `label must clear the source badge, got ${JSON.stringify(withSource)}`);
  // Source plus brand stacks both reservations and pushes rows below the rail.
  const both = nodeLabelLayout({ width: 120, height: 64, rows, brand: true, source: true });
  assert.ok(both.ys[0] >= 19 + 2, `rows should clear the source rail, got y=${both.ys[0]}`);
});

test('v1 state geometry stays identical to the legacy band layout', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-run.lifecycle.json'), 'utf8'));
  assert.equal(doc.schema_version, 1);
  const rendered = render('agent-run-v1', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
  const rects = stateRects(svgOf(rendered.output));
  assert.deepEqual(rects.queued, { x: 35, y: 126, width: 118, height: 62 });
  assert.deepEqual(rects.completed, { x: 651, y: 126, width: 118, height: 62 });
  assert.deepEqual(rects.approval, { x: 339, y: 278, width: 126, height: 58 });
  assert.deepEqual(rects.failed, { x: 339, y: 356, width: 126, height: 58 });
  assert.deepEqual(rects.cancelled, { x: 343, y: 450, width: 118, height: 58 });
});
