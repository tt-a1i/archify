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

test('default sequence and dataflow canvases fit the real desktop reader without changing explicit geometry', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-default-reader-'));
  const cases = [
    ['sequence', {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: 'Ping', output: 'seq.html' },
      participants: [{ id: 'a', type: 'external', label: 'Client' }, { id: 'b', type: 'backend', label: 'Server' }],
      messages: [{ from: 'a', to: 'b', y: 160, label: 'ping' }],
    }, [920, 760]],
    ['dataflow', {
      schema_version: 1, diagram_type: 'dataflow',
      meta: { title: 'Pipe', output: 'df.html' },
      stages: [{ label: 'In' }, { label: 'Out' }],
      nodes: [
        { id: 'a', type: 'frontend', label: 'Client', stage: 0, row: 0 },
        { id: 'b', type: 'database', label: 'Store', stage: 1, row: 0 },
      ],
      flows: [{ from: 'a', to: 'b', label: 'write' }],
    }, [940, 720]],
  ];
  try {
    for (const [type, doc, viewBox] of cases) {
      for (const authored of [false, true]) {
        const input = path.join(tmp, `${type}-${authored}.json`);
        const artifact = path.join(tmp, `${type}-${authored}.html`);
        const candidate = structuredClone(doc);
        if (authored) candidate.meta.viewBox = viewBox;
        fs.writeFileSync(input, JSON.stringify(candidate));
        execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', type, input, artifact]);
        const result = await runVisualCheck({ artifactPath: artifact, chromePath });
        if (authored) {
          assert.equal(result.exitCode, 1, `${type}: explicit narrow canvas still requires repair`);
          assert.ok(result.receipt.diagnostics.some(({ code }) => code === 'viewer/viewport-overflow'));
          assert.ok(result.receipt.containment.viewports.every((v) => !v.verticalScrollAccepted));
        } else {
          assert.equal(result.exitCode, 0, `${type}: ${JSON.stringify(result.receipt.diagnostics)}`);
          assert.equal(result.receipt.readability.status, 'pass');
          assert.ok(result.receipt.containment.viewports.every((v) => v.ok && v.readerFit === 'intrinsic-height'));
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('visual-check collects nested ID-less semantic edge text for every renderer family', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-edge-collector-'));
  const cases = [
    ['architecture', 'examples/web-app.architecture.json'],
    ['workflow', 'examples/agent-tool-call.workflow.json'],
    ['sequence', 'examples/cache-miss-request.sequence.json'],
    ['dataflow', 'examples/event-stream.dataflow.json'],
    ['lifecycle', 'examples/agent-run.lifecycle.json'],
  ];
  try {
    for (const [index, [type, input]] of cases.entries()) {
      const artifact = path.join(tmp, `${type}.html`);
      execFileSync(process.execPath, [
        path.join(skillRoot, 'bin', 'archify.mjs'), 'render', type,
        path.join(skillRoot, input), artifact, '--quality', 'showcase',
      ], { cwd: skillRoot, encoding: 'utf8' });
      const edge = index % 2
        ? `<g data-edge-from="collector-${type}" data-edge-to="reader-${type}"><g data-detail="context"><text x="1" y="1" font-size="5">nested semantic edge</text><text data-detail="fine" x="1" y="2" font-size="1">fine edge annotation</text></g></g>`
        : `<g data-edge-from="collector-${type}" data-edge-to="reader-${type}" data-detail="context"><text x="1" y="1" font-size="5">same-group semantic edge</text><g data-detail="fine"><text x="1" y="2" font-size="1">fine nested annotation</text></g></g>`;
      const injected = fs.readFileSync(artifact, 'utf8').replace('</svg>', `${edge}</svg>`);
      fs.writeFileSync(artifact, injected);
      const result = await runVisualCheck({ artifactPath: artifact, chromePath });
      const desktop = result.receipt.readability.viewports.find(({ width, height }) => width === 1440 && height === 900);
      assert.ok(desktop, `${type}: missing desktop observation`);
      assert.equal(desktop.minimumProjectedNodeTextDetail, 'edge', `${type}: ${JSON.stringify(desktop)}`);
      assert.match(desktop.minimumProjectedNodeText, /semantic edge/, `${type}: fine text must be excluded`);
      assert.deepEqual(desktop.minimumProjectedNodeTextOwner, {
        kind: 'edge', id: null, from: `collector-${type}`, to: `reader-${type}`,
      }, `${type}: ${JSON.stringify(desktop)}`);
      assert.equal(result.receipt.readability.status, 'fail', `${type}: injected 5px edge must be measured`);
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

    const artifactSource = fs.readFileSync(artifact, 'utf8');
    const svgRoot = artifactSource.match(/<svg\b[^>]*>/)?.[0];
    assert.ok(svgRoot, 'production fixture must contain an SVG root');
    // The comfortable primary-text preference uses the available width here;
    // the viewport cap still wins over the preferred reading size.
    assert.match(svgRoot, /viewBox="0 0 1376 728"/);
    assert.match(svgRoot, /data-reader-fit="intrinsic-height"/);
    assert.match(svgRoot, /data-reader-min-text="7\.5"/);

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
        assert.equal(observation.readerWidth, 1376);
        assert.ok(observation.readerWidth <= 1376);
        assert.equal(observation.diagramWidth, 1346);
        assert.equal(observation.viewBoxWidth, 1376);
        assert.ok(Number.isFinite(observation.minimumProjectedNodeTextPx));
        assert.ok(observation.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
        assert.ok(observation.minimumProjectedNodeTextPx >= 7.5, JSON.stringify(observation));
        assert.equal(typeof observation.minimumProjectedNodeText, 'string');
        assert.ok(observation.minimumProjectedNodeText.trim().length > 0);
        assert.equal(observation.readabilityOk, true);
        assert.equal(observation.overflowX, false, JSON.stringify(observation));
        if (observation.overflowY) {
          assert.equal(observation.verticalScrollAccepted, true, JSON.stringify(observation));
          assert.equal(observation.readerLayout, 'adaptive', JSON.stringify(observation));
          assert.equal(observation.readerOverflow, 'authored', JSON.stringify(observation));
          assert.equal(observation.readerFit, 'intrinsic-height', JSON.stringify(observation));
        } else {
          assert.equal(observation.verticalScrollAccepted, false, JSON.stringify(observation));
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('route-expanded intrinsic architecture preserves reading size with ordinary page scroll', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-expanded-reader-'));
  const input = path.join(
    skillRoot,
    'test/fixtures/architecture-viewport/route-expanded-worldscope.architecture.json',
  );
  const artifact = path.join(tmp, 'route-expanded-worldscope.html');
  try {
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'deliver',
      'architecture',
      input,
      artifact,
      '--quality',
      'showcase',
      '--json',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const html = fs.readFileSync(artifact, 'utf8');
    const svgRoot = html.match(/<svg\b[^>]*>/)?.[0];
    assert.ok(svgRoot, 'expected an SVG root');
    assert.match(svgRoot, /viewBox="0 0 980 678"/);
    assert.match(svgRoot, /data-reader-fit="intrinsic-height"/);
    assert.match(svgRoot, /data-reader-min-text="7\.5"/);

    const result = await runVisualCheck({ artifactPath: artifact, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    assert.equal(result.receipt.containment.status, 'pass');
    assert.equal(result.receipt.readability.status, 'pass');
    assert.equal(result.receipt.viewerChrome.status, 'pass');
    for (const viewport of result.receipt.containment.viewports) {
      assert.equal(viewport.overflowX, false, JSON.stringify(viewport, null, 2));
      assert.equal(viewport.overflowY, viewport.verticalScrollAccepted, JSON.stringify(viewport, null, 2));
      for (const [field, floor] of [
        ['minimumProjectedNonEdgeTextPx', 7.5 - 0.01],
        ['minimumProjectedEdgeTextPx', MIN_PROJECTED_NODE_TEXT_PX],
        ['minimumProjectedNodeTextPx', MIN_PROJECTED_NODE_TEXT_PX],
      ]) {
        assert.ok(Number.isFinite(viewport[field]), field + ': ' + JSON.stringify(viewport, null, 2));
        assert.ok(viewport[field] >= floor, field + ': ' + JSON.stringify(viewport, null, 2));
      }
    }
    const desktop = result.receipt.containment.viewports.find(({ width, height }) => (
      width === DESKTOP_READABILITY_VIEWPORT.width
      && height === DESKTOP_READABILITY_VIEWPORT.height
    ));
    assert.ok(desktop);
    // Reading size holds; with notes below the fold the diagram itself fits,
    // and any remaining overflow must be accepted scroll (checked above).
    assert.ok(desktop.diagramWidth >= desktop.viewBoxWidth, JSON.stringify(desktop, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extreme intrinsic architecture keeps readable page scroll below first-screen fit', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-readable-scroll-reader-'));
  const input = path.join(
    skillRoot,
    'test/fixtures/architecture-viewport/readable-scroll-worldscope.architecture.json',
  );
  const artifact = path.join(tmp, 'readable-scroll-worldscope.html');
  try {
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'deliver',
      'architecture',
      input,
      artifact,
      '--quality',
      'showcase',
      '--json',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const html = fs.readFileSync(artifact, 'utf8');
    const svgRoot = html.match(/<svg\b[^>]*>/)?.[0];
    assert.ok(svgRoot, 'expected an SVG root');
    assert.match(svgRoot, /viewBox="0 0 980 1188"/);
    assert.match(svgRoot, /data-reader-fit="intrinsic-height"/);
    assert.match(svgRoot, /data-reader-min-text="7\.5"/);

    const result = await runVisualCheck({ artifactPath: artifact, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    assert.equal(result.receipt.containment.status, 'pass');
    assert.equal(result.receipt.containment.policy, 'fit-or-reader-declared-readable-vertical-scroll');
    assert.equal(result.receipt.readability.status, 'pass');
    assert.equal(result.receipt.viewerChrome.status, 'pass');
    assert.equal(result.receipt.diagnostics.length, 0, JSON.stringify(result.receipt, null, 2));

    let scrollViewportCount = 0;
    for (const viewport of result.receipt.containment.viewports) {
      assert.equal(viewport.overflowX, false, JSON.stringify(viewport, null, 2));
      for (const [field, floor] of [
        ['minimumProjectedNonEdgeTextPx', 7.5 - 0.01],
        ['minimumProjectedEdgeTextPx', MIN_PROJECTED_NODE_TEXT_PX],
        ['minimumProjectedNodeTextPx', MIN_PROJECTED_NODE_TEXT_PX],
      ]) {
        assert.ok(Number.isFinite(viewport[field]), field + ': ' + JSON.stringify(viewport, null, 2));
        assert.ok(viewport[field] >= floor, field + ': ' + JSON.stringify(viewport, null, 2));
      }
      if (viewport.overflowY) {
        scrollViewportCount += 1;
        assert.equal(viewport.verticalScrollAccepted, true, JSON.stringify(viewport, null, 2));
        assert.equal(viewport.overflowDisposition, 'readable-vertical-scroll');
        assert.equal(viewport.readerLayout, 'adaptive');
        assert.equal(viewport.readerOverflow, 'authored');
        assert.equal(viewport.readerFit, 'intrinsic-height');
      } else {
        assert.equal(viewport.overflowY, false, JSON.stringify(viewport, null, 2));
        assert.equal(viewport.verticalScrollAccepted, false);
        assert.equal(viewport.overflowDisposition, 'contained');
      }
    }
    assert.ok(scrollViewportCount > 0, 'expected the extreme intrinsic diagram to exercise readable page scroll');
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
    assert.equal(result.receipt.containment.viewports.length, 4);
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

test('authored Architecture canvas keeps its scale and accepts readable document scrolling', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authored-reader-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'fixed.json');
  const artifact = path.join(tmp, 'fixed.html');
  const doc = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Authored overview', output: 'fixed.html', viewBox: [1040, 700], quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 80], size: [130, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [300, 80], size: [140, 64] },
      { id: 'store', type: 'database', label: 'Store', pos: [300, 470], size: [140, 64] },
    ],
    connections: [{ from: 'client', to: 'api', label: 'request' }, { from: 'api', to: 'store', label: 'persist' }],
  };
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'architecture', input, artifact]);
  const html = fs.readFileSync(artifact, 'utf8');
  assert.match(html, /viewBox="0 0 1040 700"/);
  assert.match(html, /<rect x="300" y="470" width="140" height="64"/);
  const baseline = path.join(tmp, 'legacy.html');
  fs.writeFileSync(baseline, html.replace(' data-reader-fit="authored-height"', ''));
  const old = await runVisualCheck({ artifactPath: baseline, chromePath });
  assert.equal(old.exitCode, 1, 'legacy page rejects ordinary document overflow');
  const result = await runVisualCheck({ artifactPath: artifact, chromePath });
  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostics));
  for (const viewport of result.receipt.containment.viewports) {
    const before = old.receipt.containment.viewports.find(v => v.width === viewport.width);
    assert.equal(viewport.diagramWidth, before.diagramWidth, 'keep the approved page scale');
    assert.equal(viewport.readerWidth, before.readerWidth);
    assert.equal(viewport.readerLayout, before.readerLayout);
    assert.equal(viewport.readerFit, 'authored-height');
    assert.equal(viewport.overflowX, false);
    if (viewport.overflowY) assert.equal(viewport.verticalScrollAccepted, true);
  }
  for (const overflow of ['hidden', 'auto']) {
    const clipped = path.join(tmp, `clipped-${overflow}.html`);
    fs.writeFileSync(clipped, html.replace('</head>', `<style>.diagram-container { height: 300px !important; overflow: ${overflow} !important; }</style></head>`));
    const failed = await runVisualCheck({ artifactPath: clipped, chromePath });
    assert.equal(failed.exitCode, 1);
    assert.ok(failed.receipt.diagnostics.some(d => d.code === 'viewer/diagram-clipped'), JSON.stringify(failed.receipt.diagnostics));
  }
});
