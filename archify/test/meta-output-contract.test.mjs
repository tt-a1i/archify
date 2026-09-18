import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const architectureExample = path.join(skillRoot, 'examples', 'web-app.architecture.json');
const workflowFixture = path.join(
  __dirname,
  'fixtures',
  'v1-workflow-explicit-coordinates.workflow.json',
);

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-meta-output-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeDocument(directory, name, source, output) {
  const document = JSON.parse(fs.readFileSync(source, 'utf8'));
  document.meta.output = output;
  const target = path.join(directory, name);
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return target;
}

function writeDocumentWithoutValidOutput(directory, name, source, output = undefined) {
  const document = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (output === undefined) delete document.meta.output;
  else document.meta.output = output;
  const target = path.join(directory, name);
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return target;
}

function run(args, cwd, { env = process.env } = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env });
}

function jsonOutput(result) {
  assert.doesNotThrow(
    () => JSON.parse(result.stdout),
    `expected JSON stdout, received:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

test('validate checks authored output even though its verification artifact uses a staging path', t => {
  const directory = workspace(t);
  const invalidOutputs = [
    { output: '', code: 'output/meta-path-syntax' },
    { output: '/absolute/diagram.html', code: 'output/meta-absolute' },
    { output: 'reports\\diagram.html', code: 'output/meta-path-syntax' },
    { output: 'C:diagram.html', code: 'output/meta-path-syntax' },
    { output: 'file:///tmp/diagram.html', code: 'output/meta-path-syntax' },
  ];

  for (const [index, { output, code }] of invalidOutputs.entries()) {
    const input = writeDocument(directory, `invalid-${index}.architecture.json`, architectureExample, output);
    const result = run(['validate', 'architecture', input, '--json'], directory);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const failure = jsonOutput(result);
    assert.equal(failure.ok, false);
    assert.equal(failure.command, 'validate');
    assert.equal(failure.diagnostics.length, 1, result.stdout);
    assert.equal(failure.diagnostics[0].code, code);
    assert.equal(failure.diagnostics[0].subject.path, '/meta/output');
  }

  const valid = writeDocument(
    directory,
    'valid.architecture.json',
    architectureExample,
    'reports/diagram.html',
  );
  const result = run(['validate', 'architecture', valid, '--json'], directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(jsonOutput(result).ok, true);
  assert.equal(fs.existsSync(path.join(directory, 'reports')), false);
});

test('an explicit CLI output does not hide an invalid durable authored output', t => {
  const directory = workspace(t);
  const input = writeDocument(
    directory,
    'invalid-override.architecture.json',
    architectureExample,
    'reports\\diagram.html',
  );
  const override = path.join(directory, 'override.html');

  const result = run(['render', 'architecture', input, override], directory);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /output\/meta-path-syntax/);
  assert.equal(fs.existsSync(override), false);
});

test('validate rejects an invalid durable output before allocating temporary staging', t => {
  const directory = workspace(t);
  const input = writeDocument(
    directory,
    'invalid-before-staging.architecture.json',
    architectureExample,
    'reports\\diagram.html',
  );
  const unavailableTemp = path.join(directory, 'missing-temporary-root');
  const result = run(['validate', 'architecture', input, '--json'], directory, {
    env: {
      ...process.env,
      TMPDIR: unavailableTemp,
      TMP: unavailableTemp,
      TEMP: unavailableTemp,
    },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const failure = jsonOutput(result);
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.equal(failure.diagnostics[0].subject.path, '/meta/output');
  assert.equal(fs.existsSync(unavailableTemp), false);
});

for (const boundary of [
  {
    label: 'escapes through a directory symlink',
    output: 'reports/diagram.html',
    expected: /meta\.output must stay inside the current working directory/i,
    prepare(directory, outside) {
      fs.symlinkSync(outside, path.join(directory, 'reports'), 'dir');
    },
  },
  {
    label: 'resolves through a file symlink to a non-HTML target',
    output: 'diagram.html',
    expected: /meta\.output must resolve to an? \.html file/i,
    prepare(directory) {
      fs.writeFileSync(path.join(directory, 'diagram.json'), 'trusted target\n');
      fs.symlinkSync(path.join(directory, 'diagram.json'), path.join(directory, 'diagram.html'), 'file');
    },
  },
]) {
  test(`every command rejects durable meta.output that ${boundary.label}, even with a CLI target`, t => {
    const directory = workspace(t);
    const outside = path.join(directory, '..', `${path.basename(directory)}-outside`);
    fs.mkdirSync(outside);
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    boundary.prepare(directory, outside);
    const architecture = writeDocument(
      directory,
      'invalid.architecture.json',
      architectureExample,
      boundary.output,
    );
    const peer = writeDocument(
      directory,
      'peer.architecture.json',
      architectureExample,
      'peer.html',
    );
    const workflow = writeDocument(
      directory,
      'invalid.workflow.json',
      workflowFixture,
      boundary.output,
    );
    const explicitDirectory = path.join(directory, 'explicit');
    const commands = [
      ['validate', ['validate', 'architecture', architecture, '--json']],
      ['render', ['render', 'architecture', architecture, path.join(explicitDirectory, 'render.html')]],
      ['deliver', ['deliver', 'architecture', architecture, path.join(explicitDirectory, 'deliver.html'), '--json']],
      ['preview', ['preview', 'architecture', architecture, path.join(explicitDirectory, 'preview.html'), '--no-open']],
      ['compare', ['compare', 'architecture', architecture, peer, path.join(explicitDirectory, 'compare.html'), '--json']],
      ['migrate', ['migrate', 'workflow', workflow, path.join(explicitDirectory, 'migrated.workflow.json'), '--to-schema', '2', '--json']],
    ];

    for (const [command, args] of commands) {
      const result = run(args, directory);
      assert.equal(result.status, 1, `${command}: ${result.stderr || result.stdout}`);
      assert.match(`${result.stdout}\n${result.stderr}`, boundary.expected, command);
      assert.equal(fs.existsSync(explicitDirectory), false, `${command} created its CLI target directory`);
    }
    assert.equal(fs.existsSync(path.join(outside, 'diagram.html')), false);
  });
}

for (const [label, output] of [['missing', undefined], ['non-string', 42]]) {
  test(`all artifact commands reject ${label} durable meta.output before creating outputs`, t => {
    const directory = workspace(t);
    const input = writeDocumentWithoutValidOutput(
      directory,
      `${label}.architecture.json`,
      architectureExample,
      output,
    );

    for (const command of ['validate', 'render', 'deliver']) {
      const commandDirectory = path.join(directory, command);
      const artifact = path.join(commandDirectory, 'override.html');
      const args = command === 'validate'
        ? [command, 'architecture', input, '--json']
        : command === 'deliver'
          ? [command, 'architecture', input, artifact, '--json']
          : [command, 'architecture', input, artifact];
      const result = run(args, directory);
      assert.equal(result.status, 1, `${command}: ${result.stderr || result.stdout}`);
      assert.equal(fs.existsSync(commandDirectory), false, `${command} created its output directory`);
      assert.equal(
        fs.readdirSync(directory).some((entry) => /delivery|archify-render/u.test(entry)),
        false,
        `${command} left a sidecar or staging entry`,
      );
    }
  });

  test(`compare and preview reject ${label} durable meta.output before creating outputs`, t => {
    const directory = workspace(t);
    const input = writeDocumentWithoutValidOutput(
      directory,
      `${label}.architecture.json`,
      architectureExample,
      output,
    );
    const peer = writeDocument(
      directory,
      'peer.architecture.json',
      architectureExample,
      'peer.html',
    );

    const compareDirectory = path.join(directory, 'compare');
    const compare = run([
      'compare', 'architecture', input, peer, path.join(compareDirectory, 'delta.html'), '--json',
    ], directory);
    assert.equal(compare.status, 1, compare.stderr || compare.stdout);
    assert.equal(jsonOutput(compare).diagnostics[0].code, 'output/meta-path-syntax');
    assert.equal(fs.existsSync(compareDirectory), false, 'compare created its output directory');

    const previewDirectory = path.join(directory, 'preview');
    const preview = run([
      'preview', 'architecture', input, path.join(previewDirectory, 'diagram.html'), '--no-open',
    ], directory);
    assert.equal(preview.status, 1, preview.stderr || preview.stdout);
    assert.match(preview.stderr, /meta\.output must be a portable POSIX-relative path/);
    assert.equal(fs.existsSync(previewDirectory), false, 'preview created its output directory');
  });

  test(`migration rejects ${label} durable meta.output before creating its destination`, t => {
    const directory = workspace(t);
    const source = writeDocumentWithoutValidOutput(
      directory,
      `${label}.workflow.json`,
      workflowFixture,
      output,
    );
    const destinationDirectory = path.join(directory, 'migration');
    const destination = path.join(destinationDirectory, 'migrated.workflow.json');
    const result = run([
      'migrate', 'workflow', source, destination, '--to-schema', '2', '--json',
    ], directory);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(
      jsonOutput(result).diagnostics[0].code,
      label === 'missing' ? 'schema/required' : 'output/meta-path-syntax',
    );
    assert.equal(fs.existsSync(destinationDirectory), false, 'migration created its destination directory');
  });
}

test('migration rejects a non-portable authored output without mutating its destination', t => {
  const directory = workspace(t);
  const source = writeDocument(
    directory,
    'invalid.workflow.json',
    workflowFixture,
    'reports\\diagram.html',
  );
  const sourceBytes = fs.readFileSync(source);
  const destination = path.join(directory, 'destination.workflow.json');
  const sentinel = Buffer.from('destination sentinel\n');
  fs.writeFileSync(destination, sentinel);

  const result = run([
    'migrate', 'workflow', source, destination, '--to-schema', '2', '--json',
  ], directory);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.deepEqual(fs.readFileSync(destination), sentinel);
  const failure = jsonOutput(result);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'migrate');
  assert.equal(failure.diagnostics.length, 1, result.stdout);
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.equal(failure.diagnostics[0].subject.path, '/meta/output');
});

test('migration preserves a portable authored output and remains byte-idempotent', t => {
  const directory = workspace(t);
  const source = writeDocument(
    directory,
    'valid.workflow.json',
    workflowFixture,
    'reports/diagram.html',
  );
  const firstDestination = path.join(directory, 'first.workflow.json');
  const secondDestination = path.join(directory, 'second.workflow.json');

  const first = run([
    'migrate', 'workflow', source, firstDestination, '--to-schema', '2', '--json',
  ], directory);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(JSON.parse(fs.readFileSync(firstDestination, 'utf8')).meta.output, 'reports/diagram.html');

  const second = run([
    'migrate', 'workflow', firstDestination, secondDestination, '--to-schema', '2', '--json',
  ], directory);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(fs.readFileSync(secondDestination), fs.readFileSync(firstDestination));
});
