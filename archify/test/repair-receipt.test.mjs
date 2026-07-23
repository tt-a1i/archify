import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repair-receipt-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function writeFixture(name, source) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(source, null, 2));
  return file;
}

function receipt(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

test('repair receipt: malformed JSON is one clean machine object without a Node stack', () => {
  const input = path.join(tmp, 'malformed.workflow.json');
  fs.writeFileSync(input, '{broken json');

  const result = run(['validate', 'workflow', input, '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const failure = receipt(result);
  assert.equal(failure.schemaVersion, 1);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'validate');
  assert.equal(failure.stage, 'input');
  assert.equal(failure.diagnostics.length, 1);
  assert.deepEqual(failure.diagnostics[0].subject, { input });
  assert.equal(failure.diagnostics[0].code, 'input/json-parse');
  assert.equal(failure.diagnostics[0].severity, 'error');
  assert.match(failure.diagnostics[0].evidence.reason, /JSON/);
  assert.deepEqual(failure.diagnostics[0].supportedFixes, ['repair the JSON syntax and run validation again']);
  assert.doesNotMatch(result.stdout, /\n\s+at\s|file:\/\//);
});

test('repair receipt: all five modes identify schema subjects and supported fixes', () => {
  const cases = {
    architecture: ['web-app.architecture.json', 'components'],
    workflow: ['agent-tool-call.workflow.json', 'nodes'],
    sequence: ['cache-miss-request.sequence.json', 'participants'],
    dataflow: ['product-analytics.dataflow.json', 'nodes'],
    lifecycle: ['agent-run.lifecycle.json', 'states'],
  };

  for (const [type, [example, collection]] of Object.entries(cases)) {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    source[collection][0].unexpected = true;
    const identity = source[collection][0].id;
    const input = writeFixture(`schema-${type}.json`, source);
    const result = run(['validate', type, input, '--json']);

    assert.equal(result.status, 1, `${type}: ${result.stderr || result.stdout}`);
    assert.equal(result.stderr, '', type);
    const failure = receipt(result);
    const repair = failure.diagnostics.find((entry) => entry.code === 'schema/additionalProperties');
    assert.ok(repair, type);
    assert.deepEqual(repair.subject, {
      diagramType: type,
      path: `/${collection}/0`,
      identity,
    });
    assert.equal(repair.evidence.additionalProperty, 'unexpected');
    assert.deepEqual(repair.supportedFixes, ['remove unsupported property "unexpected"']);
  }
});

test('repair receipt: human validation formats the same rule without a stack', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  source.nodes[0].unexpected = true;
  const input = writeFixture('human-schema.workflow.json', source);
  const result = run(['validate', 'workflow', input]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\[schema\/additionalProperties\]/);
  assert.match(result.stderr, /Fix: remove unsupported property "unexpected"/);
  assert.doesNotMatch(result.stderr, /\n\s+at\s|file:\/\//);
});

test('repair receipt: validate and deliver share exact Clean Flow evidence while delivery preserves the trusted artifact', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.connections[0] = {
    ...source.connections[0],
    fromSide: 'right',
    toSide: 'left',
    via: [[100, 140], [220, 140]],
  };
  const input = writeFixture('blocked-route.architecture.json', source);
  const output = path.join(tmp, 'trusted.html');
  const trusted = '<!doctype html><title>trusted prior artifact</title>\n';
  fs.writeFileSync(output, trusted);

  const validated = run(['validate', 'architecture', input, '--quality', 'showcase', '--json']);
  const delivered = run(['deliver', 'architecture', input, output, '--quality', 'showcase', '--json']);
  assert.equal(validated.status, 1, validated.stderr || validated.stdout);
  assert.equal(delivered.status, 1, delivered.stderr || delivered.stdout);
  assert.equal(validated.stderr, '');
  assert.equal(delivered.stderr, '');

  const validateRepair = receipt(validated).diagnostics.find((entry) => entry.code === 'clean-flow/edge-through-node');
  const deliverRepair = receipt(delivered).diagnostics.find((entry) => entry.code === 'clean-flow/edge-through-node');
  assert.ok(validateRepair);
  assert.ok(deliverRepair);
  assert.deepEqual(deliverRepair, validateRepair);
  assert.equal(validateRepair.subject.id, 'users-to-cdn');
  assert.equal(validateRepair.evidence.obstacleId, 'auth');
  assert.equal(validateRepair.evidence.segmentIndex, 0);
  assert.equal(validateRepair.evidence.clearancePx, 2);
  assert.ok(validateRepair.supportedFixes.some((fix) => fix.includes('route/via')));
  assert.equal(fs.readFileSync(output, 'utf8'), trusted);
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-delivery-')), []);
});

test('repair receipt: repository evidence failures retain a stable rule and exact repair', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.repository = {
    url: 'https://github.com/example/repository',
    revision: '0123456789abcdef0123456789abcdef01234567',
  };
  source.components[0].sources = [{ path: 'src/index.js', line: 1 }];
  const input = writeFixture('evidence-root-required.architecture.json', source);
  const result = run(['validate', 'architecture', input, '--json']);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const repair = receipt(result).diagnostics[0];
  assert.equal(repair.code, 'repository-evidence/root-required');
  assert.deepEqual(repair.subject, { surface: 'repository-evidence', path: '/meta/repository' });
  assert.deepEqual(repair.supportedFixes, ['pass --repo-root with the matching local Git checkout']);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
