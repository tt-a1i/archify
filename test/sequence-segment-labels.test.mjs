import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(__dirname, '..', 'archify', 'renderers', 'sequence', 'render-sequence.mjs');
const cli = path.resolve(__dirname, '..', 'archify', 'bin', 'archify.mjs');
// An unedited first draft with two abutting segments (140-300, 300-520). On
// dev the first label climbed behind the participant headers and the second
// climbed into the first segment, where it named the wrong phase.
const fixture = path.join(__dirname, 'fixtures', 'sequence-first-draft', 'scan-to-pay.sequence.json');
const PARTICIPANT_BOTTOM = 72 + 60;

// The draft's note at y320 touches the reply label at y352. Title-placement
// cases retain the annotation and give that reply plus later messages 12px
// more room; the unedited draft is tested separately as a diagnostic failure.
function spacedScanToPay() {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  for (const message of diagram.messages) if (message.y >= 352) message.y += 12;
  diagram.segments.at(-1).to += 12;
  return diagram;
}

function render(diagram, publicCli = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-segments-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const args = publicCli ? [cli, 'render', 'sequence', input, output] : [renderer, input, output];
  const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8' });
  return { ...result, input, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const labels = (html) => [...html.matchAll(/data-segment-id="(\d+)">\s*<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
  .map((match) => ({ index: +match[1], x: +match[2], y: +match[3], width: +match[4], height: +match[5] }));

test('abutting segment labels stay in their own phase and clear of the participant headers', () => {
  const diagram = spacedScanToPay();
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const placed = labels(result.html);
  assert.equal(placed.length, diagram.segments.length);
  for (const label of placed) {
    const own = diagram.segments[label.index];
    assert.ok(label.y >= PARTICIPANT_BOTTOM, `segment ${label.index} label is behind the participant headers`);
    for (const [index, other] of diagram.segments.entries()) {
      if (index === label.index) continue;
      const inside = Math.min(label.y + label.height, other.to) - Math.max(label.y, other.from);
      assert.ok(inside <= label.height / 2, `segment ${label.index} label sits in segment ${index}`);
    }
    assert.ok(label.y + label.height > own.from - 24 && label.y < own.to, `segment ${label.index} label is detached from its frame`);
  }
});

test('a label that fits above a spaced frame keeps its place above it', () => {
  const diagram = spacedScanToPay();
  diagram.segments = [{ from: 330, to: 520, label: 'pay' }];
  for (const message of diagram.messages) message.y += message.y >= 300 ? 40 : 0;
  diagram.segments[0].from = 340;
  diagram.segments[0].to = 560;
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [label] = labels(result.html);
  assert.ok(label.y + label.height <= 340, `label at ${label.y} should stay above the frame`);
});

// A three-phase upload whose middle phase is packed with messages: its title
// cannot sit on its own top border, and the next phase's title owns the strip
// above that phase's border.
const upload = path.join(__dirname, 'fixtures', 'sequence-first-draft', 'resumable-upload.sequence.json');

test('a title pushed inside its packed frame keeps clear of the next segment title', () => {
  const diagram = JSON.parse(fs.readFileSync(upload, 'utf8'));
  // The first draft's spacing, where the middle title used to land on "Finalize".
  const ys = { PATCH: 300, UploadPart: 320, HEAD: 332, Complete: 364, scan: 404, clean: 436, insert: 468, 204: 500 };
  for (const message of diagram.messages) {
    const key = Object.keys(ys).find((prefix) => message.label.startsWith(prefix));
    if (key) message.y = ys[key];
  }
  diagram.segments = [{ from: 140, to: 280, label: 'Create' }, { from: 286, to: 384, label: 'Transfer + resume' }, { from: 390, to: 540, label: 'Finalize' }];
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const placed = labels(result.html);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const overlap = Math.min(placed[i].y + placed[i].height, placed[j].y + placed[j].height) - Math.max(placed[i].y, placed[j].y);
      assert.ok(overlap <= 0, `segment titles ${placed[i].index} and ${placed[j].index} overlap by ${overlap}px`);
    }
  }
});

test('a segment edge running along a message arrow is reported with the move that clears it', () => {
  const diagram = JSON.parse(fs.readFileSync(upload, 'utf8'));
  diagram.segments[0].to = 298;
  diagram.segments[1].from = 302;
  const result = render(diagram);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Segment "Create" bottom edge at y 298 runs along message "PATCH chunk 1\.\.n" \(arrow at y 300\) — move the edge to at least 304/);
});

test('inside title candidates stay below low participant headers', () => {
  const diagram = spacedScanToPay();
  diagram.segments = [{ from: 120, to: 300, label: 'Phase' }];
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(labels(result.html)[0].y >= PARTICIPANT_BOTTOM);
});

// The real history drafts started their first frame at 144/145 and their
// first arrow at 174/175. The renderer's 18px title was partly behind the
// participant cards, even though the strip below those cards was free.
function headerDraft(from = 145, firstY = 175) {
  return {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'History phases', output: 'phase.html', quality_profile: 'showcase', viewBox: [920, 760] },
    participants: ['build', 'snapshot', 'page', 'browser', 'reader']
      .map((id) => ({ id, type: 'backend', label: id })),
    messages: [{ from: 'build', to: 'snapshot', y: firstY, label: 'ping', note: 'keep this annotation' }],
    segments: [{ from, to: 400, label: '构建期：读取固定文件；两种构建分支' }],
  };
}

