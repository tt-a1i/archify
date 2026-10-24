import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimumNodeTextWidth } from '../archify/renderers/shared/text-fit.mjs';

// Sequence message notes wrap inside one gap between neighbouring lifelines and
// keep every character (#676).
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const LONG_NOTE = 'this note explains the whole retry and backoff policy in a lot of detail so it is very long';
const URL_NOTE = 'see https://api.example.com/v2/users/profile/settings/notifications/email-preferences';

function sequence({ messages, participants = ['client', 'api', 'db'], quality = 'showcase', activations } = {}) {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: quality, column_fit: 'spread' },
    participants: participants.map((id) => ({ id, type: 'backend', label: id.toUpperCase() })),
    messages,
    ...(activations ? { activations } : {}),
  };
}

function run(t, command, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-note-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'candidate.json');
  const output = path.join(dir, 'note.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const args = command === 'render'
    ? [cli, 'render', 'sequence', input, output]
    : [cli, 'validate', 'sequence', input, '--json'];
  const result = spawnSync(process.execPath, args, { cwd: skillRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { result, html: command === 'render' && result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

function render(t, spec) {
  const { result, html } = run(t, 'render', spec);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return html;
}

function lifelines(html) {
  return [...html.matchAll(/<path d="M ([\d.]+) 142 L \1 [\d.]+" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g)]
    .map((match) => Number(match[1]));
}

function notes(html) {
  return [...html.matchAll(/<text data-detail="context" x="([\d.]+)" y="([\d.]+)" class="[^"]*" font-size="7">([\s\S]*?)<\/text>/g)]
    .map((match) => {
      const tspans = [...match[3].matchAll(/<tspan x="([\d.]+)" dy="([\d.]+)">([^<]*)<\/tspan>/g)];
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        raw: match[3],
        lines: tspans.length ? tspans.map((line) => line[3]) : [match[3]],
        tspanX: tspans.map((line) => Number(line[1])),
        dy: tspans.map((line) => Number(line[2])),
      };
    });
}

function decode(text) {
  return text.replaceAll('&amp;', '&');
}

test('the reported long note wraps inside its own lane and keeps every word', (t) => {
  const html = render(t, sequence({
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: 380, label: 'reply', variant: 'return' },
    ],
    activations: [{ participant: 'api', from: 190, to: 390 }],
  }));
  const [client, api] = lifelines(html);
  const [note] = notes(html);
  assert.ok(note.lines.length > 1, 'the long note wraps');
  assert.equal(note.lines.join(' '), LONG_NOTE, 'no word is dropped or shortened');
  assert.equal(note.x, client + 19, 'the first line keeps its original position');
  assert.deepEqual(note.dy, note.lines.map((_, index) => (index ? 11 : 0)));
  for (const line of note.lines) {
    assert.ok(note.x + minimumNodeTextWidth(line, 7) <= api - 11, `"${line}" stays clear of the API activation bar`);
  }
});

test('long unbroken text breaks after URL punctuation and keeps every character', (t) => {
  const html = render(t, sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [{ id: 'link', from: 'client', to: 'api', y: 200, label: 'docs', note: URL_NOTE }],
  }));
  const [client, api] = lifelines(html);
  const [note] = notes(html);
  assert.ok(note.lines.length > 2, 'the address spans several lines');
  assert.equal(note.lines[0], 'see');
  assert.equal(note.lines.slice(1).join(''), URL_NOTE.slice('see '.length), 'every character of the address is kept');
  for (const line of note.lines.slice(1, -1)) {
    assert.match(line, /[/.\-?&=#_]$/, `"${line}" breaks after punctuation`);
  }
  for (const line of note.lines) {
    assert.ok(client + 19 + minimumNodeTextWidth(line, 7) <= api - 11, `"${line}" fits its lane`);
  }
});

test('text without any punctuation breaks at a character boundary', (t) => {
  const token = 'x'.repeat(160);
  const html = render(t, sequence({ messages: [{ from: 'client', to: 'api', y: 200, label: 'token', note: token }] }));
  const [note] = notes(html);
  assert.ok(note.lines.length > 1);
  assert.equal(note.lines.join(''), token);
});

test('a short note keeps its original single-line markup', (t) => {
  const html = render(t, sequence({ messages: [{ from: 'api', to: 'client', y: 200, label: 'reply', note: 'cached for 5 minutes' }] }));
  const [client] = lifelines(html);
  const [note] = notes(html);
  assert.equal(note.x, client + 19);
  assert.equal(note.y, 218);
  assert.equal(note.raw, 'cached for 5 minutes');
  assert.doesNotMatch(html, /<tspan/);
});

test('mixed Chinese notes use partial lines before requiring a later reply', (t) => {
  const text = 'inner.run 成功或抛错都会 close；外层 init 失败发生在 try 之前。';
  const spec = sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue', 'worker', 'store'],
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: text },
      { id: 'reply', from: 'api', to: 'client', y: 266, label: 'reply', variant: 'return' },
    ],
    activations: [{ participant: 'api', from: 190, to: 280 }],
  });
  const html = render(t, spec);
  const [, api] = lifelines(html);
  const [note] = notes(html);
  assert.equal(note.lines.length, 3, 'the existing gap fits the full note in three lines');
  assert.equal(note.lines.join('').replaceAll(' ', ''), text.replaceAll(' ', ''));
  assert.equal(note.y, 218, 'the authored message stays in place');
  for (const line of note.lines) {
    assert.ok(note.x + minimumNodeTextWidth(line, 7) <= api - 11, `"${line}" clears the activation bar`);
  }
  assert.equal(run(t, 'validate', spec).result.status, 0, 'no extra reply spacing is required');
});

