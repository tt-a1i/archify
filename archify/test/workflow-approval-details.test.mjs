import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';
import { workflow as validateWorkflowSchema } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers', 'workflow', 'render-workflow.mjs');
const examplePath = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-approval-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approvalWorkflow(locale = 'en') {
  const document = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  document.meta.locale = locale;
  delete document.meta.output;
  delete document.cards;
  const approval = document.nodes.find(({ id }) => id === 'approval');
  approval.approval = {
    initiator: 'Release manager',
    approvers: ['Security owner', 'Service owner'],
    deliverables: ['Signed release checklist', 'Rollback evidence'],
    reworkPath: ['approval-denied', 'retry-request'],
  };
  return document;
}

function render(document, name) {
  const input = path.join(tmp, `${name}.workflow.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, `${JSON.stringify(document, null, 2)}\n`);
  const result = spawnSync(process.execPath, [renderer, input, output], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  return {
    ...result,
    output,
    html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '',
  };
}

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'browser evaluation failed');
  }
  return response.result?.value;
}

async function loadArtifact(browser, artifactPath) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
  })`, true);
  return sessionId;
}

function geometry(receipt) {
  return {
    contract: receipt.contract,
    viewBox: receipt.viewBox,
    requiredViewBox: receipt.requiredViewBox,
    columns: receipt.columns,
    nodes: receipt.nodes,
    edges: receipt.edges,
    labels: receipt.labels,
  };
}

