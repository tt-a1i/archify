import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drilldown-mark-'));
const cli = path.join(skillRoot, 'bin/archify.mjs');
const head = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');

function render(input, output) {
  return spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function svgOf(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('diagrams without drilldown emit no mark, child attr, or extra tab stop', () => {
  const output = path.join(tmp, 'plain.html');
  const result = render(head, output);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const svg = svgOf(html);
  assert.doesNotMatch(svg, /data-drilldown-child=/);
  assert.doesNotMatch(svg, /archify-drilldown-mark/);
  assert.equal((svg.match(/tabindex="0"/g) || []).length, (svg.match(/data-node-id="/g) || []).length);
});

test('drilldown mark lives in the SVG, has no tab stop, and is kept by canonical export stripping', () => {
  const spec = JSON.parse(fs.readFileSync(head, 'utf8'));
  spec.components.find((component) => component.id === 'payments').drilldown = 'payments';
  const input = path.join(tmp, 'with-drilldown.json');
  const output = path.join(tmp, 'with-drilldown.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const result = render(input, output);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const svg = svgOf(html);
  assert.match(svg, /data-drilldown-child="payments"/);
  assert.match(svg, /class="archify-drilldown-mark"/);
  assert.match(svg, /<g class="archify-drilldown-mark" aria-hidden="true">/);
  assert.doesNotMatch(svg, /class="archify-drilldown-mark"[^>]*tabindex=/);
  assert.match(html, /clone\.removeAttribute\('data-locate-active'\)/);
  assert.doesNotMatch(html, /archify-drilldown-mark[\s\S]{0,80}el\.remove\(\)/);
  const nodes = (svg.match(/data-node-id="/g) || []).length;
  const tabs = (svg.match(/tabindex="0"/g) || []).length;
  assert.equal(tabs, nodes);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