test('Chinese wrapping preserves signed scores and graphemes without growing notes', (t) => {
  const texts = [
    '评分：会话 ID 匹配 +4、匹配 file-edit seq +4、非空事件 +1；取最高且大于 0 的结果。',
    '快照按 commit hash 精确优先，再前缀匹配；未命中保留空摘录，不生成推测对话。',
    '首先说明 aaaaaaaaaaae\u0301成功或抛错都会 close；外层 init 失败发生在 try 之前。',
  ];
  const html = render(t, sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue', 'worker', 'store'],
    messages: texts.map((note, index) => ({ from: 'client', to: 'api', y: 200 + index * 200, label: 'lookup', note })),
  }));
  const wrapped = notes(html);
  assert.equal(wrapped[0].lines.join(' ').match(/\+4/g)?.length, 2, 'a sign stays with its score');
  assert.match(wrapped[0].lines.join(' '), /file-edit/);
  assert.ok(wrapped[2].lines.some((line) => line.includes('e\u0301')), 'a combining accent stays with its base letter');
  for (const [index, note] of wrapped.entries()) {
    assert.ok(note.lines.length <= [5, 4, 5][index], 'word segmentation never increases note height');
    assert.equal(note.lines.join('').replaceAll(' ', ''), texts[index].replaceAll(' ', ''));
  }
});

test('a note on a message that skips participants stays in the left-most gap, in either direction', (t) => {
  for (const [from, to] of [['client', 'db'], ['db', 'client']]) {
    const html = render(t, sequence({ messages: [{ from, to, y: 200, label: 'lookup', note: LONG_NOTE }] }));
    const [client, api] = lifelines(html);
    const [note] = notes(html);
    assert.equal(note.x, client + 19, `${from} → ${to} starts where notes always started`);
    for (const line of note.lines) {
      assert.ok(note.x + minimumNodeTextWidth(line, 7) <= api - 11, `${from} → ${to}: "${line}" stays clear of the skipped API lifeline`);
    }
  }
});

test('a short note on a reverse message that skips a participant keeps its original position', (t) => {
  const html = render(t, sequence({ messages: [{ from: 'db', to: 'client', y: 200, label: 'result', note: 'from replica' }] }));
  const [client] = lifelines(html);
  const [note] = notes(html);
  assert.equal(note.x, client + 19);
  assert.equal(note.y, 218);
  assert.equal(note.raw, 'from replica');
});

test('equal spread gaps that differ only by floating-point rounding keep the left-most gap', (t) => {
  // Six and seven spread columns produce middle gaps such as 141.80000000000007.
  for (const count of [6, 7]) {
    const ids = Array.from({ length: count }, (_, index) => `p${index}`);
    for (const [from, to] of [[ids.at(-1), ids[0]], [ids[0], ids.at(-1)]]) {
      const html = render(t, sequence({ participants: ids, messages: [{ from, to, y: 200, label: 'reply', note: 'ok' }] }));
      const [first] = lifelines(html);
      const [note] = notes(html);
      assert.ok(Math.abs(note.x - (first + 19)) < 1e-9, `${count} participants, ${from} → ${to}: note at ${note.x}, expected ${first + 19}`);
    }
  }
});

