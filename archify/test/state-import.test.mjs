import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSvgs, parseXml } from './helpers/xml.mjs';
import { importStateDiagram, parseStateDiagram } from '../importers/state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const fixtures = path.join(__dirname, 'fixtures', 'state');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-state-import-'));

function fixture(name) {
  return path.join(fixtures, name);
}

function read(name) {
  return fs.readFileSync(fixture(name), 'utf8');
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });
}

function importFixture(name, extra = []) {
  const output = path.join(tmp, `${path.basename(name, '.mmd')}-${Math.random().toString(16).slice(2)}.lifecycle.json`);
  const result = run(['import', 'state', fixture(name), output, ...extra]);
  return { result, output };
}

function codes(diagnostics) {
  return diagnostics.map((entry) => entry.code);
}

// --- Supported subset ----------------------------------------------------

test('a supported state diagram becomes typed lifecycle IR', () => {
  const imported = importStateDiagram(read('valid-agent-run.mmd'));
  assert.ok(imported.ok, JSON.stringify(imported.diagnostics, null, 2));
  const ir = imported.ir;

  assert.equal(ir.schema_version, 1);
  assert.equal(ir.diagram_type, 'lifecycle');
  assert.equal(ir.meta.title, 'Agent Run Lifecycle');
  assert.equal(ir.states.length, 8);
  assert.equal(ir.transitions.length, 8);

  const byId = new Map(ir.states.map((state) => [state.id, state]));
  assert.equal(byId.get('Queued').type, 'start');
  assert.equal(byId.get('Planning').type, 'active');
  assert.equal(byId.get('Reviewing').type, 'decision');
  assert.equal(byId.get('Completed').type, 'neutral');
  assert.equal(byId.get('Cancelled').type, 'neutral');

  // `state "description" as id` keeps the alias as the id and the quoted
  // description as the rendered label.
  assert.equal(byId.get('Executing').label, 'Executing tools');
  // A bare state keeps its own id as the label.
  assert.equal(byId.get('Planning').label, 'Planning');
  // `note right of X` becomes the state sublabel.
  assert.equal(byId.get('Blocked').sublabel, 'waits for user input');

  // The five-state spine owns the phase rail in source order.
  assert.deepEqual(
    ir.states.filter((state) => state.lane === 'main').map((state) => [state.id, state.col]),
    [['Queued', 0], ['Planning', 1], ['Executing', 2], ['Reviewing', 3], ['Completed', 4]],
  );
  assert.deepEqual(ir.states.filter((state) => state.lane === 'events').map((state) => state.id), ['Failed', 'Blocked']);
  assert.deepEqual(ir.states.filter((state) => state.lane === 'terminal').map((state) => state.id), ['Cancelled']);

  // Every authored transition survives, including the back edge, with guards.
  assert.deepEqual(
    ir.transitions.map((transition) => [transition.from, transition.to, transition.label ?? null]),
    [
      ['Queued', 'Planning', 'request accepted'],
      ['Planning', 'Executing', null],
      ['Executing', 'Reviewing', null],
      ['Reviewing', 'Completed', 'gate passed'],
      ['Reviewing', 'Failed', 'gate rejected'],
      ['Failed', 'Executing', 'retry budget'],
      ['Executing', 'Blocked', 'missing input'],
      ['Blocked', 'Cancelled', 'operator stopped'],
    ],
  );
});

test('imported lifecycle IR passes archify validate lifecycle', () => {
  const sources = [
    'valid-agent-run.mmd',
    'valid-minimal.mmd',
    'valid-legacy-header.mmd',
    'valid-dense-recovery.mmd',
    'valid-back-edges.mmd',
  ];
  for (const name of sources) {
    const { result, output } = importFixture(name);
    assert.equal(result.status, 0, `${name} import failed: ${result.stderr}`);
    const validate = run(['validate', 'lifecycle', output, '--json']);
    assert.equal(validate.status, 0, `${name} validate failed: ${validate.stdout}${validate.stderr}`);
    const receipt = JSON.parse(validate.stdout);
    assert.equal(receipt.ok, true);
    // A generated layout that only avoids hard errors is not good enough: the
    // routes and guard labels must also clear the artifact composition budget.
    assert.equal(receipt.composition.summary.errors, 0, `${name} composition errors`);
    assert.equal(receipt.composition.summary.warnings, 0, `${name} composition warnings`);
  }
});

