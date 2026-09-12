import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { translateMessage } from '../renderers/shared/i18n.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';
import {
  collectedText,
  createDocumentStub,
  loadDrilldownRuntime,
} from './helpers/template-runtime.mjs';

const SHA = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const OTHER = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

test('mismatched handshake builds a stale card without interpolating markup', () => {
  const dir = stageBundleFixture({ prefix: 'archify-drilldown-stale-' });
  try {
    const html = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const drilldown = loadDrilldownRuntime(html);
    const check = drilldown.validateHandshake({
      type: 'archify:bundle-ack',
      id: 'payments',
      specSha256: OTHER,
    }, { id: 'payments', specSha256: SHA });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'mismatch');

    const payload = '<img src=x onerror=alert(1)>';
    const model = drilldown.buildStaleCardModel(
      { id: payload, spec: SHA },
      { id: 'payments', spec: OTHER },
      check.reason,
    );
    assert.equal(model.reason, 'mismatch');
    assert.equal(model.expectedId, payload);
    assert.equal(model.expectedSha, SHA.slice(0, 12));
    assert.equal(model.actualSha, OTHER.slice(0, 12));
    assert.equal(model.title, translateMessage('en', 'viewer.drilldown.stale.title'));
    assert.equal(model.repair, translateMessage('en', 'viewer.drilldown.repair'));
    assert.equal(model.expectedIdLabel, translateMessage('en', 'viewer.drilldown.expectedId'));
    assert.equal(model.actualIdLabel, translateMessage('en', 'viewer.drilldown.actualId'));
    assert.equal(model.expectedShaLabel, translateMessage('en', 'viewer.drilldown.expectedSha'));
    assert.equal(model.actualShaLabel, translateMessage('en', 'viewer.drilldown.actualSha'));

    const doc = createDocumentStub();
    const card = doc.createElement('div');
    drilldown.fillStaleCard(card, model, doc);
    assert.equal(card.innerHTML, '');
    assert.equal(collectedText(card), [
      model.title,
      model.expectedIdLabel + ' ',
      payload,
      ' · ' + model.actualIdLabel + ' ',
      'payments',
      model.expectedShaLabel + ' ',
      SHA.slice(0, 12),
      ' · ' + model.actualShaLabel + ' ',
      OTHER.slice(0, 12),
      model.repair,
    ].join(''));
    assert.equal(card.childNodes.some((node) => node.innerHTML && /<img/i.test(node.innerHTML)), false);
    assert.doesNotMatch(collectedText(card), /SAFE|LOW RISK|NO IMPACT|✓|✔|☑/);
  } finally {
    disposeBundleFixture(dir);
  }
});
