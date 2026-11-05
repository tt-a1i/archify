import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageCleanSkill } from '../scripts/stage-clean-skill.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const packagingRoot = path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'explainer-implementation', 'packaging');

test('tracked scratch package runs public explainer without dependencies and missing runtime fails closed', t => {
  fs.mkdirSync(packagingRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(packagingRoot, 'runtime-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(scratch, 'source');
  const packaged = path.join(scratch, 'package', 'archify');
  const outside = path.join(scratch, 'outside');
  fs.mkdirSync(source);
  fs.mkdirSync(outside);
  fs.cpSync(path.join(repository, 'archify'), path.join(source, 'archify'), { recursive: true, filter(file) {
    const relative = path.relative(path.join(repository, 'archify'), file);
    return !relative.split(path.sep).some(segment => ['node_modules', 'test'].includes(segment) || segment.startsWith('.validator-check-'));
  } });
  for (const name of ['THIRD_PARTY_NOTICES.md', 'LICENSE', 'LICENSE-MIT', 'NOTICE']) {
    fs.copyFileSync(path.join(repository, name), path.join(source, name));
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
    && !key.startsWith('ARCHIFY_UPDATE_') && key !== 'ARCHIFY_EXPLAINER_PREPARED' && key !== 'NODE_PATH'));
  for (const args of [['init'], ['add', '--force', '--', 'archify', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'LICENSE-MIT', 'NOTICE']]) {
    const result = spawnSync('git', ['-C', source, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const snapshot = spawnSync('git', ['-C', source, 'write-tree'], { env, encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const staged = stageCleanSkill({ repoRoot: source, destination: packaged });
  assert.ok(staged.fileCount > 0);
  t.diagnostic(`scratch snapshot tree ${snapshot.stdout.trim()}; staged ${staged.fileCount} files; no release archive or live installation`);
  assert.equal(fs.existsSync(path.join(packaged, 'node_modules')), false);
  const smoke = spawnSync(process.execPath, [path.join(repository, 'scripts/package-smoke.mjs'), packaged, '--explainer-only'], {
    cwd: outside, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.ifError(smoke.error);
  assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);
  assert.match(smoke.stdout, /packaged explainer parser, native graph, delivery, strict check and panel patch passed without dependencies/);

  // Inject native-tool failures to check recovery without changing layout rules.
  const workflow = path.join(packaged, 'renderers/workflow');
  fs.renameSync(path.join(workflow, 'render-workflow.mjs'), path.join(workflow, 'render-workflow.actual.mjs'));
  fs.writeFileSync(path.join(workflow, 'render-workflow.mjs'), `
import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (spec.nodes.some(node => node.col > 0)) {
  const code = fs.readFileSync(new URL('./fault-mode.txt', import.meta.url), 'utf8');
  console.log(JSON.stringify({ok:false,diagnostics:[{code:'notice/example',severity:'warning',message:'Injected notice'},
    {code,severity:'error',message:'Injected native rejection'}]}));
  process.exitCode = 1;
} else await import('./render-workflow.actual.mjs');
`);
  const cycle = path.join(outside, 'cycle.md'), cycleOutput = path.join(outside, 'cycle.html');
  fs.writeFileSync(cycle, '# Retry\n\nKeep every connection.\n\n## Flow\n\n@workflow\n| a | A |\n| b | B |\n| c | C |\n| a > b |\n| b > c |\n| c > a |\n');
  const deliverCycle = () => spawnSync(process.execPath, [path.join(packaged, 'bin/archify.mjs'), 'deliver', 'explainer', cycle, cycleOutput, '--quality', 'standard', '--json'], {cwd:outside,env,encoding:'utf8',timeout:15_000,maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(workflow, 'fault-mode.txt'), 'workflow/solver-budget-exhausted');
  const recovered = deliverCycle();
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  const lastGood = fs.readFileSync(cycleOutput);
  fs.writeFileSync(path.join(workflow, 'fault-mode.txt'), 'internal/unclassified');
  const internal = deliverCycle();
  assert.notEqual(internal.status, 0, 'internal errors must not be hidden by a successful alternative');
  assert.deepEqual(fs.readFileSync(cycleOutput), lastGood);

  // A broken dependency must fail the actual delivery, not merely a file inventory check.
  const input = path.join(outside, 'draft.json');
  const output = path.join(outside, 'last-good.html');
  fs.copyFileSync(path.join(packaged, 'examples/delivery.explainer.json'), input);
  fs.writeFileSync(output, 'last good artifact');
  fs.unlinkSync(path.join(packaged, 'explainer/parse.mjs'));
  const failed = spawnSync(process.execPath, [path.join(packaged, 'bin/archify.mjs'), 'deliver', 'explainer', input, output, '--json'], {
    cwd: outside, env: { ...env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' }, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(failed.error);
  assert.notEqual(failed.status, 0, 'an incomplete packaged runtime cannot report successful delivery');
  assert.equal(fs.readFileSync(output, 'utf8'), 'last good artifact');
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.length > 0);
});
