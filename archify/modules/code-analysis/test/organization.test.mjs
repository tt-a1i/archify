import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, evaluateGraph } from '../lib/analysis.mjs';
import { run } from '../evaluate/rules/organization/generic-name.mjs';
import { extractFacts } from '../lib/analysis.mjs';
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
