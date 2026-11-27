import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { minimumNodeTextWidth } from '../archify/renderers/shared/text-fit.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const LONG_NOTE = 'Keep every word of this internal retry and backoff policy while leaving the neighbouring lifeline and the next message clear.';

function sequence(messages, overrides = {}) {
  return {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Internal processing', output: 'self.html', quality_profile: 'showcase', ...overrides.meta },
    participants: overrides.participants || ['left', 'middle', 'right'].map(id => ({ id, type: 'backend', label: id.toUpperCase() })),
    messages,
  };
}

function run(t, doc, command = 'render') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-self-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'self.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const args = command === 'render'
    ? [cli, 'render', 'sequence', input, output]
    : [cli, 'validate', 'sequence', input, '--json'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.deepEqual(JSON.parse(fs.readFileSync(input, 'utf8')), doc, 'authored ownership, wording and order remain intact');
  const exists = fs.existsSync(output);
  return { ...result, html: exists ? fs.readFileSync(output, 'utf8') : '', exists };
}

function render(t, doc) {
  const result = run(t, doc);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.html;
}

function route(html, id) {
  const group = html.match(new RegExp(`<g [^>]*data-edge-id="${id}"[^>]*>([\\s\\S]*?)<\\/g>`));
  assert.ok(group, `stable relationship ${id}`);
  const points = group[1].match(/data-composition-points="([^"]+)"/)[1].split(';').map(pair => pair.split(',').map(Number));
  return { points, markup: group[1] };
}

function note(html, index = 0) {
  const match = [...html.matchAll(/<text data-detail="context" x="([\d.]+)" y="([\d.]+)" class="[^"]+" font-size="([\d.]+)"( text-anchor="end")?>([\s\S]*?)<\/text>/g)][index];
  assert.ok(match, 'self-call note is rendered');
  const spans = [...match[5].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)];
  return { x: Number(match[1]), y: Number(match[2]), fontSize: Number(match[3]), anchor: match[4] ? 'end' : 'start', lines: spans.length ? spans.map(span => span[1]) : [match[5]] };
}

function failure(t, doc, code) {
  const result = run(t, doc, 'validate');
  assert.notEqual(result.status, 0);
  const diagnostic = JSON.parse(result.stdout).diagnostics.find(entry => entry.code === code);
  assert.ok(diagnostic, result.stdout + result.stderr);
  assert.equal(diagnostic.severity, 'error');
  assert.doesNotMatch(result.stdout, /self-message-unsupported|spans 0px/);
  const rendered = run(t, doc);
  assert.notEqual(rendered.status, 0);
  assert.equal(rendered.exists, false, 'failed layout produces no artifact');
  return diagnostic;
}

for (const quality of ['standard', 'showcase']) {
  test(`sequence ${quality} renders self-calls and preserves ordinary routes and relationship identity`, t => {
    const doc = sequence([
      { id: 'request', from: 'left', to: 'middle', y: 200, label: 'request' },
      { id: 'internal', from: 'middle', to: 'middle', y: 280, label: 'refresh' },
      { id: 'reply', from: 'middle', to: 'left', y: 390, label: 'reply', variant: 'return' },
    ], { meta: { quality_profile: quality } });
    assert.equal(run(t, doc, 'validate').status, 0);
    const html = render(t, doc);
    const self = route(html, 'internal').points;
    assert.equal(self.length, 4);
    assert.equal(self[0][0], self.at(-1)[0], 'returns to the same lifeline side');
    assert.ok(self.at(-1)[1] > self[0][1], 'time progresses downward');
    assert.match(route(html, 'internal').markup, /data-composition-edge-from="middle" data-composition-edge-to="middle"/);
    for (const id of ['request', 'reply']) {
      const points = route(html, id).points;
      assert.equal(points.length, 2);
      assert.equal(points[0][1], points[1][1]);
    }
    assert.ok(route(html, 'reply').points[1][0] < route(html, 'reply').points[0][0]);
    assert.match(route(html, 'reply').markup, /stroke-dasharray="3,5"/);
  });
}

