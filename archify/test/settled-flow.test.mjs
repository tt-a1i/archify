import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { animateAttr } from '../renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-settled-flow-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  doc.meta = { ...doc.meta, animation: 'trace' };
  const input = path.join(tmp, `${mode}.json`);
  const output = path.join(tmp, `${mode}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync('node', [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return fs.readFileSync(output, 'utf8');
}

test('all five renderers inherit one finite running-to-settled ambient contract', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /data-ambient-motion/, mode);
    assert.match(html, /function startAmbient\(\)/, mode);
    assert.match(html, /function settleAmbient\(reason\)/, mode);
    assert.match(html, /animation: archify-edge-flow [^;]+ 1;/, mode);
    assert.match(html, /animation: archify-node-pulse [^;]+ 1;/, mode);
    assert.doesNotMatch(html, /animation: archify-edge-flow [^;]+ infinite/, mode);
    assert.doesNotMatch(html, /animation: archify-node-pulse [^;]+ infinite/, mode);
  }
});

test('settled flow restores authored security and async dash semantics', () => {
  assert.match(template, /\.a-security\s*\{[^}]*stroke-dasharray:\s*5,5/);
  assert.match(template, /\.a-dashed\s*\{[^}]*stroke-dasharray:\s*4,4/);
  assert.match(template, /@keyframes archify-edge-flow\s*\{[\s\S]*?stroke-dasharray:\s*10 8/);
  assert.match(template, /100%\s*\{\s*stroke-dashoffset:\s*0;\s*opacity:\s*1;\s*\}/);
  const runningRule = template.match(/html\[data-ambient-motion="running"\][^{]+\[data-animate="edge"\][^{]*\{([^}]*)\}/)?.[1] || '';
  assert.ok(runningRule, 'running edge rule missing');
  assert.doesNotMatch(runningRule, /stroke-dasharray|stroke-dashoffset/);
});

test('ambient ownership is generation-bounded and cannot replay after settle', () => {
  assert.match(template, /var ambientStarted = false/);
  assert.match(template, /var ambientPending = new Set\(\)/);
  assert.match(template, /if \(ambientStarted \|\| !capable\) return false/);
  assert.match(template, /ambientStarted = true;[\s\S]*?html\.setAttribute\('data-ambient-motion', 'running'\)/);
  assert.match(template, /ambientPending\.delete\(event\.target\)/);
  assert.match(template, /if \(!ambientPending\.size\) settleAmbient\('complete'\)/);
  assert.match(template, /svg\.addEventListener\('animationend', onAmbientBoundary, true\)/);
  assert.match(template, /svg\.addEventListener\('animationcancel', onAmbientBoundary, true\)/);
  assert.match(template, /if \(paused \|\| owner \|\| html\.hasAttribute\('data-embed'\)/);
  assert.doesNotMatch(template, /setInterval\([^)]*ambient|addEventListener\('scroll'[^)]*ambient/);
});

test('animation delay is capped without changing normal authored order', () => {
  assert.equal(animateAttr({ animation: 'trace' }, 'edge', 0), ' data-animate="edge" style="--step:0"');
  assert.equal(animateAttr({ animation: 'trace' }, 'node', 8), ' data-animate="node" style="--step:8"');
  assert.equal(animateAttr({ animation: 'trace' }, 'edge', 99), ' data-animate="edge" style="--step:12"');
  assert.equal(animateAttr({}, 'edge', 99), '');
});

test('only the WebM canvas scene opts into a repeatable finite motion timeline', () => {
  assert.match(template, /var motionScene = createMotionScene\(svg\)/);
  assert.match(template, /drawMotionFrame\(ctx, backgroundImage, motionScene, elapsed\)/);
  assert.match(template, /var data = serializeSvg\(scale\);/);
  assert.match(template, /getPointAtLength/);
  assert.doesNotMatch(template, /serializeSvg\(1, \{ autoTheme: true, motion: true \}\)/);
});

test('Still, reduced motion, embed, share, hidden state, and stronger intent settle ambient flow', () => {
  assert.match(template, /reducedMotion\(\)/);
  assert.match(template, /html\.hasAttribute\('data-embed'\)/);
  assert.match(template, /html\.hasAttribute\('data-share-playback'\)/);
  assert.match(template, /html\.hasAttribute\('data-document-hidden'\)/);
  assert.match(template, /paused \|\| owner/);
  assert.match(template, /settleAmbient\('suppressed'\)/);
  assert.match(template, /html\[data-motion="still"\] svg\[data-animation="trace"\] \[data-animate\]/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
