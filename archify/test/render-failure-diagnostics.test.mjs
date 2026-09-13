import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');
const examples = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-render-diagnostics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, cwd, json = false) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: json ? 'json' : '' },
  });
}

function assertHumanFailure(result, code) {
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`[${code}]`), result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at\s|file:\/\/|Node\.js v/);
}

for (const [type, example] of Object.entries(examples)) {
  test(`render ${type}: input read/parse and output failures name the failing operation`, t => {
    const cwd = workspace(t);
    const input = path.join(skillRoot, 'examples', example);
    const output = path.join(cwd, 'diagram.html');
    const missing = run([cli, 'render', type, path.join(cwd, 'missing.json'), output], cwd);
    assertHumanFailure(missing, 'input/read');
    assert.match(missing.stderr, /Fix: provide one readable JSON input file/);

    const malformed = path.join(cwd, 'malformed.json');
    fs.writeFileSync(malformed, '{"broken":');
    assertHumanFailure(run([cli, 'render', type, malformed, output], cwd), 'input/json-parse');
    assert.equal(fs.existsSync(output), false);

    // Directory targets fail on both POSIX and Windows without relying on
    // permission bits (which a privileged test process may bypass).
    fs.mkdirSync(output);
    assertHumanFailure(run([cli, 'render', type, input, output], cwd), 'output/write');
    const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
    const machine = run([renderer, input, output], cwd, true);
    assert.equal(machine.status, 1);
    assert.equal(machine.stdout, '');
    const failure = JSON.parse(machine.stderr);
    assert.equal(failure.diagnostics[0].code, 'output/write');
    assert.deepEqual(failure.diagnostics[0].subject, { output });
    assert.ok(failure.diagnostics[0].evidence.systemCode);
    assert.ok(failure.diagnostics[0].supportedFixes.length);
    assert.deepEqual(fs.readdirSync(output), []);

    const blockedParent = path.join(cwd, 'parent');
    fs.writeFileSync(blockedParent, 'preserved');
    assertHumanFailure(run([renderer, input, path.join(blockedParent, 'diagram.html')], cwd), 'output/write');
    assert.equal(fs.readFileSync(blockedParent, 'utf8'), 'preserved');
  });

  test(`render ${type}: successful direct and public rendering retain the output contract`, t => {
    const cwd = workspace(t);
    const input = path.join(skillRoot, 'examples', example);
    const output = path.join(cwd, 'diagram.html');
    const publicResult = run([cli, 'render', type, input, output], cwd);
    assert.equal(publicResult.status, 0, publicResult.stderr);
    assert.equal(publicResult.stdout, `${output}\n`);
    assert.equal(publicResult.stderr, '');
    const bytes = fs.readFileSync(output);
    const directResult = run([path.join(skillRoot, 'renderers', type, `render-${type}.mjs`), input, output], cwd);
    assert.equal(directResult.status, 0, directResult.stderr);
    assert.equal(directResult.stdout, `${output}\n`);
    assert.equal(directResult.stderr, '');
    assert.deepEqual(fs.readFileSync(output), bytes);
  });
}

test('render layout rejection exposes the existing diagnostic and preserves an existing artifact', t => {
  const cwd = workspace(t);
  const input = path.join(cwd, 'layout.json');
  const output = path.join(cwd, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Wide label', quality_profile: 'standard', viewBox: [975, 395] },
    components: [{ id: 'node', type: 'security', label: '字'.repeat(40), pos: [40, 40], size: [88, 71] }],
  }));
  fs.writeFileSync(output, 'trusted artifact');
  const result = run([cli, 'render', 'architecture', input, output], cwd);
  assertHumanFailure(result, 'layout/constraint');
  assert.match(result.stderr, /shorten the label or widen size/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted artifact');
  for (const command of ['validate', 'deliver']) {
    const machine = run([cli, command, 'architecture', input, ...(command === 'deliver' ? [output] : []), '--json'], cwd);
    assert.equal(machine.status, 1);
    assert.equal(machine.stderr, '');
    const failure = JSON.parse(machine.stdout);
    assert.equal(failure.diagnostics[0].code, 'layout/constraint');
    assert.deepEqual(failure.diagnostics[0].subject, { diagramType: 'architecture' });
  }
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted artifact');
});

