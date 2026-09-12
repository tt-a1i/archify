import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { translateMessage } from '../renderers/shared/i18n.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';
import { loadDrilldownRuntime } from './helpers/template-runtime.mjs';

test('locate projection applies stale distinctly and hides a zero-count chip', () => {
  const dir = stageBundleFixture({ prefix: 'archify-drilldown-locate-' });
  try {
    const html = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const drilldown = loadDrilldownRuntime(html);

    const hidden = drilldown.locateChipModel({ files_touched_inside: 0, state: 'touched' });
    assert.equal(hidden.visible, false);
    assert.equal(hidden.count, 0);
    assert.equal(hidden.text, '');
    const empty = drilldown.locateChipModel(null);
    assert.equal(empty.visible, false);
    assert.equal(empty.count, 0);
    const chip = drilldown.locateChipModel({ files_touched_inside: 3, state: 'stale' });
    assert.equal(chip.visible, true);
    assert.equal(chip.count, 3);
    assert.equal(chip.text, translateMessage('en', 'viewer.locate.filesInside', { count: 3 }));
    assert.doesNotMatch(chip.text, /[✓✔☑✅]/);
    assert.doesNotMatch(chip.text, /\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i);

    const attrs = {};
    const node = {
      getAttribute(name) { return name === 'data-node-id' ? 'payments' : null; },
      setAttribute(name, value) { attrs[name] = value; },
      removeAttribute(name) { delete attrs[name]; },
    };
    const applied = drilldown.applyProjection({ payments: 'stale', ghost: 'nope' }, [node]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].id, 'payments');
    assert.equal(applied[0].state, 'stale');
    assert.equal(attrs['data-locate-state'], 'stale');
    const counted = {
      getAttribute(name) { return name === 'data-node-id' ? 'payments' : attrs[name]; },
      setAttribute(name, value) { attrs[name] = value; },
      removeAttribute(name) { delete attrs[name]; },
    };
    drilldown.applyProjection({ payments: 'touched' }, [counted], { payments: 6 });
    assert.equal(attrs['data-locate-inside'], '6');
    drilldown.applyProjection({ payments: 'touched' }, [counted], { payments: 0 });
    assert.equal(attrs['data-locate-inside'], undefined);
  } finally {
    disposeBundleFixture(dir);
  }
});
