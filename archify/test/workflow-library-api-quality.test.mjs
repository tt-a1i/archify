import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWorkflow } from '../renderers/workflow/workflow-api.mjs';

function workflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Quality isolation',
      output: 'quality.html',
      locale: 'en',
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'Input' },
      { id: 'b', lane: 'main', col: 3, type: 'backend', label: 'Output' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'request' }],
  };
}

function restoreQualityProfileEnv(t) {
  const previous = process.env.ARCHIFY_QUALITY_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.ARCHIFY_QUALITY_PROFILE;
    else process.env.ARCHIFY_QUALITY_PROFILE = previous;
  });
}

test('renderWorkflow stays advisory regardless of an ambient ARCHIFY_QUALITY_PROFILE the caller never asked for', async (t) => {
  restoreQualityProfileEnv(t);
  const document = workflow();

  delete process.env.ARCHIFY_QUALITY_PROFILE;
  const baseline = await renderWorkflow({ workflow: document });
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  assert.match(baseline.svg, /data-quality-gates="advisory"/);
  assert.match(baseline.svg, /data-quality-profile="standard"/);
  assert.equal(baseline.meta.quality_profile, undefined);

  // A host process that happens to run with this env var set for unrelated
  // reasons (e.g. it also shells out to archify's own CLI elsewhere) must
  // not have that leak into a library call that asked for nothing explicit.
  process.env.ARCHIFY_QUALITY_PROFILE = 'showcase';
  const withAmbientEnv = await renderWorkflow({ workflow: document });
  assert.equal(withAmbientEnv.ok, true, JSON.stringify(withAmbientEnv.diagnostics));
  assert.equal(withAmbientEnv.svg, baseline.svg);
  assert.match(withAmbientEnv.svg, /data-quality-gates="advisory"/);
  assert.doesNotMatch(withAmbientEnv.svg, /data-quality-profile="showcase"/);
  assert.equal(withAmbientEnv.meta.quality_profile, undefined);
});

test('renderWorkflow still honors an explicit qualityProfile argument under the same ambient env', async (t) => {
  restoreQualityProfileEnv(t);
  process.env.ARCHIFY_QUALITY_PROFILE = 'standard';
  const document = workflow();

  const result = await renderWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.match(result.svg, /data-quality-profile="showcase"/);
  assert.doesNotMatch(result.svg, /data-quality-gates="advisory"/);
  // meta must agree with what was actually rendered into the SVG, not the
  // caller's authored (pre-override) value.
  assert.equal(result.meta.quality_profile, 'showcase');
  assert.equal(document.meta.quality_profile, undefined, 'caller input must stay untouched');
});
