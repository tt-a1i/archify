import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const input = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function windowsShortPath(targetPath) {
  if (process.platform !== 'win32') return null;
  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', '"for %I in ("%ARCHIFY_SHORT_PATH_TARGET%") do @echo %~sI"'],
    {
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_SHORT_PATH_TARGET: targetPath },
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );
  if (result.error) throw new Error(`Could not query a Windows 8.3 path: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Could not query a Windows 8.3 path: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  const shortPath = result.stdout.trim();
  if (!shortPath) throw new Error('Windows returned an empty 8.3 path');
  if (path.resolve(shortPath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return null;
  if (fs.realpathSync.native(shortPath).toLowerCase() !== fs.realpathSync.native(targetPath).toLowerCase()) {
    throw new Error('Windows returned an 8.3 path for a different filesystem entry');
  }
  return shortPath;
}

function assignWindowsShortName(targetPath, shortName) {
  const result = spawnSync(
    'fsutil.exe',
    ['file', 'setshortname', targetPath, shortName],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) {
    throw new Error(`Could not assign Windows 8.3 name ${shortName}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no command output';
    throw new Error(`Could not assign Windows 8.3 name ${shortName} (exit ${result.status}): ${detail}`);
  }
  const alias = path.join(path.dirname(targetPath), shortName);
  const aliasStat = fs.statSync(alias, { bigint: true });
  const targetStat = fs.statSync(targetPath, { bigint: true });
  assert.deepEqual(
    [aliasStat.dev, aliasStat.ino],
    [targetStat.dev, targetStat.ino],
    'the explicitly assigned 8.3 name must resolve to the requested entry',
  );
  return alias;
}

function controlledWindowsShortRoot(required) {
  const root = process.env.ARCHIFY_WINDOWS_8DOT3_ROOT;
  const shortRoot = process.env.ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT;
  if (!root && !shortRoot) {
    if (required) {
      assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires the controlled long and short roots');
    }
    return null;
  }
  assert.ok(root && shortRoot, 'the controlled Windows 8.3 roots must be configured together');
  assert.match(
    path.win32.basename(shortRoot),
    /~/u,
    'the controlled short root must use an explicit 8.3 alias',
  );
  assert.equal(
    fs.realpathSync.native(root).toLowerCase(),
    fs.realpathSync.native(shortRoot).toLowerCase(),
    'the controlled long and short roots must identify the same directory',
  );
  return { root, shortRoot };
}

test('delivery keeps every derived sidecar component within portable limits', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-long-sidecars-'));
  const output = path.join(cwd, `${'x'.repeat(245)}.html`);
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const names = fs.readdirSync(cwd);
  const provenance = names.find((name) => name.endsWith('.delivery.json'));
  assert.ok(provenance, 'delivery provenance must be present');
  assert.match(provenance, /\.~archify-[0-9a-f]{64}\.delivery\.json$/);
  assert.equal(names.every((name) => (
    name.length <= 255 && Buffer.byteLength(name, 'utf8') <= 255
  )), true);
  assert.equal(names.some((name) => name.endsWith('.delivery-lock.json')), false);
  assert.equal(names.some((name) => name.endsWith('.delivery-pending.json')), false);

  const checked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');
});

test('strict provenance recognizes legacy sidecars for mixed-case HTML extensions', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-legacy-extension-sidecar-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const caseProbe = path.join(cwd, 'case-probe');
  fs.writeFileSync(caseProbe, 'probe');
  if (fs.existsSync(path.join(cwd, 'CASE-PROBE'))) {
    t.skip('requires a case-sensitive filesystem');
    return;
  }
  fs.unlinkSync(caseProbe);
  const output = path.join(cwd, 'diagram.HTML');
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const currentProvenance = fs.readdirSync(cwd)
    .map((name) => path.join(cwd, name))
    .find((candidate) => candidate.endsWith('.delivery.json'));
  assert.ok(currentProvenance);
  const legacyProvenance = path.join(cwd, 'diagram.delivery.json');
  assert.notEqual(currentProvenance, legacyProvenance);
  fs.renameSync(currentProvenance, legacyProvenance);

  const checked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');

  const legacyPending = path.join(cwd, 'diagram.delivery-pending.json');
  fs.writeFileSync(legacyPending, '{"status":"pending"}\n');
  const blocked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(blocked.status, 1, blocked.stderr || blocked.stdout);
  assert.equal(JSON.parse(blocked.stdout).diagnostics[0].code, 'delivery/provenance-failed');
});

test('delivery rejects an illegal output extension before preparing its missing parent', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-illegal-output-parent-'));
  const parent = path.join(cwd, 'must-remain-absent');
  const output = path.join(parent, 'diagram.txt');
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);

  assert.equal(delivered.status, 1, delivered.stderr || delivered.stdout);
  const receipt = JSON.parse(delivered.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/cli-extension');
  assert.equal(fs.existsSync(parent), false);
});

