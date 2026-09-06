import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const archifyCli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-test-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

test('export command extracts SVG from all five diagram types', () => {
  for (const [type, example] of Object.entries(CASES)) {
    const input = path.join(skillRoot, 'examples', example);
    const output = path.join(tmp, `${type}.svg`);

    execFileSync(process.execPath, [
      archifyCli,
      'export',
      type,
      input,
      output,
    ]);

    assert.ok(fs.existsSync(output), `${type}: output file should exist`);

    const svg = fs.readFileSync(output, 'utf8');
    assert.match(svg, /^<svg/, `${type}: should start with <svg`);
    assert.match(svg, /<\/svg>$/, `${type}: should end with </svg>`);
    assert.match(svg, /viewBox="0 0 \d+ \d+"/, `${type}: should have viewBox`);
    assert.match(svg, /role="img"/, `${type}: should have role="img"`);
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${type}: should have xmlns`);
    assert.match(svg, /<title/, `${type}: should include accessible title`);
    assert.match(svg, /<style>/, `${type}: should include embedded styles`);
  }
});

test('export command supports --json flag', () => {
  const input = path.join(skillRoot, 'examples', CASES.architecture);
  const output = path.join(tmp, 'json-test.svg');

  const result = execFileSync(process.execPath, [
    archifyCli,
    'export',
    'architecture',
    input,
    output,
    '--json',
  ], { encoding: 'utf8' });

  const receipt = JSON.parse(result);
  assert.strictEqual(receipt.ok, true);
  assert.strictEqual(receipt.command, 'export');
  assert.strictEqual(receipt.type, 'architecture');
  assert.strictEqual(receipt.format, 'svg');
  assert.ok(receipt.artifact.sha256);
  assert.ok(receipt.artifact.bytes > 0);
});

test('export command supports --quality flag', () => {
  const input = path.join(skillRoot, 'examples', CASES.workflow);
  const output = path.join(tmp, 'quality-test.svg');

  execFileSync(process.execPath, [
    archifyCli,
    'export',
    'workflow',
    input,
    output,
    '--quality',
    'showcase',
  ]);

  assert.ok(fs.existsSync(output));
  const svg = fs.readFileSync(output, 'utf8');
  assert.match(svg, /<svg/);
});

test('export command rejects unsupported formats', () => {
  const input = path.join(skillRoot, 'examples', CASES.architecture);
  const output = path.join(tmp, 'png-test.png');

  assert.throws(() => {
    execFileSync(process.execPath, [
      archifyCli,
      'export',
      'architecture',
      input,
      output,
      '--format',
      'png',
    ]);
  }, /not yet supported/);
});

test('export command fails with invalid input', () => {
  const output = path.join(tmp, 'invalid.svg');

  assert.throws(() => {
    execFileSync(process.execPath, [
      archifyCli,
      'export',
      'architecture',
      '/nonexistent/file.json',
      output,
    ], { stdio: 'pipe' });
  });
});

test('exported SVG is deterministic for identical input', () => {
  const input = path.join(skillRoot, 'examples', CASES.sequence);
  const output1 = path.join(tmp, 'deterministic-1.svg');
  const output2 = path.join(tmp, 'deterministic-2.svg');

  execFileSync(process.execPath, [archifyCli, 'export', 'sequence', input, output1]);
  execFileSync(process.execPath, [archifyCli, 'export', 'sequence', input, output2]);

  const svg1 = fs.readFileSync(output1, 'utf8');
  const svg2 = fs.readFileSync(output2, 'utf8');

  assert.strictEqual(svg1, svg2, 'exported SVG should be deterministic');
});

test('export command creates output directory if missing', () => {
  const input = path.join(skillRoot, 'examples', CASES.dataflow);
  const output = path.join(tmp, 'nested', 'directory', 'output.svg');

  execFileSync(process.execPath, [
    archifyCli,
    'export',
    'dataflow',
    input,
    output,
  ]);

  assert.ok(fs.existsSync(output));
});

process.on('exit', () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (error) {
    console.error(`Warning: could not clean up test directory: ${error.message}`);
  }
});
