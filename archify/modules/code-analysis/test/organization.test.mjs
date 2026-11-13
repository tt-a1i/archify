import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, evaluateGraph, extractFacts } from '../lib/analysis.mjs';
import { run } from '../evaluate/rules/organization/generic-name.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('generic basenames are advisory, opt-in and respect excluded roles', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const include = ['archify/renderers/shared/utils.mjs', 'archify/modules/code-analysis/test/helpers.mjs'];
  const config = { include, roles: { test: [] }, rules: { organization: { genericName: { enabled: true } } } };
  const { facts } = extractFacts(path.resolve(root), { language: 'ts', config });
  const graph = buildGraph(facts, config);
  const signal = ({ diagnostics }) => diagnostics.filter(finding => finding.code === 'organization/generic-name');
  assert.deepEqual(signal(evaluateGraph(graph, { include }, facts, { root })), []);
  const findings = signal(evaluateGraph(graph, config, facts, { root }));
  assert.deepEqual(findings.map(finding => finding.subject.file).sort(), [...include].sort());
  assert.ok(findings.every(finding => finding.severity === 'warning' && finding.confidence === 0.7 && finding.evidenceDigest.files[0] === finding.subject.file));
  assert.deepEqual(run({ graph: { excluded: { roles: ['test'] } }, facts: { files: [{ path: 'helpers.mjs', role: 'test' }] } }), []);
});

test('an opted-in naming warning appears on its mapped component and offers an evidence-backed retention task', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const file = 'archify/renderers/shared/utils.mjs';
  const off = { include: [file], roles: { test: [] } };
  const on = { ...off, rules: { organization: { genericName: { enabled: true } } } };
  const { facts } = extractFacts(root, { language: 'ts', config: on });
  const graph = buildGraph(facts, on);
  const ir = { components: [{ id: 'shared', label: 'Shared renderers', sources: [{ path: file }] }], connections: [] };
  const html = '<body><div class="toolbar"></div><svg><g data-node-id="shared"></g></svg></body>';
  const overlay = (config, run) => {
    const findingsDocument = evaluateGraph(graph, config, facts, { root });
    const page = buildOverlay({ ir, graph, html, facts, findings: findingsDocument.diagnostics, findingsDocument, run }).html;
    return JSON.parse(page.match(/<script type="application\/json" id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
  };

  const disabled = overlay(off);
  const initialStatus = disabled.components[0].indicators.status;
  assert.ok(['green', 'blue'].includes(initialStatus));
  assert.ok(!disabled.components[0].indicators.items.some(item => item.key === 'generic-name'));

  const enabled = overlay(on);
  const finding = enabled.findings.find(f => f.code === 'organization/generic-name');
  assert.ok(finding);
  assert.deepEqual(finding.componentIds, ['shared']);
  const component = enabled.components[0];
  assert.equal(component.indicators.status, 'amber');
  const indicator = component.indicators.items.find(item => item.key === 'generic-name');
  assert.equal(indicator.status, 'amber');
  assert.deepEqual(indicator.findings, [finding.id]);
  assert.ok(component.findings.some(f => f.id === finding.id));

  const { task, markdown } = enabled.tasks[finding.id];
  assert.deepEqual(task.scope.modify, []);
  assert.deepEqual(task.scope.read, [file]);
  assert.match(task.acceptance.join(' '), /justified rename.*or.*retain.*caller evidence/i);
  assert.match(task.verification.reanalyze.purpose, /retain.*may still be reported/i);
  assert.match(markdown, /retain.*caller evidence/i);

  const accepted = overlay(on, { review: { findings: { [finding.id]: { status: 'accepted' } } } });
  assert.equal(accepted.components[0].indicators.status, initialStatus);
  assert.ok(accepted.components[0].findings.some(f => f.id === finding.id));
});
