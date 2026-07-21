import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-lens-'));

const CASES = {
  architecture: { example: 'web-app.architecture.json', collection: 'connections' },
  workflow: { example: 'agent-tool-call.workflow.json', collection: 'edges' },
  sequence: { example: 'cache-miss-request.sequence.json', collection: 'messages' },
  dataflow: { example: 'product-analytics.dataflow.json', collection: 'flows' },
  lifecycle: { example: 'agent-run.lifecycle.json', collection: 'transitions' },
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

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

test('all typed renderers expose named, stable relationships without changing geometry', () => {
  for (const [mode, config] of Object.entries(CASES)) {
    const html = render(mode, config.example);
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', config.example), 'utf8'));
    const relationships = source[config.collection];
    const diagram = svg(html);
    const keys = new Set(Array.from(diagram.matchAll(/data-edge-key="(\d+)"/g), (match) => match[1]));

    assert.equal(keys.size, relationships.length, `${mode} keeps one stable key per source relationship`);
    relationships.forEach((relationship, index) => {
      assert.match(diagram, new RegExp(`data-edge-from="${escapeAttr(relationship.from)}"[^>]+data-edge-to="${escapeAttr(relationship.to)}"[^>]+data-edge-key="${index}"`), `${mode} relationship ${index}`);
      if (relationship.label) {
        assert.match(diagram, new RegExp(`data-edge-label="${escapeAttr(relationship.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${mode} named relationship ${index}`);
      }
    });
    assert.match(diagram, /data-node-id="[^"]+" data-node-label="[^"]+" tabindex="0"/, mode);
  }
});

test('relationship lens groups incoming, outgoing, and self-loop paths and follows neighbors', () => {
  const html = render('architecture', CASES.architecture.example);
  assert.match(html, /id="focus-chip" hidden role="region" aria-labelledby="relationship-lens-title"/);
  assert.match(html, /id="relationship-lens-list" aria-label="Connected relationships"/);
  assert.match(html, /function relationshipsFor\(id, byId\)/);
  assert.match(html, /direction = from === id && to === id \? 'loop' : \(from === id \? 'out' : 'in'\)/);
  assert.match(html, /\{ id: 'out', label: 'Outgoing' \}/);
  assert.match(html, /\{ id: 'in', label: 'Incoming' \}/);
  assert.match(html, /data-relationship-target/);
  assert.match(html, /data-relationship-key/);
  assert.match(html, /data-relationship-from/);
  assert.match(html, /data-relationship-to/);
  assert.match(html, /set\(id, \{ toggle: false \}\)/);
  assert.match(html, /Archify\.view\.reveal\(\[id\], \{ includeNeighbors: true, reason: 'relationship' \}\)/);
  assert.doesNotMatch(svg(html), /relationship-lens|Connected relationships/);
});

test('relationship preview precisely links pointer and keyboard rows to an edge and its endpoints', () => {
  const html = render('sequence', CASES.sequence.example);
  const diagram = svg(html);
  assert.match(html, /function previewRelationship\(button, options\)/);
  assert.match(html, /edge\.getAttribute\('data-edge-key'\) === key/);
  assert.match(html, /data-relationship-preview-source/);
  assert.match(html, /data-relationship-preview-target/);
  assert.match(html, /addEventListener\('pointerover'/);
  assert.match(html, /addEventListener\('pointerout'/);
  assert.match(html, /addEventListener\('focusin'/);
  assert.match(html, /addEventListener\('focusout'/);
  assert.match(html, /pinnedRelationship \|\| focusedRelationship \|\| hoveredRelationship/);
  assert.doesNotMatch(diagram, /data-relationship-preview(?:-active|-node|-source|-target)?=/);
});

test('relationship preview is export-clean and visually geometry-neutral', () => {
  const html = render('dataflow', CASES.dataflow.example);
  assert.match(html, /clone\.removeAttribute\('data-relationship-preview-active'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-relationship-preview\], \[data-relationship-preview-node\], \[data-relationship-preview-source\], \[data-relationship-preview-target\]'\)/);
  assert.match(html, /!clone\.hasAttribute\('data-relationship-preview-active'\)/);
  assert.match(html, /Relationship Preview is temporary exploration state layered on top of/);
  assert.doesNotMatch(html, /data-relationship-preview[^\n{]*\{[^}]*\b(?:x|y|transform)\s*:/);
});

test('relationship lens is keyboard navigable, mobile-pinned, and excluded from embed and print', () => {
  const html = render('workflow', CASES.workflow.example);
  assert.match(html, /event\.key !== 'ArrowDown'/);
  assert.match(html, /event\.key !== 'ArrowUp'/);
  assert.match(html, /event\.key !== 'Home'/);
  assert.match(html, /event\.key !== 'End'/);
  assert.match(html, /buttons\[index\]\.focus\(\)/);
  assert.match(html, /data-wide-diagram="true"\] \.focus-chip/);
  assert.match(html, /\.focus-chip\[data-relationship-previewing="true"\] \.relationship-lens-list/);
  assert.match(html, /\.relationship-lens-row:not\(\[data-preview-active="true"\]\)/);
  assert.match(html, /var mobile = window\.innerWidth <= 720/);
  assert.match(html, /previewingOnMobile = mobile && chip\.getAttribute\('data-relationship-previewing'\) === 'true'/);
  assert.match(html, /nodeCenter < \(visibleTop \+ visibleBottom\) \/ 2 \? pinnedBottom : pinnedTop/);
  assert.match(html, /html\[data-embed="true"\] \.focus-chip/);
  assert.match(html, /\.toolbar, \.diagram-nav, \.focus-chip, \.guided-views/);
  assert.match(html, /chip\.hidden = options\.hideChip === true \|\| normalized\.length !== 1 \|\| selectionMode/);
  assert.match(html, /event\.target\.closest\('\.diagram-nav, \.focus-chip, \.node-finder, \.diagram-guide, \.overview-map, \.route-probe, \.semantic-lens'\)/);
  assert.match(html, /function placeRelationshipLens\(\)/);
  assert.match(html, /visibleTop = Math\.max\(padding, -containerRect\.top \+ padding\)/);
  assert.match(html, /window\.addEventListener\('scroll', requestLensPlacement, \{ passive: true \}\)/);
  assert.match(html, /container\.addEventListener\('scroll', requestLensPlacement, \{ passive: true \}\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