test('self-calls turn right for left/middle participants and inward at the right edge', t => {
  const html = render(t, sequence([
    { id: 'left-loop', from: 'left', to: 'left', y: 200, label: 'refresh', variant: 'emphasis' },
    { id: 'middle-loop', from: 'middle', to: 'middle', y: 310, label: 'retry', variant: 'security' },
    { id: 'right-loop', from: 'right', to: 'right', y: 420, label: 'flush' },
  ]));
  for (const id of ['left-loop', 'middle-loop', 'right-loop']) {
    const { points, markup } = route(html, id);
    assert.equal(points.length, 4);
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1], 'orthogonal segments');
    }
    const direction = id === 'right-loop' ? -1 : 1;
    assert.ok(direction * (points[1][0] - points[0][0]) > 0);
    assert.ok(direction * (points[3][0] - points[2][0]) < 0, 'arrow returns toward its owner');
    assert.match(markup, /marker-end="url\(#arrowhead/);
  }
  assert.match(route(html, 'middle-loop').markup, /arrowhead-security/);
});

test('automatic height includes a late self-call and its complete wrapped note', t => {
  const html = render(t, sequence([
    { id: 'only-loop', from: 'worker', to: 'worker', y: 700, label: 'flush', note: LONG_NOTE.repeat(3) },
  ], { participants: ['worker', 'cache'].map(id => ({ id, type: 'backend', label: id })) }));
  const points = route(html, 'only-loop').points;
  assert.ok(points[1][0] > points[0][0]);
  const ownNote = note(html);
  assert.ok(ownNote.lines.length > 1);
  assert.equal(ownNote.lines.join(' '), LONG_NOTE.repeat(3));
  assert.ok(ownNote.y > points.at(-1)[1]);
  const height = Number(html.match(/<svg viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  const legendY = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  const lastBaseline = ownNote.y + (ownNote.lines.length - 1) * 11;
  assert.ok(height > lastBaseline);
  assert.ok(legendY > lastBaseline + 12, 'legend clears the entire note');
});

test('automatic width accounts for self-call labels before selecting a compact canvas', t => {
  const html = render(t, sequence([
    { id: 'wide', from: 'left', to: 'left', y: 200, label: 'refreshTenantAuthorizationCacheState' },
  ], { participants: ['left', 'right'].map(id => ({ id, type: 'backend', label: id })) }));
  const width = Number(html.match(/<svg viewBox="0 0 ([\d.]+) [\d.]+"/)[1]);
  assert.ok(width > 560, 'do not select the smallest width when its lane cannot fit the loop');
  const rightX = Number(html.match(/<path d="M ([\d.]+) 142 L \1 [\d.]+" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g).at(-1).match(/M ([\d.]+)/)[1]);
  assert.ok(route(html, 'wide').points[1][0] < rightX - 10, 'loop clears its neighbour');
});

test('self-call label fitting uses the active quality profile', t => {
  const doc = sequence([{ id: 'label', from: 'left', to: 'left', y: 200, label: 'abcdefghijkl' }], {
    meta: { column_fit: 'fixed', viewBox: [560, 620], quality_profile: 'standard' },
    participants: ['left', 'right'].map(id => ({ id, type: 'backend', label: id })),
  });
  render(t, doc);
  doc.meta.quality_profile = 'showcase';
  const diagnostic = failure(t, doc, 'sequence/self-message-space');
  assert.equal(diagnostic.subject.path, '/messages/0/label');
  assert.ok(diagnostic.evidence.outerX > diagnostic.evidence.boundaryX);
});

test('self-call notes on either side wrap, preserve every word and clear phase borders', t => {
  for (const owner of ['left', 'right']) {
    const doc = sequence([{ id: 'loop', from: owner, to: owner, y: 200, label: 'refresh', note: LONG_NOTE }], {
      meta: { viewBox: [1000, 680] },
    });
    doc.segments = [{ from: 150, to: 260, label: 'Phase' }];
    const html = render(t, doc);
    assert.match(html, /data-detail="context" data-graph-role="message-note-background"/, 'phase border is masked behind the note');
    const lanes = [...html.matchAll(/<path d="M ([\d.]+) 142 L \1 [\d.]+" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g)].map(match => Number(match[1]));
    const ownNote = note(html);
    assert.ok(ownNote.lines.length > 1);
    assert.equal(ownNote.lines.join(' '), LONG_NOTE);
    const gap = owner === 'left' ? 0 : 1;
    assert.equal(ownNote.anchor, owner === 'right' ? 'end' : 'start', 'notes align toward the loop owner');
    for (const line of ownNote.lines) {
      const width = minimumNodeTextWidth(line, ownNote.fontSize);
      const start = ownNote.anchor === 'end' ? ownNote.x - width : ownNote.x;
      assert.ok(start > lanes[gap] + 5, `${owner}: ${line} clears the preceding lifeline`);
      assert.ok(start + width <= lanes[gap + 1] - 10, `${owner}: ${line} clears the next lifeline`);
    }
    assert.ok(ownNote.y > route(html, 'loop').points.at(-1)[1]);
  }
});

test('consecutive self-calls with labels and notes remain renderable in context', t => {
  render(t, sequence([
    { id: 'request', from: 'left', to: 'middle', y: 200, label: 'request' },
    { id: 'first', from: 'middle', to: 'middle', y: 280, label: 'refresh', note: 'keep state' },
    { id: 'second', from: 'middle', to: 'middle', y: 390, label: 'retry', note: 'try again' },
    { id: 'reply', from: 'middle', to: 'left', y: 500, label: 'reply', variant: 'return' },
  ]));
});

test('overlapping loops and an ordinary call inside a loop fail with a repairable diagnostic', t => {
  for (const to of ['left', 'middle']) {
    const doc = sequence([
      { id: 'first', from: 'left', to: 'left', y: 200, label: 'refresh' },
      { id: 'second', from: 'left', to, y: 230, label: 'retry' },
    ]);
    const diagnostic = failure(t, doc, 'sequence/self-message-overlap');
    assert.equal(diagnostic.subject.path, '/messages/1/y');
    assert.ok(diagnostic.evidence.requiredY > doc.messages[1].y);
    assert.equal(diagnostic.supportedFixes.length, 1);
    doc.messages[1].y = diagnostic.evidence.requiredY;
    render(t, doc);
  }
});

test('a spacing repair preserves timeline order across disjoint lanes', t => {
  const doc = sequence([
    { id: 'loop', from: 'a', to: 'a', y: 200, label: 'refresh' },
    { id: 'notify', from: 'a', to: 'b', y: 250, label: 'notify' },
    { id: 'audit', from: 'c', to: 'd', y: 260, label: 'audit' },
  ], { participants: ['a', 'b', 'c', 'd'].map(id => ({ id, type: 'backend', label: id.toUpperCase() })) });
  const blocked = failure(t, doc, 'sequence/self-message-overlap');
  assert.equal(blocked.subject.path, '/messages/1/y');
  assert.ok(blocked.evidence.requiredY > doc.messages[2].y);
  assert.deepEqual(blocked.supportedFixes, [], 'moving notify would put it after audit');

  doc.messages[2].y = 340;
  const allowed = failure(t, doc, 'sequence/self-message-overlap');
  const repairedY = allowed.evidence.requiredY;
  assert.deepEqual(allowed.supportedFixes, [`set /messages/1/y to ${repairedY}`]);
  doc.messages[1].y = repairedY;
  const html = render(t, doc);
  assert.ok(route(html, 'notify').points[0][1] < route(html, 'audit').points[0][1]);
});

test('abutting loop spans still need room for the next label', t => {
  const html = render(t, sequence([{ id: 'first', from: 'left', to: 'left', y: 200, label: 'refresh' }]));
  const returnY = route(html, 'first').points.at(-1)[1];
  failure(t, sequence([
    { from: 'left', to: 'left', y: 200, label: 'refresh' },
    { from: 'left', to: 'left', y: returnY, label: 'retry' },
  ]), 'sequence/self-message-overlap');
});

test('a loop spacing repair is withheld when either horizontal leg would follow a segment border', t => {
  for (const border of [270, 312]) {
    const doc = sequence([
      { id: 'first', from: 'left', to: 'left', y: 200, label: 'refresh' },
      { id: 'second', from: 'left', to: 'left', y: 220, label: 'retry' },
    ], { meta: { viewBox: [1000, 680] } });
    doc.segments = [{ from: border, to: 500, label: 'Phase' }];
    const diagnostic = failure(t, doc, 'sequence/self-message-overlap');
    assert.deepEqual(diagnostic.supportedFixes, [], 'do not advertise a move onto a phase border');
    // The suggested spacing clears the earlier loop but would put either the
    // outgoing or return leg on this border. A further authored move can fit.
    doc.messages[1].y = diagnostic.evidence.requiredY;
    failure(t, doc, 'composition/container-border-run');
    doc.messages[1].y = 340;
    render(t, doc);
  }
});

test('a phase border near a return leg offers repairs that clear the entire self-call', t => {
  const doc = sequence([{ from: 'left', to: 'left', y: 200, label: 'refresh' }]);
  doc.segments = [{ from: 150, to: 244, label: 'Phase' }];
  const diagnostic = failure(t, doc, 'sequence/segment-message-border-run');
  assert.equal(diagnostic.subject.path, '/segments/0/to');
  assert.equal(diagnostic.evidence.messageY, 242);
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /segments/0/to to at least 246 to leave the message above it',
    'set /segments/0/to to at most 196 to leave the message below it',
  ]);
  for (const fix of diagnostic.supportedFixes) {
    doc.segments[0].to = Number(fix.match(/\b(\d+) to leave/)[1]);
    render(t, doc);
  }
  doc.segments[0] = { from: 210, to: 244, label: 'Phase' };
  const limited = failure(t, doc, 'sequence/segment-message-border-run');
  assert.deepEqual(limited.supportedFixes, [diagnostic.supportedFixes[0]], 'omit a repair that would invert the phase');
});

