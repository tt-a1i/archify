import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflow as validateWorkflow } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function workflowDocument(schemaVersion) {
  return {
    schema_version: schemaVersion,
    diagram_type: 'workflow',
    meta: { title: 'Schema compatibility' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'step', lane: 'main', col: 0, type: 'backend', label: 'Step' }],
    edges: [],
  };
}

test('generated workflow validator accepts schema versions 1 and 2 only', () => {
  assert.equal(validateWorkflow(workflowDocument(1)), true, JSON.stringify(validateWorkflow.errors));
  assert.equal(validateWorkflow(workflowDocument(2)), true, JSON.stringify(validateWorkflow.errors));
  assert.equal(validateWorkflow(workflowDocument(3)), false);
  assert.deepEqual(validateWorkflow.errors?.[0]?.params.allowedValues, [1, 2]);
});

test('validator freshness check accepts CRLF checkouts', () => {
  const scratch = fs.mkdtempSync(path.join(skillRoot, '.validator-check-'));
  try {
    fs.mkdirSync(path.join(scratch, 'scripts'));
    fs.mkdirSync(path.join(scratch, 'renderers', 'shared'), { recursive: true });
    fs.cpSync(path.join(skillRoot, 'schemas'), path.join(scratch, 'schemas'), { recursive: true });
    fs.copyFileSync(
      path.join(skillRoot, 'scripts', 'generate-validators.mjs'),
      path.join(scratch, 'scripts', 'generate-validators.mjs'),
    );

    const validator = fs.readFileSync(
      path.join(skillRoot, 'renderers', 'shared', 'generated-validators.mjs'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(scratch, 'renderers', 'shared', 'generated-validators.mjs'),
      validator.replace(/\r\n?|\n/g, '\r\n'),
    );

    const result = spawnSync(process.execPath, [
      path.join(scratch, 'scripts', 'generate-validators.mjs'),
      '--check',
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
