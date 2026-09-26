import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('automatic architectures preserve primary reading size when fitting the full page would shrink text', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-primary-reading-size-'));
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
          const guide = document.querySelector('.guided-views').getBoundingClientRect();
          const svg = document.querySelector('.diagram-container > svg');
          return { rail: document.documentElement.dataset.navStageRail,
            toolbarBottom: toolbar.bottom, guideTop: guide.top, guideWidth: guide.width,
            primaryFont: Math.min(...Array.from(svg.querySelectorAll('text[data-node-label]')).map(text => parseFloat(text.getAttribute('font-size')) * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)),
            scrollWidth: document.documentElement.scrollWidth,
            geometry: [svg.getAttribute('viewBox'), ...Array.from(svg.querySelectorAll('[data-node-id]')).map(node =>
              [node.getAttribute('transform'), ...Array.from(node.querySelectorAll('text')).map(text => text.getAttribute('font-size'))])] };
        })()`);
        const label = `${width}x${height}/${theme}`;
        assert.equal(observed.rail, 'true', label + ': fixture must exercise the compact rail');
        assert.ok(observed.guideWidth > 0, label + ': guide must be visible');
        assert.ok(observed.guideTop >= observed.toolbarBottom + 4, label + ': toolbar overlaps guide ' + JSON.stringify(observed));
        assert.ok(observed.scrollWidth <= width, label + ': horizontal overflow');
        assert.ok(observed.primaryFont >= 13.5, label + ': full-page fitting made primary text too small: ' + observed.primaryFont);
        if (geometry) assert.deepEqual(observed.geometry, geometry, label + ': authored node geometry/font changed');
        else geometry = observed.geometry;
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one long label does not enlarge the other titles in a narrow tall architecture', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reading-size-stress-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Tall architecture', output: 'output.html', quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Authentication worker', pos: [40, 40], size: [140, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [40, 340], size: [120, 60] },
      { id: 'db', type: 'database', label: 'Store', pos: [40, 640], size: [120, 60] },
    ],
    connections: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }],
  }));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', input, output]);
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    const metrics = await browser.inspect({ artifactPath: output, width: 1440, height: 900, theme: 'light' });
    const session = await browser.sessionPromise;
    const result = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const svg = document.querySelector('.diagram-container > svg');
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return [...svg.querySelectorAll('text[data-node-label]')].map(text => ({
        source: Number(text.getAttribute('font-size')), projected: Number(text.getAttribute('font-size')) * scale }));
    })()` }, session);
    assert.equal(result.exceptionDetails, undefined);
    const sizes = result.result.value;
    assert.ok(sizes[0].source < sizes[1].source, 'fixture must contain a fitted long title');
    assert.ok(sizes[1].projected >= 13.5 && sizes[1].projected <= 14.2, JSON.stringify(sizes));
    assert.ok(metrics.scrollWidth <= 1440);
    assert.ok(metrics.scrollHeight > 900, 'preserve ordinary scroll instead of shrinking the tall graph');
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
