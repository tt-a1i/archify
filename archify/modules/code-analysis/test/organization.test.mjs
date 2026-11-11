import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTask } from '../lib/task.mjs';
import { findingModules } from '../overlay/inject.mjs';
import { schemaErrors } from '../schemas/index.mjs';

test('organization heuristics are opt-in and preserve explainable role evidence', async () => {
  const { evaluate } = await import('../evaluate/index.mjs');
  const facts = { repository: { language: 'ts' }, files: [
    { path: 'src/util.js', role: 'source', sourceText: 'export function util() {}\n' },
    { path: 'src/entry.js', role: 'source', sourceText: 'const fs = require("fs"); process.argv; render(view); class Model {}\n' },
  ], imports: [], functions: [] };
  const graph = { repository: facts.repository, modules: [], edges: [], fileModules: {}, excluded: { roles: ['test', 'generated'], files: 0 } };
  const config = { rules: { organization: { mixedRoles: { enabled: true }, folderRoles: { enabled: false }, genericName: { enabled: true } } }, ignore: [] };
  const findings = evaluate(graph, config, facts);
  assert.ok(findings.diagnostics.some((finding) => finding.code === 'organization/generic-name'));
  const mixed = findings.diagnostics.find((finding) => finding.code === 'organization/mixed-roles');
  assert.ok(mixed);
  assert.equal(mixed.dimension, 'organization');
  assert.ok(Object.hasOwn(mixed.evidence, 'threshold'));
  assert.deepEqual(mixed.evidence.roles, ['entry', 'io', 'model', 'view']);
  assert.deepEqual(mixed.evidence.triggers.map(({ role }) => role), ['entry', 'io', 'view', 'model']);
  assert.ok(mixed.evidence.triggers.every(({ line, text }) => Number.isInteger(line) && text));
  assert.equal(evaluate(graph, {}, facts).rules.some((rule) => rule.startsWith('organization/')), false);
});

test('folder role evidence feeds evidence digests and task read scope', async () => {
  const { evaluate } = await import('../evaluate/index.mjs');
  const facts = { repository: { language: 'ts' }, files: [
    { path: 'src/entry.js', role: 'source', sourceText: 'process.argv;\n' },
    { path: 'src/io.js', role: 'source', sourceText: 'const fs = require("fs");\n' },
    { path: 'src/model.js', role: 'source', sourceText: 'class Model {}\n' },
    { path: 'src/view.js', role: 'source', sourceText: 'render(view);\n' },
  ], imports: [], functions: [] };
  const graph = {
    repository: facts.repository,
    modules: [{ id: 'module-src', label: 'src', path: 'src', files: 4, loc: 4, fanIn: 0, fanOut: 0, instability: null, entry: [] }],
    edges: [],
    fileModules: Object.fromEntries(facts.files.map((file) => [file.path, 'module-src'])),
    excluded: { roles: ['test', 'generated'], files: 0 },
  };
  const findings = evaluate(graph, { rules: { organization: { folderRoles: { enabled: true } } } }, facts);
  const finding = findings.diagnostics.find((entry) => entry.code === 'organization/folder-roles');
  const files = facts.files.map((file) => file.path);
  assert.ok(finding);
  assert.deepEqual(finding.subject, { directory: 'src' });
  assert.deepEqual(findingModules(finding, new Map(Object.entries(graph.fileModules))), ['module-src']);
  assert.deepEqual(schemaErrors('findings', findings), []);
  const extended = { ...facts, files: [...facts.files, { path: 'src/extra.js', role: 'source', sourceText: 'render(extra);' }] };
  const changed = evaluate(graph, { rules: { organization: { folderRoles: { enabled: true } } } }, extended).diagnostics.find((item) => item.code === 'organization/folder-roles');
  assert.equal(changed.id, finding.id, 'directory identity is stable when members change');
  assert.notEqual(changed.evidenceDigest.sha256, finding.evidenceDigest.sha256, 'changed evidence invalidates acceptance');
  assert.deepEqual(finding.evidenceDigest?.files, files);
  const task = buildTask({ findings, facts, ids: [finding.id] });
  assert.deepEqual(task.scope.modify, []);
  assert.deepEqual(task.scope.read, files);
  assert.ok(task.facts[0].evidence.roles.io, 'task retains the matched evidence');
  assert.deepEqual(task.locations.map((location) => location.file), files);
  assert.ok(task.locations.every((location) => location.kind === 'file'));
});