test('delivery rejects an indeterminate sidecar namespace before creating output state', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-unknown-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, `${'A'.repeat(225)}.html`);
  const wrapper = path.join(cwd, 'deny-sidecar-probe.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const openSync = fs.openSync;
fs.openSync = (file, ...args) => {
  if (path.basename(String(file)).startsWith('.archify-path-semantics-')) {
    const error = new Error('synthetic sidecar probe denial');
    error.code = 'EACCES';
    throw error;
  }
  return openSync(file, ...args);
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const rejected = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  const receipt = JSON.parse(rejected.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/path-resolution');
  assert.equal(
    receipt.diagnostics[0].evidence.systemCode,
    'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE',
  );
  assert.match(receipt.error, /sidecar-case-semantics-indeterminate/u);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(
    fs.readdirSync(cwd).filter((name) => name !== path.basename(wrapper)),
    [],
  );
});

test('strict provenance finds a long-stem sidecar through a case-only artifact alias', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-long-sidecar-alias-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const upperOutput = path.join(cwd, `${'A'.repeat(234)}.html`);
  const lowerOutput = path.join(cwd, `${'a'.repeat(234)}.html`);
  const delivered = run(['deliver', 'workflow', input, upperOutput, '--json'], cwd);

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  if (!fs.existsSync(lowerOutput)) {
    t.skip('the test filesystem is case-sensitive');
    return;
  }

  const checked = run(['check', lowerOutput, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');

  const redelivered = run(['deliver', 'workflow', input, lowerOutput, '--json'], cwd);
  assert.equal(redelivered.status, 0, redelivered.stderr || redelivered.stdout);
  for (const alias of [upperOutput, lowerOutput]) {
    const rechecked = run(['check', alias, '--require-provenance'], cwd);
    assert.equal(rechecked.status, 0, rechecked.stderr || rechecked.stdout);
    assert.equal(JSON.parse(rechecked.stdout).provenance, 'current');
  }
});

test('delivery sidecars preserve distinct HTML extension spellings only when the filesystem does', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-extension-case-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const lower = path.join(cwd, 'diagram.html');
  const upper = path.join(cwd, 'diagram.HTML');
  const lowerDelivery = run(['deliver', 'workflow', input, lower, '--json'], cwd);
  assert.equal(lowerDelivery.status, 0, lowerDelivery.stderr || lowerDelivery.stdout);
  const aliases = fs.existsSync(upper);
  const upperDelivery = run(['deliver', 'workflow', input, upper, '--json'], cwd);
  assert.equal(upperDelivery.status, 0, upperDelivery.stderr || upperDelivery.stdout);

  const receipts = fs.readdirSync(cwd).filter((name) => name.endsWith('.delivery.json'));
  if (aliases) {
    assert.deepEqual(receipts, ['diagram.delivery.json']);
  } else {
    assert.equal(receipts.length, 2);
    assert.ok(receipts.includes('diagram.delivery.json'));
    assert.match(
      receipts.find((name) => name !== 'diagram.delivery.json'),
      /^diagram\.HTML\.~archify-[0-9a-f]{64}\.delivery\.json$/u,
    );
  }
  for (const artifactPath of [lower, upper]) {
    const checked = run(['check', artifactPath, '--require-provenance'], cwd);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }
});

test('different long artifact names retain distinct delivery provenance', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-long-sidecar-distinct-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const shared = 'x'.repeat(233);
  const outputs = ['a', 'b'].map((suffix) => path.join(cwd, `${shared}${suffix}.html`));

  for (const output of outputs) {
    const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
    assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
    const checked = run(['check', output, '--require-provenance'], cwd);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }

  const receipts = fs.readdirSync(cwd).filter((name) => name.endsWith('.delivery.json'));
  assert.equal(receipts.length, 2);
  assert.notEqual(receipts[0], receipts[1]);
});

test('a crafted bounded stem cannot replace another artifact delivery provenance', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-namespace-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const longOutput = path.join(cwd, `${'x'.repeat(245)}.html`);
  const first = run(['deliver', 'workflow', input, longOutput, '--json'], cwd);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const firstProvenance = fs.readdirSync(cwd).find((name) => name.endsWith('.delivery.json'));
  assert.ok(firstProvenance);
  const encodedStem = firstProvenance.replace(/\.delivery\.json$/u, '');
  const craftedOutput = path.join(cwd, `${encodedStem}.html`);
  const second = run(['deliver', 'workflow', input, craftedOutput, '--json'], cwd);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const receipts = fs.readdirSync(cwd).filter((name) => name.endsWith('.delivery.json'));
  assert.equal(receipts.length, 2);
  assert.equal(new Set(receipts).size, 2);
  for (const output of [longOutput, craftedOutput]) {
    const checked = run(['check', output, '--require-provenance'], cwd);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).provenance, 'current');
  }
});

test('a pre-namespace raw sidecar remains readable and its pending journal blocks redelivery', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-migration-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const reservedStem = `legacy.~archify-${'a'.repeat(64)}`;
  const output = path.join(cwd, `${reservedStem}.html`);
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);

  const encodedProvenance = fs.readdirSync(cwd)
    .find((name) => name.endsWith('.delivery.json'));
  assert.ok(encodedProvenance);
  const rawProvenance = path.join(cwd, `${reservedStem}.delivery.json`);
  assert.notEqual(path.join(cwd, encodedProvenance), rawProvenance);
  fs.renameSync(path.join(cwd, encodedProvenance), rawProvenance);

  const checked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');

  const artifactBefore = fs.readFileSync(output);
  const provenanceBefore = fs.readFileSync(rawProvenance);
  const rawPending = path.join(cwd, `${reservedStem}.delivery-pending.json`);
  const pendingBefore = '{"legacyPending":true}\n';
  fs.writeFileSync(rawPending, pendingBefore);
  const rejected = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  const receipt = JSON.parse(rejected.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/legacy-pending');
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.deepEqual(fs.readFileSync(rawProvenance), provenanceBefore);
  assert.equal(fs.readFileSync(rawPending, 'utf8'), pendingBefore);
  assert.equal(fs.readdirSync(cwd).filter((name) => name.endsWith('.delivery.json')).length, 1);
});