test('a phase border repair clears other arrows beyond the self-call', t => {
  const doc = sequence([
    { from: 'left', to: 'left', y: 200, label: 'refresh' },
    { from: 'middle', to: 'right', y: 246, label: 'notify' },
  ]);
  doc.segments = [{ from: 196, to: 202, label: 'Phase' }];
  const diagnostic = failure(t, doc, 'sequence/segment-message-border-run');
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /segments/0/to to at least 250 to leave the message above it',
  ]);
  doc.segments[0].to = Number(diagnostic.supportedFixes[0].match(/\b(\d+) to leave/)[1]);
  render(t, doc);
});

test('a phase border repair clears fractional arrow positions using the same clearance bounds', t => {
  const doc = sequence([
    { from: 'left', to: 'left', y: 208, label: 'refresh' },
    { from: 'middle', to: 'right', y: 254.4, label: 'notify' },
  ]);
  doc.segments = [{ from: 204, to: 210, label: 'Phase' }];
  const diagnostic = failure(t, doc, 'sequence/segment-message-border-run');
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /segments/0/to to at least 258.4 to leave the message above it',
  ]);
  doc.segments[0].to = 258.4;
  render(t, doc);
});

test('a phase border repair can use a fractional gap without including the next phase message', t => {
  const doc = sequence([
    { from: 'left', to: 'left', y: 200.5, label: 'refresh' },
    { from: 'middle', to: 'right', y: 250.75, label: 'notify' },
  ], { meta: { viewBox: [920, 680] } });
  doc.segments = [{ from: 150, to: 241.5, label: 'First phase' }, { from: 246.75, to: 400, label: 'Next phase' }];
  const diagnostic = failure(t, doc, 'sequence/segment-message-border-run');
  assert.equal(diagnostic.supportedFixes[0], 'set /segments/0/to to at least 246.5 to leave the message above it');
  doc.segments[0].to = 246.5;
  assert.ok(doc.segments[0].to < doc.segments[1].from && doc.segments[1].from < doc.messages[1].y);
  render(t, doc);
});

