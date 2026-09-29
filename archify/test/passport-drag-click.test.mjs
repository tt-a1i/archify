import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../viewer/focus.js', import.meta.url), 'utf8');
const finish = source.match(/      function finishLensDrag\(event, cancel\) \{[\s\S]*?\n      \}/)?.[0];
const start = source.indexOf("      document.addEventListener('pointerdown', function () {\n        lensDragClickPointer = null;");
const end = source.indexOf("      window.addEventListener('scroll', requestLensPlacement", start);
assert.ok(finish && start >= 0 && end > start);

function fixture(moved = true) {
  const listeners = {};
  let closes = 0;
  const chip = { hidden: false, contains: () => false, removeAttribute() {}, style: { removeProperty() {} } };
  const context = { chip, lensDragClickPointer: null, manualLensPosition: null,
    lensDrag: { pointerId: 7, moved, previousManual: { left: 42, top: 64 } },
    moveBtn: { releasePointerCapture() {} },
    manualLensPlacementAvailable: () => false, requestLensPlacement() {},
    container: { getAttribute: () => null }, clear: () => closes++,
    document: { addEventListener: (name, fn) => { listeners[name] = fn; } },
  };
  vm.runInNewContext(finish + '\n' + source.slice(start, end), context);
  function click(detail = 1, pointerId = 7) {
    const event = { detail, pointerId, target: { closest: () => null }, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.click(event); return event;
  }
  context.finishLensDrag({ pointerId: 7, preventDefault() {}, stopPropagation() {} }, true);
  return { context, click, down: () => listeners.pointerdown(), closes: () => closes };
}

test('cancelled passport drag restores placement and consumes only its trailing click', () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(f.context.manualLensPosition)), { left: 42, top: 64 });
  assert.equal(f.context.lensDrag, null);
  const trailing = f.click();
  assert.equal(trailing.prevented, true); assert.equal(trailing.stopped, true); assert.equal(f.closes(), 0);
  f.down(); f.click(); assert.equal(f.closes(), 1, 'a new outside gesture still closes');
});

test('passport click suppression preserves new gestures, keyboard and unmoved clicks', () => {
  const next = fixture(); next.down(); assert.equal(next.click().prevented, false); assert.equal(next.closes(), 1);
  const keyboard = fixture(); assert.equal(keyboard.click(0).prevented, false); assert.equal(keyboard.closes(), 1);
  const otherPointer = fixture(); assert.equal(otherPointer.click(1, 9).prevented, false); assert.equal(otherPointer.closes(), 1);
  const unmoved = fixture(false); assert.equal(unmoved.click().prevented, false); assert.equal(unmoved.closes(), 1);
});
