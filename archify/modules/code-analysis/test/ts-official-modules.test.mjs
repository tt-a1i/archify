import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { MODULE_CASES } from './ts-official-cases.mjs';
import { configuredProgram, nativeDependencies, officialFixture, sdkPath, ts } from './ts-official-oracle.mjs';

for (const observation of MODULE_CASES) test(`official resolver ${observation.id}`, t => {
  const configName = observation.options ? 'jsconfig.json' : null;
  const files = { ...(configName ? { [configName]: { compilerOptions: observation.options } } : {}), ...observation.files };
  const { root } = officialFixture(t, { files });
  const { options } = configuredProgram(root, configName);
  const entry = path.join(root, observation.entry);
  const program = ts.createProgram([entry], { ...options, noResolve: true, noLib: true, types: [] });
  const source = program.getSourceFile(entry);
  let usage;
  const visit = node => {
    if (ts.isStringLiteralLike(node) && node.text === observation.specifier) usage ||= node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(usage);
  const peer = ts.resolveModuleName(observation.specifier, entry, options, ts.sys, undefined, undefined,
    program.getModeForUsageLocation(source, usage)).resolvedModule;
  const expected = peer && path.relative(fs.realpathSync(root), fs.realpathSync(peer.resolvedFileName)).split(path.sep).join('/');
  const { facts } = extractFacts(root, { language: 'ts', config: { ...loadConfig(null), exclude: [], typescript: { sdk: sdkPath } } });
  const actual = facts.imports.find(edge => edge.from === observation.entry && edge.specifier === observation.specifier);
  assert.ok(actual, observation.id);
  if (observation.officialTo) assert.equal(expected, observation.officialTo);
  if (observation.projection === 'runtime') {
    assert.equal(actual.to, observation.target, 'a declaration is projected to captured runtime JS');
  } else if (observation.projection === 'external') {
    assert.ok(peer?.isExternalLibraryImport);
    assert.equal(actual.resolved, false);
    assert.ok(facts.unresolved.external > 0);
  } else if (observation.projection === 'unsupported-source') {
    assert.equal(actual.resolved, false);
    assert.ok(facts.unresolved.unknown > 0);
  } else {
    assert.equal(actual.to, expected, 'same captured module target as the selected Compiler API');
    assert.equal(actual.resolved, Boolean(expected));
  }
});

test('real-project acceptance distinguishes literal, runtime, type-only and computed imports', t => {
  const files = {
    'jsconfig.json': { compilerOptions: { module: 'NodeNext' } },
    'package.json': { type: 'module', imports: { '#run': { types: './run.d.ts', import: './run.js' } } },
    'entry.mjs': 'import "#run";\nfunction local(require) { require("./shadowed.js"); }\nconst name = "./run.js";\nimport(name);',
    'types.ts': 'import type { Run } from "#run";',
    'run.js': 'export function run() {}',
    'run.d.ts': 'export type Run = () => void;',
    'shadowed.js': 'export {};',
  };
  const { root, selected } = officialFixture(t, { files });
  const { options, roots } = configuredProgram(root, 'jsconfig.json');
  const program = ts.createProgram(roots, options);
  const peers = file => nativeDependencies(ts, program.getSourceFile(path.join(root, file)), program, options, fs.realpathSync(root), new Set(selected));
  const { literal, computed } = peers('entry.mjs');
  assert.deepEqual(literal.map(edge => [edge.specifier, edge.officialTarget, edge.projected, edge.projection]), [
    ['#run', 'run.d.ts', 'run.js', 'runtime'],
  ]);
  assert.deepEqual(computed, [{ line: 4, specifier: '<computed>', kind: 'dynamic', resolved: false }]);
  assert.deepEqual(peers('types.ts').literal.map(edge => [edge.projected, edge.projection]), [['run.d.ts', 'type-only']]);
  const { facts } = extractFacts(root, { language: 'ts', config: { ...loadConfig(null), exclude: [], typescript: { sdk: sdkPath } } });
  assert.deepEqual(facts.imports.map(edge => [edge.from, edge.specifier, edge.kind, edge.to, edge.typeOnly]), [
    ['entry.mjs', '#run', 'static', 'run.js', undefined],
    ['entry.mjs', '<computed>', 'dynamic', undefined, undefined],
    ['types.ts', '#run', 'static', 'run.d.ts', true],
  ]);
});
