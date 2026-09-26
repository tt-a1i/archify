import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as generatedValidators from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const validateWorkflow = generatedValidators.workflow;
const commonSchema = JSON.parse(
  fs.readFileSync(path.join(skillRoot, 'schemas', 'common.schema.json'), 'utf8'),
);
const validatePortableOutputSchema = new Ajv2020({ strict: true })
  .compile(commonSchema.$defs.portableOutputPath);

function workflowDocument(schemaVersion) {
  return {
    schema_version: schemaVersion,
    diagram_type: 'workflow',
    meta: { title: 'Schema compatibility', output: 'schema-compatibility.html' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'step', lane: 'main', col: 0, type: 'backend', label: 'Step' }],
    edges: [],
  };
}

test('generated workflow validator accepts schema versions 1 and 2 only', () => {
  assert.equal(validateWorkflow.length, 1, 'the generated wrapper preserves the AJV call arity');
  assert.equal(validateWorkflow(workflowDocument(1)), true, JSON.stringify(validateWorkflow.errors));
  assert.equal(validateWorkflow(workflowDocument(2)), true, JSON.stringify(validateWorkflow.errors));
  assert.equal(validateWorkflow(workflowDocument(3)), false);
  assert.deepEqual(validateWorkflow.errors?.[0]?.params.allowedValues, [1, 2]);
});

test('portable output diagnostics preserve a caller-provided instance path', () => {
  const document = workflowDocument(1);
  document.meta.output = `${'é'.repeat(128)}.html`;
  assert.equal(validateWorkflow(document, { instancePath: '/payload' }), false);
  assert.equal(validateWorkflow.errors?.[0]?.instancePath, '/payload/meta/output');
});

test('portable output schema rejects empty basenames, unpaired surrogates, and 8.3 aliases', () => {
  for (const output of [
    '.html',
    'reports/.html',
    '\ud800.html',
    'reports/\udfff.html',
    'PROGRA~1/diagram.html',
    'reports/DIAGRA~12.HTML',
  ]) {
    assert.equal(
      validatePortableOutputSchema(output),
      false,
      `schema accepted ${JSON.stringify(output)}`,
    );
  }
  assert.equal(validatePortableOutputSchema('reports/😀.html'), true);
});

test('generated validators share one portable authored output contract', () => {
  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };
  const invalidOutputs = [
    '',
    '/absolute/diagram.html',
    'reports\\diagram.html',
    'C:diagram.html',
    'file:///tmp/diagram.html',
    'reports//diagram.html',
    'reports/./diagram.html',
    'reports/../diagram.html',
    'reports./diagram.html',
    'reports/NUL.html',
    'reports/CONIN$.html',
    'reports/COM¹.snapshot.html',
    'PROGRA~1/diagram.html',
    'reports/DIAGRA~12.HTML',
    'reports/diagram?.html',
    'reports/diagram.txt',
    '.html',
    'reports/.html',
    '\ud800.html',
    'reports/\udfff.html',
    `${'a'.repeat(251)}.html`,
    `${'é'.repeat(128)}.html`,
  ];
  const deepOutput = `${Array.from(
    { length: 10 },
    (_, index) => `component-${index}-${'a'.repeat(20)}`,
  ).join('/')}/diagram.html`;
  assert.ok(deepOutput.length > 255);
  assert.equal(validatePortableOutputSchema(deepOutput), true);

  for (const [type, example] of Object.entries(examples)) {
    const document = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    document.meta.output = 'reports/diagram.HTML';
    assert.equal(
      generatedValidators[type](document),
      true,
      `${type} rejected a portable HTML output: ${JSON.stringify(generatedValidators[type].errors)}`,
    );
    document.meta.output = deepOutput;
    assert.equal(
      generatedValidators[type](document),
      true,
      `${type} rejected a deep output whose individual components are portable: ${JSON.stringify(generatedValidators[type].errors)}`,
    );

    for (const output of invalidOutputs) {
      document.meta.output = output;
      assert.equal(
        generatedValidators[type](document),
        false,
        `${type} accepted non-portable meta.output ${JSON.stringify(output)}`,
      );
    }
  }
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