test('a raw legacy pending journal remains the barrier when an encoded journal also exists', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-migration-coexistence-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const reservedStem = `legacy.~archify-${'a'.repeat(64)}`;
  const output = path.join(cwd, `${reservedStem}.html`);
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);

  const encodedProvenance = fs.readdirSync(cwd)
    .find((name) => name.endsWith('.delivery.json'));
  assert.ok(encodedProvenance);
  const rawProvenance = path.join(cwd, `${reservedStem}.delivery.json`);
  assert.notEqual(path.join(cwd, encodedProvenance), rawProvenance);
  fs.renameSync(path.join(cwd, encodedProvenance), rawProvenance);

  const artifactBefore = fs.readFileSync(output);
  const provenanceBefore = fs.readFileSync(rawProvenance);
  const rawPending = path.join(cwd, `${reservedStem}.delivery-pending.json`);
  const pendingBefore = '{"legacyPending":true}\n';
  fs.writeFileSync(rawPending, pendingBefore);
  const encodedPending = path.join(
    cwd,
    encodedProvenance.replace(/\.delivery\.json$/u, '.delivery-pending.json'),
  );
  const encodedPendingBefore = '{"currentPending":true}\n';
  fs.writeFileSync(encodedPending, encodedPendingBefore);

  const rejected = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  const receipt = JSON.parse(rejected.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/legacy-pending');
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.deepEqual(fs.readFileSync(rawProvenance), provenanceBefore);
  assert.equal(fs.readFileSync(rawPending, 'utf8'), pendingBefore);
  assert.equal(fs.readFileSync(encodedPending, 'utf8'), encodedPendingBefore);
});

test('strict provenance follows an artifact symlink into another directory', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-file-symlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const realDirectory = path.join(cwd, 'real');
  const aliasDirectory = path.join(cwd, 'alias');
  fs.mkdirSync(realDirectory);
  fs.mkdirSync(aliasDirectory);
  const output = path.join(realDirectory, `${'x'.repeat(234)}.html`);
  const alias = path.join(aliasDirectory, 'diagram.html');

  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  try {
    fs.symlinkSync(output, alias, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }

  const checked = run(['check', alias, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');
});

test('delivery follows a dangling artifact symlink without replacing the link', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-dangling-symlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const targetDirectory = path.join(cwd, 'target');
  const aliasDirectory = path.join(cwd, 'alias');
  fs.mkdirSync(targetDirectory);
  fs.mkdirSync(aliasDirectory);
  const target = path.join(targetDirectory, 'diagram.html');
  const alias = path.join(aliasDirectory, 'diagram.html');
  try {
    fs.symlinkSync(target, alias, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }

  const delivered = run(['deliver', 'workflow', input, alias, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(target).isFile(), true);

  for (const artifactPath of [alias, target]) {
    const checked = run(['check', artifactPath, '--require-provenance'], cwd);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).provenance, 'current');
  }
});

test('delivery and strict checks reject a hard-linked artifact without changing its pair', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sidecar-hardlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'diagram.html');
  const alias = path.join(cwd, 'diagram-hardlink.html');
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const provenance = path.join(cwd, 'diagram.delivery.json');
  try {
    fs.linkSync(output, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error?.code)) {
      t.skip(`hard links are unavailable (${error.code})`);
      return;
    }
    throw error;
  }
  const artifactBefore = fs.readFileSync(output);
  const provenanceBefore = fs.readFileSync(provenance);

  for (const artifactPath of [output, alias]) {
    const checked = run(['check', artifactPath, '--require-provenance'], cwd);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assert.equal(
      JSON.parse(checked.stdout).diagnostics[0].code,
      'output/target-hardlinked',
    );
  }

  const rejected = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  assert.equal(
    JSON.parse(rejected.stdout).diagnostics[0].code,
    'output/target-hardlinked',
  );
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.deepEqual(fs.readFileSync(alias), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenance), provenanceBefore);

  fs.unlinkSync(alias);
  const checked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test('delivery and strict check reject hard-linked provenance without changing the pair', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-provenance-hardlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'diagram.html');
  const provenance = path.join(cwd, 'diagram.delivery.json');
  const alias = path.join(cwd, 'provenance-alias.json');
  const delivered = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const artifactBefore = fs.readFileSync(output);
  const provenanceBefore = fs.readFileSync(provenance);
  try {
    fs.linkSync(provenance, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error?.code)) {
      t.skip(`hard links are unavailable (${error.code})`);
      return;
    }
    throw error;
  }

  const checked = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).diagnostics[0].code, 'delivery/provenance-hardlink-unsupported');

  const rejected = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.equal(
    JSON.parse(rejected.stdout).diagnostics.some((entry) => entry.code === 'delivery/provenance-hardlink-unsupported'),
    true,
  );
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenance), provenanceBefore);
  assert.deepEqual(fs.readFileSync(alias), provenanceBefore);
  assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), false);
  assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), false);

  fs.unlinkSync(alias);
  const recovered = run(['check', output, '--require-provenance'], cwd);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
});

