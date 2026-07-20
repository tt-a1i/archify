import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-permalink-'));

const CASES = {
  architecture: { example: 'web-app.architecture.json', collection: 'connections' },
  workflow: { example: 'agent-tool-call.workflow.json', collection: 'edges' },
  sequence: { example: 'cache-miss-request.sequence.json', collection: 'messages' },
  dataflow: { example: 'product-analytics.dataflow.json', collection: 'flows' },
  lifecycle: { example: 'agent-run.lifecycle.json', collection: 'transitions' },
};

function fixture(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode].example), 'utf8'));
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

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers preserve optional authored relationship ids beside runtime keys', () => {
  for (const mode of Object.keys(CASES)) {
    const doc = fixture(mode);
    doc[CASES[mode].collection][0].id = 'shareable-relation';
    const { result, html } = run(mode, doc, 'stable-id');
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    assert.match(html, /data-edge-key="0" data-edge-id="shareable-relation"/, mode);
    assert.match(canonicalSvg(html), /data-edge-id="shareable-relation"/, mode);
  }
});

test('authored relationship identity survives source-order changes while runtime keys remain private', () => {
  const original = fixture('workflow');
  const reordered = fixture('workflow');
  const moved = reordered.edges.shift();
  reordered.edges.splice(1, 0, moved);

  const first = run('workflow', original, 'original-order');
  const second = run('workflow', reordered, 'reordered');
  assert.equal(first.result.status, 0, first.result.stderr);
  assert.equal(second.result.status, 0, second.result.stderr);
  assert.match(first.html, /data-edge-key="0" data-edge-id="request-chat"/);
  assert.match(second.html, /data-edge-key="1" data-edge-id="request-chat"/);
  assert.match(first.html, /'#relation=' \+ encodeURIComponent\(record\.id\)/);
  assert.match(second.html, /'#relation=' \+ encodeURIComponent\(record\.id\)/);
});

test('relationship ids stay optional and duplicate ids fail closed in the shared zero-install path', () => {
  for (const mode of Object.keys(CASES)) {
    const idless = fixture(mode);
    delete idless[CASES[mode].collection][0].id;
    const plain = run(mode, idless, 'idless');
    assert.equal(plain.result.status, 0, `${mode}: ${plain.result.stderr}`);
    const keyZeroTags = Array.from(plain.html.matchAll(/<(?:path|g)\b[^>]*data-edge-key="0"[^>]*>/g), (match) => match[0]);
    assert.ok(keyZeroTags.length > 0, `${mode} emits runtime key zero`);
    assert.ok(keyZeroTags.every((tag) => !tag.includes('data-edge-id=')), `${mode} does not invent a durable id`);

    const duplicate = fixture(mode);
    duplicate[CASES[mode].collection][1].id = duplicate[CASES[mode].collection][0].id;
    const rejected = run(mode, duplicate, 'duplicate');
    assert.notEqual(rejected.result.status, 0, mode);
    assert.match(rejected.result.stderr, /Relationship identity validation failed/);
    assert.match(rejected.result.stderr, /duplicates relationship id/);
  }
});

test('relationship id syntax is schema-checked before viewer output is written', () => {
  const doc = fixture('workflow');
  doc.edges[0].id = 'not a stable id';
  const { result, html } = run('workflow', doc, 'invalid-id');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\/edges\/0\/id/);
  assert.match(result.stderr, /must match pattern/);
  assert.equal(html, '');
});

test('the viewer restores and copies stable relation links without exposing numeric keys', () => {
  const { result, html } = run('workflow', fixture('workflow'), 'viewer');
  assert.equal(result.status, 0, result.stderr);
  assert.match(html, /var edgeId = edge\.getAttribute\('data-edge-id'\) \|\| ''/);
  assert.match(html, /target\.setAttribute\('data-relationship-id', record\.id\)/);
  assert.match(html, /button\.setAttribute\('data-relationship-id', relationship\.id\)/);
  assert.match(html, /copyBtn\.textContent = 'Copy relation'/);
  assert.match(html, /'#relation=' \+ encodeURIComponent\(record\.id\)/);
  assert.match(html, /var relation = params\.get\('relation'\)/);
  assert.match(html, /inspectRelationshipById\(relation, \{ updateUrl: false, toggle: false \}\)/);
  assert.match(html, /if \(html\.getAttribute\('data-embed'\) === 'true'\) return false/);
  assert.match(html, /if \(html\.getAttribute\('data-embed'\) === 'true' \|\|\s*!inspectRelationshipById/);
  assert.match(html, /params\.get\('focus'\) \|\| params\.get\('relation'\)/);
  assert.match(html, /if \(!reveal\(\)\) requestAnimationFrame\(reveal\)/);
  assert.match(html, /inspectRelationshipById: inspectRelationshipById/);
  assert.match(html, /id: record\.id \|\| null, key: record\.key/);
  assert.doesNotMatch(html, /'#relation=' \+ encodeURIComponent\(record\.key\)/);
});

test('runtime overlays drop durable edge ids while canonical SVG keeps authored identity', () => {
  const { result, html } = run('architecture', fixture('architecture'), 'export-boundary');
  assert.equal(result.status, 0, result.stderr);
  assert.match(canonicalSvg(html), /data-edge-id="users-to-cdn"/);
  assert.doesNotMatch(canonicalSvg(html), /data-relationship-hit-overlay|data-relationship-id=/);
  assert.ok((html.match(/clone\.removeAttribute\('data-edge-id'\)/g) || []).length >= 6);
  assert.match(html, /querySelectorAll\('\[data-relationship-hit-overlay\]'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