test('a phase border repair omits a move that would overlap another phase label', t => {
  const doc = sequence([
    { from: 'left', to: 'left', y: 210, label: 'refresh' },
    { from: 'middle', to: 'right', y: 258, label: 'notify' },
  ], { meta: { viewBox: [920, 680] } });
  doc.segments = [{ from: 250, to: 272, label: 'First phase' }, { from: 278, to: 400, label: 'Next phase' }];
  const diagnostic = failure(t, doc, 'sequence/segment-message-border-run');
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /segments/0/from to at most 206 to leave the message below it',
  ]);
  doc.segments[0].from = Number(diagnostic.supportedFixes[0].match(/\b(\d+) to leave/)[1]);
  render(t, doc);
});

test('simultaneous self-call notes fall back only when the larger text overlaps', t => {
  const doc = sequence([
    { id: 'retry', from: 'left', to: 'left', y: 200, label: 'retry', note: 'Retry only active sessions' },
    { id: 'flush', from: 'right', to: 'right', y: 200, label: 'flush', note: 'Leave a record of the flush.' },
  ], {
    participants: ['left', 'right'].map(id => ({ id, type: 'backend', label: id })),
    meta: { viewBox: [560, 480] },
  });
  const html = render(t, doc);
  const left = note(html);
  const right = note(html, 1);
  assert.equal(left.y, right.y, 'the notes keep their simultaneous baseline');
  assert.equal(left.fontSize, 7);
  assert.equal(right.fontSize, 7);
  assert.ok(left.x + minimumNodeTextWidth(left.lines[0], left.fontSize)
    < right.x - minimumNodeTextWidth(right.lines[0], right.fontSize));

  doc.messages[0].note = 'Retry active sessions now please';
  doc.messages[1].note = 'Leave a record of this flush here.';
  const diagnostic = failure(t, doc, 'sequence/note-overlap');
  assert.equal(diagnostic.subject.path, '/messages/0/note');
  assert.equal(diagnostic.evidence.blocker.path, '/messages/1/note');
  assert.deepEqual(diagnostic.supportedFixes, [], 'do not separate simultaneous messages');

  doc.messages[1].note = 'Record it';
  const clear = render(t, doc);
  assert.equal(note(clear).fontSize, 8.5, 'clear notes retain the preferred size');
  assert.equal(note(clear).y, note(clear, 1).y);
});