test('delivery refuses existing and dangling provenance symlinks without touching their targets', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-provenance-symlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  for (const kind of ['existing', 'dangling']) {
    const directory = path.join(cwd, kind);
    fs.mkdirSync(directory);
    const output = path.join(directory, 'diagram.html');
    const first = run(['deliver', 'workflow', input, output, '--json'], directory);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const provenance = path.join(directory, 'diagram.delivery.json');
    const preservedReceipt = fs.readFileSync(provenance);
    const target = path.join(directory, 'owned.json');
    fs.unlinkSync(provenance);
    if (kind === 'existing') fs.writeFileSync(target, preservedReceipt);
    try {
      fs.symlinkSync(target, provenance, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        t.skip(`file symlink creation requires Windows permission (${error.code})`);
        return;
      }
      throw error;
    }
    const artifactBefore = fs.readFileSync(output);
    const targetBefore = kind === 'existing' ? fs.readFileSync(target) : undefined;

    const rejected = run(['deliver', 'workflow', input, output, '--json'], directory);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    assert.equal(JSON.parse(rejected.stdout).diagnostics[0].code, 'output/target-not-regular-file');
    assert.equal(fs.lstatSync(provenance).isSymbolicLink(), true);
    assert.deepEqual(fs.readFileSync(output), artifactBefore);
    if (kind === 'existing') assert.deepEqual(fs.readFileSync(target), targetBefore);
    else assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(path.join(directory, 'diagram.delivery-pending.json')), false);
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('delivery-lock')), false);
  }
});

test('a missing-input failure cannot replace hard-linked delivery provenance', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-failure-provenance-hardlink-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'diagram.html');
  const provenance = path.join(cwd, 'diagram.delivery.json');
  const provenanceAlias = path.join(cwd, 'receipt-alias.json');
  const first = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  try {
    fs.linkSync(provenance, provenanceAlias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error?.code)) {
      t.skip(`hard links are unavailable (${error.code})`);
      return;
    }
    throw error;
  }
  const artifactBefore = fs.readFileSync(output);
  const provenanceBefore = fs.readFileSync(provenance);

  const rejected = run([
    'deliver',
    'workflow',
    path.join(cwd, 'missing-input.json'),
    output,
    '--json',
  ], cwd);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  const failure = JSON.parse(rejected.stdout);
  assert.equal(
    failure.diagnostics.some((entry) => entry.code === 'delivery/provenance-hardlink-unsupported'),
    true,
  );
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenance), provenanceBefore);
  assert.deepEqual(fs.readFileSync(provenanceAlias), provenanceBefore);
  assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), false);
  assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), false);
});

test('failed-delivery provenance preserves a replacement that appears after its snapshot', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-failure-provenance-race-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'diagram.html');
  const provenance = path.join(cwd, 'diagram.delivery.json');
  const displaced = path.join(cwd, 'previous.delivery.json');
  const first = run(['deliver', 'workflow', input, output, '--json'], cwd);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const artifactBefore = fs.readFileSync(output);
  const claimant = '{"claimant":"do-not-replace"}\n';
  const wrapper = path.join(cwd, 'replace-failure-provenance.mjs');
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) {
    return { status: 7, stdout: '', stderr: '' };
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const writeFileSync = fs.writeFileSync;
let replaced = false;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (!replaced
      && path.basename(String(file)) === ${JSON.stringify(path.basename(provenance))}
      && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')) {
    replaced = true;
    fs.renameSync(${JSON.stringify(provenance)}, ${JSON.stringify(displaced)});
    writeFileSync(${JSON.stringify(provenance)}, ${JSON.stringify(claimant)}, { flag: 'wx' });
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const rejected = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  const failure = JSON.parse(rejected.stdout);
  assert.equal(failure.provenance, 'unrecorded');
  assert.equal(failure.diagnostics.some((entry) => entry.code === 'output/target-changed'), true);
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.equal(fs.readFileSync(provenance, 'utf8'), claimant);
  assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
  assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), false);
});

test('failed-delivery provenance cannot overwrite a claimant in the final publish window', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-failure-provenance-claimant-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const output = path.join(cwd, 'diagram.html');
  const provenance = path.join(cwd, 'diagram.delivery.json');
  const provenanceName = path.basename(provenance);
  assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
  const artifactBefore = fs.readFileSync(output);
  const claimant = '{"claimant":"final-window"}\n';
  const wrapper = path.join(cwd, 'claim-failure-provenance.mjs');
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) return { status: 7, stdout: '', stderr: '' };
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const linkSync = fs.linkSync;
const writeFileSync = fs.writeFileSync;
let claimed = false;
fs.linkSync = (source, target) => {
  if (!claimed
      && path.basename(String(target)) === ${JSON.stringify(provenanceName)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    claimed = true;
    writeFileSync(target, ${JSON.stringify(claimant)}, { flag: 'wx' });
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
  assert.notEqual(failed.status, 0, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.provenance, 'unrecorded');
  assert.equal(fs.readFileSync(provenance, 'utf8'), claimant, failed.stderr || failed.stdout);
  assert.deepEqual(fs.readFileSync(output), artifactBefore);
  assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
  assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), true);
  assert.equal(
    receipt.diagnostics.some((entry) => entry.code === 'delivery/provenance-recovery-required'),
    true,
  );
});

