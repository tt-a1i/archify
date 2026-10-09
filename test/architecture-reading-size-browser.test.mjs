import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
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
          return { rail: document.documentElement.dataset.navStageRail, summaryRail: document.documentElement.dataset.readerRail || null,
            toolbarBottom: toolbar.bottom, guideTop: guide.top, guideWidth: guide.width,
            navWidth: nav.width, navHeight: nav.height,
            navStageOverlap: overlapWidth * overlapHeight,
            navStageGap: Math.max(nav.top - stage.bottom, stage.top - nav.bottom, nav.left - stage.right, stage.left - nav.right),
            primaryFont: Math.min(...Array.from(svg.querySelectorAll('text[data-node-label]')).map(text => parseFloat(text.getAttribute('font-size')) * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)),
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
        // A docked or bottom summary rail may trade comfort down to its 12px
        // floor; without one (collapsed or unavailable) the 13.5px comfort holds.
        const primaryFloor = observed.summaryRail === 'true' || observed.summaryRail === 'bottom' ? 12 : 13.5;
        assert.ok(observed.primaryFont >= primaryFloor, label + ': full-page fitting made primary text too small: ' + observed.primaryFont + ' (rail ' + observed.summaryRail + ')');
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

test('a narrow tall architecture fits the first screen without enlarging the other titles', async (t) => {
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
      return {
        diagramBottom: document.querySelector('.diagram-container').getBoundingClientRect().bottom,
        shellWidth: document.querySelector('.container').getBoundingClientRect().width,
        svgWidth: svg.getBoundingClientRect().width,
        titleLines: Math.round(document.querySelector('.header h1').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.header h1')).lineHeight)),
        sizes: [...svg.querySelectorAll('text[data-node-label]')].map(text => ({
          source: Number(text.getAttribute('font-size')), projected: Number(text.getAttribute('font-size')) * scale })),
      };
    })()` }, session);
    assert.equal(result.exceptionDetails, undefined);
    const { sizes, diagramBottom, shellWidth, svgWidth, titleLines } = result.result.value;
    // A narrow diagram is centred in a full-width reader shell, so the title,
    // toolbar, and diagram controls keep their desktop layout.
    assert.ok(shellWidth >= 960 && svgWidth < shellWidth - 200, JSON.stringify({ shellWidth, svgWidth }));
    assert.equal(titleLines, 1, 'the diagram title must not wrap in a narrow reader');
    assert.ok(sizes[0].source < sizes[1].source, 'fixture must contain a fitted long title');
    // With notes below the fold the whole graph takes the first screen: text
    // may shrink toward the declared 7.5px floor, and hierarchy still holds.
    assert.ok(sizes[0].projected < sizes[1].projected, JSON.stringify(sizes));
    assert.ok(sizes[0].projected >= 7.5 - 0.01 && sizes[1].projected <= 14.2, JSON.stringify(sizes));
    assert.ok(metrics.scrollWidth <= 1440);
    assert.ok(diagramBottom <= 900, `the tall graph must fit the first screen (diagram bottom ${diagramBottom})`);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a first-screen fit never pushes relationship labels below the 6px floor', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-edge-floor-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  // Titles only, 8px relationship labels: without the edge floor the titles'
  // 7.5px target alone would project the labels to about 5.5px.
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Tall request path', output: 'output.html', quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 40], size: [140, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [40, 480], size: [140, 60] },
      { id: 'db', type: 'database', label: 'Store', pos: [40, 920], size: [140, 60] },
    ],
    connections: [{ from: 'client', to: 'api', label: 'request' }, { from: 'api', to: 'db', label: 'persist' }],
  }));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', input, output]);
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    await browser.inspect({ artifactPath: output, width: 1440, height: 900, theme: 'light' });
    const session = await browser.sessionPromise;
    const result = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const svg = document.querySelector('.diagram-container > svg');
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return {
        edges: [...svg.querySelectorAll('g[data-detail="context"][data-edge-from] text')].map(text => Number(text.getAttribute('font-size')) * scale),
        overflow: document.documentElement.getAttribute('data-reader-overflow'),
      };
    })()` }, session);
    assert.equal(result.exceptionDetails, undefined);
    const { edges, overflow } = result.result.value;
    assert.ok(edges.length === 2, JSON.stringify(edges));
    assert.ok(edges.every(size => size >= 6), JSON.stringify(edges));
    // This graph is taller than the floor allows, so it scrolls as authored.
    assert.equal(overflow, 'authored');

    // Moving the notes beside the diagram docks the rail. The shell keeps its
    // desktop floor, but the SVG gets only the diagram's share: its primary
    // labels return to the docked comfort size instead of doubling.
    const docked = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
      document.getElementById('rail-placement').click();
      await Archify.layoutStability.whenStable();
      const svg = document.querySelector('.diagram-container > svg');
      const svgRect = svg.getBoundingClientRect();
      const railRect = document.querySelector('.reader-rail').getBoundingClientRect();
      const scale = svgRect.width / svg.viewBox.baseVal.width;
      const result = {
        rail: document.documentElement.getAttribute('data-reader-rail'),
        shellWidth: document.querySelector('.container').getBoundingClientRect().width,
        primary: Math.max(...[...svg.querySelectorAll('text[data-node-label]')].map(text => Number(text.getAttribute('font-size')) * scale)),
        svgRight: svgRect.right, railLeft: railRect.left,
      };
      localStorage.removeItem('archify-rail-placement');
      return result;
    })()` }, session);
    assert.equal(docked.exceptionDetails, undefined);
    const rail = docked.result.value;
    assert.equal(rail.rail, 'true', JSON.stringify(rail));
    assert.ok(rail.shellWidth >= 960, JSON.stringify(rail));
    assert.ok(rail.primary >= 13.5 && rail.primary <= 14.2, JSON.stringify(rail));
    assert.ok(rail.svgRight <= rail.railLeft, JSON.stringify(rail));
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
