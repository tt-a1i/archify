import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome, runVisualCheck } from '../archify/bin/visual-check.mjs';
import { isolatedVisualBrowser } from './helpers/isolated-visual-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
// The Skill ships example JSON only; `archify examples` renders this HTML on demand.
const examplesRoot = path.join(skillRoot, '..', 'examples');
const renderedExampleOutputs = [...fs.readFileSync(path.join(skillRoot, 'scripts/render-examples.mjs'), 'utf8')
  .matchAll(/'([a-z0-9-]+\.html)'/g)].map((match) => match[1]);
const packagedHtmlExamples = [...new Set([
  ...renderedExampleOutputs,
  ...fs.readdirSync(examplesRoot).filter((name) => /^drilldown-.*\.html$/.test(name)),
])].sort();

test('all rendered HTML examples pass the real visual-check desktop gate', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-packaged-examples-'));
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await browser.sessionPromise;
    assert.ok(packagedHtmlExamples.length > 0, 'expected at least one packaged HTML example');
    for (const name of packagedHtmlExamples) {
      const artifact = path.join(tmp, name);
      fs.copyFileSync(path.join(examplesRoot, name), artifact);
      const result = await runVisualCheck({
        artifactPath: artifact, chromePath, browserFactory: () => isolatedVisualBrowser(browser),
      });
      assert.equal(result.exitCode, 0, `${name}: ${JSON.stringify(result.receipt, null, 2)}`);
      assert.equal(result.receipt.containment.status, 'pass', name);
      assert.equal(result.receipt.containment.viewports.every((viewport) => viewport.ok), true, name);
    }
  } finally {
    try {
      await browser.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});