// Fixed columns keep the first note beside the segment label column at x=56.
test('a segment label steps up clear of a wrapped note', (t) => {
  const spec = sequence({
    messages: [{ from: 'client', to: 'api', y: 200, label: 'request', note: 'retries with backoff when the cache misses' }],
  });
  spec.meta.column_fit = 'fixed';
  spec.segments = [{ label: 'Fallback', from: 260, to: 360 }];
  const { result } = run(t, 'validate', spec);
  assert.equal(result.status, 0, result.stdout);
  const html = render(t, spec);
  const [note] = notes(html);
  const labelY = Number(html.match(/<rect x="56" y="(-?[\d.]+)" width="[\d.]+" height="18"/)[1]);
  const noteTop = note.y - 7;
  assert.ok(labelY + 18 + 2 <= noteTop || labelY >= note.y + (note.lines.length - 1) * 11 + 4,
    `segment label at y=${labelY} clears the note from ${noteTop}`);
});

// Read one structured diagnostic from `validate --json` and apply its single
// supported fix ("set /json/pointer to value") to a copy of the input.
function failure(t, spec, code) {
  const { result } = run(t, 'validate', spec);
  assert.notEqual(result.status, 0, 'validate must fail');
  const diagnostic = JSON.parse(result.stdout).diagnostics.find((entry) => entry.code === code);
  assert.ok(diagnostic, `expected ${code} in ${result.stdout}`);
  assert.equal(diagnostic.severity, 'error');
  return diagnostic;
}

function applyFix(spec, fix) {
  const [, pointer, value] = fix.match(/^set (\/\S+) to (.+)$/);
  const copy = structuredClone(spec);
  const keys = pointer.slice(1).split('/');
  const parent = keys.slice(0, -1).reduce((node, key) => {
    node[key] ??= {};
    return node[key];
  }, copy);
  parent[keys.at(-1)] = JSON.parse(value);
  return copy;
}

test('a segment label left covering a message label reports it with a verified fix', (t) => {
  // The reviewer's case: the wrapped note pushes the label up onto "request".
  const spec = sequence({ messages: [{ from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE }] });
  spec.meta.column_fit = 'fixed';
  spec.segments = [{ label: 'Fallback', from: 280, to: 360 }];
  const diagnostic = failure(t, spec, 'sequence/segment-label-overlap');
  assert.deepEqual(diagnostic.subject, { diagramType: 'sequence', segment: 'Fallback', path: '/segments/0/from' });
  assert.equal(diagnostic.evidence.attempts, 4);
  assert.equal(diagnostic.evidence.covered.kind, 'message label');
  assert.equal(diagnostic.evidence.covered.path, '/messages/0/label');
  assert.equal(diagnostic.evidence.covered.message, 'request');
  assert.equal(diagnostic.supportedFixes.length, 1);
  assert.match(diagnostic.supportedFixes[0], /^set \/segments\/0\/from to \d+$/);
  const repaired = run(t, 'validate', applyFix(spec, diagnostic.supportedFixes[0])).result;
  assert.equal(repaired.status, 0, repaired.stdout);
});

test('a segment label with no clear position names the note it would cover', (t) => {
  const spec = sequence({
    messages: [
      { from: 'client', to: 'api', y: 160, label: 'open' },
      { from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE.repeat(3) },
    ],
  });
  spec.meta.column_fit = 'fixed';
  spec.segments = [{ label: 'Fallback', from: 360, to: 400 }];
  const diagnostic = failure(t, spec, 'sequence/segment-label-overlap');
  assert.equal(diagnostic.evidence.covered.kind, 'note');
  assert.equal(diagnostic.evidence.covered.path, '/messages/1/note');
  for (const fix of diagnostic.supportedFixes) {
    assert.equal(run(t, 'validate', applyFix(spec, fix)).result.status, 0, `${fix} must hold`);
  }
});

