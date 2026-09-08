import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-renderer-flush-'));
const count = 200;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  });
}

const examples = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  lifecycle: ['agent-run.lifecycle.json', 'states'],
};

function invalidInput(type) {
  const [example, collection] = examples[type];
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example)));
  diagram[collection] = Array.from({ length: count }, (_, index) => ({
    ...diagram[collection][0],
    id: `node-${index}`,
    unexpected: true,
  }));
  const input = path.join(tmp, `${type}.json`);
  fs.writeFileSync(input, JSON.stringify(diagram));
  return input;
}

function assertRepairs(diagnostics, type) {
  assert.equal(diagnostics.length, count);
  for (const [index, entry] of diagnostics.entries()) {
    assert.equal(entry.code, 'schema/additionalProperties');
    assert.equal(entry.subject.path, `/${examples[type][1]}/${index}`);
    assert.equal(entry.subject.identity, `node-${index}`);
    assert.deepEqual(entry.supportedFixes, ['remove unsupported property "unexpected"']);
  }
}

for (const type of Object.keys(examples)) {
  test(`${type} renderer sends the complete failure to piped stderr`, () => {
    const input = invalidInput(type);
    const output = path.join(tmp, `${type}.html`);
    const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
    const env = { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' };
    const reference = path.join(tmp, `${type}.stderr.json`);
    const descriptor = fs.openSync(reference, 'w');
    let control;
    try {
      control = run(renderer, [input, output], { env, stdio: ['ignore', 'pipe', descriptor] });
    } finally {
      fs.closeSync(descriptor);
    }
    assert.equal(control.status, 1);
    const expected = fs.readFileSync(reference, 'utf8');
    assert.ok(Buffer.byteLength(expected) > 64 * 1024, 'exercise a failure larger than a 64 KiB pipe buffer');
    const referenceFailure = JSON.parse(expected);
    assert.equal(referenceFailure.ok, false);
    assertRepairs(referenceFailure.diagnostics, type);

    const result = run(renderer, [input, output], { env });
    assert.equal(result.status, 1, result.error?.message);
    assert.equal(result.stdout, '');
    assert.equal(Buffer.byteLength(result.stderr), Buffer.byteLength(expected));
    assert.equal(result.stderr, expected);
    assert.equal(fs.existsSync(output), false);
  });
}

for (const command of ['validate', 'deliver']) {
  test(`${command} retains large renderer repair diagnostics and existing output`, () => {
    const input = invalidInput('architecture');
    const output = path.join(tmp, `${command}-trusted.html`);
    const trusted = '<!doctype html><title>Previous verified artifact</title>\n';
    fs.writeFileSync(output, trusted);
    const args = [command, 'architecture', input];
    if (command === 'deliver') args.push(output);
    const result = run(cli, [...args, '--json']);
    assert.equal(result.status, 1, result.error?.message);
    assert.equal(result.stderr, '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.command, command);
    assert.equal(receipt.stage, 'render');
    assertRepairs(receipt.diagnostics, 'architecture');
    assert.equal(fs.readFileSync(output, 'utf8'), trusted);
    assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-delivery-')), []);
  });
}

test('compare keeps the actual renderer rule and preserves the existing output pair', () => {
  const input = invalidInput('architecture');
  const output = path.join(tmp, 'compare.html');
  const receiptPath = path.join(tmp, 'compare.receipt.json');
  fs.writeFileSync(output, 'previous HTML');
  fs.writeFileSync(receiptPath, 'previous receipt');
  const result = run(cli, ['compare', 'architecture', input, input, output, '--json']);
  assert.equal(result.status, 1, result.error?.message);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'schema/additionalProperties');
  assert.deepEqual(receipt.diagnostics[0].supportedFixes, ['remove unsupported property "unexpected"']);
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous HTML');
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), 'previous receipt');
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-compare-')), []);
});

test('concurrent fatal errors emit only the first complete diagnostic under backpressure', async () => {
  const boundaryUrl = pathToFileURL(path.join(skillRoot, 'renderers/shared/diagnostics.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { installRendererDiagnosticBoundary } from ${JSON.stringify(boundaryUrl)};
    installRendererDiagnosticBoundary();
    setImmediate(() => { throw new Error('first failure ' + 'x'.repeat(256 * 1024)); });
    setImmediate(() => {
      process.send({ backpressured: process.stderr.writableLength > 0 });
      throw new Error('second failure');
    });
  `], {
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    timeout: 10_000,
  });
  // Hold the pipe until the second exception is scheduled during the first
  // write. IPC makes this independent of timer timing and reader throughput.
  const chunks = [];
  let backpressured = false;
  child.once('message', (message) => {
    backpressured = message.backpressured;
    child.stderr.on('data', (chunk) => chunks.push(chunk));
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(backpressured, true, 'the second exception must occur while stderr is pending');
  let failure;
  try {
    failure = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    assert.fail('stderr must contain exactly one complete JSON failure');
  }
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'first failure ' + 'x'.repeat(256 * 1024));
  assert.equal(failure.diagnostics.length, 1);
  assert.equal(failure.diagnostics[0].message, failure.error);
});

test('renderer boundary still terminates when the stderr reader has closed', async () => {
  const boundaryUrl = pathToFileURL(path.join(skillRoot, 'renderers/shared/diagnostics.mjs')).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { installRendererDiagnosticBoundary } from ${JSON.stringify(boundaryUrl)};
    installRendererDiagnosticBoundary();
    setInterval(() => {}, 1000);
    setTimeout(() => { throw new Error('closed reader '.repeat(10000)); }, 20);
  `], {
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 10_000,
  });
  child.stderr.destroy();
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 1, signal: null });
});