test('workflow approval details are opt-in schema data and do not change overview geometry', () => {
  const detailed = approvalWorkflow();
  const overview = clone(detailed);
  delete overview.nodes.find(({ id }) => id === 'approval').approval;

  assert.equal(validateWorkflowSchema(detailed), true, JSON.stringify(validateWorkflowSchema.errors));
  const overviewResult = compileWorkflow({ workflow: overview });
  const detailedResult = compileWorkflow({ workflow: detailed });
  assert.equal(overviewResult.ok, true, JSON.stringify(overviewResult.diagnostics, null, 2));
  assert.equal(detailedResult.ok, true, JSON.stringify(detailedResult.diagnostics, null, 2));
  assert.deepEqual(geometry(detailedResult.receipt), geometry(overviewResult.receipt));
  assert.deepEqual(detailedResult.receipt.detailStrategy, {
    interactive: 'semantic-passport',
    staticExport: 'overview',
  });
  assert.equal(overviewResult.receipt.detailStrategy, undefined);
  assert.doesNotMatch(overviewResult.svg, /data-node-approval|data-static-export-scope/);
  assert.match(detailedResult.svg, /data-static-export-scope="overview"/);
  assert.match(detailedResult.svg, /data-node-approval="\{&quot;initiator&quot;:&quot;Release manager&quot;/);
});

test('approval details remain escaped while native SVG fallbacks expose the full facts', () => {
  const document = approvalWorkflow();
  const approval = document.nodes.find(({ id }) => id === 'approval').approval;
  approval.initiator = 'Release "owner" <ops>';
  approval.approvers = ['Security & privacy'];
  approval.deliverables = ['Signed <release> checklist'];

  const result = compileWorkflow({ workflow: document });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.doesNotMatch(result.svg, /<ops>|<release>/);
  assert.match(result.svg, /aria-label="[^"]*Approval details available"/);
  assert.match(result.svg, /Initiator: Release &quot;owner&quot; &lt;ops&gt;/);
  assert.match(result.svg, /Approvers: Security &amp; privacy/);
  assert.match(result.svg, /Required deliverables: Signed &lt;release&gt; checklist/);
});

test('approval reworkPath rejects unknown and discontinuous authored edge references', () => {
  const unknown = approvalWorkflow();
  unknown.nodes.find(({ id }) => id === 'approval').approval.reworkPath = ['missing-edge'];
  const unknownResult = compileWorkflow({ workflow: unknown });
  assert.equal(unknownResult.ok, false);
  assert.ok(unknownResult.diagnostics.some(({ code, subject }) => (
    code === 'workflow/approval-rework-reference'
      && subject.path === '/nodes/5/approval/reworkPath/0'
  )), JSON.stringify(unknownResult.diagnostics, null, 2));

  const discontinuous = approvalWorkflow();
  discontinuous.nodes.find(({ id }) => id === 'approval').approval.reworkPath = [
    'approval-denied',
    'tool-external-call',
  ];
  const discontinuousResult = compileWorkflow({ workflow: discontinuous });
  assert.equal(discontinuousResult.ok, false);
  assert.ok(discontinuousResult.diagnostics.some(({ code, evidence }) => (
    code === 'workflow/approval-rework-continuity'
      && evidence.expectedFrom === 'blocked'
      && evidence.actualFrom === 'tool'
  )), JSON.stringify(discontinuousResult.diagnostics, null, 2));
});

test('approval details fail closed when required or repeated facts would be lost or duplicated', () => {
  const incomplete = approvalWorkflow();
  delete incomplete.nodes.find(({ id }) => id === 'approval').approval.deliverables;
  assert.equal(validateWorkflowSchema(incomplete), false);
  assert.ok(validateWorkflowSchema.errors?.some(({ instancePath, params }) => (
    instancePath === '/nodes/5/approval' && params.missingProperty === 'deliverables'
  )), JSON.stringify(validateWorkflowSchema.errors, null, 2));

  const blankCases = [
    {
      path: '/nodes/5/approval/initiator',
      update: (approval) => { approval.initiator = ' \t '; },
    },
    {
      path: '/nodes/5/approval/approvers/0',
      update: (approval) => { approval.approvers[0] = '\u00a0'; },
    },
    {
      path: '/nodes/5/approval/deliverables/0',
      update: (approval) => { approval.deliverables[0] = '\n'; },
    },
  ];
  for (const blankCase of blankCases) {
    const blank = approvalWorkflow();
    blankCase.update(blank.nodes.find(({ id }) => id === 'approval').approval);
    assert.equal(validateWorkflowSchema(blank), false);
    assert.ok(validateWorkflowSchema.errors?.some(({ instancePath, keyword }) => (
      instancePath === blankCase.path && keyword === 'pattern'
    )), JSON.stringify(validateWorkflowSchema.errors, null, 2));
  }

  const repeated = approvalWorkflow();
  repeated.nodes.find(({ id }) => id === 'approval').approval.approvers.push('  Security   owner\t');
  const repeatedResult = compileWorkflow({ workflow: repeated });
  assert.equal(repeatedResult.ok, false);
  assert.ok(repeatedResult.diagnostics.some(({ code, subject, evidence }) => (
    code === 'workflow/approval-duplicate-detail'
      && subject.path === '/nodes/5/approval/approvers/2'
      && evidence.firstPath === '/nodes/5/approval/approvers/0'
      && evidence.normalizedValue === 'Security owner'
  )), JSON.stringify(repeatedResult.diagnostics, null, 2));
});

test('the HTML artifact progressively discloses approval facts and labels visual exports as overview-only', () => {
  const result = render(approvalWorkflow(), 'approval-details');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.html, /id="focus-approval"[^>]+hidden/);
  assert.match(result.html, /id="focus-approval-initiator"/);
  assert.match(result.html, /id="focus-approval-approvers"/);
  assert.match(result.html, /id="focus-approval-deliverables"/);
  assert.match(result.html, /id="focus-approval-rework"/);
  assert.match(result.html, /id="export-detail-scope"[^>]+hidden[^>]*>Visual exports show the overview only; approval details remain in this HTML artifact\.<\/p>/);
  assert.match(result.html, /function renderApprovalDetails\(node\)/);
  assert.match(result.html, /JSON\.parse\(node\.getAttribute\('data-node-approval'\) \|\| 'null'\)/);
  assert.match(result.html, /approval\.open = false/);
  assert.match(result.html, /var approvalDetails = node\.getAttribute\('data-node-approval'\) \|\| ''/);
  assert.match(result.html, /text \+ ' ' \+ approvalDetails/);
  assert.match(result.html, /data-static-export-scope="overview"/);

  for (const fact of [
    'Release manager',
    'Security owner',
    'Service owner',
    'Signed release checklist',
    'Rollback evidence',
  ]) {
    assert.match(result.html, new RegExp(fact));
  }
  assert.match(result.html, /Approval Gate[^<]*→[^<]*denied: Blocked[^<]*→[^<]*Retry Path/);
});

test('ordinary workflows keep approval affordances hidden and emit no approval metadata', () => {
  const document = approvalWorkflow('zh-CN');
  delete document.nodes.find(({ id }) => id === 'approval').approval;
  const result = render(document, 'ordinary-workflow');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '', /data-node-approval|data-static-export-scope/);
  assert.match(result.html, /id="focus-approval"[^>]+hidden/);
  assert.match(result.html, /id="export-detail-scope"[^>]+hidden/);
});

