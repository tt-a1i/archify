import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { MODULE_CASES } from './ts-official-cases.mjs';
import { configuredProgram, officialFixture, sdkPath, ts } from './ts-official-oracle.mjs';

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