test('back edges and recovery loops keep every authored transition', () => {
  const backEdges = parseStateDiagram(read('valid-back-edges.mmd'));
  assert.ok(backEdges.ok, JSON.stringify(backEdges.diagnostics, null, 2));
  assert.equal(backEdges.ir.transitions.length, 5);
  assert.ok(backEdges.ir.transitions.some((transition) => transition.from === 'Reviewing' && transition.to === 'Idle'));

  const dense = parseStateDiagram(read('valid-dense-recovery.mmd'));
  assert.ok(dense.ok, JSON.stringify(dense.diagnostics, null, 2));
  assert.equal(dense.ir.states.length, 9);
  assert.equal(dense.ir.transitions.length, 10);
  assert.deepEqual(
    dense.ir.states.filter((state) => state.lane === 'terminal').map((state) => state.id),
    ['Rejected', 'Withdrawn'],
  );
});

test('the legacy stateDiagram header, direction, and description lines are supported', () => {
  const imported = importStateDiagram(read('valid-legacy-header.mmd'));
  assert.ok(imported.ok, JSON.stringify(imported.diagnostics, null, 2));
  const byId = new Map(imported.ir.states.map((state) => [state.id, state]));
  assert.equal(byId.get('Idle').type, 'start');
  assert.equal(byId.get('Idle').sublabel, 'waiting for work');
  assert.equal(byId.get('Done').type, 'neutral');
  // `direction` is layout, not meaning: the lifecycle bands are fixed, so the
  // receipt reports it as carried-but-not-applied instead of dropping it.
  assert.deepEqual(imported.receipt.ignoredDirectives, ['direction LR']);
  // A back edge to an earlier phase is preserved.
  assert.ok(imported.ir.transitions.some((transition) => transition.from === 'Running' && transition.to === 'Idle'));
});

test('terminal outcome kinds are neutral until the author states otherwise', () => {
  const neutral = importStateDiagram(read('valid-minimal.mmd'));
  assert.ok(neutral.ok);
  assert.equal(neutral.ir.states.find((state) => state.id === 'Published').type, 'neutral');

  const declared = importStateDiagram(read('valid-minimal.mmd'), { outcomes: new Map([['Published', 'success']]) });
  assert.ok(declared.ok);
  assert.equal(declared.ir.states.find((state) => state.id === 'Published').type, 'success');
});

test('an outcome override for an unknown state fails loudly', () => {
  const imported = importStateDiagram(read('valid-minimal.mmd'), { outcomes: new Map([['Nope', 'success']]) });
  assert.equal(imported.ok, false);
  assert.deepEqual(codes(imported.diagnostics), ['import/state-unknown-outcome-target']);
});

// --- Malformed sources ---------------------------------------------------

const malformed = [
  ['malformed-missing-header.mmd', 'import/state-missing-header', 1],
  ['malformed-unterminated-note.mmd', 'import/state-unterminated-note', 4],
  ['malformed-transition.mmd', 'import/state-malformed-transition', 3],
  ['malformed-unclosed-quote.mmd', 'import/state-unclosed-quote', 3],
];

for (const [name, code, line] of malformed) {
  test(`malformed source ${name} fails with ${code}`, () => {
    const parsed = parseStateDiagram(read(name));
    assert.equal(parsed.ok, false);
    assert.deepEqual(codes(parsed.diagnostics), [code]);
    const [diagnostic] = parsed.diagnostics;
    assert.equal(diagnostic.severity, 'error');
    assert.equal(diagnostic.subject.line, line);
    assert.ok(diagnostic.evidence.line?.length > 0 || diagnostic.evidence.construct?.length > 0);
    assert.ok(diagnostic.supportedFixes.length > 0);
  });
}

// --- Unsupported-but-valid Mermaid ---------------------------------------

const unsupported = [
  ['unsupported-composite.mmd', 'import/state-unsupported-composite'],
  ['unsupported-fork.mmd', 'import/state-unsupported-fork-join'],
  ['unsupported-concurrency.mmd', 'import/state-unsupported-concurrency'],
  ['unsupported-classdef.mmd', 'import/state-unsupported-directive'],
  ['unsupported-self-transition.mmd', 'import/state-unsupported-self-transition'],
];

