// The module analyzes itself. An error-level finding here is a structural
// problem in this module's own code (today: a dependency cycle between its
// folders), so the suite fails on it instead of letting it reach Labs unseen.
//
// Warnings (complex functions, concentration, internal imports) are not
// gated: they are listed in the test output so a change that adds some is
// visible, but a gate on them would block unrelated work on every function
// that is already complex. To see the full report:
//
//   node archify/bin/archify.mjs code-analysis check archify/modules/code-analysis --language ts
//
// Only the JS sources of the module are analyzed here; the Python helper, the
// Go and Rust extractors are separate programs with their own tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildGraph, evaluateGraph, extractFacts } from '../lib/analysis.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('self-check: the module has no error-level findings on its own code', () => {
  const { facts, config } = extractFacts(ROOT, { language: 'ts' });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts, { root: ROOT });
  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const d of findings.diagnostics) bySeverity[d.severity] += 1;
  const cycles = findings.diagnostics.filter((d) => d.code === 'coupling/cycle' || d.code === 'coupling/import-cycle');
  const errors = findings.diagnostics.filter((d) => d.severity === 'error');

  console.log(`self-check: ${facts.files.length} files, ${graph.modules.length} modules, ${bySeverity.error} error, ${bySeverity.warning} warning, ${bySeverity.info} info`);
  assert.ok(graph.modules.length >= 10, 'the module graph covers the module, not a fixture');
  assert.deepEqual(cycles.map((d) => d.message), [], 'no folder of this module may depend, directly or indirectly, on a folder that depends on it');
  assert.deepEqual(errors.map((d) => `${d.code}: ${d.message}`), [],
    'an error-level finding on this module itself; fix it, or explain in the PR why the rule is wrong here');
});
