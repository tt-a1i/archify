import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}
const cases = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

test('Reader Layout preserves final-artifact behavior across its ownership boundaries', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-browser-'));
  const evidence = process.env.ARCHIFY_READER_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const artifacts = {};
  for (const [mode, example] of Object.entries(cases)) {
    const output = path.join(scratch, `${mode}.html`);
    // Optional captured base artifacts let the same behavioral cases establish
    // a pre-extraction baseline without changing the implementation under test.
    if (process.env.ARCHIFY_READER_BASELINE_DIR) {
      fs.copyFileSync(path.join(process.env.ARCHIFY_READER_BASELINE_DIR, `${mode}.html`), output);
    } else {
      execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
        path.join(skillRoot, 'examples', example), output]);
    }
    artifacts[mode] = output;
  }
  const compactErd = path.join(scratch, 'compact-table.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/erd/render-erd.mjs'),
    path.resolve(skillRoot, '../test/fixtures/reader-readability/compact-table.erd.json'), compactErd]);
  const browser = new ChromeVisualBrowser(chromePath);
  const records = [];
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    async function evaluate(expression, awaitPromise = false) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result?.value;
    }
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.readerTestErrors = [];
        addEventListener('error', function (event) { readerTestErrors.push(event.message); });
        addEventListener('unhandledrejection', function (event) { readerTestErrors.push(String(event.reason)); });`,
    });
    async function viewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    }
    async function media(theme = 'dark', reduced = false, print = false) {
      await send('Emulation.setEmulatedMedia', { media: print ? 'print' : '', features: [
        { name: 'prefers-color-scheme', value: theme },
        { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
      ] });
    }
    async function stable() {
      await evaluate(`(async function () {
        for (var i = 0; i < 2; i += 1) {
          await Archify.readerLayout.whenStable();
          await Archify.viewerChromeLayout.whenStable();
        }
      })()`, true);
    }
    async function snapshot(label) {
      const value = await evaluate(`(function () {
        var html = document.documentElement;
        var diagram = document.querySelector('.diagram-container');
        var svg = diagram.querySelector(':scope > svg');
        return {
          active: Archify.readerLayout.active(), receipt: Archify.readerLayout.receipt(),
          width: html.style.getPropertyValue('--archify-reader-width'),
          layout: html.getAttribute('data-reader-layout'), overflow: html.getAttribute('data-reader-overflow'),
          wide: diagram.getAttribute('data-wide-diagram'), shape: html.getAttribute('data-diagram-shape'),
          readerFit: svg.getAttribute('data-reader-fit'),
          readerArea: html.getAttribute('data-reader-area'),
          minimumAreaHeight: html.style.getPropertyValue('--archify-diagram-min-height'),
          legendCorner: Boolean(svg.querySelector('[data-reader-legend-corner]')),
          legendTransformRuntime: svg.querySelector('[data-legend]')?.style.getPropertyValue('--archify-reader-legend-transform') || '',
          geometry: ['viewBox', 'width', 'height'].map(function (name) { return svg.getAttribute(name); }),
          shellWidth: document.querySelector('.container').getBoundingClientRect().width,
          scrollHeight: Math.max(html.scrollHeight, document.body.scrollHeight),
          innerWidth: innerWidth, innerHeight: innerHeight,
          theme: html.getAttribute('data-theme'), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          errors: window.readerTestErrors,
          externalResources: performance.getEntriesByType('resource').map(function (entry) { return entry.name; }).filter(function (name) { return /^https?:/.test(name); })
        };
      })()`);
      assert.deepEqual(value.errors, [], `${label}: uncaught Viewer errors`);
      assert.deepEqual(value.externalResources, [], `${label}: external runtime assets`);
      records.push({ label, ...value });
      return value;
    }
    async function load(file, { width = 1440, height = 900, theme = 'dark', reduced = false, query = '', print = false, waitForLayout = true } = {}) {
      await viewport(width, height);
      await media(theme, reduced, print);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      const result = await send('Page.navigate', { url: pathToFileURL(file).href + `?theme=${theme}${query}` });
      assert.equal(result.errorText, undefined, result.errorText);
      await loaded;
      assert.deepEqual(await evaluate('window.readerTestErrors'), [], 'Viewer initialization');
      if (waitForLayout) await stable();
    }
    function variant(name, { ratio, undeclaredFit = false, beforeViewer = '' } = {}) {
      let html = fs.readFileSync(artifacts.architecture, 'utf8');
      if (ratio !== undefined) assert.match(html, /<svg\b[^>]*\bviewBox="[^"]+"/, 'Reader viewBox fixture anchor');
      if (beforeViewer) assert.ok(html.includes('  <script>\n    var Archify = {};'), 'Reader setup fixture anchor');
      if (ratio !== undefined) html = html.replace(/(<svg\b[^>]*\bviewBox=")[^"]+(")/, (_, start, end) => `${start}0 0 ${ratio * 1000} 1000${end}`);
      if (undeclaredFit) {
        // Ratio-only cases must not inherit the compiler's independent
        // intrinsic-height eligibility declaration from the source fixture.
        html = html.replace(/<svg\b[^>]*>/, root => root.replace(' data-reader-fit="intrinsic-height"', ''));
      }
      if (beforeViewer) html = html.replace('  <script>\n    var Archify = {};', () => `  <script>${beforeViewer}</script>\n  <script>\n    var Archify = {};`);
      const file = path.join(scratch, `${name}.html`);
      fs.writeFileSync(file, html);
      return file;
    }
    function inactive(state, wide = true) {
      assert.equal(state.active, false);
      assert.equal(state.width, '');
      assert.equal(state.layout, null);
      assert.equal(state.overflow, null);
      assert.equal(state.receipt.width, 0);
      assert.equal(state.readerArea, null);
      assert.equal(state.minimumAreaHeight, '');
      assert.equal(state.legendCorner, false);
      assert.equal(state.legendTransformRuntime, '');
      assert.equal(state.wide, wide ? 'true' : null);
      assert.equal(state.shape, wide ? 'wide' : null);
    }

    await t.test('five modes initialize and export clean SVG; a representative reader honors both themes and reduced motion', async () => {
      for (const [mode, file] of Object.entries(artifacts)) {
        // Mode seams remain complete; shared theme/reduced-motion behavior uses one representative.
        for (const theme of mode === 'architecture' ? ['dark', 'light'] : ['dark']) {
          await load(file, { theme, reduced: theme === 'light' });
          const state = await snapshot(`${mode}-${theme}`);
          assert.equal(state.theme, theme);
          assert.equal(state.reduced, theme === 'light');
          assert.equal(state.active, state.receipt.ratio >= 1.55);
          await evaluate('Archify.view.zoomIn()');
          await stable();
          const exported = await evaluate(`(async function () {
            var original = URL.createObjectURL;
            var captured;
            URL.createObjectURL = function (blob) {
              if (blob.type.indexOf('image/svg+xml') === 0) captured = blob;
              return original.call(URL, blob);
            };
            try {
              await Archify.exportMenu.run('svg');
              if (!captured) throw new Error('SVG export did not produce a blob');
              var text = await captured.text();
              var svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
              return { text: text, geometry: ['viewBox', 'width', 'height'].map(function (name) { return svg.getAttribute(name); }),
                dirty: !!svg.querySelector('[data-focus-match], [data-route-match], [data-reader-layout], [data-source-evidence-beacon]') ||
                  svg.hasAttribute('data-view-scale') || svg.hasAttribute('data-focus-active') || svg.hasAttribute('data-route-active') };
            } finally { URL.createObjectURL = original; }
          })()`, true);
          assert.equal(exported.dirty, false);
          assert.equal(exported.geometry[0], state.geometry[0]);
          if (evidence) fs.writeFileSync(path.join(evidence, `${mode}-${theme}.svg`), exported.text);
          await evaluate('Archify.view.reset()');
          await stable();
          const reset = await snapshot(`${mode}-${theme}-reset`);
          assert.deepEqual(reset.geometry, state.geometry);
          if (evidence && mode === 'architecture') {
            const capture = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(evidence, `architecture-1440x900-${theme}.png`), Buffer.from(capture.data, 'base64'));
          }
        }
      }
    });

    await t.test('Guide and presentation keyboard controls preserve focus, URL context and authored geometry', async () => {
      await load(artifacts.architecture, { query: '&keep=yes#reader-context' });
      const before = await snapshot('guide-presentation-before');
      async function key(key, code, windowsVirtualKeyCode) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
      }
      await evaluate("document.getElementById('btn-present').focus()");
      await key('?', 'Slash', 191);
      await evaluate('new Promise(resolve => requestAnimationFrame(resolve))', true);
      assert.equal(await evaluate("!document.getElementById('diagram-guide').hidden && document.getElementById('diagram-guide').contains(document.activeElement)"), true);
      await key('Escape', 'Escape', 27);
      assert.equal(await evaluate("document.getElementById('diagram-guide').hidden"), true);
      assert.equal(await evaluate('document.activeElement.id'), 'btn-present');
      await key('f', 'KeyF', 70);
      await stable();
      assert.deepEqual(await evaluate("({active: Archify.presentation.active(), pressed: document.getElementById('btn-present').getAttribute('aria-pressed'), present: new URL(location.href).searchParams.get('present'), keep: new URL(location.href).searchParams.get('keep'), hash: location.hash})"),
        { active: true, pressed: 'true', present: '1', keep: 'yes', hash: '#reader-context' });
      await key('Escape', 'Escape', 27);
      await stable();
      assert.equal(await evaluate('Archify.presentation.active()'), false);
      assert.deepEqual(await evaluate("[new URL(location.href).searchParams.get('present'), new URL(location.href).searchParams.get('keep'), location.hash]"), [null, 'yes', '#reader-context']);
      assert.deepEqual((await snapshot('guide-presentation-return')).geometry, before.geometry);
    });

    await t.test('ratio and desktop thresholds preserve shape while clearing temporary state', async () => {
      await load(variant('intrinsic-ratio-1.549', { ratio: 1.549 }));
      const intrinsic = await snapshot('intrinsic-ratio-1.549');
      assert.equal(intrinsic.readerFit, 'intrinsic-height');
      assert.equal(intrinsic.receipt.ratio, 1.549);
      assert.equal(intrinsic.active, true, 'intrinsic-height remains eligible below the wide-ratio threshold');
      assert.equal(intrinsic.wide, null);
      assert.equal(intrinsic.shape, null);
      for (const ratio of [1.549, 1.55, 1.551]) {
        await load(variant(`ratio-${ratio}`, { ratio, undeclaredFit: true }));
        const before = await snapshot(`ratio-${ratio}`);
        assert.equal(before.readerFit, null, 'legacy ratio fixture declares no intrinsic fit');
        assert.equal(before.active, ratio >= 1.55);
        if (ratio < 1.55) inactive(before, false);
        for (const width of [1023, 1024, 1025, 1023, 1440]) {
          await viewport(width, 900);
          await stable();
          const state = await snapshot(`ratio-${ratio}-width-${width}`);
          assert.deepEqual(state.geometry, before.geometry);
          if (ratio >= 1.55 && width >= 1024) assert.equal(state.active, true);
          else inactive(state, ratio >= 1.55);
        }
      }
    });

    const wide = variant('wide', { ratio: 3, undeclaredFit: true });
    await t.test('capped canvas keeps its original legend in the outer corner through camera, input and canonical export', async () => {
      async function corner(label) {
        const state = await evaluate(`(function () {
          var diagram = document.querySelector('.diagram-container');
          var svg = diagram.querySelector(':scope > svg');
          var legend = svg.querySelector('[data-legend]');
          var rect = diagram.getBoundingClientRect();
          var style = getComputedStyle(diagram);
          var legendRect = legend.getBoundingClientRect();
          var nodeRect = svg.querySelector('[data-node-id]').getBoundingClientRect();
          var navRect = diagram.querySelector('.diagram-nav').getBoundingClientRect();
          var left = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          var bottom = rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
          return { corner: legend.hasAttribute('data-reader-legend-corner'),
            scale: Archify.view.state().scale, svgCount: diagram.querySelectorAll(':scope > svg').length,
            originalSvg: legend.ownerSVGElement === svg,
            left: legendRect.left, bottom: legendRect.bottom, width: legendRect.width, height: legendRect.height,
            leftGap: legendRect.left - left, bottomGap: bottom - legendRect.bottom,
            nodeWidth: nodeRect.width, nodeHeight: nodeRect.height,
            navOverlap: Math.max(0, Math.min(navRect.right, legendRect.right) - Math.max(navRect.left, legendRect.left)) *
              Math.max(0, Math.min(navRect.bottom, legendRect.bottom) - Math.max(navRect.top, legendRect.top)) };
        })()`);
        records.push({ label, ...state });
        assert.equal(state.corner, true, JSON.stringify(state));
        assert.equal(state.svgCount, 1, 'Legend stays in the original root SVG');
        assert.equal(state.originalSvg, true);
        assert.ok(Math.abs(state.leftGap) <= 1 && Math.abs(state.bottomGap) <= 1, JSON.stringify(state));
        assert.equal(state.navOverlap, 0, JSON.stringify(state));
        if (evidence) {
          const capture = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(evidence, `${label}.png`), Buffer.from(capture.data, 'base64'));
        }
        return state;
      }
      async function exportLegend(label) {
        const value = await evaluate(`(async function () {
          var svg = document.querySelector('.diagram-container > svg');
          var before = svg.outerHTML;
          var original = URL.createObjectURL;
          var captured;
          URL.createObjectURL = function (blob) {
            if (blob.type.indexOf('image/svg+xml') === 0) captured = blob;
            return original.call(URL, blob);
          };
          try {
            await Archify.exportMenu.run('svg');
            var text = await captured.text();
            var clone = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
            var legend = clone.querySelector('[data-legend]');
            return { text: text, liveUnchanged: before === svg.outerHTML,
              legendMarkup: legend.outerHTML, legendCount: clone.querySelectorAll('[data-legend]').length,
              runtime: clone.hasAttribute('data-view-scale') || Boolean(clone.querySelector('[data-reader-legend-corner]')) ||
                text.includes('--archify-reader-legend-transform'),
              viewBox: clone.getAttribute('viewBox') };
          } finally { URL.createObjectURL = original; }
        })()`, true);
        assert.equal(value.liveUnchanged, true);
        assert.equal(value.legendCount, 1);
        assert.equal(value.runtime, false, 'Export restores canonical legend placement without runtime CSS');
        if (evidence) fs.writeFileSync(path.join(evidence, `${label}.svg`), value.text);
        return value;
      }
      // Capture canonical placement in the ordinary uncapped reading mode,
      // then compare the exact exported group at every capped camera size.
      await load(compactErd, { width: 1440, height: 360 });
      const canonical = await exportLegend('compact-legend-canonical');
      for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
        await load(compactErd, { width, height });
        const baseline = await corner(`compact-legend-${width}-100`);
        for (const [scale, steps] of [[0.75, 1], [0.25, 2]]) {
          await evaluate(`for (var i = 0; i < ${steps}; i += 1) Archify.view.zoomOut();`);
          await stable();
          const zoomed = await corner(`compact-legend-${width}-${Math.round(scale * 100)}`);
          assert.equal(zoomed.scale, scale);
          assert.ok(Math.abs(zoomed.width - baseline.width) <= 1 && Math.abs(zoomed.height - baseline.height) <= 1);
          assert.ok(Math.abs(zoomed.nodeWidth - baseline.nodeWidth * scale) <= 1);
          assert.ok(Math.abs(zoomed.nodeHeight - baseline.nodeHeight * scale) <= 1);
          const exported = await exportLegend(`compact-legend-export-${width}-${Math.round(scale * 100)}`);
          assert.equal(exported.legendMarkup.replace(' style=""', ''), canonical.legendMarkup);
          assert.equal(exported.viewBox, canonical.viewBox);
        }
        await evaluate('Archify.view.reset()');
        await stable();
        const reset = await corner(`compact-legend-${width}-reset`);
        assert.ok(Math.abs(reset.nodeWidth - baseline.nodeWidth) <= 1);
        await evaluate('Archify.view.zoomIn()');
        await stable();
        assert.equal((await snapshot(`compact-legend-${width}-125`)).legendCorner, false,
          'Camera enlargement restores existing in-SVG positioning and clipping');
        await evaluate('Archify.view.reset()');
        await stable();
        await corner(`compact-legend-${width}-after-enlarge`);
      }
      await load(compactErd);
      const hit = await evaluate(`(function () {
        var rect = document.querySelector('[data-legend] .er-legend-hit').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      async function keyHighlighted(highlighted = true) {
        return evaluate(`(async function () {
          var row = document.querySelector('[data-er-row]:not(:has([data-er-badge="pk"]))');
          // Input changes the existing opacity transition; observe its result
          // after animation frames rather than expecting an immediate repaint.
          for (var i = 0; i < 30; i += 1) {
            var opacity = Number(getComputedStyle(row).opacity);
            if (${highlighted ? 'opacity < 0.3' : 'opacity >= 0.99'}) return true;
            await new Promise(function (resolve) { requestAnimationFrame(resolve); });
          }
          return false;
        })()`, true);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hit });
      assert.ok(await keyHighlighted(),
        'Hovering the relocated real ERD legend highlights matching key rows');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      assert.ok(await keyHighlighted(false), 'Moving away restores ordinary row paint');
      await evaluate("document.querySelector('[data-legend] .er-legend-hit').focus({ preventScroll: true })");
      assert.ok(await keyHighlighted(),
        'Keyboard focus retains same-SVG ERD key highlighting');
      await evaluate('document.activeElement.blur()');
      await evaluate(`document.querySelector('[data-legend]').setAttribute('transform', 'translate(3 4)');
        Archify.view.zoomOut(); Archify.view.zoomOut(); Archify.view.zoomOut();`);
      await stable();
      await corner('compact-legend-authored-transform');
      assert.match((await exportLegend('compact-legend-export-authored-transform')).legendMarkup,
        /transform="translate\(3 4\)"/, 'Canonical export preserves an authored group transform');
      const marker = '<g data-legend="">';
      const original = fs.readFileSync(compactErd, 'utf8');
      assert.ok(original.includes(marker));
      const longLegend = path.join(scratch, 'compact-long-legend.html');
      // A wider, multi-row legend must use its existing position when the
      // available bottom corner would overlap the navigation dock.
      fs.writeFileSync(longLegend, original.replace(marker,
        marker + '<rect x="30" y="220" width="600" height="50" fill="none" stroke="none"/>'));
      await load(longLegend);
      const constrained = await snapshot('compact-long-legend-fallback');
      assert.equal(constrained.readerArea, 'true');
      assert.equal(constrained.legendCorner, false);
      assert.equal(constrained.legendTransformRuntime, '');
    });
    await t.test('zero-size SVG clears corner legend placement and recovers without nonfinite transforms', async () => {
      await load(compactErd, { width: 1440, height: 900 });
      assert.equal((await snapshot('legend-size-initial')).legendCorner, true);
      for (const collapse of ["svg.style.height = '0px'", "svg.style.width = '0px'; svg.style.minWidth = '0px'"]) {
        const collapsed = await evaluate(`(() => {
          const svg = document.querySelector('.diagram-container > svg');
          ${collapse};
          Archify.readerLayout.syncLegend();
          const legend = svg.querySelector('[data-legend]');
          return { width: svg.clientWidth, height: svg.clientHeight, corner: legend.hasAttribute('data-reader-legend-corner'),
            transform: legend.style.getPropertyValue('--archify-reader-legend-transform') };
        })()`);
        assert.ok(collapsed.width === 0 || collapsed.height === 0);
        assert.equal(collapsed.corner, false);
        assert.equal(collapsed.transform, '');
        records.push({ label: 'legend-size-collapsed', ...collapsed });
        await evaluate(`(() => { const svg = document.querySelector('.diagram-container > svg');
          svg.style.removeProperty('height'); svg.style.removeProperty('width'); svg.style.removeProperty('min-width');
          Archify.readerLayout.syncLegend(); })()`);
        await stable();
        assert.equal((await snapshot('legend-size-restored')).legendCorner, true);
      }
    });
    await t.test('compact real ERD keeps the normal canvas while SVG enlargement remains capped', async () => {
      const original = fs.readFileSync(compactErd, 'utf8');
      const uncapped = path.join(scratch, 'compact-table-uncapped-control.html');
      // Keep identical automatic eligibility and authored geometry; only remove
      // the SVG enlargement cap to establish the normal outer reader area.
      assert.ok(original.includes('var MAX_AUTOMATIC_SCALE = 1.5;'));
      fs.writeFileSync(uncapped, original.replace('var MAX_AUTOMATIC_SCALE = 1.5;',
        'var MAX_AUTOMATIC_SCALE = Infinity;'));
      async function area() {
        return evaluate(`(function () {
          var budget = Archify.readerLayout.measure();
          var diagram = document.querySelector('.diagram-container');
          var svg = diagram.querySelector(':scope > svg');
          var rect = diagram.getBoundingClientRect();
          var svgRect = svg.getBoundingClientRect();
          var style = getComputedStyle(diagram);
          var left = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          var right = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
          var top = rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
          var bottom = rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
          var bodyStyle = getComputedStyle(document.body);
          return { width: rect.width, height: rect.height, svgWidth: svg.clientWidth,
            intrinsicWidth: svg.viewBox.baseVal.width, budget,
            chromeX: rect.width - (right - left),
            chromeY: rect.height - (bottom - top),
            viewportWidth: innerWidth,
            bodyX: parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight),
            readerArea: document.documentElement.getAttribute('data-reader-area'),
            minimumAreaHeight: document.documentElement.style.getPropertyValue('--archify-diagram-min-height'),
            stageRail: document.documentElement.getAttribute('data-nav-stage-rail'),
            navReserve: style.getPropertyValue('--archify-nav-reserve'),
            centerX: (svgRect.left + svgRect.right - left - right) / 2,
            centerY: (svgRect.top + svgRect.bottom - top - bottom) / 2 };
        })()`);
      }
      for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
        await load(uncapped, { width, height });
        const normal = await area();
        await load(compactErd, { width, height });
        const fitted = await area();
        records.push({ label: `compact-table-${width}-canvas`, normal, fitted });
        assert.equal(normal.readerArea, null, 'uncapped automatic canvas retains ordinary document flow');
        assert.equal(normal.minimumAreaHeight, '');
        assert.equal(fitted.readerArea, 'true', 'a binding cap keeps its normal outer reader area');
        // Navigation may switch between an external rail and in-canvas controls
        // when the SVG shrinks. Both regions must keep their own normal viewport
        // budget; the enlargement cap must affect only the SVG.
        for (const region of [normal, fitted]) {
          const desiredWidth = region.budget.availableSvgHeight * region.budget.ratio + region.chromeX;
          const expectedWidth = Math.max(960, Math.min(1920, region.viewportWidth - region.bodyX, desiredWidth));
          assert.ok(Math.abs(region.width - Math.round(expectedWidth)) <= 1, JSON.stringify(region));
          assert.ok(Math.abs(region.height - region.budget.availableSvgHeight - region.chromeY) <= 1, JSON.stringify(region));
        }
        assert.ok(fitted.width > 960 && fitted.height > height * 0.75, JSON.stringify(fitted));
        assert.ok(fitted.svgWidth <= fitted.intrinsicWidth * 1.5 + 1, JSON.stringify(fitted));
        assert.ok(Math.abs(fitted.centerX) <= 1 && Math.abs(fitted.centerY) <= 1, JSON.stringify(fitted));
        const geometry = (await snapshot(`compact-table-${width}`)).geometry;
        await evaluate('Archify.view.zoomOut()');
        await stable();
        const zoomed = await area();
        records.push({ label: `compact-table-${width}-zoomed-canvas`, zoomed });
        assert.ok(Math.abs(zoomed.centerX) <= 1 && Math.abs(zoomed.centerY) <= 1, JSON.stringify(zoomed));
        assert.ok(Math.abs(zoomed.height - fitted.height) <= 1 && Math.abs(zoomed.width - fitted.width) <= 1);
        await evaluate('Archify.view.reset()');
        await stable();
        assert.deepEqual((await snapshot(`compact-table-${width}-reset`)).geometry, geometry);
      }
    });

    await t.test('automatic compact ERD clears its reader area in specialized modes and restores it on return', async () => {
      await load(compactErd);
      async function restored(label) {
        const state = await snapshot(label);
        assert.equal(state.active, true);
        assert.equal(state.readerArea, 'true');
        assert.match(state.minimumAreaHeight, /^[\d.]+px$/);
      }
      await restored('compact-area-initial');
      await evaluate("document.documentElement.setAttribute('data-embed', 'true')");
      await stable();
      inactive(await snapshot('compact-area-embed'), false);
      await evaluate("document.documentElement.removeAttribute('data-embed')");
      await stable();
      await restored('compact-area-after-embed');
      await evaluate('Archify.presentation.enter()');
      await stable();
      inactive(await snapshot('compact-area-presentation'), false);
      await evaluate('Archify.presentation.exit()');
      await stable();
      await restored('compact-area-after-presentation');
      await media('dark', false, true);
      await stable();
      inactive(await snapshot('compact-area-print'), false);
      await media('dark');
      await stable();
      await restored('compact-area-after-print');
    });

    await t.test('compact ERD resize clears and restores its area across desktop eligibility and binding cap boundaries', async () => {
      await load(compactErd);
      const initial = await snapshot('compact-resize-initial');
      assert.equal(initial.readerArea, 'true');
      await viewport(1023, 900);
      await stable();
      const narrow = await snapshot('compact-resize-ineligible');
      inactive(narrow, false);
      assert.deepEqual(narrow.geometry, initial.geometry);
      await viewport(1440, 900);
      await stable();
      const desktop = await snapshot('compact-resize-eligible');
      assert.equal(desktop.readerArea, 'true');
      assert.deepEqual(desktop.geometry, initial.geometry);
      // The same desktop width at a short viewport height already fits this
      // graph below its enlargement cap; that ordinary flow needs no area floor.
      await viewport(1440, 360);
      await stable();
      const uncapped = await snapshot('compact-resize-nonbinding');
      assert.equal(uncapped.active, true);
      assert.equal(uncapped.readerArea, null);
      assert.equal(uncapped.minimumAreaHeight, '');
      assert.deepEqual(uncapped.geometry, initial.geometry);
      await viewport(1440, 900);
      await stable();
      const capped = await snapshot('compact-resize-binding');
      assert.equal(capped.readerArea, 'true');
      assert.match(capped.minimumAreaHeight, /^[\d.]+px$/);
      assert.deepEqual(capped.geometry, initial.geometry);
    });

    await t.test('automatic width-first content favors reading width while small canvases cap enlargement', async () => {
      function readerFixture(name, width, height, attributes) {
        const original = fs.readFileSync(artifacts.architecture, 'utf8');
        const svgStart = original.indexOf('<svg');
        const svgEnd = original.indexOf('</svg>', svgStart) + '</svg>'.length;
        assert.ok(svgStart >= 0 && svgEnd > svgStart);
        const rows = height > 1000 ? 48 : 4;
        const rowMarkup = Array.from({ length: rows }, (_, index) => {
          const y = 20 + index * (height - 60) / rows;
          return `<g data-node-id="reader-row-${index}">
            <rect x="20" y="${y}" width="${width - 40}" height="36" fill="var(--backend-fill)" stroke="var(--backend-stroke)"/>
            <text data-node-label="" x="30" y="${y + 24}" class="t-primary" font-size="14">Reader row ${index + 1}</text>
          </g>`;
        }).join('\n');
        const svg = `<svg viewBox="0 0 ${width} ${height}" ${attributes}>${rowMarkup}</svg>`;
        const file = path.join(scratch, `${name}.html`);
        fs.writeFileSync(file, original.slice(0, svgStart) + svg + original.slice(svgEnd));
        return file;
      }
      const samples = [
        // Family names do not alter this synthetic SVG. Real sequence and
        // waterfall declarations are exercised by the following renderer case.
        ['width-first-tall', 1100, 2400, 'width-first'],
        ['small-erd', 456, 270, 'intrinsic-height'],
      ];
      for (const [name, width, height, fit] of samples) {
        const file = readerFixture(name, width, height,
          `data-reader-fit="${fit}" data-reader-min-text="7.5"`);
        for (const [viewportWidth, viewportHeight] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
          await load(file, { width: viewportWidth, height: viewportHeight });
          const before = await snapshot(`${name}-${viewportWidth}`);
          const dimensions = await evaluate(`(function () {
            var svg = document.querySelector('.diagram-container > svg');
            var diagram = svg.parentElement;
            var style = getComputedStyle(diagram);
            var startY = diagram.getBoundingClientRect().top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
            return { width: svg.clientWidth, height: svg.clientHeight,
              startOffsetY: svg.getBoundingClientRect().top - startY,
              readerArea: document.documentElement.getAttribute('data-reader-area'),
              minimumAreaHeight: document.documentElement.style.getPropertyValue('--archify-diagram-min-height'),
              primaryPx: 14 * svg.clientWidth / svg.viewBox.baseVal.width,
              overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1 };
          })()`);
          assert.equal(before.active, true);
          if (evidence && (viewportWidth === 1440 || viewportWidth === 2048)) {
            const capture = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(evidence, `${name}-${viewportWidth}-reading.png`), Buffer.from(capture.data, 'base64'));
          }
          assert.equal(dimensions.overflowX, false, JSON.stringify(dimensions));
          assert.ok(dimensions.width <= width * 1.5 + 1, JSON.stringify(dimensions));
          if (dimensions.width < width * 1.5 - 1) {
            assert.equal(dimensions.readerArea, null, 'nonbinding automatic cap preserves natural document flow');
            assert.equal(dimensions.minimumAreaHeight, '');
          }
          if (name === 'small-erd') {
            assert.ok(dimensions.width >= 456, JSON.stringify(dimensions));
            assert.ok(before.shellWidth >= 960, JSON.stringify(before));
          } else {
            assert.ok(dimensions.width >= 1250, JSON.stringify(dimensions));
            assert.ok(dimensions.primaryPx >= 14, JSON.stringify(dimensions));
            assert.ok(before.scrollHeight > before.innerHeight);
            assert.ok(Math.abs(dimensions.startOffsetY) <= 1, 'long content begins at the normal canvas top: ' + JSON.stringify(dimensions));
            assert.equal(before.overflow, 'authored');
          }
          await evaluate('Archify.view.zoomIn(); Archify.view.reset()');
          await stable();
          assert.deepEqual((await snapshot(`${name}-${viewportWidth}-reset`)).geometry, before.geometry);
          await evaluate('Archify.presentation.enter()');
          await stable();
          const presentation = await snapshot(`${name}-${viewportWidth}-presentation`);
          inactive(presentation, width / height >= 1.55);
          const stage = await evaluate(`(function () {
            var rect = document.querySelector('.diagram-container > svg').getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: innerHeight };
          })()`);
          assert.ok(stage.top >= 0 && stage.bottom <= stage.height + 1, JSON.stringify(stage));
          if (evidence && viewportWidth === 1440) {
            const capture = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(evidence, `${name}-${viewportWidth}-presentation.png`), Buffer.from(capture.data, 'base64'));
          }
          await evaluate('Archify.presentation.exit()');
          await stable();
          assert.deepEqual((await snapshot(`${name}-${viewportWidth}-return`)).geometry, before.geometry);
        }
      }
      // UI and column metadata alone never declare automatic Reader fitting.
      for (const marker of ['data-sequence-column-fit="fixed"', 'data-waterfall-ui=""', '']) {
        const authored = readerFixture('undeclared-reader', 1100, 2400, marker);
        await load(authored);
        inactive(await snapshot('undeclared-reader'), false);
        const heightFit = readerFixture('height-fit-reader', 1100, 2400, `data-reader-fit="intrinsic-height" ${marker}`);
        await load(heightFit);
        const state = await snapshot('height-fit-reader');
        assert.equal(state.active, true);
        assert.ok(state.receipt.width < 1200, 'intrinsic fitting stays independent of family markers');
      }
      const authoredSmall = readerFixture('authored-small', 456, 270, '');
      await load(authoredSmall, { width: 2048, height: 1320 });
      assert.ok(await evaluate("document.querySelector('.diagram-container > svg').clientWidth > 456 * 1.5"),
        'an authored canvas retains its previous enlargement behavior');
    });
    await t.test('compact automatic Sequence fits the initial desktop stage without shrinking source text', async () => {
      const compact = JSON.parse(fs.readFileSync(path.resolve(skillRoot,
        '../test/fixtures/reader-readability/compact-roundtrip.sequence.json'), 'utf8'));
      // Wrapped notes need 6px more room before the Accepted label. Preserve
      // all annotations and the remaining timeline while exercising Reader fit.
      compact.messages.find(message => message.id === 'accepted').y = 236;
      function renderSequence(name, doc) {
        const input = path.join(scratch, `${name}.json`);
        const output = path.join(scratch, `${name}.html`);
        fs.writeFileSync(input, JSON.stringify(doc));
        execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'sequence', input, output]);
        return output;
      }
      async function stage(label) {
        const value = await evaluate(`(function () {
          var svg = document.querySelector('.diagram-container > svg');
          function bounds(element) {
            var rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
          }
          var textScales = Array.from(svg.querySelectorAll('text')).map(function (text) {
            var matrix = text.getScreenCTM();
            return Math.hypot(matrix.a, matrix.b);
          });
          var legend = svg.querySelector('[data-legend]');
          var legendRect = legend.getBoundingClientRect();
          var containerRect = svg.parentElement.getBoundingClientRect();
          var containerStyle = getComputedStyle(svg.parentElement);
          var navRect = document.querySelector('.diagram-nav').getBoundingClientRect();
          return { svg: bounds(svg), stage: bounds(svg.parentElement),
            controls: bounds(document.querySelector('.diagram-nav')),
            legend: { corner: legend.hasAttribute('data-reader-legend-corner'),
              bounds: bounds(legend),
              originalSvg: legend.ownerSVGElement === svg, count: document.querySelectorAll('[data-legend]').length,
              leftGap: legendRect.left - containerRect.left - parseFloat(containerStyle.borderLeftWidth) - parseFloat(containerStyle.paddingLeft),
              bottomGap: containerRect.bottom - parseFloat(containerStyle.borderBottomWidth) - parseFloat(containerStyle.paddingBottom) - legendRect.bottom,
              navOverlap: Math.max(0, Math.min(navRect.right, legendRect.right) - Math.max(navRect.left, legendRect.left)) *
                Math.max(0, Math.min(navRect.bottom, legendRect.bottom) - Math.max(navRect.top, legendRect.top)) },
            width: svg.clientWidth, sourceWidth: svg.viewBox.baseVal.width,
            minimumTextScale: Math.min.apply(Math, textScales),
            viewportWidth: innerWidth, viewportHeight: innerHeight,
            geometry: ['viewBox', 'width', 'height'].map(function (name) { return svg.getAttribute(name); }) };
        })()`);
        records.push({ label, ...value });
        return value;
      }
      function fits(value) {
        for (const region of [value.svg, value.stage, value.controls]) {
          assert.ok(region.top >= -1 && region.bottom <= value.viewportHeight + 1 &&
            region.left >= -1 && region.right <= value.viewportWidth + 1, JSON.stringify(value));
        }
        assert.ok(value.minimumTextScale >= 1 - 0.01, 'initial fitting must retain source text size: ' + JSON.stringify(value));
        assert.ok(value.width <= value.sourceWidth * 1.5 + 1, 'automatic enlargement remains capped: ' + JSON.stringify(value));
      }
      function legendPlacement(value, corner) {
        assert.equal(value.legend.corner, corner, JSON.stringify(value));
        assert.equal(value.legend.originalSvg, true, 'legend remains in the original SVG');
        assert.equal(value.legend.count, 1, 'legend is never duplicated');
        if (corner) {
          assert.ok(Math.abs(value.legend.leftGap) <= 1 && Math.abs(value.legend.bottomGap) <= 1,
            'legend sits in the outer stage padding corner: ' + JSON.stringify(value));
          assert.equal(value.legend.navOverlap, 0, 'legend must not overlap navigation');
        }
      }
      async function exportedLegend() {
        return evaluate(`(async function () {
          var svg = document.querySelector('.diagram-container > svg');
          var before = svg.outerHTML, original = URL.createObjectURL, captured;
          URL.createObjectURL = function (blob) {
            if (blob.type.indexOf('image/svg+xml') === 0) captured = blob;
            return original.call(URL, blob);
          };
          try {
            await Archify.exportMenu.run('svg');
            var text = await captured.text();
            var clone = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
            return { legend: clone.querySelector('[data-legend]').outerHTML.replace(' style=""', ''),
              geometry: ['viewBox', 'width', 'height'].map(function (name) { return clone.getAttribute(name); }),
              count: clone.querySelectorAll('[data-legend]').length, liveUnchanged: before === svg.outerHTML,
              runtime: Boolean(clone.querySelector('[data-reader-legend-corner]')) || text.includes('--archify-reader-legend-transform') };
          } finally { URL.createObjectURL = original; }
        })()`, true);
      }
      const file = renderSequence('compact-roundtrip', compact);
      await load(file, { width: 1396, height: 540 });
      const canonical = await exportedLegend();
      assert.equal(canonical.count, 1);
      assert.equal(canonical.liveUnchanged, true);
      assert.equal(canonical.runtime, false);
      await load(file, { width: 1396, height: 830 });
      const initial = await stage('compact-sequence-initial');
      fits(initial);
      legendPlacement(initial, true);
      if (evidence) {
        assert.equal(await evaluate('scrollY'), 0, 'initial screenshot uses the top of the document');
        assert.equal(await evaluate('Archify.view.state().scale'), 1);
        const capture = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(evidence, 'compact-sequence-initial.png'), Buffer.from(capture.data, 'base64'));
      }
      assert.deepEqual(await exportedLegend(), canonical, 'initial fitting exports canonical geometry and legend placement');
      assert.ok((await snapshot('compact-sequence-shell')).shellWidth >= 960, 'height fitting preserves the desktop shell');
      await evaluate('Archify.view.zoomIn(); Archify.view.zoomIn()');
      await stable();
      const zoomed = await stage('compact-sequence-legend-150');
      assert.equal(await evaluate('Archify.view.state().scale'), 1.5);
      legendPlacement(zoomed, false);
      assert.deepEqual(zoomed.geometry, initial.geometry);
      assert.deepEqual(await exportedLegend(), canonical, 'zoom exports canonical legend placement without changing live SVG');
      await evaluate('Archify.view.reset()');
      await stable();
      const reset = await stage('compact-sequence-legend-reset');
      fits(reset);
      legendPlacement(reset, true);
      assert.deepEqual(reset.geometry, initial.geometry);
      await viewport(1396, 540);
      await stable();
      const short = await stage('compact-sequence-short-window');
      assert.ok(short.stage.bottom > short.viewportHeight, 'insufficient height retains page scrolling');
      assert.ok(short.minimumTextScale >= 1 - 0.01, 'short windows do not shrink source text');
      assert.ok(short.width >= initial.width, 'short windows recover reading width');
      await viewport(1396, 830);
      await stable();
      const resizedBack = await stage('compact-sequence-resized-back');
      fits(resizedBack);
      legendPlacement(resizedBack, true);
      await evaluate('Archify.presentation.enter()');
      await stable();
      const presented = await stage('compact-sequence-presentation');
      legendPlacement(presented, false);
      assert.deepEqual(presented.geometry, initial.geometry);
      assert.deepEqual(await exportedLegend(), canonical, 'presentation exports canonical legend placement');
      assert.ok(presented.svg.top >= -1 && presented.svg.bottom <= presented.viewportHeight + 1, JSON.stringify(presented));
      await evaluate('Archify.presentation.exit()');
      await stable();
      const returned = await stage('compact-sequence-return');
      fits(returned);
      legendPlacement(returned, true);
      assert.deepEqual(returned.geometry, initial.geometry, 'fitting never rewrites authored SVG geometry');
      await media('dark', false, true);
      await stable();
      const printed = await stage('compact-sequence-print');
      legendPlacement(printed, false);
      assert.deepEqual(printed.geometry, initial.geometry);
      assert.deepEqual(await exportedLegend(), canonical, 'print exports canonical legend placement');
      await media();
      await stable();
      legendPlacement(await stage('compact-sequence-print-return'), true);

      const wide = { ...compact, segments: [], cards: [],
        messages: [{ from: 'client', to: 'worker', y: 160, label: 'Check status' }] };
      await load(renderSequence('short-wide-sequence', wide), { width: 1396, height: 480 });
      const shortWide = await stage('short-wide-sequence');
      assert.ok(shortWide.sourceWidth < 960 && shortWide.sourceWidth /
        Number(shortWide.geometry[0].split(/\s+/)[3]) >= 1.55, 'exercise a small wide canvas');
      fits(shortWide);

      const long = { ...compact, segments: [], cards: [], messages: Array.from({ length: 20 }, (_, index) => ({
        from: index % 2 ? 'service' : 'client', to: index % 2 ? 'client' : 'service',
        y: 160 + index * 100, label: `Message ${index + 1}`,
      })) };
      await load(renderSequence('long-automatic-sequence', long), { width: 1396, height: 830 });
      const reading = await stage('long-automatic-sequence');
      assert.ok(reading.stage.bottom > reading.viewportHeight, 'long automatic Sequence retains page scrolling');
      assert.ok(reading.minimumTextScale >= 1 - 0.01, 'long Sequence preserves readable text');
      assert.ok(reading.width >= reading.sourceWidth * 1.4, 'long Sequence retains reading-width enlargement');

      const explicit = structuredClone(compact);
      explicit.meta.viewBox = initial.geometry[0].split(/\s+/).slice(2).map(Number);
      await load(renderSequence('explicit-roundtrip', explicit), { width: 1396, height: 830 });
      const authored = await stage('explicit-roundtrip');
      assert.deepEqual(authored.geometry, initial.geometry);
      assert.equal((await snapshot('explicit-sequence')).readerFit, null, 'explicit canvases retain their previous eligibility');
      assert.ok(authored.stage.bottom > authored.viewportHeight, 'explicit geometry retains its original desktop layout');
    });

    await t.test('public renderers declare automatic reading width while undeclared canvases retain their fit', async () => {
      const sequence = { schema_version: 1, diagram_type: 'sequence', meta: { title: 'Reader sequence', output: 'reader-sequence.html' },
        participants: [{ id: 'a', type: 'external', label: 'Client' }, { id: 'b', type: 'backend', label: 'Server' }],
        messages: [{ from: 'a', to: 'b', y: 160, label: 'ping' }] };
      const waterfall = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/checkout-request.waterfall.json'), 'utf8'));
      const workflow = { schema_version: 2, diagram_type: 'workflow',
        meta: { title: 'Reader stacked workflow', output: 'reader-workflow.html', legend: { mode: 'hidden' } },
        lanes: [{ id: 'runtime', label: 'Runtime' }],
        nodes: [-180, -90, 0, 90, 180].map((yOffset, index) => ({
          id: `stage-${index}`, lane: 'runtime', col: 2, type: 'backend', label: `Stage ${index + 1}`, yOffset,
        })), edges: [] };
      for (const [mode, doc] of [['sequence', sequence], ['waterfall', waterfall], ['workflow', workflow]]) {
        const input = path.join(scratch, `${mode}-automatic.json`);
        const output = path.join(scratch, `${mode}-automatic.html`);
        fs.writeFileSync(input, JSON.stringify(doc));
        execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', mode, input, output]);
        const html = fs.readFileSync(output, 'utf8');
        assert.match(html.match(/<svg\b[^>]*>/)[0], /data-reader-fit="width-first"/);
        await load(output);
        const declared = await snapshot(`${mode}-automatic`);
        assert.equal(declared.active, true);
        assert.equal(declared.readerFit, 'width-first');
        const undeclared = path.join(scratch, `${mode}-undeclared.html`);
        fs.writeFileSync(undeclared, html.replace(' data-reader-fit="width-first"', ''));
        await load(undeclared);
        const fallback = await snapshot(`${mode}-undeclared`);
        assert.deepEqual(fallback.geometry, declared.geometry);
        if (declared.receipt.ratio < 1.55) inactive(fallback, false);
        else assert.ok(fallback.receipt.width <= declared.receipt.width);
        for (const query of ['&embed=1', '&present=1']) {
          await load(output, { query });
          const alternate = await snapshot(`${mode}-${query}`);
          inactive(alternate, declared.receipt.ratio >= 1.55);
          assert.deepEqual(alternate.geometry, declared.geometry);
        }
        await load(output, { print: true });
        const printed = await snapshot(`${mode}-print`);
        inactive(printed, declared.receipt.ratio >= 1.55);
        assert.deepEqual(printed.geometry, declared.geometry);
        await media();
      }
    });
    await t.test('desktop budgets, extreme content and limited horizontal space preserve geometry', async () => {
      for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
        await load(wide, { width, height });
        const state = await snapshot(`desktop-${width}x${height}`);
        assert.equal(state.active, true);
        assert.ok(state.receipt.width >= 960 && state.receipt.width <= Math.min(width, 1920));
      }
      await load(wide, { width: 2048, height: 3000 });
      assert.equal((await snapshot('maximum-width')).receipt.width, 1920);
      await evaluate(`document.body.style.paddingLeft = '100px'; document.body.style.paddingRight = '100px'`);
      await viewport(1024, 900);
      await stable();
      assert.equal((await snapshot('available-width-below-floor')).receipt.width, 824);
      await load(wide, { width: 1440, height: 300 });
      const geometry = (await snapshot('short-window')).geometry;
      await evaluate(`document.querySelector('.header').style.minHeight = '1000px';
        document.querySelector('.cards').innerHTML = '<div style="height:1200px">Long content</div>'`);
      await stable();
      const overflow = await snapshot('long-content');
      // The summary rail moves cards beside the diagram, so its width joins the readable floor.
      const rail = await evaluate(`document.documentElement.getAttribute('data-reader-rail') === 'true'`);
      assert.equal(overflow.receipt.width, rail ? 960 + 288 + 20 : 960);
      assert.equal(overflow.overflow, 'authored');
      assert.ok(overflow.scrollHeight > overflow.innerHeight);
      assert.deepEqual(overflow.geometry, geometry);
    });

    await t.test('embed, presentation and print return to ordinary layout without clearing shape', async () => {
      for (const mode of ['embed', 'present', 'print']) {
        await load(wide, { query: mode === 'print' ? '' : `&${mode}=1`, print: mode === 'print' });
        inactive(await snapshot(`initial-${mode}`));
        if (mode === 'print') await media();
        else if (mode === 'present') await evaluate('Archify.presentation.exit()');
        else await evaluate("document.documentElement.removeAttribute('data-embed')");
        await stable();
        assert.equal((await snapshot(`exit-${mode}`)).active, true);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (mode === 'print') await media('dark', false, true);
          else if (mode === 'present') await evaluate('Archify.presentation.enter()');
          else await evaluate("document.documentElement.setAttribute('data-embed', 'true')");
          await stable();
          inactive(await snapshot(`enter-${mode}-${attempt}`));
          if (mode === 'print') await media();
          else if (mode === 'present') await evaluate('Archify.presentation.exit()');
          else await evaluate("document.documentElement.removeAttribute('data-embed')");
          await stable();
          assert.equal((await snapshot(`return-${mode}-${attempt}`)).active, true);
        }
      }
    });

    await t.test('content observers and burst scheduling converge while camera state remains usable', async () => {
      await load(wide, { width: 1920, height: 1080 });
      const before = await snapshot('before-content');
      await evaluate(`document.querySelector('.header h1').textContent = 'Long reader title '.repeat(30);
        document.querySelector('.cards').innerHTML += '<div class="card" style="height:500px">Late card</div>';
        for (var i = 0; i < 30; i += 1) { dispatchEvent(new Event('resize')); Archify.readerLayout.schedule(); }
        Archify.view.zoomIn();`);
      await stable();
      const changed = await snapshot('after-content');
      assert.ok(changed.receipt.width <= before.receipt.width);
      assert.deepEqual(changed.geometry, before.geometry);
      await evaluate('Archify.view.reset()');
      await stable();
      const first = await snapshot('settled-1');
      await stable();
      assert.deepEqual(await snapshot('settled-2'), first);
    });

    await t.test('optional content and browser interfaces retain their fallback behavior', async () => {
      const file = variant('optional', { ratio: 3, beforeViewer: `
        document.querySelector('.cards').remove();
        // Other Viewer modules require the chapter control IDs. Only remove
        // Reader's optional layout selector, keeping those controls available.
        document.querySelector('.guided-views')?.classList.remove('guided-views');
        window.ResizeObserver = undefined;
        window.MutationObserver = undefined;
        Object.defineProperty(document, 'fonts', { value: undefined });
      ` });
      await load(file);
      assert.equal((await snapshot('optional-interfaces-absent')).active, true);
      await viewport(1023, 900);
      await stable();
      inactive(await snapshot('optional-resize-out'));
      await viewport(1440, 900);
      await stable();
      assert.equal((await snapshot('optional-resize-back')).active, true);
    });

    await t.test('font readiness gates sampling and pending-frame timeout remains explicit', async () => {
      const delayedFonts = variant('delayed-fonts', { ratio: 3, beforeViewer: `
        window.readerTestOriginalFonts = document.fonts;
        Object.defineProperty(document, 'fonts', { configurable: true, value: {
          ready: new Promise(function (resolve) { window.readerTestReleaseFonts = resolve; })
        } });
      ` });
      await load(delayedFonts, { waitForLayout: false });
      const fontGate = await evaluate(`(async function () {
        var resolved = false;
        var ready = Archify.readerLayout.whenStable().then(function () { resolved = true; });
        document.querySelector('.cards').style.minHeight = '450px';
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        var beforeReady = resolved;
        readerTestReleaseFonts();
        await ready;
        Object.defineProperty(document, 'fonts', { configurable: true, value: readerTestOriginalFonts });
        return { beforeReady: beforeReady, afterReady: resolved };
      })()`, true);
      assert.deepEqual(fontGate, { beforeReady: false, afterReady: true });
      await stable();
      assert.equal((await snapshot('delayed-fonts-and-content')).active, true);
      await load(wide);
      const result = await evaluate(`(async function () {
        var original = document.fonts;
        var release;
        var scheduled = 0;
        Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(function (resolve) { release = resolve; }) } });
        try {
          var waiting = Archify.waitForStableLayout({ maximumFrames: 1, schedule: function () { scheduled += 1; }, pending: function () { return true; } });
          var observed = waiting.then(function () { return 'unexpected success'; }, function (error) { return error.message; });
          await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
          var beforeReady = scheduled;
          release();
          return { beforeReady: beforeReady, outcome: await observed, afterReady: scheduled };
        } finally { Object.defineProperty(document, 'fonts', { configurable: true, value: original }); }
      })()`, true);
      assert.equal(result.beforeReady, 0);
      assert.equal(result.afterReady, 1);
      assert.match(result.outcome, /did not reach stable dimensions/);
      await stable();
    });
  } finally {
    if (evidence) fs.writeFileSync(path.join(evidence, 'reader-observations.json'), `${JSON.stringify(records, null, 2)}\n`);
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