for (const [name, code] of unsupported) {
  test(`unsupported construct in ${name} fails with ${code}`, () => {
    const parsed = parseStateDiagram(read(name));
    assert.equal(parsed.ok, false);
    assert.deepEqual(codes(parsed.diagnostics), [code]);
    const [diagnostic] = parsed.diagnostics;
    assert.ok(Number.isInteger(diagnostic.subject.line));
    assert.ok(diagnostic.supportedFixes.length > 0);
  });
}

test('a state diagram larger than the lifecycle bands is rejected with its budget', () => {
  const imported = importStateDiagram(read('unsupported-capacity.mmd'));
  assert.equal(imported.ok, false);
  assert.deepEqual(codes(imported.diagnostics), ['import/state-capacity-exceeded']);
  const [diagnostic] = imported.diagnostics;
  assert.equal(diagnostic.evidence.band, 'terminal');
  assert.equal(diagnostic.evidence.capacity, 3);
  assert.ok(diagnostic.evidence.states.length > 3);
});

test('ambiguous entry points and unrenderable text are named, not guessed at', () => {
  const cases = [
    ['stateDiagram-v2\n  A --> B\n', 'import/state-missing-initial'],
    ['stateDiagram-v2\n  [*] --> A\n  [*] --> B\n  A --> B\n', 'import/state-multiple-initial'],
    ['stateDiagram-v2\n  [*] --> A\n  A --> B\n  A --> A2\n  note "floating" as N1\n', 'import/state-unsupported-floating-note'],
    ['stateDiagram-v2\n  [*] --> A\n  state A <<end>>\n  A --> B\n', 'import/state-unsupported-annotation'],
    ['---\nconfig: {}\n---\nstateDiagram-v2\n  [*] --> A\n  A --> B\n', 'import/state-unsupported-frontmatter'],
    ['stateDiagram-v2\n  [*] --> A\n  A --> 9Bad\n', 'import/state-invalid-id'],
    [`stateDiagram-v2\n  [*] --> A\n  state "${'x'.repeat(40)}" as A\n  A --> B\n`, 'import/state-label-too-long'],
    [`stateDiagram-v2\n  [*] --> A\n  A --> B: ${'guard '.repeat(8)}\n`, 'import/state-transition-label-too-long'],
  ];
  for (const [source, code] of cases) {
    const parsed = parseStateDiagram(source);
    assert.equal(parsed.ok, false, `expected ${code} for:\n${source}`);
    assert.deepEqual(codes(parsed.diagnostics), [code]);
  }
});

// --- Adversarial input ---------------------------------------------------

test('adversarial label text stays inert text in the IR and in the artifact', () => {
  const parsed = parseStateDiagram(read('adversarial-injection.mmd'));
  assert.ok(parsed.ok, JSON.stringify(parsed.diagnostics, null, 2));

  const byId = new Map(parsed.ir.states.map((state) => [state.id, state]));
  assert.equal(byId.get('Evil').label, '<script>x</script>');
  // A quoted description containing "-->" is a description, not a transition.
  assert.equal(byId.get('Sink').label, 'arrow --> here');
  assert.equal(parsed.ir.transitions.length, 1);
  assert.equal(parsed.ir.transitions[0].label, '"&amp;" <b>');
  // Mermaid entity codes are carried as literal text, never decoded.
  assert.equal(byId.get('Sink').sublabel, '"quoted" & #quot; </text>');

  const { result, output } = importFixture('adversarial-injection.mmd');
  assert.equal(result.status, 0, result.stderr);
  const artifact = path.join(tmp, 'adversarial.html');
  const render = run(['render', 'lifecycle', output, artifact]);
  assert.equal(render.status, 0, render.stderr);

  const markup = fs.readFileSync(artifact, 'utf8');
  assert.ok(!markup.includes('<script>x</script>'), 'raw script markup must not reach the artifact');
  assert.ok(markup.includes('&lt;script&gt;x&lt;/script&gt;'), 'label text must be escaped');
  for (const svg of [...extractSvgs(markup).direct, ...extractSvgs(markup).embedded]) parseXml(svg);
});

