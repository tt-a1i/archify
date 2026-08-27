import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function writeWorkflow(cwd, nodes) {
  const input = path.join(cwd, 'diagram.workflow.json');
  const spec = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'column spacing', quality_profile: 'showcase', viewBox: [900, 520] },
    lanes: [{ id: 'lane', label: 'Lane' }],
    nodes,
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'step', variant: 'default' }],
  };
  fs.writeFileSync(input, `${JSON.stringify(spec, null, 2)}\n`);
  return input;
}

test('short same-lane edge on a tight column pair names legal wider pairs', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-col-'));
  const input = writeWorkflow(cwd, [
    { id: 'a', lane: 'lane', col: 1, type: 'backend', label: 'A', sublabel: 'x' },
    { id: 'b', lane: 'lane', col: 2, type: 'backend', label: 'B', sublabel: 'y' },
  ]);

  const result = run(['validate', 'workflow', input, '--quality', 'showcase'], cwd);
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /too short \(12px; minimum 28px\)/);
  assert.match(output, /wider adjacent pair/);
  assert.match(output, /0→1/);
  assert.match(output, /2→3/);
  assert.match(output, /4→5/);
  assert.doesNotMatch(output, /drop its label/);
});

test('short same-lane edge on col 3→4 also names legal wider pairs', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-col-'));
  const input = writeWorkflow(cwd, [
    { id: 'a', lane: 'lane', col: 3, type: 'backend', label: 'A', sublabel: 'x' },
    { id: 'b', lane: 'lane', col: 4, type: 'backend', label: 'B', sublabel: 'y' },
  ]);

  const result = run(['validate', 'workflow', input, '--quality', 'showcase'], cwd);
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /too short \(22px; minimum 28px\)/);
  assert.match(output, /0→1/);
  assert.match(output, /2→3/);
  assert.match(output, /4→5/);
});

test('same-lane edge on a wide column pair still validates', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-col-'));
  const input = writeWorkflow(cwd, [
    { id: 'a', lane: 'lane', col: 0, type: 'backend', label: 'A', sublabel: 'x' },
    { id: 'b', lane: 'lane', col: 1, type: 'backend', label: 'B', sublabel: 'y' },
  ]);

  const result = run(['validate', 'workflow', input, '--quality', 'showcase'], cwd);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /too short/);
});
