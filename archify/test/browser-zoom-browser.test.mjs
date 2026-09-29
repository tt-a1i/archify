import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
if (process.env.ARCHIFY_CHROME && !chrome) throw new Error('ARCHIFY_CHROME is not executable');

test('real browser page zoom selects canvas or document flow from the resulting CSS viewport', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to check real browser page zoom.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-zoom-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const artifact = path.join(scratch, 'architecture.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/web-app.architecture.json'), artifact]);
  const evidence = process.env.ARCHIFY_FIXED_CANVAS_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => { if (evidence) fs.writeFileSync(path.join(evidence, 'browser-page-zoom.json'), JSON.stringify(records, null, 2) + '\n'); });

  for (const factor of [1, 2]) {
    // Chrome's default storage partition uses key "x"; zoom factor = 1.2^level.
    // https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc
    // This writes only the unique temporary profile created by ChromeVisualBrowser.
    // No device-metrics emulation or pinch zoom is used in this test.
    const browser = new ChromeVisualBrowser(chrome, {
      spawnImpl(command, args, options) {
        const profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
        assert.ok(profile && path.basename(profile).startsWith('archify-visual-check-profile-'));
        const directory = path.join(profile, 'Default');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'Preferences'), JSON.stringify({
          partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } },
        }));
        return spawn(command, args, options);
      },
    });
    try {
      const session = await browser.sessionPromise;
      const send = (method, params = {}) => browser.cdp.send(method, params, session);
      async function run(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
        return result.result?.value;
      }
      const targets = await browser.cdp.send('Target.getTargets');
      const target = targets.targetInfos.find(target => target.type === 'page');
      const { windowId } = await browser.cdp.send('Browser.getWindowForTarget', { targetId: target.targetId });
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.navigate', { url: pathToFileURL(artifact).href });
      await loaded;
      for (let round = 0; round < 3; round++) {
        for (const [width, height] of [[1440, 900], [2880, 1800]]) {
          await browser.cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
          await run(`(async()=>{await document.fonts.ready;await Archify.readerLayout.whenStable();await Archify.viewerChromeLayout.whenStable();})()`);
          // Isolate page zoom after layout settles. Crossing from responsive SVG
          // sizing to fixed units may legitimately rebase the camera multiplier.
          await run('Archify.view.reset()');
          const observation = await run(`(()=>{const cards=document.querySelector('.cards'),root=document.documentElement;return {
            css:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio,pinch:visualViewport.scale,
            fixed:root.hasAttribute('data-fixed-canvas'),cards:cards.querySelectorAll('.card').length,
            legendVisible:getComputedStyle(document.querySelector('[data-legend]')).visibility!=='hidden',
            dockVisible:getComputedStyle(document.querySelector('.fixed-legend')).display!=='none',
            cardsHeight:cards.getBoundingClientRect().height,rootRange:[root.scrollWidth-root.clientWidth,root.scrollHeight-root.clientHeight],
            camera:Archify.view.state()};})()`);
          records.push({ factor, round, requestedWindow: [width, height], ...observation });
          assert.ok(Math.abs(observation.dpr - factor) < 0.01, 'Chrome must actually apply page zoom: ' + JSON.stringify(observation));
          assert.equal(observation.pinch, 1, 'pinch zoom must remain inactive');
          assert.equal(observation.camera.scale, 1, 'each page-zoom observation uses an explicit 100% diagram reset');
          assert.equal(observation.fixed, observation.css[0] >= 1024 && observation.css[1] >= 600);
          assert.equal(observation.cards, 3);
          assert.equal(observation.dockVisible, observation.fixed);
          assert.equal(observation.legendVisible, !observation.fixed);
          if (observation.fixed) assert.ok(observation.rootRange.every(value => value <= 1), JSON.stringify(observation));
          else assert.ok(observation.cardsHeight > 0, 'document fallback must restore cards');
          if (round === 0 && evidence) {
            const screenshot = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(evidence, `browser-zoom-${factor * 100}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
          }
        }
      }
    } finally { await browser.close(); }
  }
  for (const width of [1440, 2880]) {
    const baseline = records.find(row => row.factor === 1 && row.round === 0 && row.requestedWindow[0] === width);
    const zoomed = records.find(row => row.factor === 2 && row.round === 0 && row.requestedWindow[0] === width);
    assert.ok(Math.abs(baseline.css[0] / zoomed.css[0] - 2) < 0.02, JSON.stringify({ baseline, zoomed }));
  }
  assert.ok(records.some(row => row.factor === 2 && row.fixed));
  assert.ok(records.some(row => row.factor === 2 && !row.fixed));
});
