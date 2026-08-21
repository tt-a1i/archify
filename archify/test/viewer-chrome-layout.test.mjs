import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-chrome-layout-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return output;
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function load(browser, artifactPath, { width = 1440, height = 900 } = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(function () {
    document.documentElement.setAttribute('data-motion', 'still');
    return Archify.readerLayout.whenStable()
      .then(function () { return Archify.viewerChromeLayout.whenStable(); });
  })()`, true);
  return sessionId;
}

test('all typed renderers inherit one conditional Dock Safe Rail', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = fs.readFileSync(render(mode, example), 'utf8');
    assert.match(html, /--archify-nav-reserve: 0px/, mode);
    assert.match(html, /Archify\.viewerChromeLayout = \(function \(\)/, mode);
    assert.match(html, /var baselineNavRect = shifted\(navRect, -reserve\)/, mode);
    assert.match(html, /svgRect\.bottom \+ SAFE_GAP - baselineNavRect\.top/, mode);
    assert.match(html, /Archify\.readerLayout\.schedule\(\)/, mode);
    assert.match(html, /bottom: calc\(4\.15rem \+ var\(--archify-nav-reserve\)\)/, mode);
    assert.match(html, /bottom: calc\(1rem \+ var\(--archify-nav-reserve\)\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /nav-safe-rail|archify-nav-reserve|viewerChromeLayout/, mode);
  }
});

test('Dock Safe Rail preserves mobile, embed, presentation, print, and export boundaries', () => {
  const html = fs.readFileSync(render('architecture', CASES.architecture), 'utf8');
  assert.match(html, /html:not\(\[data-embed="true"\]\) \.diagram-container \{\s*padding: 0\.75rem 0\.75rem 4\.25rem;/);
  assert.match(html, /html\[data-embed="true"\] \.diagram-container \{[\s\S]*?padding: 0\.5rem;/);
  assert.match(html, /html\[data-present="true"\]:not\(\[data-embed="true"\]\) \.diagram-container \{[\s\S]*?padding: 0\.75rem;/);
  assert.match(html, /@media print \{[\s\S]*?\.diagram-container \{ --archify-nav-reserve: 0px !important; \}/);
  assert.doesNotMatch(canonicalSvg(html), /data-nav-safe-rail/);
});

test('Dock Safe Rail resolves a forced Legend collision across the shared diagram viewer', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const [mode, example] of Object.entries(CASES)) {
      const sessionId = await load(browser, render(mode, example));
      const receipt = await evaluate(browser, sessionId, `(function () {
        var nav = document.querySelector('.diagram-nav');
        var legendElement = document.querySelector('[data-legend]');
        if (!legendElement) {
          return {
            noLegend: true,
            runtime: Archify.viewerChromeLayout.receipt(),
            safeRail: document.querySelector('.diagram-container').getAttribute('data-nav-safe-rail')
          };
        }
        var initialLegend = legendElement.getBoundingClientRect();
        var containerRect = document.querySelector('.diagram-container').getBoundingClientRect();
        nav.style.right = 'auto';
        nav.style.left = Math.max(0, initialLegend.left - containerRect.left) + 'px';
        nav.style.bottom = Math.max(0, containerRect.bottom - initialLegend.bottom) + 'px';
        nav.style.width = Math.max(240, initialLegend.width) + 'px';
        Archify.viewerChromeLayout.schedule();
        return Archify.viewerChromeLayout.whenStable().then(function () {
          var legend = legendElement.getBoundingClientRect();
          var dock = nav.getBoundingClientRect();
          var svg = document.querySelector('.diagram-container > svg').getBoundingClientRect();
          var width = Math.max(0, Math.min(legend.right, dock.right) - Math.max(legend.left, dock.left));
          var height = Math.max(0, Math.min(legend.bottom, dock.bottom) - Math.max(legend.top, dock.top));
          return {
            runtime: Archify.viewerChromeLayout.receipt(),
            intersectionArea: width * height,
            stageGap: dock.top - svg.bottom,
            safeRail: document.querySelector('.diagram-container').getAttribute('data-nav-safe-rail')
          };
        });
      })()`, true);

      if (receipt.noLegend) {
        assert.equal(receipt.runtime.active, false, mode);
        assert.equal(receipt.runtime.reserve, 0, mode);
        assert.equal(receipt.safeRail, null, mode);
        continue;
      }
      assert.equal(receipt.runtime.active, true, `${mode}: ${JSON.stringify(receipt)}`);
      assert.ok(receipt.runtime.reserve > 0, `${mode}: ${JSON.stringify(receipt)}`);
      assert.equal(receipt.intersectionArea, 0, `${mode}: ${JSON.stringify(receipt)}`);
      assert.ok(receipt.stageGap >= 9, `${mode}: ${JSON.stringify(receipt)}`);
      assert.equal(receipt.safeRail, 'true', mode);
    }
  } finally {
    await browser.close();
  }
});

test('Maka remains collision-free at the reported Retina-equivalent viewport', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const output = path.join(tmp, 'maka-architecture.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.resolve(skillRoot, '..', 'examples', 'maka-architecture.architecture.json'),
    output,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, output, { width: 1484, height: 724 });
    const receipt = await evaluate(browser, sessionId, `(function () {
      var runtime = Archify.viewerChromeLayout.receipt();
      var legend = document.querySelector('[data-legend]').getBoundingClientRect();
      var dock = document.querySelector('.diagram-nav').getBoundingClientRect();
      var width = Math.max(0, Math.min(legend.right, dock.right) - Math.max(legend.left, dock.left));
      var height = Math.max(0, Math.min(legend.bottom, dock.bottom) - Math.max(legend.top, dock.top));
      return {
        runtime: runtime,
        intersectionArea: width * height,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    })()`);

    assert.equal(receipt.intersectionArea, 0, JSON.stringify(receipt));
    assert.ok(receipt.scrollWidth <= receipt.innerWidth, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
