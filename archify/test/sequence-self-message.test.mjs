import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function renderOutcome(doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-self-'));
  const input = path.join(tmp, 'input.json');
  const output = path.join(tmp, 'output.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', html: fs.readFileSync(output, 'utf8') };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), html: '' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function render(doc) {
  const outcome = renderOutcome(doc);
  assert.equal(outcome.code, 0, outcome.stderr);
  return outcome.html;
}

function sequence(messages, overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: {
      title: 'Self messages',
      quality_profile: 'showcase',
      column_fit: 'spread',
      viewBox: [1000, 680],
      ...overrides.meta,
    },
    participants: overrides.participants || [
      { id: 'left', type: 'frontend', label: 'Left' },
      { id: 'middle', type: 'backend', label: 'Middle' },
      { id: 'right', type: 'database', label: 'Right' },
    ],
    messages,
  };
}

function routePoints(html, id) {
  const match = html.match(new RegExp(`<path[^>]*data-composition-edge-id="${id}"[^>]*data-composition-points="([^"]+)"`));
  assert.ok(match, `expected route for ${id}`);
  return match[1].split(';').map((pair) => pair.split(',').map(Number));
}

test('left and middle self-messages loop right while the rightmost loop stays inside by turning left', () => {
  const html = render(sequence([
    { id: 'left-loop', from: 'left', to: 'left', y: 200, label: 'refresh' },
    { id: 'middle-loop', from: 'middle', to: 'middle', y: 320, label: 'retry' },
    { id: 'right-loop', from: 'right', to: 'right', y: 440, label: 'flush' },
  ]));

  for (const id of ['left-loop', 'middle-loop', 'right-loop']) {
    const points = routePoints(html, id);
    assert.equal(points.length, 4, `${id} must use a four-point loop`);
    assert.equal(points[0][1], points[1][1]);
    assert.equal(points[2][1], points[3][1]);
    assert.equal(points[2][1] - points[1][1], 42);
  }
  assert.ok(routePoints(html, 'left-loop')[1][0] > routePoints(html, 'left-loop')[0][0]);
  assert.ok(routePoints(html, 'middle-loop')[1][0] > routePoints(html, 'middle-loop')[0][0]);
  assert.ok(routePoints(html, 'right-loop')[1][0] < routePoints(html, 'right-loop')[0][0]);
  assert.match(html, /data-edge-id="left-loop"/);
});

test('ordinary sequence messages retain a two-point horizontal route', () => {
  const html = render(sequence([
    { id: 'request', from: 'left', to: 'middle', y: 220, label: 'request' },
  ]));
  const points = routePoints(html, 'request');
  assert.equal(points.length, 2);
  assert.equal(points[0][1], points[1][1]);
});

test('a self-message fails closed when its label cannot fit beside the participant', () => {
  const doc = sequence([
    { id: 'too-wide', from: 'left', to: 'left', y: 220, label: 'this self message label is deliberately much too wide for either adjacent lane' },
  ], {
    meta: { quality_profile: 'standard', column_fit: 'fixed', viewBox: [560, 620] },
    participants: [
      { id: 'left', type: 'frontend', label: 'Left' },
      { id: 'right', type: 'backend', label: 'Right' },
    ],
  });
  const outcome = renderOutcome(doc);
  assert.notEqual(outcome.code, 0);
  assert.match(outcome.stderr, /Self-message .* does not fit beside participant "left"/);
  assert.match(outcome.stderr, /column_fit "spread"/);
});

test('a self-message reserves its full loop height inside the readable timeline', () => {
  const outcome = renderOutcome(sequence([
    { id: 'late-loop', from: 'middle', to: 'middle', y: 590, label: 'late' },
  ]));
  assert.notEqual(outcome.code, 0);
  assert.match(outcome.stderr, /so its self-call loop stays inside the lifeline/);
});
