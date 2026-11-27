import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { PROJECT_CASES } from './ts-official-cases.mjs';
import { configuredProgram, officialFixture, serverProjects, sdkPath } from './ts-official-oracle.mjs';

for (const observation of PROJECT_CASES) test(`official tsserver ${observation.id}`, async t => {
  const { root, selected } = officialFixture(t, observation);
  const peers = await serverProjects(root, selected);
  assert.equal(peers.get(observation.entry).config, observation.config);
  let observed;
  const { facts } = extractFacts(root, { language: 'ts', config: { ...loadConfig(null), exclude: [], typescript: { sdk: sdkPath } }, onCapture: input => { observed = input.options; } });
  for (const file of selected) {
    const peer = peers.get(file);
    const project = facts.languageScope.projects.find(project => project.files.includes(file));
    assert.equal(project?.config, peer.config, `${file}: default project follows tsserver`);
    // Native Programs may overlap. Archify records a source once under its
    // default project, rather than counting shared source facts twice.
    const expectedFiles = selected.filter(file => peers.get(file).config === peer.config).sort();
    assert.deepEqual(project.files, expectedFiles, `${file}: every selected source has the official default owner`);
    assert.ok(project.files.every(file => peer.files.includes(file)), `${file}: owner includes every assigned source`);
    assert.deepEqual(project.members, peer.files.filter(file => selected.includes(file)), `${file}: caller Program retains shared captured dependencies`);
    const actualOptions = Array.isArray(observed) ? observed.find(item => item.config === peer.config).options : observed;
    const expected = configuredProgram(root, peer.config).options;
    for (const key of ['module', 'moduleResolution', 'target', 'jsx', 'allowJs']) {
      assert.equal(actualOptions[key], expected[key], `${observation.id}: ${key} follows the official effective configuration`);
    }
  }
  if (observation.callFrom) {
    assert.deepEqual(facts.calls.find(call => call.file === observation.callFrom)?.target, observation.callTarget,
      'shared default ownership does not erase a caller Program function target');
  }
});