test('unexpected renderer exceptions keep native debugging information and are not relabelled as input errors', t => {
  const cwd = workspace(t);
  const helper = new URL('../renderers/shared/cli.mjs', import.meta.url).href;
  const script = `import ${JSON.stringify(helper)}; throw Object.assign(new SyntaxError('implementation defect'), { code: 'EACCES' });`;
  const human = run(['--input-type=module', '-e', script], cwd);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /SyntaxError: implementation defect/);
  assert.match(human.stderr, /\n\s+at\s/);
  const machine = run(['--input-type=module', '-e', script], cwd, true);
  assert.equal(machine.status, 1);
  assert.equal(JSON.parse(machine.stderr).diagnostics[0].code, 'internal/unclassified');
});

test('a recorded layout diagnostic cannot hide a later unclassified exception', t => {
  const cwd = workspace(t);
  const helper = new URL('../renderers/shared/diagnostics.mjs', import.meta.url).href;
  const setup = `import { installRendererDiagnosticBoundary, recordDiagnostic, throwDiagnosticError } from ${JSON.stringify(helper)};
    installRendererDiagnosticBoundary();
    recordDiagnostic({ code: 'layout/constraint', message: 'earlier layout problem' });`;
  for (const failure of [
    `throw new TypeError('later implementation defect');`,
    `throwDiagnosticError('later implementation defect', []);`,
  ]) {
    const result = run(['--input-type=module', '-e', setup + failure], cwd, true);
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stderr);
    assert.deepEqual(receipt.diagnostics.map(d => d.code), ['internal/unclassified']);
    assert.equal(receipt.diagnostics[0].message, 'later implementation defect');
  }
  const classified = run(['--input-type=module', '-e', setup + `throwDiagnosticError('layout rejected', [{ code: 'layout/constraint', message: 'final layout problem' }]);`], cwd, true);
  assert.equal(classified.status, 1);
  assert.deepEqual(JSON.parse(classified.stderr).diagnostics.map(d => d.message), ['earlier layout problem', 'final layout problem']);
});

test('invalid output arguments keep their implementation error instead of a filesystem repair', t => {
  const cwd = workspace(t);
  const helper = new URL('../renderers/shared/cli.mjs', import.meta.url).href;
  const templatePath = path.join(skillRoot, 'assets/template.html');
  const script = `import fs from 'node:fs'; import { writeDiagram } from ${JSON.stringify(helper)};
    writeDiagram({ outPath: undefined, template: fs.readFileSync(${JSON.stringify(templatePath)}, 'utf8'), diagramType: 'architecture', meta: { title: 'Test' }, svg: '', cards: [] });`;
  const human = run(['--input-type=module', '-e', script], cwd);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /TypeError \[ERR_INVALID_ARG_TYPE\]/);
  assert.match(human.stderr, /\n\s+at\s/);
  assert.doesNotMatch(human.stderr, /output\/write|choose a writable/);
  const machine = run(['--input-type=module', '-e', script], cwd, true);
  assert.equal(machine.status, 1);
  assert.equal(JSON.parse(machine.stderr).diagnostics[0].code, 'internal/unclassified');
});

test('renderer and standalone CLI format the same diagnostics consistently', () => {
  // Evaluate only the pure formatter: importing the CLI would run its command
  // dispatch, and sharing its renderer import would break incomplete-install doctor.
  const formatters = [cli, path.join(skillRoot, 'renderers/shared/diagnostics.mjs')].map(file => {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('function formatDiagnostics(');
    assert.notEqual(start, -1);
    const end = source.indexOf('\n}', start) + 2;
    return vm.runInNewContext(`(${source.slice(start, end)})`);
  });
  for (const diagnostics of [[], [
    { code: 'layout/constraint', message: '标签过宽', supportedFixes: ['widen size', 'shorten label'] },
    { code: 'internal/unclassified', message: 'No repair available' },
  ]]) {
    assert.equal(formatters[0]('Render failed', diagnostics), formatters[1]('Render failed', diagnostics));
  }
});
