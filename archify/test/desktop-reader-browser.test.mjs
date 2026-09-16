import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChrome, runVisualCheck } from '../bin/visual-check.mjs';
import { DESKTOP_READABILITY_VIEWPORT, MIN_PROJECTED_NODE_TEXT_PX } from '../renderers/shared/desktop-readability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const packagedHtmlExamples = fs.readdirSync(path.join(skillRoot, 'examples'))
  .filter((name) => name.endsWith('.html') && !name.endsWith('.visual-check.html'))
  .sort();

test('all packaged HTML examples pass the real visual-check desktop gate', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-packaged-examples-'));
  try {
    assert.ok(packagedHtmlExamples.length > 0, 'expected at least one packaged HTML example');
    for (const name of packagedHtmlExamples) {
      const artifact = path.join(tmp, name);
      fs.copyFileSync(path.join(skillRoot, 'examples', name), artifact);
      const result = await runVisualCheck({ artifactPath: artifact, chromePath });
      assert.equal(result.exitCode, 0, `${name}: ${JSON.stringify(result.receipt, null, 2)}`);
      assert.equal(result.receipt.containment.status, 'pass', name);
      assert.equal(result.receipt.containment.viewports.every((viewport) => viewport.ok), true, name);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('production showcase is readable in the real 1440 by 900 adaptive reader', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-desktop-reader-'));
  const artifact = path.join(tmp, 'production-deployment.html');
  try {
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'architecture',
      path.join(skillRoot, 'examples', 'production-deployment.architecture.json'),
      artifact,
      '--quality',
      'showcase',
    ], { cwd: skillRoot, encoding: 'utf8' });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await runVisualCheck({ artifactPath: artifact, chromePath });
      assert.equal(result.exitCode, 0, `attempt ${attempt}: ${JSON.stringify(result.receipt, null, 2)}`);
      assert.equal(result.receipt.readability.status, 'pass', `attempt ${attempt}: ${JSON.stringify(result.receipt, null, 2)}`);
      const desktop = result.receipt.readability.viewports.find(({ width, height }) => (
        width === DESKTOP_READABILITY_VIEWPORT.width && height === DESKTOP_READABILITY_VIEWPORT.height
      ));
      const darkDesktop = result.receipt.captures.screenshots.find(({ width, height, theme }) => (
        width === DESKTOP_READABILITY_VIEWPORT.width
        && height === DESKTOP_READABILITY_VIEWPORT.height
        && theme === 'dark'
      ));
      for (const observation of [desktop, darkDesktop]) {
        assert.ok(observation);
        assert.equal(observation.readerWidth, 960);
        assert.equal(observation.diagramWidth, 930);
        assert.ok(observation.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
        assert.equal(observation.minimumProjectedNodeTextDetail, 'boundary');
        assert.equal(observation.minimumProjectedNodeText, 'AWS eu-west-1 / disaster recovery');
        assert.equal(observation.readabilityOk, true);
        assert.equal(observation.scrollHeight, DESKTOP_READABILITY_VIEWPORT.height);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