test('organization heuristics honor the graph test and generated exclusions', async () => {
  const { evaluate } = await import('../evaluate/index.mjs');
  const facts = { repository: { language: 'ts' }, files: [
    { path: 'src/util.ts', role: 'source', sourceText: 'export function util() {}' },
    { path: 'src/a.ts', role: 'source', sourceText: 'process.argv; const fs = require("fs"); render(view); class Model {}' },
    { path: 'test/util.ts', role: 'test', sourceText: 'process.argv; const fs = require("fs"); render(view); class Model {}' },
    { path: 'generated/common.ts', role: 'generated', sourceText: 'process.argv; const fs = require("fs"); render(view); class Model {}' },
  ], imports: [], functions: [] };
  const graph = { repository: facts.repository, modules: [], edges: [], fileModules: {}, excluded: { roles: ['test', 'generated'], files: 2 } };
  const config = { rules: { organization: { mixedRoles: { enabled: true }, folderRoles: { enabled: true }, genericName: { enabled: true } } }, ignore: [] };
  const findings = evaluate(graph, config, facts).diagnostics.filter((finding) => finding.dimension === 'organization');
  assert.ok(findings.length);
  assert.ok(findings.every((finding) => !JSON.stringify(finding).includes('test/') && !JSON.stringify(finding).includes('generated/')));
});

test('organization heuristics keep documented small-tool, utility, entry and framework-convention counterexamples quiet', async () => {
  const { evaluate } = await import('../evaluate/index.mjs');
  const files = [
    { path: 'tools/release.ts', role: 'source', sourceText: 'process.argv; const fs = require("fs"); render("done"); class ReleaseModel {}' },
    { path: 'src/date-util.ts', role: 'source', sourceText: 'export const today = () => new Date();' },
    { path: 'src/main.ts', role: 'source', sourceText: 'process.argv; const fs = require("fs");' },
    { path: 'test/fixture.ts', role: 'test', sourceText: 'process.argv; const fs = require("fs"); render(view); class Fixture {}' },
    { path: 'generated/types.ts', role: 'generated', sourceText: 'process.argv; const fs = require("fs"); render(view); class Generated {}' },
  ];
  const graph = { repository: { language: 'ts' }, modules: [], edges: [], fileModules: {}, excluded: { roles: ['test', 'generated'], files: 2 } };
  const config = { rules: { organization: { mixedRoles: { enabled: true }, folderRoles: { enabled: true }, genericName: { enabled: true } } }, ignore: [] };
  const diagnostics = evaluate(graph, config, { repository: graph.repository, files, imports: [], functions: [] }).diagnostics;
  assert.ok(diagnostics.some((finding) => finding.code === 'organization/mixed-roles' && finding.subject.file === 'tools/release.ts'), 'small tools are visible heuristic candidates for reviewer disposition');
  assert.ok(!diagnostics.some((finding) => finding.subject.file === 'src/date-util.ts'), 'descriptive utility names stay quiet');
  assert.ok(!diagnostics.some((finding) => finding.subject.file === 'src/main.ts' && finding.code === 'organization/mixed-roles'), 'entry and IO alone do not trigger mixed roles');
  assert.ok(diagnostics.every((finding) => !JSON.stringify(finding).includes('test/fixture.ts') && !JSON.stringify(finding).includes('generated/types.ts')));
});


test('check CLI emits schema-valid opt-in organization findings', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-org-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'util.js'), 'export const helper = () => 1;\n');
  const config = path.join(root, 'config.json');
  const out = path.join(root, 'out');
  fs.writeFileSync(config, JSON.stringify({ rules: { organization: { genericName: { enabled: true } } } }));
  const cli = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, root, '--language', 'ts', '--config', config, '--out', out, '--fail-on', 'never', '--json'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const findings = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
  assert.deepEqual(schemaErrors('findings', findings), []);
  assert.ok(findings.diagnostics.some((item) => item.code === 'organization/generic-name' && item.subject.file === 'util.js'));
});