test('real Chrome reveals approval facts without growing the first-screen document', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser approval-detail regression.',
}, async () => {
  const document = approvalWorkflow();
  document.nodes.find(({ id }) => id === 'approval').approval.deliverables.push(
    ...Array.from({ length: 16 }, (_, index) => (
      `Evidence package ${index + 1} with deployment, rollback, and audit records`
    )),
  );
  const result = render(document, 'approval-details-browser');
  assert.equal(result.status, 0, result.stderr);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, result.output);
    const state = await evaluate(browser, sessionId, `(async function () {
      var beforeHeight = document.documentElement.scrollHeight;
      Archify.focus.set('approval', { toggle: false });
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
      var detail = document.getElementById('focus-approval');
      var collapsed = detail.hidden === false && detail.open === false;
      detail.open = true;
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
      var chipRect = document.getElementById('focus-chip').getBoundingClientRect();
      var approvalBody = detail.querySelector('.semantic-passport-approval-body');
      var approvalValue = detail.querySelector('dd');
      var approvalScope = detail.querySelector('.semantic-passport-approval-scope');
      var approvalSummary = detail.querySelector('summary');
      var summaryRect = approvalSummary.getBoundingClientRect();
      var input = document.getElementById('node-finder-input');
      Archify.finder.open();
      input.value = 'Rollback evidence';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var finderLabels = Array.prototype.map.call(
        document.querySelectorAll('.node-finder-result strong'),
        function (node) { return node.textContent.trim(); }
      );
      return {
        collapsed: collapsed,
        open: detail.open,
        text: detail.textContent.replace(/\\s+/g, ' ').trim(),
        exportScopeVisible: document.getElementById('export-detail-scope').hidden === false,
        finderLabels: finderLabels,
        beforeHeight: beforeHeight,
        afterHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        chipTop: chipRect.top,
        chipBottom: chipRect.bottom,
        approvalBodyScrollable: approvalBody.scrollHeight > approvalBody.clientHeight,
        approvalValueFontSize: parseFloat(getComputedStyle(approvalValue).fontSize),
        approvalScopeFontSize: parseFloat(getComputedStyle(approvalScope).fontSize),
        approvalSummaryFontSize: parseFloat(getComputedStyle(approvalSummary).fontSize),
        summaryHeight: summaryRect.height
      };
    })()`, true);

    assert.equal(state.collapsed, true);
    assert.equal(state.open, true);
    assert.equal(state.exportScopeVisible, true);
    assert.deepEqual(state.finderLabels, ['Approval Gate']);
    for (const fact of [
      'Release manager',
      'Security owner',
      'Service owner',
      'Signed release checklist',
      'Rollback evidence',
      'Approval Gate → denied: Blocked → Retry Path',
    ]) assert.match(state.text, new RegExp(fact));
    assert.ok(state.beforeHeight <= state.viewportHeight, JSON.stringify(state));
    assert.ok(state.afterHeight <= state.viewportHeight, JSON.stringify(state));
    assert.ok(state.chipTop >= 0 && state.chipBottom <= state.viewportHeight, JSON.stringify(state));
    assert.equal(state.approvalBodyScrollable, true, JSON.stringify(state));
    assert.ok(state.approvalValueFontSize >= 10, JSON.stringify(state));
    assert.ok(state.approvalScopeFontSize >= 9, JSON.stringify(state));
    assert.ok(state.approvalSummaryFontSize >= 10, JSON.stringify(state));

    await evaluate(browser, sessionId, 'Archify.finder.close({ restoreFocus: false })');
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    const mobileState = await evaluate(browser, sessionId, `(async function () {
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
      var chipRect = document.getElementById('focus-chip').getBoundingClientRect();
      var summaryRect = document.querySelector('#focus-approval summary').getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        chipLeft: chipRect.left,
        chipRight: chipRect.right,
        chipBottom: chipRect.bottom,
        summaryHeight: summaryRect.height
      };
    })()`, true);
    assert.ok(mobileState.documentWidth <= mobileState.viewportWidth, JSON.stringify(mobileState));
    assert.ok(mobileState.chipLeft >= 0 && mobileState.chipRight <= mobileState.viewportWidth, JSON.stringify(mobileState));
    assert.ok(mobileState.chipBottom <= mobileState.viewportHeight, JSON.stringify(mobileState));
    assert.ok(mobileState.summaryHeight >= 44, JSON.stringify(mobileState));
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
