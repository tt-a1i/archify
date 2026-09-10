import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ChromeVisualBrowser } from '../../bin/visual-check.mjs';

// Test-only Blink settings: headless hosts may have no physical mouse.
// Disabling touch emulation would restore those host defaults and undo this.
const pointerSettings = '--blink-settings=availableHoverTypes=2,primaryHoverType=2,availablePointerTypes=4,primaryPointerType=4';

export function desktopBrowser(chrome) {
  return new ChromeVisualBrowser(chrome, {
    spawnImpl: (command, args, options) => spawn(command, [pointerSettings, ...args], options),
  });
}

export async function desktopPointerCheck(browser, session) {
  const version = await browser.cdp.send('Browser.getVersion');
  await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      // Capture the native query before controlled coarse-pointer fixtures run.
      const query = window.matchMedia.bind(window);
      const sample = () => ({
        hover: query('(hover: hover)').matches,
        fine: query('(pointer: fine)').matches,
        combined: query('(hover: hover) and (pointer: fine)').matches,
        anyHover: query('(any-hover: hover)').matches,
        anyFine: query('(any-pointer: fine)').matches,
        maxTouchPoints: navigator.maxTouchPoints,
      });
      window.__archifyTestPointer = { initial: sample(), sample };
    })();
  ` }, session);
  return async function checkDesktopPointer() {
    const result = await browser.cdp.send('Runtime.evaluate', {
      expression: '({initial:__archifyTestPointer.initial,current:__archifyTestPointer.sample()})',
      returnByValue: true,
    }, session);
    assert.equal(result.exceptionDetails, undefined, 'Desktop pointer diagnostics did not initialize');
    const samples = result.result.value;
    for (const phase of ['initial', 'current']) {
      for (const capability of ['hover', 'fine', 'combined', 'anyHover', 'anyFine']) {
        assert.equal(samples[phase][capability], true,
          `Desktop pointer capability ${phase}.${capability}: ${JSON.stringify({
            browser: version.product, platform: process.platform, pointerSettings, samples,
          })}`);
      }
    }
  };
}