test('a wrapped note below an authored canvas reports the height it needs', (t) => {
  const spec = (height) => ({
    ...sequence({ messages: [{ id: 'late', from: 'client', to: 'api', y: 660, label: 'late', note: LONG_NOTE.repeat(3) }] }),
    meta: { title: 'Fixed canvas', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [920, height], legend: { mode: 'hidden' } },
  });
  const diagnostic = failure(t, spec(760), 'sequence/note-canvas-limit');
  assert.equal(diagnostic.subject.path, '/messages/0/note');
  assert.equal(diagnostic.subject.message, 'late');
  assert.equal(diagnostic.evidence.viewBoxHeight, 760);
  assert.equal(diagnostic.evidence.canvasLimitY, 760 - 65 + 20);
  assert.ok(diagnostic.evidence.note.y + diagnostic.evidence.note.height > diagnostic.evidence.canvasLimitY);
  const required = diagnostic.evidence.requiredViewBoxHeight;
  assert.deepEqual(diagnostic.supportedFixes, [`set /meta/viewBox/1 to ${required}`]);
  const repaired = run(t, 'validate', applyFix(spec(760), diagnostic.supportedFixes[0])).result;
  assert.equal(repaired.status, 0, repaired.stdout);
  const standard = spec(760);
  standard.meta.quality_profile = 'standard';
  assert.equal(run(t, 'validate', standard).result.status, 0, 'standard keeps accepting the authored canvas');
});

test('a wrapped note that reaches the next message names the message and the y it needs', (t) => {
  const crowded = (replyY) => sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: replyY, label: 'reply', variant: 'return' },
    ],
  });
  const diagnostic = failure(t, crowded(230), 'sequence/note-overlap');
  assert.match(diagnostic.message, /Note on message "request" wraps to \d+ lines/);
  assert.deepEqual(diagnostic.subject, { diagramType: 'sequence', message: 'request', path: '/messages/0/note', from: 'client', to: 'api' });
  assert.equal(diagnostic.evidence.blocker.path, '/messages/1/y');
  assert.equal(diagnostic.evidence.blocker.message, 'reply');
  assert.equal(diagnostic.evidence.blocker.y, 230);
  assert.ok(diagnostic.evidence.lines > 1);
  const requiredY = diagnostic.evidence.requiredY;
  assert.ok(requiredY > 230);
  assert.deepEqual(diagnostic.supportedFixes, [`set /messages/1/y to ${requiredY}`]);

  const repaired = run(t, 'validate', applyFix(crowded(230), diagnostic.supportedFixes[0])).result;
  assert.equal(repaired.status, 0, repaired.stdout);
  // An automatic canvas grows after the move. An authored canvas of the same
  // original height cannot promise that one-field repair. Place this case later
  // in the timeline so its automatic height is also schema-valid when authored.
  const constrainedSpec = crowded(230);
  for (const message of constrainedSpec.messages) message.y += 140;
  const automatic = failure(t, constrainedSpec, 'sequence/note-overlap');
  const compactHeight = Number(render(t, { ...constrainedSpec, meta: { ...constrainedSpec.meta, quality_profile: 'standard' } })
    .match(/<svg viewBox="0 0 920 (\d+)"/)[1]);
  constrainedSpec.meta.viewBox = [920, compactHeight];
  const constrained = failure(t, constrainedSpec, 'sequence/note-overlap');
  assert.ok(automatic.evidence.requiredY > compactHeight - 65 - 18, 'repair needs more timeline room than the authored canvas');
  assert.equal(automatic.supportedFixes.length, 1, 'automatic height grows for the move');
  assert.deepEqual(constrained.supportedFixes, [], 'authored height remains binding');
  const html = render(t, crowded(requiredY));
  assert.equal(decode(notes(html)[0].lines.join(' ')), LONG_NOTE);
});

