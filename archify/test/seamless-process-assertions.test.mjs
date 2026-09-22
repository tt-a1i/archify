import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessFrames, assertCommittedGeometry, assertStableChrome } from './helpers/seamless-process-assertions.mjs';

const box = { x: 320, y: 100, width: 1000, height: 600 };
function sample(at = 1) {
  return {
    at, documentTimeOrigin: 1000, href: 'file:///atlas.html?theme=light#diagram=system',
    entryId: 'system-visit', current: 'system', theme: 'light', applicationPresent: true, everCommitted: true,
    mode: 'rail', viewport: { width: 1440, height: 900 }, intent: { mode: 'explicit', at: 0 },
    errors: [], samplingErrors: [], error: false,
    shell: Object.fromEntries(['brand', 'directory', 'search', 'toolbar'].map(name => [name, { present: true, same: true, bounds: box }])),
    frames: [{ id: 1, diagram: 'system', entryId: 'system-visit', state: 'active', active: true, visible: true,
      ready: true, theme: 'light', graphVisible: true, graph: { ...box }, bounds: { ...box },
      camera: { centerX: 500, centerY: 300, scale: 1, scrollLeft: 0, scrollTop: 0 } }],
  };
}
const sequence = () => [sample(1), sample(2), sample(3)];

test('an explicit navigation cannot borrow the native-history permission exception', () => {
  const frames = sequence();
  frames[1].frames[0].active = false;
  frames[1].entryId = 'wrongly-pushed-before-commit';
  assert.throws(() => assertProcessFrames(frames), /Explicit prepare revoked/);
  frames[1].intent.mode = 'history';
  frames[1].frames[0].inert = true; frames[1].frames[0].ariaHidden = 'true';
  assert.doesNotThrow(() => assertProcessFrames(frames));
  frames[1].frames[0].active = true;
  assert.throws(() => assertProcessFrames(frames), /Native history must revoke/);
});

test('revoked history previews may lose bridge readiness but newly active targets may not', () => {
  const frames = sequence();
  Object.assign(frames[1], { entryId: 'departed-to-another-visit', intent: { mode: 'history', at: 1 } });
  Object.assign(frames[1].frames[0], { active: false, ready: false, inert: true, ariaHidden: 'true' });
  assert.doesNotThrow(() => assertProcessFrames(frames));
  frames[1].frames[0].inert = false;
  assert.throws(() => assertProcessFrames(frames), /departed preview must remain inert/);
  Object.assign(frames[1], { entryId: 'system-visit', intent: { mode: 'explicit', at: 1 } });
  Object.assign(frames[1].frames[0], { active: true, inert: false, ariaHidden: null });
  assert.throws(() => assertProcessFrames(frames), /active visible target must be ready/);
});

test('error UI allows an absent graph only after a native history departure', () => {
  const frames = sequence();
  frames[1].frames = []; frames[1].error = true;
  assert.throws(() => assertProcessFrames(frames), /Expected one visible graph/);
  frames[1].intent.mode = 'history';
  assert.doesNotThrow(() => assertProcessFrames(frames));
});

test('a visible iframe containing a hidden or zero-sized graph cannot pass', () => {
  const frames = sequence();
  frames[1].frames[0].graphVisible = false;
  assert.throws(() => assertProcessFrames(frames), /no visible graph/);
  frames[1].frames[0].graphVisible = true;
  frames[1].frames[0].graph.height = 0;
  assert.throws(() => assertProcessFrames(frames), /no visible graph/);
});

test('cold verification checks the first application frame and distinguishes expected initialization errors', () => {
  const frames = sequence();
  frames[0].frames = []; frames[0].everCommitted = false; frames[0].theme = 'dark';
  assert.throws(() => assertProcessFrames(frames, { cold: true, expectedTheme: 'light', expectedDiagram: 'system' }), /Wrong cold-start theme/);
  frames[0].theme = 'light';
  frames[1].errors = ['Injected initialization failure: payment'];
  assert.throws(() => assertProcessFrames(frames, { cold: true, expectedTheme: 'light', expectedDiagram: 'system' }), /Unexpected runtime error/);
  assert.doesNotThrow(() => assertProcessFrames(frames, { cold: true, expectedTheme: 'light', expectedDiagram: 'system', allowedErrors: ['Injected initialization failure: payment'] }));
  frames[1].errors = ['Injected initialization failure: worker'];
  assert.throws(() => assertProcessFrames(frames, { cold: true, expectedTheme: 'light', expectedDiagram: 'system', allowedErrors: ['Injected initialization failure: payment'] }), /Unexpected runtime error/);
});

test('unexpected errors, stopped frame probes and absent persistent controls fail verification', () => {
  const frames = sequence();
  frames[1].errors.push('Unhandled export error');
  assert.throws(() => assertProcessFrames(frames), /Unhandled export error/);
  frames[1].errors = []; frames[1].samplingErrors.push('Cannot read document');
  assert.throws(() => assertProcessFrames(frames), /must not silently stop/);
  frames[1].samplingErrors = []; frames[1].shell.search.present = false;
  assert.throws(() => assertProcessFrames(frames), /search is missing/);
});

test('newly committed graph or camera movement fails, while a later reader interaction is allowed', () => {
  const frames = sequence();
  frames[1].frames[0].id = 2; frames[2].frames[0].id = 2;
  frames[2].frames[0].camera.centerX += 20;
  assert.throws(() => assertCommittedGeometry(frames), /camera.*moved after reveal/);
  frames[2].frames[0].camera.centerX -= 20;
  frames[2].frames[0].graph.width += 20;
  assert.throws(() => assertCommittedGeometry(frames), /graph.*moved after reveal/);
  frames[2].intent.at = 2;
  assert.doesNotThrow(() => assertCommittedGeometry(frames));
});

test('visible directory and search geometry remain stable across visits without mistaking an explicit close for drift', () => {
  const frames = sequence();
  for (const item of frames) item.shell.search.bounds = { ...box };
  frames[0].shell.search.bounds = { x: 0, y: 0, width: 0, height: 0 };
  assert.doesNotThrow(() => assertStableChrome(frames));
  frames[2].shell.search.bounds.x += 10;
  assert.throws(() => assertStableChrome(frames), /search.x moved/);
});
