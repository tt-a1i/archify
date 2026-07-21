import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-radar-'));

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

test('all typed renderers inherit one viewer-only Semantic Radar', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="overview-map" hidden role="region" aria-labelledby="overview-map-title"/, mode);
    assert.match(html, /id="overview-map-surface" tabindex="0" role="group"/, mode);
    assert.match(html, /id="btn-overview-map"[^>]+aria-label="Open semantic radar"[^>]+aria-expanded="false"[^>]+aria-controls="overview-map"/, mode);
    assert.match(html, /Archify\.radar = \(function \(\)/, mode);
    assert.match(html, /document\.createElementNS\(namespace, 'svg'\)/, mode);
    assert.match(html, /mapSvg\.setAttribute\('aria-label', 'Semantic diagram radar nodes'\)/, mode);
    assert.match(html, /diagram\.querySelectorAll\('\[data-node-id\]'\)/, mode);
    assert.equal((html.match(/<svg\b/g) || []).length, 1, `${mode} keeps one static canonical SVG`);
    assert.doesNotMatch(canonicalSvg(html), /overview-map|Semantic radar|data-radar-node-id/, mode);
  }
});

test('Semantic Radar derives semantic node bounds and focuses stable IDs', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /box = node\.getBBox\(\)/);
  assert.match(html, /rect\.setAttribute\('data-radar-node-id', id\)/);
  assert.match(html, /rect\.setAttribute\('data-kind', node\.getAttribute\('data-node-kind'\) \|\| 'neutral'\)/);
  assert.match(html, /rect\.setAttribute\('aria-label', 'Focus ' \+ nodeLabel\(node, id\) \+ ' from Semantic Radar'\)/);
  assert.match(html, /Archify\.focus\.set\(id, \{ toggle: false \}\)/);
  assert.match(html, /Archify\.view\.reveal\(\[id\], \{ includeNeighbors: true, reason: 'radar' \}\)/);
  assert.match(html, /function bringNodeIntoWindow\(node\)/);
  assert.match(html, /window\.scrollY \+ rect\.top \+ rect\.height \/ 2 - window\.innerHeight \/ 2/);
  assert.match(html, /data-radar-active/);
});

test('Semantic Radar tracks desktop camera and mobile contained scroll', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /function logicalViewport\(\)/);
  assert.match(html, /x = viewBox\.x \+ container\.scrollLeft \/ metrics\.scale/);
  assert.match(html, /x = viewBox\.x \+ \(\(-state\.x \/ state\.scale\) - metrics\.offsetX\) \/ metrics\.scale/);
  assert.match(html, /viewport\.setAttribute\('width', String\(visible\.width\)\)/);
  assert.match(html, /mobileWide \? Math\.round\(visible\.width \/ viewBox\.width \* 100\) \+ '% width'/);
  assert.match(html, /function centerAt\(logicalX, logicalY, options\)/);
  assert.match(html, /minimumScale: 1\.5, instant: true/);
  assert.match(html, /container\.scrollTo\(\{ left: mobileTarget, behavior: options\.instant \? 'auto' : 'smooth' \}\)/);
  assert.match(html, /data-wide-diagram="true"\] \.overview-map/);
  assert.match(html, /function updateDocking\(\)/);
  assert.match(html, /chip\.style\.top = Math\.round\(top\) \+ 'px';[\s\S]+Archify\.radar\.sync\(\)/);
  assert.match(html, /activeRect\.left \+ activeRect\.width \/ 2 > window\.innerWidth \/ 2/);
  assert.match(html, /var blockers = \[activeRect, lensRect\]\.filter/);
  assert.match(html, /candidates\.push\(rect\.top - 10 - panel\.offsetHeight, rect\.bottom \+ 10\)/);
  assert.match(html, /return candidate \+ panel\.offsetHeight <= rect\.top - 10 \|\| candidate >= rect\.bottom \+ 10/);
  assert.match(html, /--archify-radar-top/);
  assert.match(html, /\.overview-map\[data-docked="true"\]/);
});

test('Semantic Radar keeps redundant accessible navigation and clean exports', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /Semantic radar \(M\)/);
  assert.match(html, /e\.key === 'm' \|\| e\.key === 'M'/);
  assert.match(html, /e\.key === 'Escape' && Archify\.radar\.isOpen\(\)/);
  assert.match(html, /event\.key === 'ArrowLeft'[\s\S]+event\.key === 'ArrowRight'[\s\S]+event\.key === 'ArrowUp'[\s\S]+event\.key === 'ArrowDown'/);
  assert.match(html, /node && \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
  assert.match(html, /\.overview-map-viewport \{[\s\S]*?pointer-events: none;/);
  assert.match(html, /html\[data-embed="true"\] \.overview-map/);
  assert.match(html, /class="overview-map no-print"/);
  assert.match(html, /The radar is built at runtime so the checked artifact still contains[\s\S]+one canonical SVG block/);
  assert.doesNotMatch(canonicalSvg(html), /overview-map-node|overview-map-viewport/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
