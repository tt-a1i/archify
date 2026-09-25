import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(columnFit, profile, from = 140, messageY = 180) {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: {
      title: 'Segment header clearance', output: 'sequence.html',
      quality_profile: profile, column_fit: columnFit, viewBox: [1080, 480],
    },
    participants: [
      { id: 'client', type: 'frontend', label: 'Client', sublabel: 'request source' },
      { id: 'service', type: 'backend', label: 'Service', sublabel: 'request target' },
    ],
    segments: [{ from, to: 260, label: 'Visible stage heading' }],
    messages: [{ id: 'call', from: 'client', to: 'service', y: messageY, label: 'Request' }],
  };
}

function deliver(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-segment-header-'));
  try {
    const input = path.join(dir, 'sequence.json');
    const output = path.join(dir, 'sequence.html');
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [
      path.join(skillRoot, 'bin/archify.mjs'), 'deliver', 'sequence', input, output,
      '--quality', doc.meta.quality_profile, '--json',
    ], { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).ok, true);
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function firstRect(markup) {
  const match = markup.match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(match, 'expected a rectangle');
  const [x, y, width, height] = match.slice(1).map(Number);
  return { x, y, width, height };
}

function segmentLabel(html, index = 0, text = 'Visible stage heading') {
  const group = html.match(new RegExp(`<g data-graph-role="segment-label" data-segment-id="${index}">([\\s\\S]*?)<\\/g>`));
  assert.ok(group, 'segment label remains in the artifact');
  assert.ok(group[1].includes(`>${text}</text>`), 'authored heading text is preserved');
  assert.match(group[1], /font-size="9"/);
  return firstRect(group[1]);
}

test('header avoidance reserves other segment titles and keeps every moved title on canvas', () => {
  const doc = fixture('spread', 'showcase');
  doc.segments = [
    { from: 72, to: 260, label: 'Already clear title' },
    { from: 140, to: 260, label: 'First hidden title' },
    { from: 140, to: 260, label: 'Second hidden title' },
  ];
  const html = deliver(doc);
  const labels = doc.segments.map((segment, index) => segmentLabel(html, index, segment.label));
  assert.equal(labels[0].y, 50, 'an existing clear title is not relocated');
  for (const [index, label] of labels.entries()) {
    assert.ok(label.y >= 0 && label.y + label.height <= 70, 'all labels fit above the headers');
    for (const other of labels.slice(index + 1)) assert.equal(overlaps(label, other), false);
  }
});

test('an exhausted top rail preserves legacy acceptance instead of moving a title off canvas', () => {
  const doc = fixture('fixed', 'standard');
  doc.segments = [
    { from: 72, to: 260, label: 'Clear title' },
    ...Array.from({ length: 4 }, (_, index) => ({ from: 140, to: 260, label: `Title ${index}` })),
  ];
  const html = deliver(doc);
  const labels = doc.segments.map((segment, index) => segmentLabel(html, index, segment.label));
  assert.ok(labels.every((label) => label.y >= 0));
  assert.equal(labels.at(-1).y, 118, 'no free upward slot retains the old position');
});

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertHeaderClearance(html, doc) {
  const label = segmentLabel(html);
  for (const participant of doc.participants) {
    const group = html.match(new RegExp(`<g [^>]*data-node-id="${participant.id}"[^>]*>([\\s\\S]*?)<rect`));
    assert.ok(group, `participant ${participant.id} remains present`);
    const start = html.indexOf(group[0]);
    const header = firstRect(html.slice(start));
    assert.equal(overlaps(label, header), false, `segment label overlaps ${participant.id} header`);
    assert.equal(header.y, 72, 'participant geometry is preserved');
    assert.equal(header.height, 60);
  }
  assert.ok(label.y >= 0, 'label remains inside the canvas');
  assert.match(html, new RegExp(`data-composition-frame-id="0" x="48" y="${doc.segments[0].from}" width="984" height="${260 - doc.segments[0].from}"`));
  return label;
}

for (const columnFit of ['fixed', 'spread']) {
  for (const profile of ['standard', 'showcase']) {
    test(`${profile}/${columnFit}: segment title clears participant headers without changing authored bands`, () => {
      const doc = fixture(columnFit, profile);
      assertHeaderClearance(deliver(doc), doc);
    });
    test(`${profile}/${columnFit}: message avoidance cannot push a segment title into a participant header`, () => {
      const doc = fixture(columnFit, profile, 170, 160);
      const label = assertHeaderClearance(deliver(doc), doc);
      assert.ok(label.y + label.height < 140, 'the title is also clear of the message label at y=140');
    });
    test(`${profile}/${columnFit}: from=150 remains accepted and from=160 keeps its clear placement`, () => {
      const nearHeader = fixture(columnFit, profile, 150);
      assertHeaderClearance(deliver(nearHeader), nearHeader);
      const clear = fixture(columnFit, profile, 160);
      const label = assertHeaderClearance(deliver(clear), clear);
      assert.equal(label.y, 138, 'an already clear segment label does not move');
      assert.equal(label.x, 56);
      assert.equal(label.height, 18);
    });
  }
}
