import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const template = fs.readFileSync(new URL('../assets/template.html', import.meta.url), 'utf8');
const start = template.lastIndexOf("document.addEventListener('keydown', function (e) {");
assert.ok(start >= 0);
const source = template.slice(start, template.indexOf('</script>', start));

function dispatch(key, descended, field = false, focused = true, nested = false) {
  let handler;
  const calls = [];
  const inactive = { isOpen: () => false, active: () => false };
  const Archify = {
    preset: inactive, semanticLens: inactive, guide: inactive, radar: inactive,
    routeProbe: inactive, intentTrace: inactive,
    focus: { active: () => focused, clear: () => calls.push('clear-focus') },
    drilldown: { active: () => descended, back: () => calls.push('back') },
    presentation: inactive,
  };
  const window = { parent: { postMessage: (message) => calls.push(message.type) } };
  if (!nested) window.parent = window;
  vm.runInNewContext(source, { Archify, window, document: {
    addEventListener: (_, callback) => { handler = callback; },
    documentElement: { getAttribute: (name) => name === 'data-bundle-nested' && nested ? 'true' : null },
  } });
  handler({ key, target: { tagName: field ? 'INPUT' : 'DIV' },
    preventDefault: () => calls.push('prevent-default') });
  return calls;
}

test('ordinary viewer Backspace preserves focus; Escape still clears it', () => {
  assert.deepEqual(dispatch('Backspace', false), []);
  assert.deepEqual(dispatch('Escape', false), ['prevent-default', 'clear-focus']);
});

test('descended Backspace retains Escape priority and ignores text inputs', () => {
  assert.deepEqual(dispatch('Backspace', true), dispatch('Escape', true));
  assert.deepEqual(dispatch('Backspace', true, true), []);
});

test('descended Backspace returns to the parent when no temporary focus remains', () => {
  assert.deepEqual(dispatch('Backspace', true, false, false), ['prevent-default', 'back']);
});

test('nested child Backspace clears its own focus before asking the parent to ascend', () => {
  assert.deepEqual(dispatch('Backspace', false, false, true, true), ['prevent-default', 'clear-focus']);
  assert.deepEqual(dispatch('Backspace', false, false, true, true), dispatch('Escape', false, false, true, true));
});

test('nested child forwards either return key after its Escape ladder is exhausted', () => {
  for (const key of ['Escape', 'Backspace']) {
    assert.deepEqual(dispatch(key, false, false, false, true), ['prevent-default', 'archify:drilldown-escape']);
    assert.deepEqual(dispatch(key, false, true, false, true), []);
  }
});
