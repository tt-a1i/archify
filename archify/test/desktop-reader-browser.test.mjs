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

const issue250TallGroup = {
  schema_version: 2,
  diagram_type: 'workflow',
  meta: { title: 'Issue 250 stacked stages', output: 'issue-250.html' },
  lanes: [{ id: 'cage', label: 'One cage' }],
  groups: [{
    id: 'group', label: 'Cage', lane: 'cage', fromCol: 1, toCol: 3, variant: 'security',
  }],
  mainPath: ['stageA', 'stageB', 'stageC'],
  nodes: [
    { id: 'stageA', lane: 'cage', col: 2, type: 'security', label: 'stageA', yOffset: -90 },
    { id: 'stageB', lane: 'cage', col: 2, type: 'security', label: 'stageB', yOffset: 0 },
    { id: 'stageC', lane: 'cage', col: 2, type: 'security', label: 'stageC', yOffset: 90 },
  ],
  edges: [
    {
      id: 'stage-a-b', from: 'stageA', to: 'stageB', role: 'main', fromSide: 'bottom', toSide: 'top',
    },
    {
      id: 'stage-b-c', from: 'stageB', to: 'stageC', role: 'main', fromSide: 'bottom', toSide: 'top',
    },
  ],
};

const issue250FiveStageGroup = {
  ...issue250TallGroup,
  meta: { title: 'Issue 250 five stacked stages', output: 'issue-250-five-stage.html' },
  mainPath: ['stageA', 'stageB', 'stageC', 'stageD', 'stageE'],
  nodes: [
    { id: 'stageA', lane: 'cage', col: 2, type: 'security', label: 'stageA', yOffset: -300 },
    { id: 'stageB', lane: 'cage', col: 2, type: 'security', label: 'stageB', yOffset: -150 },
    { id: 'stageC', lane: 'cage', col: 2, type: 'security', label: 'stageC', yOffset: 0 },
    { id: 'stageD', lane: 'cage', col: 2, type: 'security', label: 'stageD', yOffset: 150 },
    { id: 'stageE', lane: 'cage', col: 2, type: 'security', label: 'stageE', yOffset: 300 },
  ],
  edges: [
    { id: 'stage-a-b', from: 'stageA', to: 'stageB', role: 'main', fromSide: 'bottom', toSide: 'top' },
    { id: 'stage-b-c', from: 'stageB', to: 'stageC', role: 'main', fromSide: 'bottom', toSide: 'top' },
    { id: 'stage-c-d', from: 'stageC', to: 'stageD', role: 'main', fromSide: 'bottom', toSide: 'top' },
    { id: 'stage-d-e', from: 'stageD', to: 'stageE', role: 'main', fromSide: 'bottom', toSide: 'top' },
  ],
};

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

test('offline intrinsic workflows fit while authored overflow still identifies lane frames', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const fixtureRoot = path.join(skillRoot, 'test/fixtures/workflow-viewport');
  const failed = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'order-overflow.workflow.json'), 'utf8'));
  const repaired = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'order-reflow.workflow.json'), 'utf8'));
  const meaning = ({ lane, col, yOffset, ...node }) => node;
  assert.deepEqual(failed.nodes.map(meaning), repaired.nodes.map(meaning));
  for (const key of ['edges', 'semanticChecks', 'mainPath', 'cards', 'phases']) {
    assert.deepEqual(repaired[key], failed[key], key);
  }
  // Each fixture publishes to its own file; all authored metadata stays the same.
  assert.deepEqual({ ...repaired.meta, output: failed.meta.output }, failed.meta);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-viewport-'));
  try {
    for (const name of ['order-overflow', 'order-reflow', 'order-pinned-overflow']) {
      let input = path.join(fixtureRoot, `${name}.workflow.json`);
      if (name === 'order-pinned-overflow') {
        input = path.join(tmp, `${name}.workflow.json`);
        // Freeze the historical canvas: fitting must respect an authored viewBox.
        const pinned = structuredClone(failed);
        pinned.meta.viewBox = [860, 786];
        fs.writeFileSync(input, JSON.stringify(pinned));
      }
      const artifact = path.join(tmp, `${name}.html`);
      execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'deliver', 'workflow',
        input, artifact, '--quality', 'showcase', '--json'], { cwd: skillRoot });
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
      if (name === 'order-pinned-overflow') {
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

test('issue #250 tall intrinsic workflow fits every required desktop viewport', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-issue-250-reader-'));
  const input = path.join(tmp, 'issue-250.workflow.json');
  const artifact = path.join(tmp, 'issue-250.html');
  try {
    fs.writeFileSync(input, `${JSON.stringify(issue250TallGroup, null, 2)}\n`);
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'workflow',
      input,
      artifact,
      '--quality',
      'showcase',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const result = await runVisualCheck({ artifactPath: artifact, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    assert.equal(result.receipt.containment.status, 'pass');
    assert.equal(result.receipt.readability.status, 'pass');
    assert.equal(result.receipt.viewerChrome.status, 'pass');
    assert.deepEqual(
      result.receipt.containment.viewports.map(({ width, height, theme }) => `${width}x${height}:${theme}`).sort(),
      [
        '1440x900:dark', '1440x900:light',
        '1600x1000:dark', '1600x1000:light',
        '1920x1080:dark', '1920x1080:light',
        '2048x1320:dark', '2048x1320:light',
      ],
    );
    for (const viewport of result.receipt.containment.viewports) {
      assert.equal(viewport.overflowX, false, JSON.stringify(viewport, null, 2));
      assert.equal(viewport.overflowY, false, JSON.stringify(viewport, null, 2));
      assert.equal(viewport.scrollHeight, viewport.height, JSON.stringify(viewport, null, 2));
      assert.ok(viewport.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
    }
    assert.deepEqual(
      result.receipt.captures.screenshots.map(({ width, height, theme, resolvedTheme }) => ({
        width, height, theme, resolvedTheme,
      })),
      [
        { width: 1440, height: 900, theme: 'light', resolvedTheme: 'light' },
        { width: 1440, height: 900, theme: 'dark', resolvedTheme: 'dark' },
        { width: 2048, height: 1320, theme: 'light', resolvedTheme: 'light' },
        { width: 2048, height: 1320, theme: 'dark', resolvedTheme: 'dark' },
      ],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('issue #250 five-stage stack fits below source scale without crossing the readability floor', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-issue-250-five-stage-'));
  const input = path.join(tmp, 'issue-250-five-stage.workflow.json');
  const artifact = path.join(tmp, 'issue-250-five-stage.html');
  try {
    fs.writeFileSync(input, `${JSON.stringify(issue250FiveStageGroup, null, 2)}\n`);
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'workflow',
      input,
      artifact,
      '--quality',
      'showcase',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const result = await runVisualCheck({ artifactPath: artifact, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    for (const viewport of result.receipt.containment.viewports) {
      assert.equal(viewport.overflowY, false, JSON.stringify(viewport, null, 2));
      assert.equal(viewport.scrollHeight, viewport.height, JSON.stringify(viewport, null, 2));
      assert.ok(viewport.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
    }
    const desktop = result.receipt.containment.viewports.find(({ width, height }) => (
      width === DESKTOP_READABILITY_VIEWPORT.width && height === DESKTOP_READABILITY_VIEWPORT.height
    ));
    assert.ok(desktop);
    assert.ok(desktop.diagramWidth < desktop.viewBoxWidth, JSON.stringify(desktop, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
