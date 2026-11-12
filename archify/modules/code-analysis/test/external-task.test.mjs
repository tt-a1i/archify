// External tasks preserve the imported claim, its captured source and its limits.
// These are small authored import-contract inputs, not freshly executed lint scans.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildTask, renderTaskMarkdown, validateTask } from '../lib/task.mjs';
import { createRangeDigest, verifyTask } from '../lib/evidence.mjs';
import { importExternal } from '../lib/external.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'task.mjs');
const ID = 'CONV-123456abcdef';
const hash = (text) => createHash('sha256').update(text).digest('hex');

function capturedRun(t, { binding = 'verified', command = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-task-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'main.ts': 'export const value = 1;\n',
    'worker.py': '# café 😀\nimport os\nprint("ready")\n',
  };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  const repository = { root: '.', language: 'ts', adapter: 'typescript@test', sourceKind: 'working-tree', snapshotId: '1'.repeat(64) };
  const facts = { repository, files: [{ path: 'main.ts', sourceText: files['main.ts'] }] };
  const locations = [{ file: 'worker.py', line: 2, endLine: 2, column: 8, endColumn: 10 }, { file: 'main.ts', line: 1, endLine: 1, column: 14, endColumn: 19 }];
  const external = {
    sourceId: 'workspace-lint', tool: 'ESLint', ruleId: '@example/no-unused-vars', originalSeverity: 2,
    reportPointer: '/0/messages/0', identityRevision: 1, fingerprint: 'source-fingerprint/v1:test',
    binding, reviewDigest: '2'.repeat(64), locations,
    helpUri: 'https://example.invalid/rules/no-unused-vars',
  };
  const diagnostic = {
    id: ID, code: 'conventions/eslint', dimension: 'conventions', severity: 'warning', confidence: null,
    message: 'The imported tool reports an unused name.',
    subject: { ...locations[0], locations }, evidence: { reportNote: 'A source claim, not an Archify rule threshold.' },
    supportedFixes: ['Review whether the name is intentionally retained.'], external,
    evidenceDigest: createRangeDigest(locations, new Map(Object.entries(files))),
  };
  const context = {
    id: external.sourceId, format: 'eslint', tool: 'ESLint', toolVersion: 'test', adapterRevision: 1, identityRevision: 1,
    reportSha256: '3'.repeat(64), configDigest: '4'.repeat(64), status: 'imported',
    coverage: { files: ['main.ts', 'worker.py'], complete: true }, binding, suppressed: 0, notices: [],
    sourceHashes: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, hash(text)])),
    ...(command ? { command } : {}),
  };
  const findings = {
    schema_version: 1, repository, rules: [diagnostic.code], summary: { errors: 0, warnings: 1, info: 0, suppressed: 0 },
    analysis: {
      analyzer: { name: '@archify/code-analysis', version: 'test' }, language: 'ts', adapter: 'typescript@test', configDigest: '5'.repeat(64),
      ruleVersions: { [diagnostic.code]: 1 }, coverage: { files: 1, excludedRoles: [], parseErrors: [] }, external: [context],
    },
    externalEvidence: [{ path: 'worker.py', sourceText: files['worker.py'], sha256: hash(files['worker.py']) }],
    diagnostics: [diagnostic],
  };
  return { root, files, facts, findings, diagnostic, context };
}

