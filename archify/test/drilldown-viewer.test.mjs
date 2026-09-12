import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';
import { loadDrilldownRuntime } from './helpers/template-runtime.mjs';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

test('viewer handshake, child file, and breadcrumb helpers reject unsafe values', () => {
  const dir = stageBundleFixture({ prefix: 'archify-drilldown-viewer-' });
  try {
    const html = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    assert.match(html, /id="archify-drilldown-host"/);
    assert.match(html, /id="archify-drilldown-crumb"/);
    assert.match(html, /id="archify-drilldown-frame"/);
    assert.match(html, /id="btn-drilldown-descend"/);
    assert.doesNotMatch(html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '', /archify-drilldown-host/);

    const drilldown = loadDrilldownRuntime(html);
    assert.equal(drilldown.isSafeChildFile('payments.html'), true);
    assert.equal(drilldown.isSafeChildFile('../evil.html'), false);
    assert.equal(drilldown.isSafeChildFile('payments.html.bak'), false);
    assert.equal(drilldown.resolveChildFile({
      diagrams: [{ id: 'payments', file: 'payments.html' }],
    }, 'payments'), 'payments.html');
    assert.equal(drilldown.resolveChildFile({
      diagrams: [{ id: 'payments', file: '../payments.html' }],
    }, 'payments'), null);
    assert.match(html, /showStale\(!child \? 'missing-child' : 'missing-row'/);
    assert.equal(drilldown.crumbCurrentText('Typed Renderers', 'Typed Renderers'), 'Typed Renderers');
    assert.equal(drilldown.crumbCurrentText('Shared Renderer Runtime', 'Render Pipeline'), 'Shared Renderer Runtime · Render Pipeline');
    assert.match(html, /html\[data-bundle-nested="true"\] \.toolbar/);
    assert.match(html, /html\[data-bundle-nested="true"\] \.diagram-nav/);
    assert.match(html, /data-locate-inside-count/);

    const expected = { id: 'payments', specSha256: SHA };
    const ok = drilldown.validateHandshake({
      type: 'archify:bundle-ack',
      id: 'payments',
      specSha256: SHA,
    }, expected);
    assert.equal(ok.ok, true);
    assert.equal(drilldown.validateHandshake({
      type: 'archify:bundle-ack',
      id: 'payments',
      specSha256: OTHER,
    }, expected).reason, 'mismatch');
    assert.equal(drilldown.validateHandshake({
      type: 'archify:bundle-ack',
      id: 'payments',
      specSha256: 'not-a-hash',
    }, expected).reason, 'sha256');
    assert.equal(drilldown.validateHandshake({
      type: 1,
      id: 'payments',
      specSha256: SHA,
    }, expected).reason, 'type');
  } finally {
    disposeBundleFixture(dir);
  }
});
