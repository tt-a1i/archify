import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
test('compact stage rail and in-canvas navigation keep the diagram clear of toolbar and controls', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-header-clearance-'));
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples/web-app.architecture.json'), 'utf8'));
  spec.meta.title = 'Service map';
  delete spec.meta.subtitle;
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', input, output]);
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined);
      return result.result?.value;
    };
    let geometry;
    let compactRailCases = 0;
    for (const [width, height] of [[1440, 900], [1600, 900], [2048, 1320]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.navigate', { url: pathToFileURL(output).href });
      await loaded;
      for (const theme of ['light', 'dark']) {
        const observed = await evaluate(`(async () => {
          await document.fonts.ready;
          if (document.documentElement.dataset.theme !== '${theme}') document.getElementById('btn-theme').click();
          await Archify.layoutStability.whenStable();
          const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
          const guide = document.querySelector('.diagram-container').getBoundingClientRect();
          const svg = document.querySelector('.diagram-container > svg');
          const stage = svg.getBoundingClientRect();
          const nav = document.querySelector('.diagram-nav').getBoundingClientRect();
          const overlapWidth = Math.max(0, Math.min(stage.right, nav.right) - Math.max(stage.left, nav.left));
          const overlapHeight = Math.max(0, Math.min(stage.bottom, nav.bottom) - Math.max(stage.top, nav.top));
          return { rail: document.documentElement.dataset.navStageRail,
            toolbarBottom: toolbar.bottom, guideTop: guide.top, guideWidth: guide.width,
            navWidth: nav.width, navHeight: nav.height,
            navStageOverlap: overlapWidth * overlapHeight,
            navStageGap: Math.max(nav.top - stage.bottom, stage.top - nav.bottom, nav.left - stage.right, stage.left - nav.right),
            scrollWidth: document.documentElement.scrollWidth,
            geometry: [svg.getAttribute('viewBox'), ...Array.from(svg.querySelectorAll('[data-node-id]')).map(node =>
              [node.getAttribute('transform'), ...Array.from(node.querySelectorAll('text')).map(text => text.getAttribute('font-size'))])] };
        })()`);
        const label = `${width}x${height}/${theme}`;
        // Compact viewports still exercise the real stage rail. On a taller
        // screen the independently capped SVG can leave enough normal canvas
        // space for in-canvas navigation; either placement must clear the stage.
        if (width <= 1600) assert.equal(observed.rail, 'true', label + ': compact fixture must exercise the stage rail');
        else assert.ok(observed.rail === undefined || observed.rail === 'true', label + ': unexpected navigation placement');
        if (observed.rail === 'true') compactRailCases += 1;
        assert.ok(observed.navWidth > 0 && observed.navHeight > 0, label + ': navigation must be visible');
        assert.equal(observed.navStageOverlap, 0, label + ': navigation overlaps graph stage ' + JSON.stringify(observed));
        assert.ok(observed.navStageGap >= 9.99, label + ': navigation lacks its 10px stage clearance ' + JSON.stringify(observed));
        assert.ok(observed.guideWidth > 0, label + ': diagram must be visible');
        assert.ok(observed.guideTop >= observed.toolbarBottom + 4, label + ': toolbar overlaps diagram ' + JSON.stringify(observed));
        assert.ok(observed.scrollWidth <= width, label + ': horizontal overflow');
        if (geometry) assert.deepEqual(observed.geometry, geometry, label + ': authored node geometry/font changed');
        else geometry = observed.geometry;
      }
    }
    assert.ok(compactRailCases >= 4, 'both themes at 1440 and 1600 must exercise real compact-stage clearance');
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
