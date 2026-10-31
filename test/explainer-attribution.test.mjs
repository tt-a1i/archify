import assert from 'node:assert/strict';
import test from 'node:test';
import { renderExplainer } from '../archify/explainer/render.mjs';
import { validateExplainer } from '../archify/explainer/validate.mjs';

function documentOf(evidence) {
  return {
    schema_version: 1,
    diagram_type: 'explainer',
    meta: { id: 'claim-page', title: 'Claim evidence' },
    answer: { summary: 'Latency improved.', ...(evidence ? { evidence } : {}) },
    panels: [{ id: 'results', title: 'Results', blocks: [{ id: 'latency-chart', type: 'chart', text: 'pie title Latency\n  "Improved" : 80\n  "Baseline" : 120', title: 'Latency' }] }],
    sources: [{ id: 'runbook', title: 'Runbook', url: 'https://example.com/runbook' }],
  };
}

test('claim evidence accepts stable block and source IDs and exposes navigable HTML mapping', () => {
  const document = documentOf(['latency-chart', 'runbook']);
  assert.equal(validateExplainer(document).ok, true);
  const html = renderExplainer(document, { sourceText: JSON.stringify(document), preparedSources: { sources: {} }, preparedDiagrams: { diagrams: {} } });
  assert.match(html, /data-claim-evidence="latency-chart"/);
  assert.match(html, /href="#latency-chart"/);
  assert.match(html, /data-claim-evidence="runbook"/);
  assert.match(html, /href="#source-runbook"/);
  assert.match(html, /class="answer-verdict"/);
  assert.match(html, /aria-hidden="true"> · <\/span>/);
});

test('claim evidence reports dangling IDs without changing legacy documents', () => {
  const invalid = validateExplainer(documentOf(['missing-evidence']));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.diagnostics.some(diagnostic => diagnostic.code === 'explainer/unresolved-reference'));
  assert.equal(validateExplainer(documentOf()).ok, true);
});

test('claim evidence rejects an ID shared by a source and content target', () => {
  const document = documentOf(['latency-chart']);
  document.sources[0].id = 'latency-chart';
  const result = validateExplainer(document);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(diagnostic => (
    diagnostic.code === 'explainer/ambiguous-reference'
    && diagnostic.subject.path === '/answer/evidence/0'
  )));
});
