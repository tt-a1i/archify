import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finder-'));

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

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers ship the same geometry-neutral node finder', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="btn-node-finder"[^>]+aria-label="Find a node"[^>]+aria-haspopup="dialog"/, mode);
    assert.match(html, /id="node-finder" hidden role="dialog" aria-modal="false"/, mode);
    assert.match(html, /id="node-finder-input" type="search"/, mode);
    assert.match(html, /Archify\.finder = \(function \(\)/, mode);
    assert.match(html, /svg\.querySelectorAll\('\[data-node-id\]'\)/, mode);
    assert.doesNotMatch(svg(html), /node-finder|Archify\.finder|Find a node/, mode);
  }
});

test('finder searches semantic ids and labels, then delegates to focus and reveal', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /search: \(id \+ ' ' \+ label \+ ' ' \+ type \+ ' ' \+ sublabel \+ ' ' \+ context \+ ' ' \+ tag \+ ' ' \+ text\)\.toLowerCase\(\)/);
  assert.match(html, /item\.search\.indexOf\(query\) !== -1/);
  assert.match(html, /Archify\.guidedViews\.showAll\(\{ clearFocus: false, updateUrl: false \}\)/);
  assert.match(html, /Archify\.view\.reset\(\{ automatic: true \}\)/);
  assert.match(html, /Archify\.focus\.set\(id, \{ toggle: false \}\)/);
  assert.match(html, /Archify\.view\.reveal\(\[id\], \{ includeNeighbors: true, reason: 'finder' \}\)/);
  assert.match(html, /item\.node\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /var key = from \+ '\\u0000' \+ to/);
});

test('finder becomes a contextual Route Probe endpoint picker without changing semantic focus', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /function resolveContext\(options\)/);
  assert.match(html, /Archify\.routeProbe\.finderContext\(\)/);
  assert.match(html, /context\.allowedIds\.indexOf\(item\.id\) !== -1/);
  assert.match(html, /context\.kind === 'route-source' \|\| context\.kind === 'route-target'/);
  assert.match(html, /Archify\.routeProbe\.choose\(id\)/);
  assert.match(html, /reason: 'route-pick'/);
  assert.match(html, /data-context="route-source"/);
  assert.match(html, /data-context="route-target"/);
  assert.match(html, /Choose ' \+ item\.label \+ ' as route destination, ' \+ badge/);
  assert.match(html, /available\.length \+ ' ' \+ context\.availableNoun/);
});

test('finder is keyboard accessible, mobile-pinned, and subordinate to embed mode', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /e\.key === '\/'/);
  assert.match(html, /Archify\.finder\.open\(\)/);
  assert.match(html, /event\.key === 'ArrowDown'/);
  assert.match(html, /event\.key === 'ArrowUp'/);
  assert.match(html, /event\.key === 'Escape'/);
  assert.match(html, /event\.stopPropagation\(\)/);
  assert.match(html, /Archify\.exportMenu\.isOpen\(\)\) Archify\.exportMenu\.close\(false\)/);
  assert.match(html, /data-wide-diagram="true"\] \.node-finder/);
  assert.match(html, /html\[data-embed="true"\] \.node-finder/);
  assert.match(html, /html\.getAttribute\('data-embed'\) === 'true'/);
  assert.match(html, /data-node-finder-trigger/);
  assert.match(html, /!event\.target\.closest\('\[data-node-finder-trigger\]'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
