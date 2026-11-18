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

function note(html) {
  const match = html.match(/<text data-detail="context" x="([\d.]+)" y="([\d.]+)" class="[^"]+" font-size="7"( text-anchor="end")?>([\s\S]*?)<\/text>/);
  assert.ok(match, 'self-call note is rendered');
  const spans = [...match[4].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)];
  return { x: Number(match[1]), y: Number(match[2]), anchor: match[3] ? 'end' : 'start', lines: spans.length ? spans.map(span => span[1]) : [match[4]] };
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
      const width = minimumNodeTextWidth(line, 7);
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
