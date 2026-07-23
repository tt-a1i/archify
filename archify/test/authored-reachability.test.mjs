import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authored-reach-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function reachabilityFunction() {
  const start = template.indexOf('function computeReachability(');
  const end = template.indexOf('\n      function reachabilityFor(', start);
  assert.ok(start >= 0 && end > start, 'template exposes one extractable reachability function');
  return vm.runInNewContext(`(${template.slice(start, end)})`);
}

test('authored reachability is available in every typed artifact without entering canonical SVG', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="focus-reach" hidden/);
    assert.match(html, /id="btn-reach-upstream"[^>]+aria-pressed="false"/);
    assert.match(html, /id="btn-reach-downstream"[^>]+aria-pressed="false"/);
    assert.match(html, /function computeReachability\(originId, direction, relationships\)/);
    assert.match(html, /svg\.setAttribute\('data-reach-active', direction\)/);
    assert.doesNotMatch(canonicalSvg(html), /data-reach-(?:active|match|origin|depth)/, mode);
  }
});

test('reachability uses stable breadth-first depth, supports cycles, and deduplicates edge fragments', () => {
  const compute = reachabilityFunction();
  const relationships = [
    { key: 'a-b', from: 'a', to: 'b' },
    { key: 'a-c', from: 'a', to: 'c' },
    { key: 'b-d', from: 'b', to: 'd' },
    { key: 'c-d', from: 'c', to: 'd' },
    { key: 'd-b', from: 'd', to: 'b' },
    { key: 'x-a', from: 'x', to: 'a' },
    { key: 'a-b', from: 'a', to: 'b' },
  ];

  const downstream = compute('a', 'downstream', relationships);
  assert.deepEqual(Array.from(downstream.nodeIds), ['a', 'b', 'c', 'd']);
  assert.deepEqual({ ...downstream.depths }, { a: 0, b: 1, c: 1, d: 2 });
  assert.deepEqual(Array.from(downstream.edgeKeys), ['a-b', 'a-c', 'b-d', 'c-d', 'd-b']);
  assert.equal(downstream.maxDepth, 2);

  const upstream = compute('d', 'upstream', relationships);
  assert.deepEqual(Array.from(upstream.nodeIds), ['d', 'b', 'c', 'a', 'x']);
  assert.deepEqual({ ...upstream.depths }, { d: 0, b: 1, c: 1, a: 2, x: 3 });
  assert.equal(upstream.maxDepth, 3);
  assert.equal(compute('a', 'sideways', relationships), null);
});

test('reachability stays explicit, deep-linkable, keyboard reachable, and export-clean', () => {
  assert.match(template, /Authored Reachability is a bounded graph query over the relationships/);
  assert.match(template, /direction !== 'upstream' && direction !== 'downstream'/);
  assert.match(template, /encodeURIComponent\(activeIds\[0\]\) \+ '&reach=' \+ direction/);
  assert.match(template, /applyReachability\(reach, \{ updateUrl: false, toggle: false, reveal: false \}\)/);
  assert.match(template, /upstreamBtn\.addEventListener\('click'/);
  assert.match(template, /downstreamBtn\.addEventListener\('click'/);
  assert.match(template, /clone\.removeAttribute\('data-reach-active'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-reach-match\], \[data-reach-origin\], \[data-reach-depth\]'/);
  assert.match(template, /!clone\.hasAttribute\('data-reach-active'\)/);
  assert.match(template, /svg\[data-preset="blueprint"\]\[data-reach-active\]/);
  assert.match(template, /\.diagram-container svg\[data-reach-active\] \[data-node-id\]/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
