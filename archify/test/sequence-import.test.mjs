import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSequence, parseSequence } from '../importers/sequence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixturesDir = path.join(__dirname, 'fixtures', 'sequence-import');

function fixture(name) {
  return path.join(fixturesDir, `${name}.mmd`);
}

function readFixture(name) {
  return fs.readFileSync(fixture(name), 'utf8');
}

function parsed(name) {
  const result = parseSequence(readFixture(name));
  assert.ok(result.ok, `expected "${name}" to import, got ${JSON.stringify(result.diagnostics)}`);
  return result.ir;
}

function rejected(name) {
  const result = parseSequence(readFixture(name));
  assert.equal(result.ok, false, `expected "${name}" to be rejected`);
  return result.diagnostics;
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

// The supported seam: import the fixture, then push the emitted JSON through
// `archify validate sequence` exactly as a user would.
function importAndValidate(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-import-'));
  const out = path.join(tmp, `${name}.sequence.json`);
  try {
    const imported = runCli(['import', 'sequence', fixture(name), out, '--json']);
    assert.equal(imported.status, 0, `import failed: ${imported.stdout}${imported.stderr}`);
    const validated = runCli(['validate', 'sequence', out, '--json']);
    return {
      receipt: JSON.parse(imported.stdout),
      validation: JSON.parse(validated.stdout),
      status: validated.status,
      stderr: validated.stderr,
      ir: JSON.parse(fs.readFileSync(out, 'utf8')),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const VALIDATING_FIXTURES = [
  'valid-basic',
  'valid-checkout',
  'valid-arrow-variants',
  'valid-explicit-activation',
  'valid-implicit-participants',
  'valid-hyphenated-ids',
  'valid-frontmatter-title',
  'valid-autonumber-start-step',
  'adversarial-injection',
  'adversarial-id-collision',
  'adversarial-crlf-and-tabs',
  'adversarial-invalid-utf8',
];

// --- Supported subset ----------------------------------------------------

test('a supported sequenceDiagram imports into typed Sequence IR', () => {
  const ir = parsed('valid-basic');
  assert.equal(ir.schema_version, 1);
  assert.equal(ir.diagram_type, 'sequence');
  assert.equal(ir.meta.title, 'Imported Sequence');
  assert.deepEqual(ir.participants, [
    { id: 'browser', type: 'backend', label: 'Browser' },
    { id: 'api', type: 'backend', label: 'API' },
  ]);
  assert.deepEqual(ir.messages, [
    { from: 'browser', to: 'api', y: 180, label: 'GET /orders', variant: 'default' },
    { from: 'api', to: 'browser', y: 222, label: '200 OK', variant: 'return' },
  ]);
});

test('participant aliases keep the alias as the label and the name as the id source', () => {
  const ir = parsed('valid-checkout');
  assert.deepEqual(ir.participants.map((participant) => participant.id), ['shopper', 'web', 'api', 'queue']);
  assert.deepEqual(ir.participants.map((participant) => participant.label), ['Shopper', 'Storefront', 'Orders API', 'Job Queue']);
});

test('actor declarations map to external participants and participant declarations to backend', () => {
  const ir = parsed('valid-checkout');
  assert.equal(ir.participants.find((participant) => participant.id === 'shopper').type, 'external');
  assert.equal(ir.participants.find((participant) => participant.id === 'web').type, 'backend');
});

test('message order and direction survive the import in source order', () => {
  const ir = parsed('valid-checkout');
  assert.deepEqual(
    ir.messages.map((message) => `${message.from}->${message.to}`),
    ['shopper->web', 'web->api', 'api->queue', 'api->web', 'web->shopper'],
  );
  const ys = ir.messages.map((message) => message.y);
  assert.deepEqual(ys, [...ys].sort((left, right) => left - right));
  assert.equal(new Set(ys).size, ys.length, 'every message needs its own row on the timeline');
});

test('Mermaid arrow variants map onto the documented Sequence message kinds', () => {
  const ir = parsed('valid-arrow-variants');
  assert.deepEqual(
    ir.messages.map((message) => [message.label, message.variant]),
    [
      ['solid open', 'default'],
      ['solid arrow', 'default'],
      ['dotted open', 'return'],
      ['dotted arrow', 'return'],
      ['solid cross', 'dashed'],
      ['dotted cross', 'dashed'],
      ['solid async', 'dashed'],
      ['dotted async', 'dashed'],
    ],
  );
});

test('the importer never invents the emphasis or security kinds Mermaid does not encode', () => {
  for (const name of ['valid-basic', 'valid-checkout', 'valid-arrow-variants']) {
    for (const message of parsed(name).messages) {
      assert.ok(['default', 'return', 'dashed'].includes(message.variant), `unexpected variant ${message.variant}`);
    }
  }
});

test('the "+" and "-" activation suffixes produce a bounded activation span', () => {
  const ir = parsed('valid-checkout');
  assert.equal(ir.activations.length, 1);
  const [activation] = ir.activations;
  assert.equal(activation.participant, 'api');
  assert.equal(activation.type, 'backend');
  const activating = ir.messages.find((message) => message.label.endsWith('POST /orders'));
  const deactivating = ir.messages.find((message) => message.label.endsWith('202 accepted'));
  assert.ok(activation.from < activating.y, 'activation opens above the activating message');
  assert.ok(activation.to > deactivating.y, 'activation closes below the deactivating message');
});

test('activate and deactivate statements produce the same bounded activation span', () => {
  const ir = parsed('valid-explicit-activation');
  assert.equal(ir.activations.length, 1);
  assert.equal(ir.activations[0].participant, 'worker');
  assert.ok(ir.activations[0].to > ir.activations[0].from);
});

test('notes attach to the message they follow', () => {
  const ir = parsed('valid-checkout');
  const annotated = ir.messages.filter((message) => message.note);
  assert.equal(annotated.length, 1);
  assert.equal(annotated[0].note, 'idempotency key required');
  assert.ok(annotated[0].label.endsWith('POST /orders'));
});

test('autonumber prefixes every message label in source order', () => {
  assert.deepEqual(
    parsed('valid-checkout').messages.map((message) => message.label),
    ['1. open checkout', '2. POST /orders', '3. enqueue fulfilment', '4. 202 accepted', '5. show confirmation'],
  );
  assert.deepEqual(
    parsed('valid-autonumber-start-step').messages.map((message) => message.label),
    ['10. first', '15. second'],
  );
});

test('participants mentioned only in a message are created in first-mention order', () => {
  const ir = parsed('valid-implicit-participants');
  assert.deepEqual(ir.participants.map((participant) => participant.label), ['Alice', 'Bob']);
  assert.deepEqual(ir.participants.map((participant) => participant.type), ['backend', 'backend']);
});

test('a hyphenated participant name is not mistaken for a message arrow', () => {
  const ir = parsed('valid-hyphenated-ids');
  assert.deepEqual(ir.participants.map((participant) => participant.id), ['web-x-app', 'edge-api']);
  assert.deepEqual(
    ir.messages.map((message) => [message.from, message.to]),
    [['web-x-app', 'edge-api'], ['edge-api', 'web-x-app']],
  );
});

test('front matter supplies meta.title when the source names one', () => {
  assert.equal(parsed('valid-frontmatter-title').meta.title, 'Session Refresh Trace');
});

test('every emitted id matches the shared Archify id pattern', () => {
  const idPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  for (const name of VALIDATING_FIXTURES) {
    for (const participant of parsed(name).participants) {
      assert.match(participant.id, idPattern, `${name}: id "${participant.id}"`);
    }
  }
});

// --- Delivered as a real artifact ---------------------------------------

for (const name of VALIDATING_FIXTURES) {
  test(`imported "${name}" passes archify validate sequence`, () => {
    const { validation, status, stderr, receipt } = importAndValidate(name);
    assert.equal(status, 0, `validate failed: ${JSON.stringify(validation)}${stderr}`);
    assert.equal(validation.ok, true);
    assert.equal(validation.type, 'sequence');
    assert.equal(receipt.ok, true);
    assert.equal(receipt.command, 'import');
    assert.equal(receipt.source, 'mermaid-sequence');
  });
}

test('the import receipt counts what was actually emitted', () => {
  const { receipt, ir } = importAndValidate('valid-checkout');
  assert.equal(receipt.participants, ir.participants.length);
  assert.equal(receipt.messages, ir.messages.length);
  assert.equal(receipt.activations, ir.activations.length);
  assert.equal(receipt.notes, 1);
  assert.equal(receipt.schemaVersion, 1);
});

// --- Unsupported control structures -------------------------------------

const UNSUPPORTED_CASES = [
  ['unsupported-loop', 'import/unsupported-keyword-loop', 4],
  ['unsupported-alt', 'import/unsupported-keyword-alt', 4],
  ['unsupported-opt', 'import/unsupported-keyword-opt', 4],
  ['unsupported-par', 'import/unsupported-keyword-par', 4],
  ['unsupported-critical', 'import/unsupported-keyword-critical', 4],
  ['unsupported-break', 'import/unsupported-keyword-break', 4],
  ['unsupported-rect', 'import/unsupported-keyword-rect', 4],
  ['unsupported-box', 'import/unsupported-keyword-box', 2],
  ['unsupported-create-destroy', 'import/unsupported-keyword-create', 3],
  ['unsupported-links', 'import/unsupported-keyword-link', 4],
  ['unsupported-acc-title', 'import/unsupported-keyword-acctitle', 2],
  ['unsupported-init-directive', 'import/unsupported-directive', 1],
  ['unsupported-self-message', 'import/sequence-self-message', 4],
  ['unsupported-bidirectional-arrow', 'import/sequence-unsupported-arrow', 4],
];

for (const [name, code, line] of UNSUPPORTED_CASES) {
  test(`"${name}" fails with ${code} instead of dropping the construct`, () => {
    const [diagnostic] = rejected(name);
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.subject.line, line);
    assert.equal(diagnostic.evidence.source.line, line);
  });
}

test('a rejected control structure never leaks its messages into a partial import', () => {
  const result = parseSequence(readFixture('unsupported-loop'));
  assert.equal(result.ok, false);
  assert.equal(result.ir, undefined, 'a rejected source must not produce IR');
});

// --- Malformed sources ---------------------------------------------------

const MALFORMED_CASES = [
  ['malformed-no-declaration', 'import/sequence-missing-declaration', 1],
  ['malformed-missing-colon', 'import/sequence-missing-message-separator', 4],
  ['malformed-empty-message-label', 'import/sequence-empty-message-label', 4],
  ['malformed-unknown-statement', 'import/sequence-unknown-statement', 4],
  ['malformed-unknown-activate', 'import/sequence-unknown-participant', 5],
  ['malformed-note-unknown-participant', 'import/sequence-unknown-participant', 5],
  ['malformed-unbalanced-deactivate', 'import/sequence-unbalanced-deactivate', 5],
  ['malformed-dangling-activate', 'import/sequence-dangling-activate', 5],
  ['malformed-unexpected-end', 'import/sequence-unexpected-end', 5],
  ['malformed-duplicate-participant', 'import/sequence-duplicate-participant', 3],
  ['malformed-note-before-message', 'import/sequence-unattached-note', 4],
  ['malformed-invalid-autonumber', 'import/sequence-invalid-autonumber', 2],
  ['malformed-no-messages', 'import/sequence-no-messages', 4],
  ['malformed-participant-label-too-long', 'import/sequence-participant-label-too-long', 2],
];

for (const [name, code, line] of MALFORMED_CASES) {
  test(`"${name}" fails with ${code} and a source location`, () => {
    const [diagnostic] = rejected(name);
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.subject.line, line);
  });
}

test('every importer diagnostic carries the agent-facing contract fields', () => {
  for (const [name] of [...MALFORMED_CASES, ...UNSUPPORTED_CASES]) {
    for (const diagnostic of rejected(name)) {
      assert.match(diagnostic.code, /^import\//, `${name}: unstable code ${diagnostic.code}`);
      assert.equal(diagnostic.severity, 'error', `${name}: severity`);
      assert.ok(diagnostic.message.length > 0, `${name}: message`);
      assert.equal(typeof diagnostic.subject.line, 'number', `${name}: subject.line`);
      assert.equal(typeof diagnostic.subject.column, 'number', `${name}: subject.column`);
      assert.equal(typeof diagnostic.evidence.source.line, 'number', `${name}: evidence.source.line`);
      assert.ok(diagnostic.supportedFixes.length > 0, `${name}: supportedFixes`);
      for (const fix of diagnostic.supportedFixes) {
        assert.equal(typeof fix, 'string');
        assert.ok(fix.trim().length > 0);
      }
    }
  }
});

test('a source that is not Mermaid at all fails with a diagnostic rather than a crash', () => {
  for (const junk of ['', '   ', '{"schema_version": 1}', '\u0000\u0001', 'sequenceDiagram']) {
    const result = parseSequence(junk);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(junk)}`);
    assert.match(result.diagnostics[0].code, /^import\//);
  }
});

test('undefined and non-string input are rejected instead of throwing', () => {
  for (const junk of [undefined, null, 42]) {
    const result = parseSequence(junk);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'import/sequence-missing-declaration');
  }
});

// --- Adversarial input ---------------------------------------------------

test('markup in Mermaid labels stays literal text and never becomes structure', () => {
  const ir = parsed('adversarial-injection');
  assert.equal(ir.diagram_type, 'sequence');
  assert.equal(ir.participants.length, 2);
  assert.equal(ir.messages.length, 2);
  assert.equal(ir.messages[0].label, "</text><script>fetch('//evil.invalid')</script>");
  assert.ok(ir.messages[0].note.includes('"diagram_type": "architecture"'));
  assert.equal(ir.participants[0].label, '<b>A</b>');
  // The quoted-JSON payload must not have created a component collection.
  assert.deepEqual(
    Object.keys(ir).sort(),
    ['diagram_type', 'messages', 'meta', 'participants', 'schema_version'],
  );
});

test('an adversarial label is escaped in the delivered artifact', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-import-adversarial-'));
  const json = path.join(tmp, 'adversarial.sequence.json');
  const html = path.join(tmp, 'adversarial.html');
  try {
    assert.equal(runCli(['import', 'sequence', fixture('adversarial-injection'), json]).status, 0);
    const render = spawnSync(process.execPath, [
      path.join(skillRoot, 'renderers', 'sequence', 'render-sequence.mjs'),
      json,
      html,
    ], { encoding: 'utf8', stdio: 'pipe' });
    assert.equal(render.status, 0, render.stderr);
    const artifact = fs.readFileSync(html, 'utf8');
    assert.equal(artifact.includes("<script>fetch('//evil.invalid')</script>"), false, 'raw script tag must not reach the artifact');
    assert.ok(artifact.includes('&lt;script&gt;fetch('), 'the payload survives as escaped text');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('names that are not valid Archify ids are re-derived without collapsing participants', () => {
  const ir = parsed('adversarial-id-collision');
  const ids = ir.participants.map((participant) => participant.id);
  assert.equal(new Set(ids).size, ids.length, 'distinct Mermaid names must stay distinct participants');
  assert.deepEqual(ir.participants.map((participant) => participant.label), ['First', 'Second', 'Third', 'Fourth', 'Fifth']);
  assert.deepEqual(ids, ['A-B', 'A-B-2', 'A_B', 'p4', 'p5']);
});

test('control characters in a label are rejected rather than smuggled into the artifact', () => {
  const [diagnostic] = rejected('adversarial-control-character');
  assert.equal(diagnostic.code, 'import/sequence-unsafe-label');
  assert.equal(diagnostic.evidence.reason, 'control character');
  assert.doesNotMatch(diagnostic.message, /[\u0000-\u001F\u007F]/, 'the diagnostic must not echo the control character');
});

test('an unpaired surrogate in a label is rejected', () => {
  const result = parseSequence('sequenceDiagram\n  participant a as A\uD800\n  participant b as B\n  a->>b: call\n');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'import/sequence-unsafe-label');
  assert.equal(result.diagnostics[0].evidence.reason, 'unpaired surrogate');
});

test('invalid UTF-8 bytes decode to replacement characters and still deliver a valid artifact', () => {
  const { validation, status } = importAndValidate('adversarial-invalid-utf8');
  assert.equal(status, 0);
  assert.equal(validation.ok, true);
});

test('CRLF line endings and tab indentation import identically to LF and spaces', () => {
  const ir = parsed('adversarial-crlf-and-tabs');
  assert.deepEqual(ir.participants.map((participant) => participant.label), ['A', 'B']);
  assert.equal(ir.messages[0].label, 'tab separated label');
});

// --- CLI surface ---------------------------------------------------------

test('archify import sequence writes typed IR to the requested output file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-import-cli-'));
  const out = path.join(tmp, 'out.sequence.json');
  try {
    const result = runCli(['import', 'sequence', fixture('valid-basic'), out, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(
      { schemaVersion: receipt.schemaVersion, command: receipt.command, source: receipt.source, ok: receipt.ok },
      { schemaVersion: 1, command: 'import', source: 'mermaid-sequence', ok: true },
    );
    assert.equal(receipt.output, out);
    assert.equal(receipt.input, fixture('valid-basic'));
    const ir = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(ir.diagram_type, 'sequence');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('archify import sequence prints typed IR on stdout when no output file is given', () => {
  const result = runCli(['import', 'sequence', fixture('valid-basic')]);
  assert.equal(result.status, 0, result.stderr);
  const ir = JSON.parse(result.stdout);
  assert.equal(ir.diagram_type, 'sequence');
  assert.equal(ir.participants.length, 2);
});

test('archify import exits non-zero with a machine-readable receipt for an unsupported construct', () => {
  const result = runCli(['import', 'sequence', fixture('unsupported-loop'), '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.command, 'import');
  assert.equal(receipt.source, 'mermaid-sequence');
  assert.equal(receipt.diagnostics[0].code, 'import/unsupported-keyword-loop');
  assert.equal(receipt.diagnostics[0].subject.line, 4);
});

test('archify import reports malformed input as a diagnostic, never as a stack trace', () => {
  const result = runCli(['import', 'sequence', fixture('malformed-missing-colon')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[import\/sequence-missing-message-separator\]/);
  assert.doesNotMatch(result.stderr, /^\s+at .+:\d+:\d+\)?$/m, 'no stack frames in agent-facing output');
});

test('archify import reports an unreadable input file with an input/read diagnostic', () => {
  const result = runCli(['import', 'sequence', path.join(fixturesDir, 'does-not-exist.mmd'), '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'input/read');
});

test('archify import rejects an unknown format and an unknown option', () => {
  const unknownFormat = runCli(['import', 'gantt', fixture('valid-basic')]);
  assert.equal(unknownFormat.status, 2);
  assert.match(unknownFormat.stderr, /Unsupported import format "gantt"/);

  const unknownOption = runCli(['import', 'sequence', fixture('valid-basic'), '--quality=showcase']);
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /Unknown import option/);
});

test('archify usage advertises the import command and its formats', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /archify import <format> <input\.mmd> \[output\.json\] \[--json\]/);
  assert.match(result.stdout, /sequence \(Mermaid sequenceDiagram\)/);
});

// --- Existing behavior unchanged -----------------------------------------

test('JSON-authored sequence documents keep validating exactly as before', () => {
  for (const example of ['cache-miss-request.sequence.json', 'async-job-roundtrip.sequence.json']) {
    const result = runCli(['validate', 'sequence', path.join(skillRoot, 'examples', example), '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }
});

test('importSequence exposes the same IR as parseSequence plus a receipt', () => {
  const source = readFixture('valid-basic');
  const imported = importSequence(source);
  assert.ok(imported.ok);
  assert.deepEqual(imported.ir, parseSequence(source).ir);
  assert.deepEqual(imported.receipt, {
    schemaVersion: 1,
    command: 'import',
    source: 'mermaid-sequence',
    ok: true,
    participants: 2,
    messages: 2,
    activations: 0,
    notes: 0,
  });
});

// --- Narrow grammar cases ------------------------------------------------

test('several notes on one message are joined instead of overwriting each other', () => {
  const result = parseSequence([
    'sequenceDiagram',
    '  participant a as A',
    '  participant b as B',
    '  a->>b: call',
    '  Note over a,b: first',
    '  Note right of b: second',
  ].join('\n'));
  assert.ok(result.ok);
  assert.equal(result.ir.messages[0].note, 'first / second');
});

test('autonumber off stops the numbering from that line onward', () => {
  const result = parseSequence([
    'sequenceDiagram',
    '  participant a as A',
    '  participant b as B',
    '  autonumber',
    '  a->>b: numbered',
    '  autonumber off',
    '  b-->>a: plain',
  ].join('\n'));
  assert.ok(result.ok);
  assert.deepEqual(result.ir.messages.map((message) => message.label), ['1. numbered', 'plain']);
});

test('a title statement sets meta.title', () => {
  for (const line of ['title: Payment Capture', 'title Payment Capture']) {
    const result = parseSequence(['sequenceDiagram', `  ${line}`, '  a->>b: call'].join('\n'));
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.equal(result.ir.meta.title, 'Payment Capture');
  }
});

test('an activate/deactivate pair with no message between them is rejected, not flattened', () => {
  const result = parseSequence([
    'sequenceDiagram',
    '  participant a as A',
    '  participant b as B',
    '  a->>b: call',
    '  activate b',
    '  deactivate b',
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'import/sequence-empty-activation');
  assert.equal(result.diagnostics[0].subject.line, 6);
});

test('an activation left open at the end of the source runs to the end of the timeline', () => {
  const result = parseSequence([
    'sequenceDiagram',
    '  participant a as A',
    '  participant b as B',
    '  a->>+b: call',
    '  b->>a: still working',
  ].join('\n'));
  assert.ok(result.ok);
  const [activation] = result.ir.activations;
  const lastY = result.ir.messages.at(-1).y;
  assert.ok(activation.to > lastY, 'the bar must outlast the last message');
});

test('a long participant label widens the columns instead of being truncated or rejected', () => {
  const source = [
    'sequenceDiagram',
    '  participant a as Payment Reconciliation',
    '  participant b as Settlement Ledger',
    '  participant c as Notification Fanout',
    '  participant d as Merchant Onboarding',
    '  a->>b: settle',
    '  b->>c: announce',
    '  c->>d: notify',
  ].join('\n');
  const result = parseSequence(source);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.ir.participants.map((participant) => participant.label),
    ['Payment Reconciliation', 'Settlement Ledger', 'Notification Fanout', 'Merchant Onboarding'],
  );
  assert.equal(result.ir.meta.column_fit, 'spread');
  assert.ok(result.ir.meta.viewBox[0] > 480, `expected a widened viewBox, got ${result.ir.meta.viewBox[0]}`);

  // The widened layout has to survive the renderer's own participant-box gate.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-import-wide-'));
  const json = path.join(tmp, 'wide.sequence.json');
  try {
    fs.writeFileSync(json, JSON.stringify(result.ir));
    const validated = runCli(['validate', 'sequence', json, '--json']);
    assert.equal(validated.status, 0, validated.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unclosed front matter is rejected with its own diagnostic', () => {
  const result = parseSequence('---\ntitle: Trace\n');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'import/sequence-unclosed-frontmatter');
});

test('a front matter key other than title is rejected rather than ignored', () => {
  const result = parseSequence('---\nconfig:\n  theme: forest\n---\nsequenceDiagram\n  a->>b: call\n');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'import/sequence-unsupported-frontmatter');
  assert.equal(result.diagnostics[0].subject.line, 2);
});

test('empty participant names, empty aliases, and headless messages each get their own code', () => {
  const cases = [
    ['sequenceDiagram\n  participant ""\n  a->>b: call\n', 'import/sequence-empty-participant-name'],
    ['sequenceDiagram\n  participant a as ""\n  a->>b: call\n', 'import/sequence-empty-participant-label'],
    ['sequenceDiagram\n  participant a as A\n  participant b as B\n  ->>b: call\n', 'import/sequence-missing-message-endpoint'],
    ['sequenceDiagram\n  participant a as A\n  participant b as B\n  a->>b: \n  Note over a: \n', 'import/sequence-empty-message-label'],
  ];
  for (const [source, code] of cases) {
    const result = parseSequence(source);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(source)}`);
    assert.equal(result.diagnostics[0].code, code);
  }
});

test('a note with no text is rejected instead of producing an empty annotation', () => {
  const result = parseSequence('sequenceDiagram\n  participant a as A\n  participant b as B\n  a->>b: call\n  Note over a:\n');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'import/sequence-empty-note');
});
