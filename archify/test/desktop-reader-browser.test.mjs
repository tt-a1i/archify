import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChromeVisualBrowser, findChrome, runVisualCheck } from '../bin/visual-check.mjs';
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

test('offline workflow viewport repair retains order semantics and identifies overflowing lane frames', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const fixtureRoot = path.join(skillRoot, 'test/fixtures/workflow-viewport');
  const failed = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'order-overflow.workflow.json'), 'utf8'));
  const repaired = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'order-reflow.workflow.json'), 'utf8'));
  const meaning = ({ lane, col, yOffset, ...node }) => node;
  assert.deepEqual(failed.nodes.map(meaning), repaired.nodes.map(meaning));
  for (const key of ['edges', 'semanticChecks', 'mainPath', 'cards', 'phases', 'meta']) {
    assert.deepEqual(repaired[key], failed[key], key);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-viewport-'));
  try {
    for (const name of ['order-overflow', 'order-reflow']) {
      const artifact = path.join(tmp, `${name}.html`);
      execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'deliver', 'workflow',
        path.join(fixtureRoot, `${name}.workflow.json`), artifact, '--quality', 'showcase', '--json'], { cwd: skillRoot });
      const result = await runVisualCheck({
        artifactPath: artifact, chromePath,
        browserFactory: async (executable) => {
          const browser = new ChromeVisualBrowser(executable);
          try {
            const session = await browser.sessionPromise;
            await browser.cdp.send('Network.enable', {}, session);
            await browser.cdp.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] }, session);
            return browser;
          } catch (error) {
            await browser.close();
            throw error;
          }
        },
      });
      if (name === 'order-overflow') {
        assert.equal(result.exitCode, 1);
        const diagnostic = result.receipt.diagnostics.find(({ code }) => code === 'viewer/viewport-overflow');
        assert.ok(diagnostic, JSON.stringify(result.receipt));
        assert.equal(diagnostic.evidence.workflowLanes[0].frameId, 'lane-0');
        assert.equal(diagnostic.evidence.workflowLanes[0].nodeCount, 12);
        assert.ok(diagnostic.evidence.workflowLanes[0].spaceAboveNodesPx > 100);
      } else {
        assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
        assert.equal(result.receipt.containment.status, 'pass');
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