// The issue fixture (#903): one wrapped note reaches two later messages. The
// receipt must carry the whole ordered adjustment — moving only the first
// blocker leaves the second one reached with no offered repair.
test('a note that reaches several messages emits the whole ordered adjustment', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
        { from: 'client', to: 'api', y: 490, label: 'unaffected later reply' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  const requiredY = diagnostic.evidence.requiredY;
  assert.equal(diagnostic.evidence.blocker.path, '/messages/1/y');
  assert.deepEqual(
    diagnostic.evidence.reached.map((entry) => entry.path),
    ['/messages/1/y', '/messages/2/y'],
    'the receipt lists every message the note reaches',
  );
  assert.match(diagnostic.message, /and 1 more message below/);
  assert.deepEqual(diagnostic.supportedFixes, [
    `set /messages/1/y to ${requiredY}`,
    `set /messages/2/y to ${requiredY + 28}`,
  ]);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  assert.deepEqual(repaired.messages[3], spec.messages[3], 'a clear later message stays unchanged (#924)');
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

test('the ordered adjustment withholds rather than reordering the timeline', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
        { from: 'client', to: 'api', y: 430, label: 'later reply' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  // The second blocker can only clear the first by passing "later reply" at
  // 430; moving a message past an unrelated one would reorder the timeline, so
  // the adjustment is withheld instead.
  assert.deepEqual(diagnostic.supportedFixes, []);
});

test('a note that reaches several messages withholds the adjustment without authored room', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 500], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'no arrangement fits the authored canvas, so no edit is advertised');
});

test('a reached message with its own note is checked at its moved position', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker', note: 'alpha beta gamma delta epsilon zeta eta theta iota' },
        { from: 'client', to: 'api', y: 380, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  // The first blocker takes the first clear slot 399: the row at 380 is
  // vacated by this same adjustment, so it must not veto the scan. The second
  // then clears the first blocker's note at its new position
  // (399 + 22 + 20 + 2 = 443), which a scan reading the note's stale y
  // would miss.
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /messages/1/y to 399',
    'set /messages/2/y to 443',
  ]);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

test('a note on the moved message that cannot clear the content limit withholds the adjustment', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'mid' },
        { from: 'client', to: 'api', y: 366, label: 'tail', note: Array(60).fill('word').join(' ') },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 520], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  // At this height the tail's own wrapped note breaches the authored content
  // limit from every reachable slot, which would trade this failure for
  // sequence/note-canvas-limit, so no edit is advertised.
  assert.deepEqual(diagnostic.supportedFixes, []);
});

test('the ordered adjustment keeps off a segment frame edge', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'mid', note: 'short blurb' },
        { from: 'client', to: 'api', y: 374, label: 'tail' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  spec.segments = [{ label: 'Phase', from: 402, to: 540 }];
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  // requiredY 399 is inside the edge's 4px clearance (402); the first clear
  // slot is 406, and the next message follows 28px later on the same lane.
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /messages/1/y to 406',
    'set /messages/2/y to 434',
  ]);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

test('disjoint lanes may keep a closer row in the ordered adjustment', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api', 'db'],
      messages: [
        { from: 'client', to: 'db', y: 300, label: 'owner', note: 'x'.repeat(240) },
        { from: 'client', to: 'api', y: 330, label: 'mid' },
        { from: 'api', to: 'db', y: 380, label: 't'.repeat(36) },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 529], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  // The two arrows only touch at one lifeline, so the 28px crowding rule does
  // not bind between them; the second slot sits 24px below the first.
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /messages/1/y to 421',
    'set /messages/2/y to 445',
  ]);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

test('a single move steps past a segment edge but not past a message', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  spec.segments = [{ label: 'Phase', from: 401, to: 520 }];
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  // requiredY 399 is inside the edge's 4px clearance (401); 405 is the first
  // slot that clears it, and nothing sits below the blocker to cross.
  assert.deepEqual(diagnostic.supportedFixes, ['set /messages/1/y to 405']);
  const repaired = applyFix(spec, diagnostic.supportedFixes[0]);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);

  const blocked = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'blocker' },
        { from: 'client', to: 'api', y: 420, label: 'unrelated reply' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const crossing = failure(t, blocked, 'sequence/note-overlap');
  // The note does not reach the reply at 420, and every slot that clears the
  // 28px spacing with it would have to sit below it, so no edit is offered.
  assert.deepEqual(crossing.supportedFixes, []);
});

