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
  assert.match(html, /target\.closest\('\[data-node-id\], \[data-relationship-hit-key\], \.overview-map'\)/);
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

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
