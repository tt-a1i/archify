import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildOverlay } from '../overlay/inject.mjs';
import { renderDriftOverlay } from '../overlay/drift.mjs';
import { clientAsset } from '../overlay/client-assets.mjs';

const dir = new URL('../overlay/client/', import.meta.url);
const names = fs.readdirSync(dir).sort();

test('client assets: analysis and drift pages inline their respective browser code', () => {
  const drift = ['drift.css', 'drift.js'];
  const analysis = ['atlas.css', 'atlas.js', 'atlas3d.css', 'atlas3d.js', 'entry.css', 'overlay.css', 'overlay.js', 'verification.js'];
  assert.deepEqual(names, [...analysis, ...drift].sort());
  const { html } = buildOverlay({ graph: { modules: [], edges: [], repository: { language: 'ts' }, excluded: {}, unresolved: {} } });
  const driftHtml = renderDriftOverlay(
    '<html><body><div class="toolbar"></div><svg data-node-id="fixture"></svg></body></html>',
    { edges: [] },
    'a'.repeat(64),
  );
  for (const name of names) assert.equal(clientAsset(name), '\n' + fs.readFileSync(new URL(name, dir), 'utf8'));
  assert.ok(html.includes(clientAsset('verification.js')), 'the offline report carries its receipt client');
  for (const name of drift) {
    assert.ok(driftHtml.includes(clientAsset(name)), name);
    assert.ok(!html.includes(clientAsset(name)), 'ordinary analysis has no drift assets: ' + name);
  }
  for (const name of analysis) assert.ok(!driftHtml.includes(clientAsset(name)), name);
});

test('client assets: scripts are valid classic scripts', () => {
  for (const name of names.filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: name }), name);
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, `${name} is inlined in a classic <script>`);
  }
});

test('client assets: nothing can close the tag they are inlined in', () => {
  for (const name of names) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(source, /<\/(script|style)/i, name);
    assert.doesNotMatch(source, /\r/, `${name} must use LF line endings so the page bytes match on every platform`);
  }
});

test('client assets: the embedded three.js cannot close or escape its inert script element', () => {
  const three = fs.readFileSync(new URL('../overlay/vendor/three.min.js', import.meta.url), 'utf8');
  assert.doesNotMatch(three, /<\/script|<!--|<script/i);
  assert.match(fs.readFileSync(new URL('../overlay/vendor/THREE-LICENSE.txt', import.meta.url), 'utf8'), /The MIT License/);
});
