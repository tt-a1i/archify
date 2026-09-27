import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}
// Full edge labels have real room: caller/listener gap 90px and
// queue/worker gap 105px. Readability must not rely on detached label masks.
const fixtureJson = path.join(root, 'test/fixtures/reader-readability/synthetic-wide.architecture.json');

test('declared wide synthetic reader preserves geometry and reaches edge/node readability', {
  skip: chromePath ? false :
    'Set ARCHIFY_CHROME to run the maintained real browser regression.',
}, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-readability-'));
  const artifact = path.join(scratch, 'synthetic-wide.html');
  try {
    execFileSync(process.execPath, [
      path.join(root, 'bin', 'archify.mjs'), 'deliver', 'architecture', fixtureJson, artifact,
      '--quality', 'showcase',
    ], { cwd: root, stdio: 'pipe' });
    const artifactSource = fs.readFileSync(artifact, 'utf8');
    const svgStart = artifactSource.indexOf('<svg');
    const svgEnd = artifactSource.indexOf('</svg>', svgStart) + '</svg>'.length;
    assert.ok(svgStart >= 0 && svgEnd > svgStart, 'generated artifact must contain a canonical SVG');
    const canonicalSvg = artifactSource.slice(svgStart, svgEnd);
    assert.match(canonicalSvg, /viewBox="0 0 1428 706"/);
    const tallArtifact = path.join(scratch, 'synthetic-wide-tall.html');
    // With the fixture's 9px minimum label, 2300x1600 yields 1946.67px of
    // reader width, below the 1984px viewport reserve but above the 1920px
    // new-wide cap. This keeps the explicit legacy-width guard meaningful.
    fs.writeFileSync(tallArtifact, artifactSource.replace('viewBox="0 0 1428 706"', 'viewBox="0 0 2300 1600"'));

    const browser = new ChromeVisualBrowser(chromePath);
    try {
      const session = await browser.sessionPromise;
      const send = (method, params = {}) => browser.cdp.send(method, params, session);
      const evaluate = async (expression, awaitPromise = false) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
        return result.result?.value;
      };
      await send('Browser.setDownloadBehavior', { behavior: 'deny' });
      async function stable() {
        await evaluate(`(async function () {
          for (var i = 0; i < 2; i += 1) {
            await Archify.readerLayout.whenStable();
            await Archify.viewerChromeLayout.whenStable();
          }
        })()`, true);
      }
      async function load(width, height, theme = 'dark', query = '', print = false, file = artifact) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setEmulatedMedia', { media: print ? 'print' : '', features: [
          { name: 'prefers-color-scheme', value: theme },
        ] });
        const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
        const result = await send('Page.navigate', { url: pathToFileURL(file).href + `?theme=${theme}${query}` });
        assert.equal(result.errorText, undefined, result.errorText);
        await loaded;
        await evaluate(`(function () {
          if (Archify.view && Archify.view.reset) Archify.view.reset();
          if (Archify.motionGovernor && Archify.motionGovernor.setMode) {
            Archify.motionGovernor.setMode('still');
          }
        })()`);
        await stable();
      }
      async function snapshot() {
        return evaluate(`(function () {
          var html = document.documentElement;
          var svg = document.querySelector('.diagram-container > svg');
          var container = document.querySelector('.diagram-container');
          var box = svg.viewBox.baseVal;
          var width = svg.getBoundingClientRect().width;
          function projected(text) {
            return parseFloat(text.getAttribute('font-size')) * width / box.width;
          }
          var edge = Array.from(svg.querySelectorAll('g[data-detail="context"][data-edge-from][data-edge-to] > text'))
            .map(projected);
          var node = Array.from(svg.querySelectorAll(
            'text[data-node-label], text[data-boundary-label], text[data-detail="context"]'
          )).filter(function (text) {
            return text.getAttribute('data-detail') !== 'context' || text.closest('[data-node-id]');
          }).map(projected);
          var chrome = Archify.viewerChromeLayout.receipt();
          var camera = Archify.view.state();
          return {
            active: Archify.readerLayout.active(), receipt: Archify.readerLayout.receipt(),
            layout: html.getAttribute('data-reader-layout'), overflow: html.getAttribute('data-reader-overflow'),
            readerFit: svg.getAttribute('data-reader-fit'), minText: svg.getAttribute('data-reader-min-text'),
            geometry: ['viewBox', 'width', 'height'].map(function (name) { return svg.getAttribute(name); }),
            edgeCount: edge.length, nodeCount: node.length,
            edgeMinimum: edge.length ? Math.min.apply(Math, edge) : null,
            nodeMinimum: node.length ? Math.min.apply(Math, node) : null,
            edgeFinite: edge.length > 0 && edge.every(Number.isFinite),
            nodeFinite: node.length > 0 && node.every(Number.isFinite),
            overflowX: Math.max(html.scrollWidth, document.body.scrollWidth) > innerWidth,
            // Bottom notes and index sit below the fold by design.
            overflowY: Math.max(html.scrollHeight, document.body.scrollHeight) - (html.getAttribute('data-reader-rail') === 'bottom'
              ? document.getElementById('reader-rail').getBoundingClientRect().height + parseFloat(getComputedStyle(document.getElementById('reader-rail')).marginTop)
              : 0) > innerHeight + 1,
            theme: html.getAttribute('data-theme'), motion: html.getAttribute('data-motion'),
            motionMode: Archify.motionGovernor.mode(), detailLevel: container.getAttribute('data-detail-level'),
            cameraScale: camera.scale, cameraMode: camera.mode,
            viewPercent: document.querySelector('[data-view-percent]')?.textContent || null,
            chromeStageIntersectionArea: chrome.stageIntersectionArea,
            chromeIntersectionArea: chrome.intersectionArea,
            innerWidth: innerWidth, innerHeight: innerHeight,
          };
        })()`);
      }

      const viewports = [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]];
      for (const [width, height] of viewports) {
        for (const theme of width === 1440 ? ['dark', 'light'] : ['dark']) {
          await load(width, height, theme);
          const state = await snapshot();
          assert.equal(state.active, true);
          assert.equal(state.layout, 'adaptive');
          assert.equal(state.readerFit, 'intrinsic-height');
          assert.equal(state.minText, '7.5');
          assert.equal(state.edgeCount, 15, JSON.stringify(state));
          assert.ok(state.nodeCount > 0, JSON.stringify(state));
          assert.equal(state.edgeFinite, true, JSON.stringify(state));
          assert.equal(state.nodeFinite, true, JSON.stringify(state));
          assert.ok(state.edgeMinimum >= 7.5 - 0.01, JSON.stringify(state));
          assert.ok(state.nodeMinimum >= 7.5 - 0.01, JSON.stringify(state));
          assert.equal(state.overflowX, false, JSON.stringify(state));
          assert.equal(state.theme, theme, JSON.stringify(state));
          assert.equal(state.motionMode, 'still', JSON.stringify(state));
          if (state.motion !== null) assert.equal(state.motion, 'still', JSON.stringify(state));
          assert.equal(state.detailLevel, 'read', JSON.stringify(state));
          assert.equal(state.cameraScale, 1, JSON.stringify(state));
          assert.equal(state.viewPercent, '100%', JSON.stringify(state));
          assert.ok(Number.isFinite(state.chromeStageIntersectionArea));
          assert.ok(Number.isFinite(state.chromeIntersectionArea));
          assert.ok(state.chromeStageIntersectionArea <= 0, JSON.stringify(state));
          assert.ok(state.chromeIntersectionArea <= 0, JSON.stringify(state));
          assert.equal(state.geometry[0], '0 0 1428 706');
          if (state.overflowY) assert.equal(state.overflow, 'authored', JSON.stringify(state));
          if (width === 1440) assert.ok(state.receipt.width >= 1294, JSON.stringify(state));
          await stable();
          assert.deepEqual(await snapshot(), state, `${width}x${height} ${theme}: unstable reader`);
        }
      }

      await load(1024, 900);
      const physicallyCapped = await snapshot();
      assert.equal(physicallyCapped.active, true);
      assert.ok(physicallyCapped.receipt.width <= 1024, JSON.stringify(physicallyCapped));
      assert.equal(physicallyCapped.edgeCount, 15, JSON.stringify(physicallyCapped));
      assert.equal(physicallyCapped.edgeFinite, true, JSON.stringify(physicallyCapped));
      assert.ok(physicallyCapped.edgeMinimum < 7.5, 'a physical width cap must report the unmet declaration');
      assert.equal(physicallyCapped.overflowX, false, JSON.stringify(physicallyCapped));

      await load(2048, 1320, 'dark', '', false, tallArtifact);
      const legacyTall = await snapshot();
      assert.equal(legacyTall.active, true);
      assert.equal(legacyTall.geometry[0], '0 0 2300 1600');
      assert.ok(legacyTall.receipt.width > 1920, JSON.stringify(legacyTall));
      assert.ok(legacyTall.nodeMinimum >= 7.5 - 0.01, JSON.stringify(legacyTall));

      await load(1440, 900, 'dark', '&embed=1');
      assert.equal((await snapshot()).active, false, 'embed mode must bypass the adaptive reader');
      await load(1440, 900, 'dark', '&present=1');
      assert.equal((await snapshot()).active, false, 'presentation mode must bypass the adaptive reader');
      await load(1440, 900, 'dark', '', true);
      assert.equal((await snapshot()).active, false, 'print mode must bypass the adaptive reader');
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