test('external task: exported JSON and Markdown keep rule, source, related positions and supplemental excerpts', (t) => {
  const run = capturedRun(t);
  run.findings.analysis.external.push({ ...run.context, id: 'unselected-source', command: 'unselected command' });
  const task = buildTask({ ...run, ids: [ID] });
  assert.deepEqual(schemaErrors('ai-task', task), []);
  assert.equal(task.findings[0].confidence, null);
  assert.equal(task.findings[0].external.ruleId, '@example/no-unused-vars');
  assert.equal(task.findings[0].external.originalSeverity, 2);
  assert.deepEqual(task.source.external.map((s) => s.id), ['workspace-lint']);
  assert.deepEqual(task.locations.map((l) => [l.file, l.startLine, l.startColumn, l.endColumn]), [['worker.py', 2, 8, 10], ['main.ts', 1, 14, 19]]);
  assert.equal(task.locations[0].sha256, hash('import os'));
  assert.ok(task.locations[0].excerpt.segments[0].lines.includes('import os'));
  assert.deepEqual(task.scope.modify, ['main.ts', 'worker.py']);
  assert.deepEqual(task.facts[0].evidence, run.diagnostic.evidence);
  assert.deepEqual(task.verification.commands, [], 'no command is invented or imported from another source');
  assert.ok(task.toConfirm.some((item) => item.includes('no generation command was recorded')));
  assert.match(task.verification.reanalyze.purpose, /does not run the external tools/);
  const markdown = renderTaskMarkdown(task);
  assert.match(markdown, /What the external sources reported/);
  assert.match(markdown, /@example\/no-unused-vars/);
  assert.match(markdown, /Source severity: 2; product severity: warning/);
  assert.match(markdown, /Columns: 8–10/);
  assert.match(markdown, /```python\n/);
  assert.match(markdown, /report SHA-256/);
  assert.match(markdown, /re-reading a previous report is not a new tool run/);
});

test('external task: commands come only from selected source manifests or explicit task arguments and are never run', (t) => {
  const run = capturedRun(t, { command: 'recorded-lint-command --json > lint.json' });
  const task = buildTask({ ...run, ids: [ID], commands: [{ command: 'recorded-project-tests' }] });
  assert.deepEqual(task.verification.commands.map((c) => c.command), ['recorded-project-tests', 'recorded-lint-command --json > lint.json']);
  assert.equal(task.verification.commands[1].source, 'external source manifest: workspace-lint');
  assert.match(task.verification.commands[1].purpose, /original configuration and scan scope/);
  assert.ok(!task.toConfirm.some((item) => /no generation command was recorded/.test(item)));
  assert.equal(fs.existsSync(path.join(run.root, 'lint.json')), false);
});

test('external task: source claim changes get a different task identity even when the code stays the same', (t) => {
  const run = capturedRun(t);
  const before = buildTask({ ...run, ids: [ID] });
  run.diagnostic.external = { ...run.diagnostic.external, reviewDigest: '6'.repeat(64), originalSeverity: 1 };
  const after = buildTask({ ...run, ids: [ID] });
  assert.notEqual(after.taskId, before.taskId);
  assert.equal(after.findings[0].evidenceDigest.sha256, before.findings[0].evidenceDigest.sha256);
});

test('external task: corrupt or conflicting supplemental evidence fails instead of being attached to a task', (t) => {
  const run = capturedRun(t);
  run.findings.externalEvidence[0].sourceText = 'different source\n';
  assert.throws(() => buildTask({ ...run, ids: [ID] }), (error) => error.diagnostics?.[0]?.code === 'task/evidence-invalid');
  run.findings.externalEvidence = [{ path: 'main.ts', sourceText: run.files['main.ts'], sha256: hash(run.files['main.ts']) }];
  assert.throws(() => buildTask({ ...run, ids: [ID] }), (error) => error.diagnostics?.[0]?.code === 'task/evidence-invalid');
});

test('external task: old diff and whole-file claims retain origin without granting a line-based modification scope', (t) => {
  const run = capturedRun(t, { binding: 'changed' });
  assert.deepEqual(buildTask({ ...run, ids: [ID] }).scope.modify, [], 'a stale report cannot authorize edits even when it lists source lines');
  run.diagnostic.code = 'external/coderabbit';
  run.diagnostic.dimension = 'external-review';
  run.diagnostic.external = {
    ...run.diagnostic.external, tool: 'CodeRabbit', ruleId: null, originalSeverity: null,
    locations: [{ file: 'worker.py' }],
    origin: { id: 42, url: 'https://example.invalid/pr/1#discussion-42', commit: 'old-commit', side: 'LEFT', original_line: 2 },
  };
  run.diagnostic.subject = { file: 'worker.py' };
  delete run.diagnostic.evidenceDigest;
  const task = buildTask({ ...run, ids: [ID] });
  assert.equal(task.locations[0].kind, 'file');
  assert.equal(task.locations[0].startLine, undefined);
  assert.equal(task.locations[0].excerpt, null);
  assert.deepEqual(task.scope.modify, []);
  assert.ok(task.scope.read.includes('worker.py'));
  assert.equal(task.findings[0].external.origin.side, 'LEFT');
  assert.match(task.acceptance[0], /retained behaviour is accepted with an explicit reason/);
  assert.match(renderTaskMarkdown(task), /"side": "LEFT"/);
});

test('external task: unknown report binding stays unverifiable after source bytes are checked', (t) => {
  const run = capturedRun(t, { binding: 'unverified' });
  const captured = buildTask({ ...run, ids: [ID] });
  const checked = verifyTask(captured, run.root);
  assert.equal(checked.evidence.status, 'unverifiable');
  assert.equal(checked.evidence.findings[ID].sourceStatus, 'valid');
  assert.equal(checked.evidence.findings[ID].reportBinding, 'unverified');
  assert.deepEqual(schemaErrors('ai-task', checked), []);
});

test('SARIF text assertions keep uncited scanned files bound during task verification', (t) => {
  const run = capturedRun(t);
  const report = { version: '2.1.0', runs: [{
    tool: { driver: { name: 'ExampleLint', version: '1.0' } },
    artifacts: [
      { location: { uri: 'main.ts' }, contents: { text: run.files['main.ts'] } },
      { location: { uri: 'worker.py' }, contents: { text: run.files['worker.py'] } },
    ],
    results: [{ ruleId: 'example-rule', message: { text: 'Review the exported value.' }, locations: [
      { physicalLocation: { artifactLocation: { index: 0 }, region: { startLine: 1 } } },
    ] }],
  }] };
  fs.writeFileSync(path.join(run.root, 'report.json'), JSON.stringify(report));
  const imported = importExternal({ root: run.root, facts: run.facts, config: { external: { sources: [{ id: 'example-sarif', format: 'sarif', file: 'report.json' }] } } });
  assert.equal(imported.sources[0].binding, 'verified');
  assert.equal(imported.sources[0].sourceHashes, undefined, 'the report contains only text assertions');
  const findings = {
    ...run.findings,
    diagnostics: imported.diagnostics,
    externalEvidence: imported.evidenceFiles,
    analysis: { ...run.findings.analysis, external: imported.sources },
  };
  assert.deepEqual(schemaErrors('findings', findings), []);
  const id = imported.diagnostics[0].id;
  const task = buildTask({ findings, facts: run.facts, ids: [id] });
  assert.deepEqual(task.source.external[0].sourceTextHashes, {
    'main.ts': hash(run.files['main.ts']),
    'worker.py': hash(run.files['worker.py']),
  });
  assert.deepEqual(schemaErrors('ai-task', task), []);
  assert.equal(verifyTask(task, run.root).evidence.status, 'valid');
  fs.writeFileSync(path.join(run.root, 'worker.py'), `\ufeff${run.files['worker.py']}`);
  assert.equal(verifyTask(task, run.root).evidence.status, 'valid', 'a text-only assertion accepts an equivalent decoded Python BOM');
  fs.writeFileSync(path.join(run.root, 'worker.py'), `\ufeff${run.files['worker.py'].replace('ready', 'changed')}`);
  const stale = verifyTask(task, run.root);
  assert.equal(stale.evidence.findings[id].reportBinding, 'changed');
  assert.equal(stale.evidence.status, 'changed');
  const taskFile = path.join(run.root, 'task.json');
  fs.writeFileSync(taskFile, JSON.stringify(task));
  const required = spawnSync(process.execPath, [BIN, '--verify', taskFile, '--root', run.root, '--require-valid', '--json'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(required.status, 1, required.stderr);
  assert.equal(JSON.parse(required.stdout).evidence, 'changed');
});

test('external task: verified report binding cannot upgrade an exhausted source digest budget', (t) => {
  const run = capturedRun(t);
  const captured = new Map(Object.entries(run.files));
  // Model source text captured without a UTF-8 signature, while generation-time
  // byte hashes correctly bind the signed files. Seven independent signatures
  // need more representations than the bounded legacy digest search examines.
  for (let i = 0; i < 7; i++) {
    const file = `context${i}.ts`, text = `export const context${i} = 1;\n`;
    fs.writeFileSync(path.join(run.root, file), `\ufeff${text}`);
    captured.set(file, text);
    run.findings.externalEvidence.push({ path: file, sourceText: text, sha256: hash(text) });
    run.diagnostic.external.locations.push({ file, line: 1, endLine: 1, role: 'related' });
  }
  const files = [...captured.keys()].sort();
  run.diagnostic.evidenceDigest = { files, sha256: hash(JSON.stringify(files.map(file => [file, hash(captured.get(file))]))) };
  run.context.coverage.files = files;
  run.context.sourceHashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(run.root, file)))]));

  const checked = verifyTask(buildTask({ ...run, ids: [ID] }), run.root);
  assert.ok(checked.locations.every(location => location.status === 'valid'));
  assert.equal(checked.evidence.findings[ID].digestMatches, null);
  assert.equal(checked.evidence.findings[ID].reportBinding, 'verified');
  assert.equal(checked.evidence.findings[ID].sourceStatus, 'unverifiable');
  assert.equal(checked.evidence.status, 'unverifiable');
  assert.match(checked.evidence.reason, /could not be recomputed/);
  assert.deepEqual(schemaErrors('ai-task', checked), []);
});

test('external task schema: null confidence cannot silently remove external provenance', (t) => {
  const task = buildTask({ ...capturedRun(t), ids: [ID] });
  delete task.findings[0].external;
  assert.throws(() => validateTask(task), (error) => error.diagnostics?.[0]?.code === 'task/invalid');
});

test('external task CLI: embedded evidence and source context survive create/verify; require-valid protects unknown or changed reports', (t) => {
  const run = capturedRun(t, { command: 'recorded-lint-command --json > lint.json' });
  const dir = path.join(run.root, 'analysis');
  fs.mkdirSync(dir);
  const writeAnalysis = () => {
    fs.writeFileSync(path.join(dir, 'raw-facts.json'), JSON.stringify(run.facts));
    fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(run.findings));
  };
  const command = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 30000 });
  writeAnalysis();
  const created = command([dir, '--finding', ID, '--root', run.root, '--format', 'json', '--require-valid']);
  assert.equal(created.status, 0, created.stderr);
  const task = JSON.parse(created.stdout);
  assert.equal(task.evidence.status, 'valid');
  assert.equal(task.locations[0].sha256, hash('import os'));
  assert.equal(fs.existsSync(path.join(run.root, 'lint.json')), false, 'task preparation never runs recorded commands');
  const file = path.join(run.root, 'exported-task.json');
  fs.writeFileSync(file, created.stdout);
  fs.writeFileSync(path.join(run.root, 'worker.py'), run.files['worker.py'].replace('import os', 'import sys'));
  const changed = command(['--verify', file, '--root', run.root, '--require-valid', '--json']);
  assert.equal(changed.status, 1, changed.stderr);
  assert.equal(JSON.parse(changed.stdout).evidence, 'changed');
  fs.writeFileSync(path.join(run.root, 'worker.py'), run.files['worker.py']);
  run.diagnostic.external.binding = 'unverified';
  run.context.binding = 'unverified';
  writeAnalysis();
  const unknown = command([dir, '--finding', ID, '--root', run.root, '--require-valid', '--json']);
  assert.equal(unknown.status, 1, unknown.stderr);
  const receipt = JSON.parse(unknown.stdout);
  assert.equal(receipt.evidence, 'unverifiable');
  assert.deepEqual(receipt.external, [{ id: 'workspace-lint', tool: 'ESLint', binding: 'unverified' }]);
});
