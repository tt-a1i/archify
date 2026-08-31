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

test('real browser readability includes inherited relationship labels', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-reader-'));
  const input = path.join(tmp, 'relationship.architecture.json');
  const artifact = path.join(tmp, 'relationship.html');
  try {
    fs.writeFileSync(input, JSON.stringify({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Relationship readability', quality_profile: 'showcase', viewBox: [1376, 420] },
      components: [
        { id: 'client', type: 'frontend', label: 'Client', pos: [100, 160], size: [140, 60] },
        { id: 'service', type: 'backend', label: 'Service', pos: [520, 160], size: [140, 60] },
      ],
      connections: [{ from: 'client', to: 'service', label: 'HTTPS', route: 'straight', labelAt: [380, 140] }],
      cards: [],
    }));
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'architecture',
      input,
      artifact,
      '--quality',
      'showcase',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const result = await runVisualCheck({ artifactPath: artifact, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    const desktop = result.receipt.readability.viewports.find(({ width, height }) => (
      width === DESKTOP_READABILITY_VIEWPORT.width && height === DESKTOP_READABILITY_VIEWPORT.height
    ));
    assert.ok(desktop);
    assert.equal(desktop.minimumProjectedNodeText, 'HTTPS');
    assert.equal(desktop.minimumProjectedNodeTextDetail, 'context');
    assert.ok(desktop.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
