import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ChromeVisualBrowser } from '../../bin/visual-check.mjs';

// Headless Linux has no physical pointer. Configure Blink's desktop capabilities
// at launch so real CDP mouse events exercise the same guards as a desktop mouse.
// These settings belong to this test fixture, not the installed visual-check CLI.
export function desktopBrowser(chrome) {
  return new ChromeVisualBrowser(chrome, {
    spawnImpl: (executable, args, options) => spawn(executable, [
      '--blink-settings=availablePointerTypes=4,primaryPointerType=4,availableHoverTypes=2,primaryHoverType=2',
      ...args,
    ], options),
  });
}

export async function assertDesktopPointer(browser, session) {
  const result = await browser.cdp.send('Runtime.evaluate', {
    // Query native capabilities separately: some negative fixtures deliberately
    // override the combined hover-and-pointer query to exercise coarse input.
    expression: `({hover:matchMedia('(hover: hover)').matches,fine:matchMedia('(pointer: fine)').matches})`,
    returnByValue: true,
  }, session);
  assert.equal(result.exceptionDetails, undefined);
  assert.deepEqual(result.result.value, { hover: true, fine: true },
    'Desktop pointer fixture was lost after navigation; do not reset touch emulation.');
}
