import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildGraph, evaluateGraph } from '../lib/analysis.mjs';
import { buildTask, buildTaskPayloads, renderTaskMarkdown } from '../lib/task.mjs';
import { verifyTask } from '../lib/evidence.mjs';
import { schemaErrors } from '../schemas/index.mjs';

test('module tasks give bounded structure while the full digest still detects unsampled file changes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-module-summary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = Array.from({ length: 90 }, (_, i) => ({ path: `src/server/route-${String(i).padStart(2, '0')}.ts`,
    sourceText: `export const n${i} = ${i};\n` + '// context\n'.repeat(i + 1), loc: i + 2, role: 'source' }));
  files.push({ path: 'outside/main.ts', sourceText: 'export const entry = 1;\n', loc: 1, role: 'source' });
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true }); fs.writeFileSync(path.join(root, file.path), file.sourceText); }
  const facts = { schema_version: 1, repository: { root: '.', revision: null, url: null, sourceKind: 'working-tree', language: 'ts', adapter: 'typescript@test', snapshotId: 'a'.repeat(64) },
    files, imports: [{ from: 'outside/main.ts', to: files[0].path, specifier: '../src/server/route-00', resolved: true, kind: 'static', line: 1 }], functions: [], symbols: [], calls: [],
    unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  const config = { rules: { coupling: { concentration: { minModules: 2 } } } };
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts, { root });
  const diagnostic = findings.diagnostics.find(d => d.code === 'coupling/concentration' && d.subject.module === 'src-server');
  assert.ok(diagnostic);
  const task = buildTask({ findings, facts, ids: [diagnostic.id] });
  assert.deepEqual(schemaErrors('ai-task', task), []);
  assert.deepEqual(task.findings[0].evidenceDigest, diagnostic.evidenceDigest);
  assert.equal(task.findings[0].evidenceDigest.files.length, 90);
  assert.deepEqual(task.locations, [], 'do not manufacture line evidence for module membership');
  assert.ok(task.scope.read.length <= 16);
  const summary = task.moduleSummaries[0];
  assert.equal(summary.files, 90);
  assert.equal(summary.path, 'src/server');
  assert.equal(summary.largestFiles.items[0].file, files[89].path);
  assert.deepEqual(summary.entryFiles.items, [{ file: files[0].path, importers: 1 }]);
  assert.deepEqual(summary.clusters.items, [{ pathGroup: 'route-*', files: 90, loc: files.slice(0, 90).reduce((n, f) => n + f.loc, 0) }]);
  const markdown = renderTaskMarkdown(task);
  assert.doesNotMatch(markdown, /No line evidence for this file/);
  assert.match(markdown, /Path\/name groups/);
  assert.ok(markdown.split('\n').length < 150);
  assert.deepEqual(buildTaskPayloads({ findings, facts, ids: [diagnostic.id] })[diagnostic.id], { task, markdown });
  assert.equal(verifyTask(task, root).evidence.status, 'valid');
  const unsampled = files[20].path;
  assert.ok(!task.scope.read.includes(unsampled));
  fs.appendFileSync(path.join(root, unsampled), '// changed outside the summary\n');
  assert.equal(verifyTask(task, root).evidence.status, 'changed');
  fs.unlinkSync(path.join(root, unsampled));
  assert.notEqual(verifyTask(task, root).evidence.status, 'valid');
  const legacy = structuredClone(task); delete legacy.moduleSummaries;
  assert.deepEqual(schemaErrors('ai-task', legacy), [], 'historical tasks do not require summaries');
});
