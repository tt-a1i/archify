import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

import { translateMessage } from '../renderers/shared/i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const focusSource = fs.readFileSync(path.resolve(skillRoot, '..', 'viewer', 'focus.js'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-passport-'));
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
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
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

async function loadArtifact(browser, artifactPath, { width = 1440, height = 900 } = {}) {
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
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
    });
  })()`, true);
  return sessionId;
}

test('all typed renderers emit details-on-demand metadata and native SVG titles', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    const diagram = svg(html);
    assert.match(diagram, /data-node-kind="[^"]+"/, mode);
    assert.match(diagram, /data-node-sublabel="[^"]+"/, mode);
    assert.match(diagram, /data-node-context="[^"]+"/, mode);
    assert.match(diagram, /<g id="node-[^"]+"[\s\S]*?<title>[^<]+ · [^<]+<\/title>/, mode);
  }
});

test('renderer-owned structure supplies truthful Semantic Passport context', () => {
  const architecture = render('architecture', CASES.architecture);
  const workflow = render('workflow', CASES.workflow);
  const sequence = render('sequence', CASES.sequence);
  const dataflow = render('dataflow', CASES.dataflow);
  const lifecycle = render('lifecycle', CASES.lifecycle);

  assert.match(architecture, /data-node-id="api"[^>]+data-node-kind="backend"[^>]+data-node-context="AWS Region: us-west-2 › sg-api :443\/:8000"/);
  assert.match(workflow, /data-node-id="approval"[^>]+data-node-kind="security"[^>]+data-node-context="Policy &amp; Recovery › Human or policy stop › Plan \+ route"/);
  assert.match(sequence, /data-node-id="redis"[^>]+data-node-kind="database"[^>]+data-node-context="Sequence participant"/);
  assert.match(dataflow, /data-node-id="warehouse"[^>]+data-node-kind="database"[^>]+data-node-context="04 \/ Store"/);
  assert.match(lifecycle, /data-node-id="executing"[^>]+data-node-kind="active"[^>]+data-node-context="Lifecycle phases"/);
});

test('Relationship Lens renders one Semantic Passport and copyable stable focus link', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /<span class="relationship-lens-eyebrow">Semantic passport<\/span>/);
  assert.match(html, /id="focus-detail" hidden/);
  assert.match(html, /id="focus-kind" data-passport="kind"/);
  assert.match(html, /id="focus-context" data-passport="context" hidden/);
  assert.match(html, /id="focus-tag" data-passport="tag" hidden/);
  assert.match(html, /id="focus-id" data-passport="id"/);
  assert.match(html, /id="btn-focus-clear"[^>]+aria-label="Close semantic passport"[^>]+title="Close">&#215;<\/button>/);
  assert.match(html, /id="btn-focus-copy"[^>]+aria-label="Copy link to focused node"/);
  assert.match(html, /id="btn-focus-relations"[^>]+aria-expanded="false"[^>]+aria-controls="relationship-lens-list"/);
  assert.match(html, /function renderPassport\(id, node\)/);
  assert.match(html, /var relationId = record && record\.id/);
  assert.match(html, /\? '#relation=' \+ encodeURIComponent\(relationId\)/);
  assert.match(html, /: '#focus=' \+ encodeURIComponent\(activeIds\[0\]\)/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /copyLink: copyFocusLink/);
  assert.match(html, /compactOnMobile = mobile && chip\.getAttribute\('data-relations-expanded'\) !== 'true'/);
  assert.match(html, /nodeTop - chip\.offsetHeight - gap/);
  assert.match(html, /focus-chip:not\(\[data-relations-expanded="true"\]\) \.relationship-lens-list \{ display: none; \}/);
  assert.match(html, /clearBtn\.addEventListener\('click', function \(\) \{ clear\(\{ restoreFocus: true \}\); \}\)/);
  assert.match(html, /chip\.hidden \|\| !target \|\| typeof target\.closest !== 'function' \|\| chip\.contains\(target\)/);
  assert.match(html, /target\.closest\('\[data-node-id\], \[data-relationship-hit-key\], \.overview-map, \.atlas-navigation, \.atlas-compact-navigation, \.atlas-directory, \.atlas-breadcrumb, \.atlas-parent-context, \.atlas-rail, \.atlas-inspector, \.atlas-directory-section'\)/);
  assert.match(html, /document\.addEventListener\('click',[\s\S]+?clear\(\);\s+\}, true\);/);
  assert.match(html, /Archify\.focus\.clear\(\{ restoreFocus: true \}\)/);
  assert.match(html, /renderRelationshipLens\(normalized\[0\],\s*byId\);\s*placeRelationshipLens\(\);/);
  assert.match(html, /applyReachability[\s\S]*?placeRelationshipLens\(\);/);
  assert.match(html, /clearRelationshipPreview[\s\S]*?renderRelationshipCopyAction\(\);\s*placeRelationshipLens\(\);/);
  assert.match(html, /previewRelationship[\s\S]*?renderRelationshipPulse\(key\);\s*placeRelationshipLens\(\);/);
  assert.match(html, /relationsBtn\.addEventListener\('click'[\s\S]*?placeRelationshipLens\(\);/);
  assert.match(html, /reposition:\s*placeRelationshipLens/);
});

test('semantic passport computes and applies target top synchronously on open and switch without a 1-frame snap', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = path.join(tmp, 'passport-synchronous-placement.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'architecture',
    path.join(skillRoot, 'examples', CASES.architecture),
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 1440, height: 900 });
    const result = await evaluate(browser, sessionId, `(function () {
      var chip = document.getElementById('focus-chip');
      var initialHidden = chip.hidden;
      var initialTop = chip.style.top;

      // Focus node 'auth' (top rank): must compute and apply top synchronously before next paint
      Archify.focus.set('auth', { toggle: false });
      var synchronousTopAuth = chip.style.top;
      var hiddenAuth = chip.hidden;

      // Switch focus to node 's3' (bottom rank): must update top synchronously without stale 1-frame delay
      Archify.focus.set('s3', { toggle: false });
      var synchronousTopS3 = chip.style.top;
      var hiddenS3 = chip.hidden;

      return {
        initialHidden: initialHidden,
        initialTop: initialTop,
        synchronousTopAuth: synchronousTopAuth,
        hiddenAuth: hiddenAuth,
        synchronousTopS3: synchronousTopS3,
        hiddenS3: hiddenS3
      };
    })()`);

    assert.equal(result.initialHidden, true);
    assert.equal(result.hiddenAuth, false);
    assert.notEqual(result.synchronousTopAuth, '', 'passport target position must land synchronously before next paint');
    assert.equal(result.hiddenS3, false);
    assert.notEqual(result.synchronousTopS3, '', 'switched passport target position must land synchronously');
    assert.notEqual(result.synchronousTopAuth, result.synchronousTopS3, 'target positions for different nodes must differ');
  } finally {
    await browser.close().catch(() => {});
  }
});

test('committed lifecycle focus hides the non-semantic primary rail', () => {
  const html = render('lifecycle', CASES.lifecycle);
  const diagram = svg(html);
  const rail = diagram.match(/<path\b[^>]*data-lifecycle-rail[^>]*>/)?.[0] || '';

  assert.ok(rail, 'lifecycle: expected the primary decorative rail to be identifiable');
  assert.doesNotMatch(rail, /data-edge-from|data-edge-to/, 'the rail must remain non-semantic');
  assert.match(
    html,
    /svg\[data-focus-active\] \[data-lifecycle-rail\]\s*\{\s*opacity:\s*0;/,
    'committed node focus must not expose the decorative rail through dimmed nodes',
  );
});

test('Semantic Passport exposes one localized, bounded move affordance outside canonical export', () => {
  const html = render('workflow', CASES.workflow);
  const diagram = svg(html);

  assert.match(
    html,
    /<button class="relationship-lens-drag-handle" id="btn-focus-move"[^>]+data-focus-drag-handle[^>]+aria-label="Move semantic passport\./,
  );
  assert.equal(translateMessage('en', 'viewer.passport.move'), 'Move semantic passport. Drag, use arrow keys, or press Home to reset.');
  assert.equal(translateMessage('zh-CN', 'viewer.passport.move'), '移动语义护照。可拖动、使用方向键移动，或按 Home 恢复自动位置。');
  assert.match(html, /\.relationship-lens-drag-handle\s*\{[\s\S]*cursor:\s*grab;[\s\S]*touch-action:\s*none;/);
  assert.match(html, /\.focus-chip button:focus-visible,[\s\S]*outline:\s*2px solid var\(--frontend-stroke\);/);
  assert.match(html, /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*\.relationship-lens-drag-handle \{ display: none; \}/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*\.relationship-lens-drag-handle \{ display: none; \}/);
  assert.match(html, /function manualLensPlacementAvailable\(\)[\s\S]*finePointerQuery\.matches/);
  assert.match(html, /function beginLensDrag\(event\)/);
  assert.match(html, /function moveLensDrag\(event\)/);
  assert.match(html, /function finishLensDrag\(event, cancel\)/);
  assert.match(html, /function resetLensPlacement\(options\)/);
  assert.match(html, /function applyManualLensPosition\(position\)/);
  assert.match(html, /Math\.hypot\(dx, dy\) <= 3/);
  assert.match(html, /moveBtn\.setPointerCapture\(event\.pointerId\)/);
  assert.match(html, /moveBtn\.addEventListener\('dblclick'/);
  assert.match(html, /event\.key === 'Home'/);
  assert.match(html, /var distance = event\.shiftKey \? 4 : 16/);
  assert.match(html, /preserveLensPlacement: preserveLensPlacement/);
  assert.match(html, /window\.addEventListener\('resize', requestLensPlacement\)/);
  assert.doesNotMatch(diagram, /btn-focus-move|data-focus-drag-handle|data-manual-placement|data-panel-dragging/);
});

test('Node Finder searches and presents the same passport facts', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /var authored = node\.getAttribute\('data-node-kind'\)/);
  assert.match(html, /var sublabel = node\.getAttribute\('data-node-sublabel'\) \|\| ''/);
  assert.match(html, /var context = node\.getAttribute\('data-node-context'\) \|\| ''/);
  assert.match(html, /var tag = node\.getAttribute\('data-node-tag'\) \|\| ''/);
  assert.match(html, /search: \(id \+ ' ' \+ label \+ ' ' \+ type \+ ' ' \+ sublabel \+ ' ' \+ context \+ ' ' \+ tag \+ ' ' \+ sourceSearch \+ ' ' \+ text\)\.toLowerCase\(\)/);
  assert.match(html, /\[viewerKindLabel\(item\.type\), item\.id, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
  assert.match(html, /meta\.title = \[viewerKindLabel\(item\.type\), item\.id, item\.context, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
});

test('internal structure projection is text-only and preserves native history semantics', () => {
  assert.match(focusSource, /detail\.after\(quicklook\)/);
  assert.match(focusSource, /textElement\('h2', 'node-structure-title'/);
  assert.match(focusSource, /textElement\('ul', 'node-structure-tree'/);
  assert.match(focusSource, /structureBody = textElement\('div', 'node-structure-body'/);
  assert.doesNotMatch(focusSource, /\.innerHTML\s*=/);
  assert.match(focusSource, /history\.pushState\(structureEntry, '', url\)/);
  assert.match(focusSource, /renderStructure\(id, section, requestedItem\)[\s\S]+?return surfaceReady\.then\(function \(\) \{[\s\S]+?history\.pushState\(structureEntry, '', url\)/);
  assert.match(focusSource, /pendingOpen = \{ revision: expectedRevision, trigger: trigger \}/);
  assert.match(focusSource, /deactivateStructure\(\{ restoreFocus: false, restoreScroll: true \}\)[\s\S]+?userError\(id, error\)/);
  assert.match(focusSource, /ArchifyAddress\.send\('navigate', \{ focus: id, inspect: 'structure', section: section, item: requestedItem/);
  assert.match(focusSource, /ArchifyAddress\.send\('structure-return'\)/);
  assert.match(focusSource, /renderError\(id, 'viewer\.internalStructure\.empty', 'empty'\);[\s\S]+?empty: true/);
  assert.match(focusSource, /graphState\.forEach\(hideElement\)/);
  assert.match(focusSource, /state\.element\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(focusSource, /currentSurface === 'structure' && currentNodeId === id[\s\S]+?return Promise\.resolve\(true\)/);
});

test('standalone internal-structure entries carry exact-address reading snapshots', () => {
  const start = focusSource.indexOf('      function standaloneHistoryState(');
  const end = focusSource.indexOf('      function scheduleStandaloneReadingSave()', start);
  assert.ok(start >= 0 && end > start, 'standalone history helpers remain independently testable');
  const helpers = vm.runInNewContext(`(() => {\n${focusSource.slice(start, end)}\nreturn { standaloneHistoryState, storedStandaloneReading };\n})()`);
  const reading = { surface: 'graph', nodeId: 'controller', scrollTop: 91, focus: { id: 'focus-internal-structure' } };
  const state = helpers.standaloneHistoryState({ owner: 'kept' }, 'graph', 'https://example.test/map#focus=controller', 'controller', null, reading);
  assert.equal(state.owner, 'kept');
  assert.deepEqual(JSON.parse(JSON.stringify(state.archifyInternalStructure)), {
    surface: 'graph', href: 'https://example.test/map#focus=controller', nodeId: 'controller', graphHref: null, reading,
  });
  assert.deepEqual(helpers.storedStandaloneReading(state, 'https://example.test/map#focus=controller'), reading);
  assert.equal(helpers.storedStandaloneReading(state, 'https://example.test/map#focus=other'), null);
});

test('standalone internal-structure history commits after preparation and restores traversed entries', () => {
  assert.match(focusSource,
    /return surfaceReady\.then\(function \(\) \{[\s\S]+?history\.replaceState\(graphEntry[\s\S]+?history\.pushState\(structureEntry/);
  assert.match(focusSource, /window\.addEventListener\('popstate', syncStandaloneHistoryWithoutUnhandledRejection\)/);
  assert.match(focusSource,
    /expectedRevision = \+\+standaloneSyncRevision[\s\S]+?expectedHref = location\.href[\s\S]+?storedStandaloneReading\(history\.state, expectedHref\)[\s\S]+?syncAddress\(\)[\s\S]+?expectedRevision !== standaloneSyncRevision \|\| location\.href !== expectedHref[\s\S]+?restore\(reading/);
  assert.match(focusSource, /showSection[\s\S]+?replaceStandaloneReading\(url\)/);
  assert.match(focusSource, /history\.back\(\)[\s\S]+?return true/);
});

test('structure tree exposes keyboard navigation and selection', () => {
  assert.match(focusSource, /rootList\.setAttribute\('role', 'tree'\)/);
  assert.match(focusSource, /button\.setAttribute\('role', 'treeitem'\)/);
  assert.match(focusSource, /event\.key === 'ArrowDown'/);
  assert.match(focusSource, /event\.key === 'ArrowUp'/);
  assert.match(focusSource, /event\.key === 'ArrowLeft'/);
  assert.match(focusSource, /event\.key === 'ArrowRight'/);
  assert.match(focusSource, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('internal structure controls keep a 44px hit target at every viewport', () => {
  for (const selector of [
    '\\.node-structure-entry',
    '\\.node-structure-actions button',
    '\\.node-structure-mode',
    '\\.node-structure-treeitem',
    '\\.node-structure-source',
  ]) {
    assert.match(focusSource, new RegExp(`${selector}\\{[^}]*min-height:44px`));
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