test('a simultaneous message on the opposite side of a loop remains valid', t => {
  render(t, sequence([
    { from: 'middle', to: 'middle', y: 200, label: 'refresh' },
    { from: 'middle', to: 'left', y: 220, label: 'reply', variant: 'return' },
  ]));
});

test('a loop outside an authored timeline fails before writing HTML and gives a height repair', t => {
  const doc = sequence([{ from: 'middle', to: 'middle', y: 600, label: 'late' }], {
    meta: { viewBox: [1000, 680], legend: { mode: 'hidden' } },
  });
  const diagnostic = failure(t, doc, 'sequence/self-message-timeline');
  assert.equal(diagnostic.subject.path, '/messages/0/y');
  assert.ok(diagnostic.evidence.y > diagnostic.evidence.maximumY);
  assert.equal(diagnostic.supportedFixes.length, 1);
  doc.meta.viewBox[1] = diagnostic.evidence.requiredViewBoxHeight;
  render(t, doc);
});

test('a wrapped self-call note beyond an authored canvas reports the height it needs', t => {
  const doc = sequence([{ from: 'middle', to: 'middle', y: 560, label: 'late', note: LONG_NOTE.repeat(3) }], {
    meta: { viewBox: [1000, 680], legend: { mode: 'hidden' } },
  });
  const diagnostic = failure(t, doc, 'sequence/note-canvas-limit');
  assert.equal(diagnostic.subject.path, '/messages/0/note');
  doc.meta.viewBox[1] = diagnostic.evidence.requiredViewBoxHeight;
  render(t, doc);
});

test('a standard self-call cannot clip its wrapped note on a fixed canvas', t => {
  const doc = sequence([{ from: 'left', to: 'left', y: 369, label: 'flush', note: 'W'.repeat(144) }], {
    meta: { quality_profile: 'standard', column_fit: 'fixed', viewBox: [560, 480] },
  });
  const diagnostic = failure(t, doc, 'sequence/note-canvas-limit');
  assert.equal(diagnostic.subject.path, '/messages/0/note');
  doc.meta.viewBox[1] = diagnostic.evidence.requiredViewBoxHeight;
  assert.equal(note(render(t, doc)).lines.join(''), doc.messages[0].note);
});

test('a self-call note that reaches a later message reuses the verified note-overlap repair', t => {
  const doc = sequence([
    { from: 'left', to: 'left', y: 200, label: 'refresh', note: LONG_NOTE.repeat(2) },
    { from: 'left', to: 'middle', y: 280, label: 'notify' },
  ]);
  const diagnostic = failure(t, doc, 'sequence/note-overlap');
  assert.equal(diagnostic.subject.path, '/messages/0/note');
  assert.equal(diagnostic.supportedFixes.length, 1);
  doc.messages[1].y = diagnostic.evidence.requiredY;
  render(t, doc);
});
