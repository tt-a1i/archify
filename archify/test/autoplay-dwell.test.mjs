import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-autoplay-dwell-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

const AUTHORS = {
  dwell: {
    storyFollowMinMs: 2000,
    journeyStepMs: 1800,
    viewIntervalMs: 4000,
  },
};

function fixture(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode]), 'utf8'));
}

function run(mode, doc, suffix) {
  const input = path.join(tmp, `${mode}-${suffix}.json`);
  const output = path.join(tmp, `${mode}-${suffix}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output,
  ], { encoding: 'utf8' });
  return { result, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function authoredHtml(html) {
  const match = html.match(/<script id="archify-motion-data" type="application\/json">(.*?)<\/script>/);
  return match ? JSON.parse(match[1]) : null;
}

test('authored meta.motion emits an effective motion block and overrides the readable-dwell defaults in every renderer', () => {
  for (const mode of Object.keys(CASES)) {
    const doc = fixture(mode);
    doc.meta.motion = structuredClone(AUTHORS);
    const { result, html } = run(mode, doc, 'authored');
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    const parsed = authoredHtml(html);
    assert.ok(parsed, `${mode}: delivered HTML must carry the authored motion data block`);
    assert.equal(parsed.dwell.storyFollowMinMs, 2000, mode);
    assert.equal(parsed.dwell.journeyStepMs, 1800, mode);
    assert.equal(parsed.dwell.viewIntervalMs, 4000, mode);
    // The template must derive all three timing constants from the authored config.
    assert.match(html, /var VIEW_INTERVAL_MS = Archify\.motionConfig\.dwell\.viewIntervalMs/, mode);
    assert.match(html, /var STORY_FOLLOW_MIN_DWELL_MS = Archify\.motionConfig\.dwell\.storyFollowMinMs/, mode);
    assert.match(html, /var JOURNEY_DWELL_MS = Archify\.motionConfig\.dwell\.journeyStepMs/, mode);
  }
});

test('absent meta.motion emits no motion block and keeps the readable-dwell defaults', () => {
  for (const mode of Object.keys(CASES)) {
    const { result, html } = run(mode, fixture(mode), 'plain');
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    assert.equal(authoredHtml(html), null, `${mode}: authored-less render must carry no motion data block`);
    // The shared resolver keeps the camera-settle floor as the fallback.
    assert.match(html, /storyFollowMinMs: 1100/, mode);
    assert.match(html, /journeyStepMs: 1100/, mode);
    assert.match(html, /viewIntervalMs: 3200/, mode);
  }
});

test('a partial dwell object leaves unset keys at their readable-dwell defaults', () => {
  const doc = fixture('architecture');
  doc.meta.motion = { dwell: { journeyStepMs: 2400 } };
  const { result, html } = run('architecture', doc, 'partial');
  assert.equal(result.status, 0, result.stderr);
  const parsed = authoredHtml(html);
  assert.ok(parsed);
  assert.equal(parsed.dwell.journeyStepMs, 2400);
  assert.equal(parsed.dwell.storyFollowMinMs, undefined);
  assert.equal(parsed.dwell.viewIntervalMs, undefined);
  // The template resolver falls back per-key when a field is absent.
  assert.match(html, /storyFollowMinMs: 1100/);
  assert.match(html, /viewIntervalMs: 3200/);
});