test('the ordered adjustment covers a long chain of reached messages', (t) => {
  const spec = sequence({
    participants: ['client', 'api'],
    messages: [
      { from: 'client', to: 'api', y: 160, label: 'owner', note: Array(800).fill('word').join(' ') },
      ...Array.from({ length: 23 }, (_, index) => ({ from: 'client', to: 'api', y: 188 + 28 * index, label: `m${index}` })),
    ],
  });
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  const requiredY = diagnostic.evidence.requiredY;
  assert.equal(diagnostic.evidence.reached.length, 23);
  assert.equal(diagnostic.supportedFixes.length, 23, 'every reached message gets its own slot');
  assert.equal(diagnostic.supportedFixes[0], `set /messages/1/y to ${requiredY}`);
  assert.equal(diagnostic.supportedFixes[22], `set /messages/23/y to ${requiredY + 28 * 22}`);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

test('standard keeps accepting a crowded note', (t) => {
  const spec = sequence({
    quality: 'standard',
    messages: [
      { from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { from: 'api', to: 'client', y: 230, label: 'reply', variant: 'return' },
    ],
  });
  assert.equal(run(t, 'validate', spec).result.status, 0);
  spec.segments = [{ from: 150, to: 232, label: 'Request' }];
  // Render the crowded reply first: a later opaque note would cover it.
  spec.messages.reverse();
  const html = render(t, spec);
  assert.equal(decode(notes(html)[0].lines.join(' ')), LONG_NOTE);
  const [left, right] = lifelines(html);
  const masks = [...html.matchAll(/<rect[^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*class="c-mask"/g)];
  assert.ok(masks.length > 0);
  for (const [, x, y, width, height] of masks) {
    const crossesReply = +x < right && +x + +width > left && +y < 230 && +y + +height > 230;
    assert.equal(crossesReply, false, 'opaque backgrounds must not hide the authored reply');
  }
});

test('an automatic canvas grows to hold a wrapped note on the last message', (t) => {
  const html = render(t, sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [{ from: 'client', to: 'api', y: 700, label: 'late', note: LONG_NOTE.repeat(2) }],
  }));
  const height = Number(html.match(/<svg viewBox="0 0 920 (\d+)"/)[1]);
  const [note] = notes(html);
  const lastBaseline = note.y + (note.lines.length - 1) * 11;
  const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  assert.ok(lastBaseline + 2 < legendTitle - 12, `last note line ${lastBaseline} stays above the legend title ${legendTitle}`);
  assert.ok(height > 760);
});

test('a widened automatic canvas wraps a late note using its final lane geometry', (t) => {
  const ids = Array.from({ length: 8 }, (_, index) => `p${index}`);
  const token = 'x'.repeat(160);
  const spec = sequence({
    participants: ids,
    messages: [{ from: 'p1', to: 'p2', y: 700, label: 'late', note: token }],
  });
  // This dev-supported label widens the automatic canvas beyond 920px.
  spec.participants[4].label = 'Team operations';
  const html = render(t, spec);
  const [, widthText, heightText] = html.match(/<svg viewBox="0 0 (\d+) (\d+)"/);
  const width = Number(widthText);
  const height = Number(heightText);
  assert.ok(width > 920 && width <= 1085, `automatic width ${width} stays within the readable bound`);
  const lanes = lifelines(html);
  const [note] = notes(html);
  assert.equal(note.x, lanes[1] + 19, 'note starts in the final sender lane');
  assert.ok(note.lines.length > 1);
  assert.equal(note.lines.join(''), token);
  for (const line of note.lines) {
    assert.ok(note.x + minimumNodeTextWidth(line, 7) <= lanes[2] - 11, `${line} clears the final next lifeline`);
  }
  const lastBaseline = note.y + (note.lines.length - 1) * 11;
  const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  assert.ok(lastBaseline + 2 < legendTitle - 12, 'automatic height includes the wrapped note');
  const authored = render(t, { ...spec, meta: { ...spec.meta, viewBox: [width, height] } });
  assert.deepEqual(lifelines(authored), lanes, 'authored and computed canvas widths give the same lanes');
  assert.deepEqual(notes(authored), notes(html), 'note wrapping uses the final width before automatic height');
});

// A phase can contain the arrow while its wrapped explanation spills into the
// next phase. Advise without rewriting the author's timeline or rejecting v1.
test('a wrapped note crossing its phase reports a usable boundary repair', t => {
  const spec = sequence({ messages: [{ id: 'reply', from: 'api', to: 'client', y: 200, label: 'reply', note: LONG_NOTE }] });
  spec.segments = [{ from: 150, to: 232, label: 'Response' }];
  const { result } = run(t, 'validate', spec);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const warning = (JSON.parse(result.stdout).composition?.sequenceNoteBorders || []).find(d => d.code === 'sequence/note-segment-border');
  assert.equal(warning?.reviewSuggested, true);
  assert.equal(JSON.parse(result.stdout).composition.summary.warnings, 0, 'review evidence must not become a showcase finalization failure');
  assert.equal(warning.subject.path, '/messages/0/note');
  assert.equal(warning.evidence.segment.path, '/segments/0/to');
  assert.ok(warning.evidence.note.y + warning.evidence.note.height > spec.segments[0].to);
  assert.equal(warning.supportedFixes.length, 1);
  const fix = warning.supportedFixes[0].match(/^set \/segments\/0\/to to (\d+)$/);
  assert.ok(fix, warning.supportedFixes[0]);
  const original = render(t, spec);
  assert.match(original, /data-composition-frame-kind="segment"[^>]* y="150"[^>]* height="82"/);
  assert.equal(notes(original)[0].y, 218, 'the note keeps its authored message baseline');
  spec.segments[0].to = Number(fix[1]);
  const repaired = run(t, 'validate', spec).result;
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.ok(!(JSON.parse(repaired.stdout).composition?.sequenceNoteBorders || []).some(d => d.code === 'sequence/note-segment-border'));
  assert.equal(notes(render(t, spec))[0].lines.join(' '), LONG_NOTE, 'repair keeps the complete note');
});

test('phase repair advice does not absorb the next phase, outside arrow, or fixed canvas', t => {
  for (const blocker of ['phase', 'message', 'canvas']) {
    const spec = sequence({ quality: 'standard', messages: [{ id: 'reply', from: 'api', to: 'client', y: 200, label: 'reply', note: LONG_NOTE }] });
    spec.segments = [{ from: 150, to: 232, label: 'Response' }];
    if (blocker === 'phase') spec.segments.push({ from: 240, to: 320, label: 'Next' });
    if (blocker === 'message') spec.messages.push({ id: 'next', from: 'api', to: 'db', y: 240, label: 'next' });
    if (blocker === 'canvas') {
      spec.meta.viewBox = [640, 480];
      spec.messages[0].y = 395;
      spec.segments[0] = { from: 350, to: 425, label: 'Response' };
    }
    const { result } = run(t, 'validate', spec);
    assert.equal(result.status, 0, blocker + ': ' + result.stdout + result.stderr);
    const warning = (JSON.parse(result.stdout).composition?.sequenceNoteBorders || []).find(d => d.code === 'sequence/note-segment-border');
    assert.equal(warning?.reviewSuggested, true, blocker);
    assert.deepEqual(warning.supportedFixes, [], blocker);
  }
});

test('notes that fit their phase, or messages outside it, do not request a phase review', t => {
  const spec = sequence({ messages: [{ id: 'reply', from: 'api', to: 'client', y: 200, label: 'reply', note: LONG_NOTE }] });
  for (const segment of [{ from: 150, to: 360, label: 'Response' }, { from: 350, to: 410, label: 'Later' }]) {
    spec.segments = [segment];
    const { result } = run(t, 'validate', spec);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!(JSON.parse(result.stdout).composition?.sequenceNoteBorders || []).some(d => d.code === 'sequence/note-segment-border'));
  }
});
// A later reached row still sits on the slot this same adjustment vacates, so
// it must not veto the scan: with rows at 330 and 397, the first clear slot
// is 399 — not 425 past the stale row.
test('the ordered adjustment ignores rows the same repair vacates', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 397, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.deepEqual(diagnostic.supportedFixes, [
    'set /messages/1/y to 399',
    'set /messages/2/y to 427',
  ]);
  let repaired = spec;
  for (const fix of diagnostic.supportedFixes) repaired = applyFix(repaired, fix);
  const after = run(t, 'validate', repaired).result;
  assert.equal(after.status, 0, after.stdout + after.stderr);
});

