import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { architecture, workflow } from '../renderers/shared/generated-validators.mjs';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/archify.mjs');

function document(locale = 'en') {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Artifact semantics', output: 'artifact.html', locale, legend: { mode: 'all' } },
    components: [
      { id: 'producer', type: 'backend', label: 'Parser', pos: [50, 100] },
      { id: 'ir', type: 'artifact', label: 'JSON IR', sublabel: 'Downloaded file', pos: [300, 100] },
    ],
    connections: [],
  };
}

function render(doc) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-artifact-kind-'));
  try {
    const input = path.join(temp, 'input.json');
    const output = path.join(temp, 'output.html');
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('v1 Architecture accepts artifact while the shared Workflow kind contract stays unchanged', () => {
  const doc = document();
  assert.equal(architecture(doc), true, JSON.stringify(architecture.errors));
  const workflowDoc = JSON.parse(fs.readFileSync(path.join(root, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  workflowDoc.nodes[0].type = 'artifact';
  assert.equal(workflow(workflowDoc), false);
  assert.equal(workflow.errors?.[0]?.instancePath, '/nodes/0/type');
});

test('Architecture renders a distinct artifact icon, color, semantic kind and translated legend', () => {
  for (const [locale, label] of [
    ['en', 'File / artifact'],
    ['zh-CN', '文件 / 产物'],
    ['es', 'Archivo / artefacto'],
  ]) {
    const html = render(document(locale));
    assert.match(html, /data-node-id="ir"[^>]+data-node-kind="artifact"/);
    assert.match(html, /class="c-artifact"/);
    assert.match(html, /data-semantic-sigil="artifact" class="semantic-sigil s-artifact"/);
    assert.match(html, /data-legend-kind="artifact"/);
    assert.ok(html.includes(label), `${locale} artifact legend label is missing`);
    assert.match(html, /\.c-artifact\s*\{ fill: var\(--artifact-fill\);\s*stroke: var\(--artifact-stroke\); \}/);
  }
});

test('legacy Architecture all-mode legend does not add an unused artifact category', () => {
  const doc = document();
  doc.components.pop();
  assert.equal(architecture(doc), true, JSON.stringify(architecture.errors));
  assert.doesNotMatch(render(doc), /data-legend-kind="artifact"/);
});

test('radar and Semantic Lens paint artifacts with the authored neutral color in both themes', {
  skip: process.env.ARCHIFY_CHROME ? false : 'Set ARCHIFY_CHROME for the browser color check.',
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-artifact-viewer-'));
  const htmlPath = path.join(temp, 'artifact.html');
  fs.writeFileSync(htmlPath, render(document()));
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    }, session);
    async function evaluate(expression) {
      const result = await browser.cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, session);
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result?.value;
    }
    for (const theme of ['dark', 'light']) {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await browser.cdp.send('Page.navigate', { url: `${pathToFileURL(htmlPath).href}?theme=${theme}` }, session);
      await loaded;
      const colors = await evaluate(`new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          Archify.radar.open();
          const node = document.querySelector('.overview-map-node[data-kind="artifact"]');
          const authored = document.querySelector('[data-node-id="ir"] .c-artifact');
          const radarFill = node && getComputedStyle(node).fill;
          const authoredStroke = authored && getComputedStyle(authored).stroke;
          Archify.radar.close();
          Archify.semanticLens.open();
          const button = document.querySelector('.semantic-lens-kind[data-kind="artifact"]');
          const swatch = button && button.querySelector('.semantic-lens-swatch');
          resolve({ radarFill, authoredStroke, lensColor: swatch && getComputedStyle(swatch).backgroundColor,
            label: button && button.querySelector('strong').textContent });
        }));
      })`);
      assert.equal(colors.radarFill, colors.authoredStroke, `${theme} radar: ${JSON.stringify(colors)}`);
      assert.equal(colors.lensColor, colors.authoredStroke, `${theme} lens: ${JSON.stringify(colors)}`);
      assert.equal(colors.label, 'File / artifact');
    }

    // Older embedded SVGs may have a typed fill without a semantic kind attribute.
    // Finder should still infer the new kind from the authored component class.
    const fallbackPath = path.join(temp, 'artifact-fallback.html');
    const source = fs.readFileSync(htmlPath, 'utf8');
    const withoutKind = source.replace(/<g\b[^>]*data-node-id="ir"[^>]*>/,
      (tag) => tag.replace(/\sdata-node-kind="artifact"/, ''));
    assert.ok(withoutKind !== source, 'fallback fixture removed the artifact kind attribute');
    fs.writeFileSync(fallbackPath, withoutKind);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(fallbackPath).href }, session);
    await loaded;
    const finder = await evaluate(`(() => {
      Archify.finder.open();
      const input = document.getElementById('node-finder-input');
      input.value = 'artifact';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const result = document.querySelector('.node-finder-result[data-node-id="ir"]');
      return { found: Boolean(result), description: result && result.querySelector('small').textContent };
    })()`);
    assert.equal(finder.found, true, JSON.stringify(finder));
    assert.match(finder.description, /File \/ artifact/);
  } finally {
    await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