for (const candidateRole of ['artifact', 'provenance']) {
  test(`delivery rejects a hard-linked staged ${candidateRole} candidate`, (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-${candidateRole}-candidate-hardlink-`));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, 'diagram.html');
    const provenance = path.join(cwd, 'diagram.delivery.json');
    const externalAlias = path.join(cwd, `${candidateRole}-candidate-alias`);
    assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
    const artifactBefore = fs.readFileSync(output);
    const provenanceBefore = fs.readFileSync(provenance);
    const wrapper = path.join(cwd, `hardlink-${candidateRole}-candidate.mjs`);
    const candidateName = candidateRole === 'artifact' ? path.basename(output) : 'delivery-provenance.json';
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const lstatSync = fs.lstatSync;
const linkSync = fs.linkSync;
let linked = false;
fs.lstatSync = (file, options) => {
  if (!linked
      && path.basename(String(file)) === ${JSON.stringify(candidateName)}
      && path.basename(path.dirname(String(file))).startsWith('.archify-delivery-')) {
    linked = true;
    linkSync(file, ${JSON.stringify(externalAlias)});
  }
  return lstatSync(file, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const receipt = JSON.parse(failed.stdout);
    assert.equal(
      receipt.diagnostics.some((entry) => entry.code === (
        candidateRole === 'artifact'
          ? 'output/target-hardlinked'
          : 'delivery/provenance-hardlink-unsupported'
      )),
      true,
    );
    assert.deepEqual(fs.readFileSync(output), artifactBefore);
    assert.deepEqual(fs.readFileSync(provenance), provenanceBefore);
    assert.equal(fs.existsSync(externalAlias), true);
    assert.equal(fs.statSync(externalAlias).nlink, 1);
    assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
    assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), false);
  });
}

for (const candidateRole of ['artifact', 'provenance']) {
  test(`delivery preserves a published ${candidateRole} claimant and its old backup after an external hard link`, (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-${candidateRole}-publish-hardlink-`));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, 'diagram.html');
    const provenance = path.join(cwd, 'diagram.delivery.json');
    const externalAlias = path.join(cwd, `${candidateRole}-published-alias`);
    assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
    const artifactBefore = fs.readFileSync(output);
    const provenanceBefore = fs.readFileSync(provenance);
    const wrapper = path.join(cwd, `hardlink-published-${candidateRole}.mjs`);
    const candidateName = candidateRole === 'artifact' ? path.basename(output) : 'delivery-provenance.json';
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
let linked = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!linked
      && path.basename(String(source)) === ${JSON.stringify(candidateName)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    linked = true;
    linkSync(source, ${JSON.stringify(externalAlias)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const receipt = JSON.parse(failed.stdout);
    assert.equal(
      receipt.diagnostics.some((entry) => entry.code === (
        candidateRole === 'artifact'
          ? 'output/target-hardlinked'
          : 'delivery/provenance-hardlink-unsupported'
      )),
      true,
    );
    const recovery = receipt.diagnostics.find(
      (entry) => entry.code === 'delivery/commit-recovery-required',
    );
    assert.ok(recovery, failed.stderr || failed.stdout);
    assert.equal(recovery.evidence.recoveryRequired, true);
    const affectedTarget = candidateRole === 'artifact' ? output : provenance;
    const affectedBefore = candidateRole === 'artifact' ? artifactBefore : provenanceBefore;
    const unaffectedTarget = candidateRole === 'artifact' ? provenance : output;
    const unaffectedBefore = candidateRole === 'artifact' ? provenanceBefore : artifactBefore;
    assert.deepEqual(fs.readFileSync(unaffectedTarget), unaffectedBefore);
    assert.equal(fs.existsSync(externalAlias), true);
    assert.equal(fs.statSync(externalAlias).ino, fs.statSync(affectedTarget).ino);
    assert.ok(fs.statSync(externalAlias).nlink >= 2);
    const backup = recovery.evidence.recoverableBackups.find(({ label }) => label === (
      candidateRole === 'artifact' ? 'HTML artifact' : 'delivery provenance'
    ));
    assert.ok(backup, 'the displaced previous file must remain recoverable');
    assert.deepEqual(fs.readFileSync(backup.path), affectedBefore);
    assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
    assert.equal(fs.existsSync(path.join(cwd, '.archify-delivery-lock.json')), true);
  });
}