function assertAuthoredTimeline(html, diagram) {
  const frames = [...html.matchAll(/data-composition-frame-id="(\d+)" x="48" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
    .map((match) => ({ from: +match[2], to: +match[2] + +match[3] }));
  assert.deepEqual(frames, diagram.segments.map(({ from, to }) => ({ from, to })), 'authored phase bounds stay fixed');
  const routes = [...html.matchAll(/<path data-composition-edge-from="[^"]+"[^>]* d="M [\d.]+ ([\d.]+) L [\d.]+ \1"/g)]
    .map((match) => +match[1]);
  assert.deepEqual(routes, diagram.messages.map(({ y }) => y), 'authored arrows stay fixed');
  const note = html.match(/<text data-detail="fine" x="[\d.]+" y="([\d.]+)"[^>]*font-size="([\d.]+)">keep this annotation<\/text>/);
  assert.ok(note, 'the authored note stays complete');
  assert.deepEqual(note.slice(1).map(Number), [diagram.messages.find((message) => message.note).y + 18, 7],
    'the annotation keeps its authored baseline and font');
}

for (const from of [145, 144]) {
  test(`first phase from ${from} clears headers without moving its frame, arrows or note`, () => {
    const diagram = headerDraft(from, from + 30);
    if (from === 144) {
      // These arrows defeat all four legacy inside slots near the frame top.
      diagram.messages[0].note = undefined;
      diagram.messages.push(
        { from: 'snapshot', to: 'build', y: 211, label: 'missing' },
        { from: 'build', to: 'page', y: 252, label: 'guide', note: 'keep this annotation' },
      );
    }
    const result = render(diagram);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const [title] = labels(result.html);
    assert.ok(title.y >= PARTICIPANT_BOTTOM + 2, 'the full title clears the participant cards');
    assert.ok(title.y <= from && title.y + title.height >= from, 'the title still names its own top border');
    assert.ok(title.y + title.height + 2 <= diagram.messages[0].y - 20, 'the first message label stays clear');
    assertAuthoredTimeline(result.html, diagram);
  });
}

test('a header-adjacent title cannot cover an earlier first message', () => {
  const diagram = headerDraft(145, 160);
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [title] = labels(result.html);
  assert.ok(title.y >= 160 + 22 + 2, 'the occupied header strip retains the safe inside fallback');
  assertAuthoredTimeline(result.html, diagram);
});

test('a nested frame keeps the existing title placement', () => {
  const diagram = headerDraft();
  diagram.segments.push({ from: 250, to: 350, label: 'Nested detail' });
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(labels(result.html)[0].y + 18 < diagram.segments[0].from,
    'the header-only adjustment does not reinterpret nested phase bounds');
  assertAuthoredTimeline(result.html, diagram);
});

test('a header-adjacent title keeps clear of another title that moved above its nominal slot', () => {
  const diagram = headerDraft();
  diagram.messages[0].note = undefined;
  diagram.segments[0].to = 154;
  diagram.segments.push({ from: 194, to: 350, label: '读取快照与生成页面' });
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [first, next] = labels(result.html);
  assert.ok(next.y < diagram.segments[1].from - 22, 'the other title actually moved up from its nominal slot');
  assert.ok(first.y + first.height + 2 <= next.y, 'the new header strip does not introduce a title collision');
});

test('inside segment title clears a message note after avoiding participant headers', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Annotated phase', output: 'phase.html', quality_profile: 'showcase', viewBox: [920, 760] },
    participants: [{ id: 'client', type: 'external', label: 'Client' }, { id: 'api', type: 'backend', label: 'API' }],
    messages: [{ from: 'client', to: 'api', y: 160, label: 'ping', note: 'diagnostic annotation' }],
    segments: [{ from: 120, to: 300, label: 'Processing phase title covering the annotation' }],
  };
  const result = render(diagram, true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [title] = labels(result.html);
  const note = result.html.match(/<text data-detail="fine" x="([\d.]+)" y="([\d.]+)" class="[^"]*" font-size="([\d.]+)">diagnostic annotation<\/text>/);
  assert.ok(note, 'the full authored annotation remains visible');
  assert.deepEqual(note.slice(1).map(Number), [176, 178, 7], 'note position and font remain authored geometry');
  assert.ok(title.y >= PARTICIPANT_BOTTOM, 'title clears the participant headers');
  assert.ok(title.x <= Number(note[1]) && title.x + title.width > Number(note[1]), 'fixture shares horizontal space with the note');
  const baseline = Number(note[2]);
  const font = Number(note[3]);
  assert.ok(title.y + title.height <= baseline - font * 1.2 || title.y >= baseline + font * 0.3,
    `title at y${title.y}..${title.y + title.height} must clear the annotation around baseline ${baseline}`);
});

for (const profile of ['standard', 'showcase']) {
  test(`near-border message preserves ${profile} acceptance policy`, () => {
    const diagram = {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: 'Phase boundary', output: 'phase.html', quality_profile: profile, viewBox: [920, 760] },
      participants: [{ id: 'client', type: 'external', label: 'Client' }, { id: 'api', type: 'backend', label: 'API' }],
      messages: [{ from: 'client', to: 'api', y: 200, label: 'ping' }],
      segments: [{ from: 140, to: 202, label: 'Phase' }],
    };
    const result = render(diagram);
    if (profile === 'standard') assert.equal(result.status, 0, result.stdout + result.stderr);
    else {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /bottom edge at y 202 runs along message "ping"/);
      const validated = spawnSync(process.execPath, [cli, 'validate', 'sequence', result.input, '--json'], { encoding: 'utf8' });
      const diagnostic = JSON.parse(validated.stdout).diagnostics.find(entry => entry.code === 'sequence/segment-message-border-run');
      assert.equal(diagnostic.subject.path, '/segments/0/to');
      assert.equal(diagnostic.evidence.borderY, 202);
      assert.equal(diagnostic.evidence.messageY, 200);
      assert.deepEqual(diagnostic.supportedFixes, [
        'set /segments/0/to to at least 204 to leave the message above it',
        'set /segments/0/to to at most 196 to leave the message below it',
      ]);
    }
  });
}


test('the unedited payment draft reports its note overlap with a valid spacing repair', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const rejected = render(diagram, true);
  assert.notEqual(rejected.status, 0);
  const validated = spawnSync(process.execPath, [cli, 'validate', 'sequence', rejected.input, '--json'], { encoding: 'utf8' });
  const diagnostic = JSON.parse(validated.stdout).diagnostics.find(entry => entry.code === 'sequence/note-overlap');
  assert.ok(diagnostic, validated.stdout);
  assert.equal(diagnostic.subject.path, '/messages/5/note');
  assert.equal(diagnostic.evidence.blocker.path, '/messages/6/y');
  assert.equal(diagnostic.evidence.requiredY, 364);
  assert.deepEqual(diagnostic.supportedFixes, [], 'moving only the reply would crowd the following message');
  const repaired = render(spacedScanToPay(), true);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.match(repaired.html, /需验签，并按订单号幂等处理/, 'repair preserves the authored annotation');
  diagram.meta.quality_profile = 'standard';
  const compatible = render(diagram, true);
  assert.equal(compatible.status, 0, compatible.stdout + compatible.stderr);
});
