import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-motion-governor-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example, animation = 'trace') {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  doc.meta = { ...doc.meta };
  if (animation) doc.meta.animation = animation;
  else delete doc.meta.animation;
  const input = path.join(tmp, `${mode}-${animation || 'static'}.json`);
  const output = path.join(tmp, `${mode}-${animation || 'static'}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync('node', [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return fs.readFileSync(output, 'utf8');
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all renderers inherit one viewer-only Live/Still Motion Governor', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="btn-motion"[^>]+hidden[^>]+aria-label="Pause motion"/, mode);
    assert.match(html, /Archify\.motionGovernor = \(function \(\)/, mode);
    assert.match(html, /var capable = !!\(svg && svg\.getAttribute\('data-animation'\) === 'trace'\)/, mode);
    assert.match(svgBlock(html), /data-animation="trace"/, mode);
    assert.doesNotMatch(svgBlock(html), /data-motion-(?:capable|owner)|motion-control/, mode);
  }
});

test('static artifacts stay truly still while trace artifacts opt into ambient motion', () => {
  const html = render('architecture', CASES.architecture, null);
  const svg = svgBlock(html);
  assert.doesNotMatch(svg, /data-animation=/);
  assert.match(html, /\.pulse-dot \{[\s\S]*?animation: none;/);
  assert.match(html, /html\[data-motion-capable="true"\] \.pulse-dot \{ animation: pulse 2s infinite; \}/);
  assert.match(html, /html\[data-motion-capable="true"\]\[data-preset="signal-flow"\]\[data-ambient-motion="running"\] \.diagram-container::before/);
  assert.match(html, /if \(!capable\) \{[\s\S]*?btn\.hidden = true;[\s\S]*?capable: false/);
  assert.match(html, /html\.setAttribute\('data-motion-capable', 'true'\);[\s\S]*?btn\.hidden = false/);
});

test('reader pause is persistent, explicit, and reduced-motion aware', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /var STORAGE_KEY = 'archify-motion'/);
  assert.match(html, /localStorage\.setItem\(STORAGE_KEY, 'still'\)/);
  assert.match(html, /localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(html, /html\.setAttribute\('data-motion', paused \? 'still' : 'live'\)/);
  assert.match(html, /btn\.setAttribute\('aria-pressed', paused \? 'false' : 'true'\)/);
  assert.match(html, /Motion paused by reduced-motion preference/);
  assert.match(html, /motionQuery\.addEventListener\('change', render\)/);
  assert.match(html, /document\.addEventListener\('visibilitychange', syncVisibility\)/);
  assert.match(html, /Archify\.guidedViews\.isPlaying\(\)[\s\S]*?Archify\.guidedViews\.pause\(\)/);
  assert.match(html, /play\.disabled = !playing && !automaticPlaybackAllowed/);
  assert.match(html, /Story playback unavailable while motion is Still/);
  assert.match(html, /\.pulse-dot \{ animation: none !important; \}/);
  assert.match(html, /html\[data-motion="still"\] \.story-trail-flow/);
});

test('strong semantic intent receives the single motion budget', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /if \(svg\.hasAttribute\('data-story-playing'\) \|\| svg\.hasAttribute\('data-story-follow'\)\) return 'story'/);
  assert.match(html, /if \(svg\.hasAttribute\('data-story-active'\)\) return 'chapter'/);
  assert.match(html, /data-route-picking'[\s\S]*?return 'route'/);
  assert.match(html, /data-lens-active'\)\) return 'lens'/);
  assert.match(html, /data-relationship-preview-active'\)\) return 'relationship'/);
  assert.match(html, /data-intent-trace-active'\)\) return 'intent'/);
  assert.match(html, /data-focus-active'\)\) return 'focus'/);
  assert.match(html, /data-legend-preview-active'\)\) return 'legend'/);
  assert.match(html, /new MutationObserver\(function \(\) \{ publishOwner\(\); \}\)/);
  assert.match(html, /html\[data-motion-owner\] svg\[data-animation="trace"\] \[data-animate\]/);
  assert.match(html, /function claim\(next, cleanup\)[\s\S]*?return ownerToken/);
  assert.match(html, /function release\(token\)[\s\S]*?token !== ownerToken/);
  assert.match(html, /function clearClaim\(preempted\)[\s\S]*?try \{ cleanup\(\); \} catch/);
  assert.match(html, /function claim\(next, cleanup\)[\s\S]*?clearClaim\(true\)/);
  assert.match(html, /animation: archify-route-probe-flow 1\.1s[\s\S]*?1 both/);
  assert.doesNotMatch(html, /archify-route-probe-flow[^;]*infinite/);
});

test('motion control is mobile-contained, embed-safe, and export-neutral', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /\.toolbar #btn-motion\[hidden\] \{ display: none !important; \}/);
  assert.match(html, /\.toolbar button \{[\s\S]*?min-height: 2\.75rem;/);
  assert.match(html, /@media \(max-width: 360px\) \{[\s\S]*?\.toolbar #btn-motion \{ min-width: 4\.4rem;/);
  assert.match(html, /#theme-label, #preset-label, #present-label \{ display: none; \}/);
  assert.match(html, /html\[data-embed="true"\] \.diagram-container::before/);
  assert.match(html, /html\[data-share-playback="true"\] \.diagram-container::before/);
  assert.match(html, /Still also parks bounded[\s\S]*?viewer signals without discarding their static meaning/);
  assert.match(html, /recordExportReceipt\('svg', blob, d\.canonicalStateClean\)/);
  assert.doesNotMatch(svgBlock(html), /btn-motion|data-motion=|data-motion-owner/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