for (const targetRole of ['artifact', 'provenance']) {
  test(`delivery preserves the ${targetRole} claimant that replaces the just-published candidate`, (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-${targetRole}-post-link-claimant-`));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, 'diagram.html');
    const provenance = path.join(cwd, 'diagram.delivery.json');
    assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
    const before = new Map([[output, fs.readFileSync(output)], [provenance, fs.readFileSync(provenance)]]);
    const physicalDirectory = fs.realpathSync.native(cwd);
    const target = targetRole === 'artifact'
      ? path.join(physicalDirectory, path.basename(output))
      : path.join(physicalDirectory, path.basename(provenance));
    const other = targetRole === 'artifact' ? provenance : output;
    const candidateName = targetRole === 'artifact' ? path.basename(output) : 'delivery-provenance.json';
    const claimant = targetRole === 'artifact'
      ? '<!doctype html><title>post-link claimant</title>\n'
      : '{"claimant":"post-link"}\n';
    const claimantIdentityFile = path.join(cwd, `${targetRole}-post-link-identity.json`);
    const displacedCandidate = path.join(cwd, `${targetRole}-displaced-candidate`);
    const wrapper = path.join(cwd, `replace-published-${targetRole}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
const lstatSync = fs.lstatSync;
let armedTarget;
let replaced = false;
fs.linkSync = (source, finalPath) => {
  const result = linkSync(source, finalPath);
  if (!replaced
      && path.basename(String(source)) === ${JSON.stringify(candidateName)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    armedTarget = String(finalPath);
  }
  return result;
};
fs.lstatSync = (file, options) => {
  if (!replaced && armedTarget && String(file) === armedTarget) {
    replaced = true;
    fs.renameSync(file, ${JSON.stringify(displacedCandidate)});
    fs.writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const stat = lstatSync(file, { bigint: true });
    fs.writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({ dev: String(stat.dev), ino: String(stat.ino) }));
  }
  return lstatSync(file, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const receipt = JSON.parse(failed.stdout);
    assert.equal(receipt.diagnostics[0].code, 'output/target-changed');
    const recovery = receipt.diagnostics.find(
      (entry) => entry.code === 'delivery/commit-recovery-required',
    );
    assert.ok(recovery, failed.stderr || failed.stdout);
    assert.equal(fs.readFileSync(target, 'utf8'), claimant);
    const claimantIdentity = fs.lstatSync(target, { bigint: true });
    assert.deepEqual(
      { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
      JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
    );
    assert.deepEqual(fs.readFileSync(other), before.get(other));
    assert.equal(fs.existsSync(displacedCandidate), true);
    const backup = recovery.evidence.recoverableBackups.find(({ label }) => label === (
      targetRole === 'artifact' ? 'HTML artifact' : 'delivery provenance'
    ));
    assert.ok(backup, 'the prior target must remain recoverable beside the preserved claimant');
    assert.deepEqual(
      fs.readFileSync(backup.path),
      before.get(targetRole === 'artifact' ? output : provenance),
    );
    assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
    assert.equal(fs.existsSync(path.join(cwd, '.archify-delivery-lock.json')), true);
  });
}

for (const candidateRole of ['artifact', 'provenance']) {
  test(`delivery preserves a claimant that replaces the staged ${candidateRole} at retirement`, (t) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-${candidateRole}-retirement-claimant-`));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, 'diagram.html');
    assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
    const candidateName = candidateRole === 'artifact' ? path.basename(output) : 'delivery-provenance.json';
    const claimant = `${candidateRole} retirement claimant\n`;
    const claimantIdentityFile = path.join(cwd, `${candidateRole}-retirement-identity.json`);
    const displacedCandidate = path.join(cwd, `${candidateRole}-retirement-displaced`);
    const wrapper = path.join(cwd, `replace-staged-${candidateRole}-at-retirement.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
const isCandidate = (file) => (
  path.basename(String(file)) === ${JSON.stringify(candidateName)}
  && path.basename(path.dirname(String(file))).startsWith('.archify-delivery-')
);
const replaceCandidate = (file) => {
  replaced = true;
  renameSync(file, ${JSON.stringify(displacedCandidate)});
  writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
  const stat = fs.lstatSync(file, { bigint: true });
  writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({
    dev: String(stat.dev),
    ino: String(stat.ino),
  }));
};
fs.unlinkSync = (file, ...args) => {
  if (!replaced && isCandidate(file)) replaceCandidate(file);
  return unlinkSync(file, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (!replaced
      && isCandidate(source)
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    replaceCandidate(source);
  }
  return renameSync(source, target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const staging = fs.readdirSync(cwd).filter((name) => (
      name.startsWith('.archify-delivery-')
      && fs.lstatSync(path.join(cwd, name)).isDirectory()
    ));
    assert.equal(staging.length, 1, failed.stderr || failed.stdout);
    const candidate = path.join(cwd, staging[0], candidateName);
    assert.equal(fs.readFileSync(candidate, 'utf8'), claimant);
    const claimantIdentity = fs.lstatSync(candidate, { bigint: true });
    assert.deepEqual(
      { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
      JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
    );
    assert.equal(fs.existsSync(displacedCandidate), true);
  });
}

for (const initiallyExisting of [false, true]) {
  for (const targetRole of ['artifact', 'provenance']) {
    test(`delivery preserves an ${initiallyExisting ? 'existing replacement' : 'absent-slot claimant'} for the ${targetRole}`, (t) => {
      const cwd = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `archify-${initiallyExisting ? 'replacement' : 'claimant'}-${targetRole}-`,
      ));
      t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
      const output = path.join(cwd, 'diagram.html');
      const provenance = path.join(cwd, 'diagram.delivery.json');
      if (initiallyExisting) {
        const first = run(['deliver', 'workflow', input, output, '--json'], cwd);
        assert.equal(first.status, 0, first.stderr || first.stdout);
      }
      const before = new Map([
        [output, fs.existsSync(output) ? fs.readFileSync(output) : null],
        [provenance, fs.existsSync(provenance) ? fs.readFileSync(provenance) : null],
      ]);
      const physicalDirectory = fs.realpathSync.native(cwd);
      const target = targetRole === 'artifact'
        ? path.join(physicalDirectory, path.basename(output))
        : path.join(physicalDirectory, path.basename(provenance));
      const other = targetRole === 'artifact' ? provenance : output;
      const claimant = targetRole === 'artifact'
        ? '<!doctype html><title>claimant</title>\n'
        : '{"claimant":true}\n';
      const identityFile = path.join(cwd, `${targetRole}-claimant-identity.json`);
      const displaced = path.join(cwd, `${targetRole}-displaced`);
      const wrapper = path.join(cwd, `claim-${targetRole}.mjs`);
      fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
let injected = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!injected
      && path.basename(String(file)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(file))).startsWith('.archify-delivery-')) {
    injected = true;
    if (fs.existsSync(${JSON.stringify(target)})) fs.renameSync(${JSON.stringify(target)}, ${JSON.stringify(displaced)});
    writeFileSync(${JSON.stringify(target)}, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const stat = fs.lstatSync(${JSON.stringify(target)}, { bigint: true });
    writeFileSync(${JSON.stringify(identityFile)}, JSON.stringify({ dev: String(stat.dev), ino: String(stat.ino) }));
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

      const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
      assert.equal(failed.status, 1, failed.stderr || failed.stdout);
      const receipt = JSON.parse(failed.stdout);
      assert.equal(receipt.diagnostics[0].code, 'output/target-changed');
      assert.equal(fs.readFileSync(target, 'utf8'), claimant);
      const expectedIdentity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      const actualIdentity = fs.lstatSync(target, { bigint: true });
      assert.deepEqual(
        { dev: String(actualIdentity.dev), ino: String(actualIdentity.ino) },
        expectedIdentity,
      );
      const otherBefore = before.get(other);
      if (otherBefore === null) assert.equal(fs.existsSync(other), false);
      else assert.deepEqual(fs.readFileSync(other), otherBefore);
      assert.equal(fs.existsSync(path.join(cwd, 'diagram.delivery-pending.json')), true);
      assert.equal(fs.readdirSync(cwd).some((name) => name.includes('delivery-lock')), false);
    });
  }
}

test('delivery rejects a nested directory alias retarget before taking its write-slot snapshot', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-nested-alias-retarget-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const route = path.join(cwd, 'route');
  const outer = path.join(cwd, 'outer');
  const first = path.join(cwd, 'first-target');
  const second = path.join(cwd, 'second-target');
  const inner = path.join(route, 'inner');
  for (const directory of [route, first, second]) fs.mkdirSync(directory);
  try {
    fs.symlinkSync(route, outer, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(first, inner, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.skip('directory alias creation is unavailable on this Windows host');
      return;
    }
    throw error;
  }
  const requestedOutput = path.join(outer, 'inner', 'diagram.html');
  const firstOutput = path.join(first, 'diagram.html');
  const secondOutput = path.join(second, 'diagram.html');
  const firstPhysical = fs.realpathSync.native(first);
  const wrapper = path.join(cwd, 'retarget-nested-alias.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const mkdirSync = fs.mkdirSync;
let retargeted = false;
fs.mkdirSync = (directory, options) => {
  const result = mkdirSync(directory, options);
  if (!retargeted && String(directory) === ${JSON.stringify(firstPhysical)}) {
    retargeted = true;
    fs.unlinkSync(${JSON.stringify(inner)});
    fs.symlinkSync(${JSON.stringify(second)}, ${JSON.stringify(inner)}, ${JSON.stringify(process.platform === 'win32' ? 'junction' : 'dir')});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(requestedOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'output/target-changed');
  assert.equal(receipt.diagnostics[0].evidence.targetState.code, 'write-slot-changed-before-snapshot');
  for (const target of [firstOutput, secondOutput]) {
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(target.replace(/\.html$/u, '.delivery.json')), false);
  }
  assert.equal(
    [...fs.readdirSync(first), ...fs.readdirSync(second)]
      .some((name) => name.includes('archify-delivery') || name.includes('delivery-lock')),
    false,
  );
});

test('Windows delivery accepts an existing 8.3 artifact alias and keeps strict provenance', (t) => {
  const requiresWindows8dot3 = process.env.ARCHIFY_REQUIRE_WINDOWS_8DOT3 === '1';
  if (process.platform !== 'win32') {
    if (requiresWindows8dot3) assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires Windows');
    t.skip('Windows-only 8.3 delivery regression');
    return;
  }
  const controlledRoot = controlledWindowsShortRoot(requiresWindows8dot3);
  const cwd = controlledRoot
    ? fs.mkdtempSync(path.join(controlledRoot.root, 'delivery-'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delivery-eight-dot-three-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const directory = path.join(cwd, 'directory name requiring short alias');
  fs.mkdirSync(directory);
  const output = path.join(directory, 'diagram artifact with long name.html');
  assert.equal(run(['deliver', 'workflow', input, output, '--json'], cwd).status, 0);
  const shortOutput = controlledRoot
    ? assignWindowsShortName(output, 'ARCHDL~1.HTM')
    : windowsShortPath(output);
  if (!shortOutput) {
    if (requiresWindows8dot3) assert.fail('the controlled Windows fixture did not expose the explicit file 8.3 alias');
    t.skip('the Windows volume does not expose a distinct 8.3 artifact alias');
    return;
  }
  assert.equal(
    fs.realpathSync.native(shortOutput).toLowerCase(),
    fs.realpathSync.native(output).toLowerCase(),
    'the artifact path must resolve through the controlled explicit 8.3 alias',
  );
  assert.equal(
    path.win32.extname(shortOutput).toLowerCase(),
    '.htm',
    'the regression must exercise the three-character 8.3 file extension',
  );

  const redelivered = run(['deliver', 'workflow', input, shortOutput, '--json'], cwd);
  assert.equal(redelivered.status, 0, redelivered.stderr || redelivered.stdout);
  const checkedOutput = run(['check', output, '--require-provenance'], cwd);
  assert.equal(checkedOutput.status, 0, checkedOutput.stderr || checkedOutput.stdout);
  assert.equal(JSON.parse(checkedOutput.stdout).provenance, 'current');

  // Publication replaces the directory entry. NTFS need not transfer an
  // explicitly assigned short name from the retired entry to its successor.
  // Exercise the current artifact's alias, not the old entry's cached name.
  const currentShortOutput = controlledRoot
    ? assignWindowsShortName(output, 'ARCHDL~2.HTM')
    : windowsShortPath(output);
  assert.ok(currentShortOutput, 'the current artifact must expose a distinct 8.3 alias');
  assert.equal(path.win32.extname(currentShortOutput).toLowerCase(), '.htm');
  const checkedAlias = run(['check', currentShortOutput, '--require-provenance'], cwd);
  assert.equal(checkedAlias.status, 0, checkedAlias.stderr || checkedAlias.stdout);
  assert.equal(JSON.parse(checkedAlias.stdout).provenance, 'current');
  assert.deepEqual(fs.readdirSync(directory).sort(), [
    path.basename(output),
    path.basename(output).replace(/\.html$/u, '.delivery.json'),
  ].sort(), 'redelivery through an alias must keep one canonical artifact and provenance pair');
});

test('normalization aliases contend for one future long-stem delivery lock', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-normalized-sidecar-alias-'));
  let active;
  t.after(() => {
    if (active && !fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active?.exitCode === null && active.signalCode === null) active.kill();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const probeNfc = path.join(cwd, '\u00e9-probe');
  const probeNfd = path.join(cwd, 'e\u0301-probe');
  fs.writeFileSync(probeNfc, 'probe');
  const aliasesNormalization = fs.existsSync(probeNfd);
  fs.unlinkSync(probeNfc);
  if (!aliasesNormalization) {
    t.skip('the test filesystem is normalization-sensitive');
    return;
  }

  const nfcStem = '\u00e9'.repeat(80);
  const nfdStem = nfcStem.normalize('NFD');
  const nfcOutput = path.join(cwd, `${nfcStem}.html`);
  const nfdOutput = path.join(cwd, `${nfdStem}.html`);
  const ready = path.join(cwd, 'active-delivery.ready');
  const release = path.join(cwd, 'active-delivery.release');
  const wrapper = path.join(cwd, 'hold-active-delivery.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(nfdOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  active = spawn(process.execPath, [wrapper], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let activeStdout = '';
  let activeStderr = '';
  active.stdout.on('data', (chunk) => { activeStdout += chunk; });
  active.stderr.on('data', (chunk) => { activeStderr += chunk; });
  const activeExit = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, `active delivery did not acquire its lock: ${activeStderr}`);

  const contender = run(['deliver', 'workflow', input, nfcOutput, '--json'], cwd);
  assert.equal(contender.status, 1, contender.stderr || contender.stdout);
  assert.equal(JSON.parse(contender.stdout).diagnostics[0].code, 'delivery/concurrent-attempt');

  fs.writeFileSync(release, 'release');
  assert.deepEqual(await activeExit, { code: 0, signal: null }, activeStderr || activeStdout);

  const checked = run(['check', nfcOutput, '--require-provenance'], cwd);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).provenance, 'current');

  const redelivered = run(['deliver', 'workflow', input, nfcOutput, '--json'], cwd);
  assert.equal(redelivered.status, 0, redelivered.stderr || redelivered.stdout);
  for (const alias of [nfcOutput, nfdOutput]) {
    const rechecked = run(['check', alias, '--require-provenance'], cwd);
    assert.equal(rechecked.status, 0, rechecked.stderr || rechecked.stdout);
    assert.equal(JSON.parse(rechecked.stdout).provenance, 'current');
  }
});