// Applying only the first edit of a joint plan strands the rest without room
// (the moved row becomes their ceiling), so the receipt must say the listed
// edits are one atomic adjustment instead of alternatives.
test('the ordered adjustment is advertised as one atomic repair', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 600], legend: { mode: 'hidden' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.ok(diagnostic.supportedFixes.length > 1);
  assert.match(diagnostic.message, /one atomic adjustment, apply them all before revalidating/);
});
// A joint move that would push content into the implicit legend band on an
// authored canvas is withheld: the follow-up layout/constraint offers no fix,
// so advertising the move strands the repair loop.
test('the ordered adjustment withholds a move that strands the implicit legend', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 520] },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'the move fails on apply with an unfixable legend diagnostic');
});

// Rows may be fractional while the scan steps in whole pixels: the ceiling
// keeps the last integer slot below a fractional row instead of discarding it.
test('the ordered adjustment keeps the last integer slot below fractional rows', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api', 'db'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'blocker' },
        { from: 'api', to: 'db', y: 443.5, label: 'disjoint' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread' },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.requiredY, 443);
  assert.deepEqual(diagnostic.supportedFixes, ['set /messages/1/y to 443']);
  const repaired = run(t, 'validate', applyFix(spec, diagnostic.supportedFixes[0])).result;
  assert.equal(repaired.status, 0, repaired.stdout);
});

