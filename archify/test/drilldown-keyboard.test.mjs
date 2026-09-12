import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const template = fs.readFileSync(new URL('../assets/template.html', import.meta.url), 'utf8');
const start = template.lastIndexOf("document.addEventListener('keydown', function (e) {");
assert.ok(start >= 0);
const source = template.slice(start, template.indexOf('</script>', start));

function dispatch(key, descended, field = false, focused = true) {
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
  vm.runInNewContext(source, { Archify, document: {
    addEventListener: (_, callback) => { handler = callback; },
    documentElement: { getAttribute: () => null },
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