test('control characters in Mermaid text are rejected instead of copied into JSON', () => {
  const parsed = parseStateDiagram(read('adversarial-control-characters.mmd'));
  assert.equal(parsed.ok, false);
  assert.deepEqual(codes(parsed.diagnostics), ['import/state-unsafe-text']);
  assert.equal(parsed.diagnostics[0].evidence.codePoint, 'U+0007');
});

// --- CLI surface ---------------------------------------------------------

test('archify import state writes IR and a machine-readable receipt', () => {
  const { result, output } = importFixture('valid-agent-run.mmd', ['--json', '--outcome', 'Completed=success', '--outcome', 'Cancelled=failure']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'import');
  assert.equal(receipt.source, 'mermaid-state');
  assert.equal(receipt.target, 'lifecycle');
  assert.equal(receipt.states, 8);
  assert.equal(receipt.transitions, 8);
  assert.deepEqual(receipt.startStates, ['Queued']);
  assert.deepEqual(receipt.terminalStates, ['Completed', 'Cancelled']);
  assert.equal(receipt.output, path.resolve(output));

  const ir = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(ir.states.find((state) => state.id === 'Completed').type, 'success');
  assert.equal(ir.states.find((state) => state.id === 'Cancelled').type, 'failure');

  const validate = run(['validate', 'lifecycle', output, '--json']);
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
});

test('archify import state prints IR on stdout when no output path is given', () => {
  const result = run(['import', 'state', fixture('valid-minimal.mmd')]);
  assert.equal(result.status, 0, result.stderr);
  const ir = JSON.parse(result.stdout);
  assert.equal(ir.diagram_type, 'lifecycle');
  assert.equal(ir.states.length, 2);
});

test('archify import state exits non-zero with a receipt for unsupported syntax', () => {
  const result = run(['import', 'state', fixture('unsupported-composite.mmd'), '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.source, 'mermaid-state');
  assert.equal(receipt.diagnostics[0].code, 'import/state-unsupported-composite');
  assert.ok(receipt.diagnostics[0].message.includes('line 3'));
});

test('archify import state never leaves a partial artifact behind on failure', () => {
  const output = path.join(tmp, 'never-written.lifecycle.json');
  const result = run(['import', 'state', fixture('unsupported-fork.mmd'), output]);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(output), false);
});

test('archify import rejects an unknown import format', () => {
  const result = run(['import', 'sequence-diagram', fixture('valid-minimal.mmd')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported import format/);
});

test('archify import reports an unreadable source as a structured diagnostic', () => {
  const result = run(['import', 'state', path.join(tmp, 'missing.mmd'), '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'input/read');
});

// --- Documented example --------------------------------------------------

test('the documented runnable example imports, validates, and renders', () => {
  const source = path.join(skillRoot, 'examples', 'release-train.state.mmd');
  const output = path.join(tmp, 'release-train.lifecycle.json');
  const imported = run([
    'import', 'state', source, output,
    '--outcome', 'Live=success', '--outcome', 'Cancelled=failure', '--outcome', 'RolledBack=success',
  ]);
  assert.equal(imported.status, 0, imported.stderr);

  const ir = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(ir.meta.title, 'Release Train Lifecycle');
  assert.deepEqual(ir.lanes.map((lane) => lane.id), ['main', 'events', 'terminal']);
  assert.equal(ir.states.find((state) => state.id === 'Verifying').type, 'decision');
  assert.equal(ir.states.find((state) => state.id === 'Approval').label, 'Needs Approval');
  assert.equal(ir.states.find((state) => state.id === 'Paused').sublabel, 'health gate open');

  const validate = run(['validate', 'lifecycle', output, '--json']);
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const receipt = JSON.parse(validate.stdout);
  assert.equal(receipt.composition.summary.errors, 0);
  assert.equal(receipt.composition.summary.warnings, 0);
});

// --- Existing JSON authoring is untouched --------------------------------

test('JSON-authored lifecycle examples still validate unchanged', () => {
  for (const example of ['examples/agent-run.lifecycle.json', 'examples/deployment-release.lifecycle.json']) {
    const result = run(['validate', 'lifecycle', path.join(skillRoot, example), '--json']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }
});