// A reached row can own a note taller than the bounded scan window: the repair
// is withheld honestly at the bound instead of extending the search for
// pathological notes (#923 review).
test('the ordered adjustment withholds past its bounded scan window', (t) => {
  const spec = sequence({
    participants: ['client', 'api'],
    messages: [
      { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
      { from: 'client', to: 'api', y: 330, label: 'first', note: Array(620).fill('word').join(' ') },
      { from: 'client', to: 'api', y: 380, label: 'second' },
    ],
  });
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.requiredY, 399);
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'the bounded scan withholds rather than reach past a pathological note');
});

// A segment frame edge rejects every integer slot within 4px; the repair is
// withheld honestly instead of searching subpixel positions for one (#923
// review).
test('the single repair withholds when only a subpixel slot would clear a segment edge', (t) => {
  const spec = sequence({
    messages: [
      { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
      { from: 'client', to: 'api', y: 330, label: 'blocker' },
      { from: 'api', to: 'db', y: 443.5, label: 'disjoint' },
    ],
  });
  spec.segments = [{ label: 'Phase', from: 200, to: 439.2 }];
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.requiredY, 443);
  assert.deepEqual(diagnostic.supportedFixes, [], 'no subpixel search is required; honest refusal');
});

// An explicitly configured legend that is over-wide fails on apply for a
// reason the note cannot fix; the repair is withheld rather than claimed
// verified (#923 review).
test('the ordered adjustment withholds when the explicit legend cannot fit the canvas width', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: {
      title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread',
      viewBox: [560, 700], legend: { mode: 'all', entries: { default: { label: 'x'.repeat(75) } } },
    },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'an over-wide explicit legend cannot take a claimed verified repair');
});
// Activations and segment frames set the legend floor too; an explicit legend
// already stranded by those constant terms must not take a claimed verified
// repair either (#923 review).
test('the ordered adjustment withholds when static content already strands the explicit legend', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 700], legend: { mode: 'all' } },
  };
  spec.segments = [{ label: 'Late', from: 500, to: 600 }];
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'a legend already stranded by the phase cannot take a claimed verified repair');
});

// An explicitly configured visible legend is a hard error when it cannot fit,
// so a move that strands it must withhold exactly like the implicit case; the
// hidden-mode bypass only applies when nothing is visible (#923 review).
test('the ordered adjustment withholds a move that strands an explicit visible legend', (t) => {
  const spec = {
    ...sequence({
      participants: ['client', 'api'],
      messages: [
        { from: 'client', to: 'api', y: 300, label: 'owner', note: Array(60).fill('word').join(' ') },
        { from: 'client', to: 'api', y: 330, label: 'first blocker' },
        { from: 'client', to: 'api', y: 366, label: 'second blocker' },
      ],
    }),
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread', viewBox: [560, 520], legend: { mode: 'all' } },
  };
  const diagnostic = failure(t, spec, 'sequence/note-overlap');
  assert.equal(diagnostic.evidence.reached.length, 2);
  assert.deepEqual(diagnostic.supportedFixes, [], 'the move fails on apply with an unfixable legend diagnostic');
});
