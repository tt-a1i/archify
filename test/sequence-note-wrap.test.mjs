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
  return [...html.matchAll(/<text data-detail="fine" x="([\d.]+)" y="([\d.]+)" class="[^"]*" font-size="7">([\s\S]*?)<\/text>/g)]
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

test('standard keeps accepting a crowded note', (t) => {
  const spec = sequence({
    quality: 'standard',
    messages: [
      { from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { from: 'api', to: 'client', y: 230, label: 'reply', variant: 'return' },
    ],
  });
  assert.equal(run(t, 'validate', spec).result.status, 0);
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
