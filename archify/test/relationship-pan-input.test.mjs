import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../viewer/focus.js', import.meta.url), 'utf8');
const binding = source.match(/relationshipHitOverlay\.addEventListener\('pointerdown', function \(event\) \{[\s\S]*?\n        \}\);/)?.[0];
assert.ok(binding);
function blocked({ button = 0, pointerType = 'mouse', space = false, hit = true } = {}) {
  let callback, stopped = false;
  vm.runInNewContext(binding, {
    relationshipHitOverlay: { addEventListener: (_, fn) => { callback = fn; } },
    container: { classList: { contains: name => name === 'is-pan-ready' && space } },
  });
  callback({ button, pointerType, target: { closest: () => hit }, stopPropagation() { stopped = true; } });
  return stopped;
}
test('relationship rails preserve ordinary primary clicks and let canvas pan gestures bubble', () => {
  assert.equal(blocked(), true);
  assert.equal(blocked({ hit: false }), false);
  for (const intent of [{ button: 1 }, { button: 2 }, { space: true }, { pointerType: 'touch' }, { pointerType: 'pen' }]) {
    assert.equal(blocked(intent), false, JSON.stringify(intent));
  }
});
