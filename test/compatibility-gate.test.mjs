import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ci = parse(fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const release = parse(fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));

test('default and compatibility share the real public CLI core while full discovers every suite', () => {
  assert.equal(manifest.scripts.test, 'npm run test:core');
  assert.equal(manifest.scripts['test:compat'], 'npm run test:core');
  assert.match(manifest.scripts['test:core'], /core-smoke\.test\.mjs/);
  assert.match(manifest.scripts['test:full'], /test:generated/);
  assert.match(manifest.scripts['test:full'], /run-tests\.mjs$/);
  assert.ok(!manifest.scripts['test:core'].includes('golden'));
});

test('generated checks have one explicit entrypoint separate from core feedback', () => {
  const checks = manifest.scripts['test:generated'];
  for (const required of ['check:viewer', 'check:brand-marks', 'check:validators', 'check:release-identity', 'test/golden.mjs']) assert.ok(checks.includes(required));
});

test('all maintained Node check names remain and publication uses exhaustive verification', () => {
  assert.deepEqual(ci.jobs.test.strategy.matrix['node-version'], [18, 20, 24]);
  assert.equal(ci.jobs.test.name, undefined);
  assert.equal(ci.jobs.test.needs, 'scope', 'short compatibility checks must not wait for complete regression');
  const canonical = ci.jobs['canonical-test'];
  assert.equal(canonical.name, 'test (22)');
  assert.deepEqual(canonical.needs, ['scope', 'full-regression']);
  assert.ok(canonical.steps.some(step => step.with?.['node-version'] === 22));
  const full = ci.jobs['full-regression'];
  assert.equal(full.if, "needs.scope.outputs.scope == 'full'");
  assert.equal(full.strategy['fail-fast'], false);
  assert.deepEqual(full.strategy.matrix.shard, [1, 2]);
  assert.ok(full.steps.some(step => step.with?.['node-version'] === 22));
  assert.ok(full.steps.some(step => step.run === 'node scripts/run-tests.mjs --shard=${{ matrix.shard }}/2'));
  const generated = full.steps.find(step => step.run === 'npm run test:generated');
  assert.equal(generated.if, 'matrix.shard == 2', 'complete generated checks run once inside a regression shard');
  const hermes = full.steps.find(step => step.run === 'node --test integrations/hermes-agent/test/plugin-contract.test.mjs');
  assert.equal(hermes.if, 'matrix.shard == 2');
  assert.equal(full.steps.filter(step => step.run === 'npm run test:generated').length, 1);
  const coreGenerated = canonical.steps.find(step => step.run === 'npm run test:generated');
  assert.equal(coreGenerated.if, "needs.scope.outputs.scope == 'core' && needs.scope.outputs.generated == 'true'");
  for (const step of canonical.steps.filter(step => step.uses || step.name === 'Install renderer dependencies')) {
    assert.equal(step.if, "needs.scope.outputs.scope == 'core'", 'full aggregation must not bootstrap another runtime');
  }
  for (const name of ['deploy-pages', 'deploy-cloudflare']) {
    assert.ok(ci.jobs[name].needs.includes('test'));
    assert.ok(ci.jobs[name].needs.includes('canonical-test'));
  }
  assert.ok(ci.jobs.test.steps.some(step => step.run === 'npm run test:compat'));
  assert.ok(release.jobs.release.steps.some(step => step.run === 'npm run test:full'));
  assert.ok(!release.jobs.release.steps.some(step => step.run === 'npm test'));
});
