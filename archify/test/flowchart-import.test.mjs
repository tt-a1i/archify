import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseFlowchart, importFlowchart } from '../importers/flowchart.mjs';
import { commitImportOutput, importOutputAliasesInput } from '../renderers/shared/output-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(__dirname, 'fixtures', 'flowchart');

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

// --- Valid imports -------------------------------------------------------

test('valid simple flowchart imports into typed architecture IR', () => {
  const result = parseFlowchart(readFixture('valid-simple.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.schema_version, 1);
  assert.equal(result.ir.diagram_type, 'architecture');
  assert.equal(result.ir.components.length, 4);
  assert.equal(result.ir.connections.length, 3);
  const labels = result.ir.components.map((c) => c.label);
  assert.ok(labels.includes('API Server'));
  assert.ok(labels.includes('PostgreSQL'));
  assert.ok(labels.includes('Redis Cache'));
  assert.ok(labels.includes('Analytics Worker'));
});

test('valid subgraph flowchart maps subgraphs to boundaries', () => {
  const result = parseFlowchart(readFixture('valid-subgraph.mmd'));
  assert.ok(result.ok);
  assert.equal(result.ir.components.length, 4);
  assert.equal(result.ir.connections.length, 3);
  assert.ok(result.ir.boundaries, 'Expected boundaries from subgraphs');
  assert.equal(result.ir.boundaries.length, 2);
  const boundaryLabels = result.ir.boundaries.map((b) => b.label);
  assert.ok(boundaryLabels.includes('Frontend'));
  assert.ok(boundaryLabels.includes('Backend'));
  const frontend = result.ir.boundaries.find((b) => b.label === 'Frontend');
  assert.ok(frontend.wraps.includes('A'));
  assert.ok(frontend.wraps.includes('B'));
  const backend = result.ir.boundaries.find((b) => b.label === 'Backend');
  assert.ok(backend.wraps.includes('C'));
  assert.ok(backend.wraps.includes('D'));
});

test('nested subgraphs record membership in every enclosing region', () => {
  const result = parseFlowchart(readFixture('valid-nested-subgraphs.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.boundaries.length, 2);
  const outer = result.ir.boundaries.find((b) => b.label === 'Outer');
  const inner = result.ir.boundaries.find((b) => b.label === 'Inner');
  assert.ok(outer, 'Expected an Outer boundary');
  assert.ok(inner, 'Expected an Inner boundary');
  assert.ok(outer.wraps.includes('A'), 'Outer must record A so its wraps list is not empty');
  assert.ok(inner.wraps.includes('A'), 'Inner must record A');
});

test('valid labeled edges preserve labels in connections', () => {
  const result = parseFlowchart(readFixture('valid-labeled-edges.mmd'));
  assert.ok(result.ok);
  assert.equal(result.ir.connections.length, 4);
  const labeledConn = result.ir.connections.find((c) => c.label === 'HTTPS request');
  assert.ok(labeledConn, 'Expected a connection labeled "HTTPS request"');
  const sqlConn = result.ir.connections.find((c) => c.label === 'SQL query');
  assert.ok(sqlConn, 'Expected a connection labeled "SQL query"');
  const cacheConn = result.ir.connections.find((c) => c.label === 'cache miss');
  assert.ok(cacheConn, 'Expected a connection labeled "cache miss"');
  assert.equal(cacheConn.variant, 'dashed');
});

test('valid chained edges create multiple connections from one line', () => {
  const result = parseFlowchart(readFixture('valid-chained.mmd'));
  assert.ok(result.ok);
  assert.equal(result.ir.components.length, 4);
  assert.equal(result.ir.connections.length, 3);
  assert.equal(result.ir.connections[0].from, 'A');
  assert.equal(result.ir.connections[0].to, 'B');
  assert.equal(result.ir.connections[1].from, 'B');
  assert.equal(result.ir.connections[1].to, 'C');
  assert.equal(result.ir.connections[2].from, 'C');
  assert.equal(result.ir.connections[2].to, 'D');
});

test('a later explicit node declaration updates the earlier implicit one', () => {
  const result = parseFlowchart(readFixture('valid-redeclared-labels.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.components.length, 2);
  const a = result.ir.components.find((c) => c.id === 'A');
  const b = result.ir.components.find((c) => c.id === 'B');
  assert.equal(a.label, 'Named source');
  assert.equal(b.label, 'Named target');
});

test('a later explicit declaration inside the same statement still wins', () => {
  const result = parseFlowchart(readFixture('valid-same-statement-redeclare.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  const b = result.ir.components.find((c) => c.id === 'B');
  assert.equal(b.label, 'Named bee', 'The later explicit declaration must not be dropped within one statement');
});

test('an implicit self-reference refined later in the same statement keeps the label', () => {
  const result = parseFlowchart('flowchart LR\n  A --> A[Label]');
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  const a = result.ir.components.find((c) => c.id === 'A');
  assert.equal(a.label, 'Label', 'A --> A[Label] must import the explicit label, not the bare id');
});

test('conflicting explicit declarations within one statement exit non-zero', () => {
  const result = parseFlowchart(readFixture('malformed-conflicting-same-statement.mmd'));
  assert.ok(!result.ok, 'Expected A[One] --> A[Two] to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-conflicting-node-declaration'));
});

test('RL direction places sources to the right of their targets', () => {
  const result = parseFlowchart(readFixture('valid-direction-rl.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  const a = result.ir.components.find((c) => c.id === 'A');
  const b = result.ir.components.find((c) => c.id === 'B');
  assert.ok(a.pos[0] > b.pos[0], `RL: source x=${a.pos[0]} must exceed target x=${b.pos[0]}`);
});

test('BT direction places sources below their targets', () => {
  const result = parseFlowchart(readFixture('valid-direction-bt.mmd'));
  assert.ok(result.ok, `Expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`);
  const a = result.ir.components.find((c) => c.id === 'A');
  const b = result.ir.components.find((c) => c.id === 'B');
  assert.ok(a.pos[1] > b.pos[1], `BT: source y=${a.pos[1]} must exceed target y=${b.pos[1]}`);
  const labeled = result.ir.connections.find((c) => c.label === 'retry');
  assert.ok(labeled, 'Expected the labeled B→C connection');
  assert.ok(labeled.labelDy < 0, 'BT labels shift upward toward the route midpoint');
});

test('LR and TD layouts keep their original orientation', () => {
  const lr = parseFlowchart('flowchart LR\n  A[Source] --> B[Target]');
  assert.ok(lr.ok);
  const aLr = lr.ir.components.find((c) => c.id === 'A');
  const bLr = lr.ir.components.find((c) => c.id === 'B');
  assert.ok(aLr.pos[0] < bLr.pos[0], 'LR: source must sit left of target');
  const td = parseFlowchart('flowchart TD\n  A[Source] --> B[Target]');
  assert.ok(td.ok);
  const aTd = td.ir.components.find((c) => c.id === 'A');
  const bTd = td.ir.components.find((c) => c.id === 'B');
  assert.ok(aTd.pos[1] < bTd.pos[1], 'TD: source must sit above target');
});

test('all component types are valid Archify componentType values', () => {
  const result = parseFlowchart(readFixture('valid-subgraph.mmd'));
  assert.ok(result.ok);
  const validTypes = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
  for (const comp of result.ir.components) {
    assert.ok(validTypes.includes(comp.type), `Component ${comp.id} has invalid type "${comp.type}"`);
  }
});

test('all component ids match the Archify id pattern', () => {
  const result = parseFlowchart(readFixture('valid-simple.mmd'));
  assert.ok(result.ok);
  const idPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  for (const comp of result.ir.components) {
    assert.match(comp.id, idPattern, `Component id "${comp.id}" does not match pattern`);
  }
});

// --- Malformed sources ---------------------------------------------------

test('unclosed subgraph exits non-zero with a stable diagnostic', () => {
  const result = parseFlowchart(readFixture('malformed-unclosed-subgraph.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-unclosed-subgraph'));
});

test('unclosed node shape exits non-zero with a stable diagnostic', () => {
  const result = parseFlowchart(readFixture('malformed-unclosed-shape.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-unclosed-node-shape'));
});

test('missing diagram declaration exits non-zero with a stable diagnostic', () => {
  const result = parseFlowchart(readFixture('malformed-no-declaration.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-missing-declaration'));
});

test('unbalanced end exits non-zero with a stable diagnostic', () => {
  const result = parseFlowchart(readFixture('malformed-unbalanced-end.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-unbalanced-end'));
});

test('conflicting explicit redeclarations exit non-zero instead of silently picking one', () => {
  const result = parseFlowchart(readFixture('malformed-conflicting-redeclaration.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/flowchart-conflicting-node-declaration'));
});

// --- Unsupported sources --------------------------------------------------

test('classDef directive exits non-zero with a stable named diagnostic', () => {
  const result = parseFlowchart(readFixture('unsupported-classDef.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/unsupported-keyword-classdef'));
});

test('style directive exits non-zero with a stable named diagnostic', () => {
  const result = parseFlowchart(readFixture('unsupported-style.mmd'));
  assert.ok(!result.ok);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/unsupported-keyword-style'));
});

test('open link "---" exits non-zero instead of becoming a dashed edge', () => {
  const result = parseFlowchart(readFixture('unsupported-open-link.mmd'));
  assert.ok(!result.ok, 'Expected the open link "---" to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/unsupported-edge-syntax'));
});

test('dotted open link "-." exits non-zero with the unsupported-edge diagnostic', () => {
  const result = parseFlowchart(readFixture('unsupported-dotted-open-link.mmd'));
  assert.ok(!result.ok, 'Expected the dotted open link "-." to be rejected');
  const diag = result.diagnostics.find((d) => d.code === 'import/unsupported-edge-syntax');
  assert.ok(diag, `Expected import/unsupported-edge-syntax, got: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(!result.diagnostics.some((d) => d.code === 'import/flowchart-invalid-node-id'),
    'The rejection must not surface as an invalid-node-id parse error');
  assert.ok(diag.message.includes('"-.-"'), 'The diagnostic should name the offending open-link form');
});

test('subgraph "direction" directive exits non-zero instead of inventing components', () => {
  const result = parseFlowchart(readFixture('unsupported-subgraph-direction.mmd'));
  assert.ok(!result.ok, 'Expected the subgraph direction directive to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/unsupported-direction-directive'));
});

test('CLI import command exits non-zero for the open link with a stable diagnostic', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const fixture = path.join(fixturesDir, 'unsupported-open-link.mmd');
  const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', fixture, '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0, 'Expected non-zero exit for the open link "---"');
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((d) => d.code === 'import/unsupported-edge-syntax'));
});

test('every imported valid fixture passes showcase layout validation', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const fixtures = fs.readdirSync(fixturesDir).filter((f) => f.startsWith('valid-') && f.endsWith('.mmd'));
  assert.ok(fixtures.length >= 8, `Expected the full valid fixture set, found: ${fixtures.join(', ')}`);
  for (const name of fixtures) {
    const fixture = path.join(fixturesDir, name);
    const tmpOut = path.join(os.tmpdir(), `archify-import-${name.replace(/\.mmd$/, '')}-${Date.now()}.json`);
    const imported = spawnSync(process.execPath, [cli, 'import', 'flowchart', fixture, tmpOut, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(imported.status, 0, `${name}: import failed: ${imported.stderr}`);
    const validated = spawnSync(process.execPath, [cli, 'validate', 'architecture', tmpOut, '--quality', 'showcase', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(validated.status, 0, `${name}: showcase validation failed: ${validated.stdout}`);
    fs.unlinkSync(tmpOut);
  }
});

// --- Adversarial sources -------------------------------------------------

test('adversarial HTML injection in node labels is preserved as text, not interpreted', () => {
  const result = parseFlowchart(readFixture('adversarial-injection.mmd'));
  assert.ok(result.ok);
  const labels = result.ir.components.map((c) => c.label);
  // The label should contain the raw text including the script tag, not interpret it.
  assert.ok(labels.some((l) => l.includes('<script>')), 'Label should preserve raw text');
  assert.ok(labels.some((l) => l.includes('malicious')), 'Label should preserve raw text');
});

// --- CLI integration -----------------------------------------------------

test('CLI import command produces valid JSON IR from a flowchart file', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const fixture = path.join(fixturesDir, 'valid-simple.mmd');
  const tmpOut = path.join(os.tmpdir(), `archify-import-${Date.now()}.json`);
  const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', fixture, tmpOut, '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'import');
  assert.equal(receipt.source, 'mermaid-flowchart');
  assert.equal(receipt.components, 4);
  assert.equal(receipt.connections, 3);
  // Verify the IR file was written and is valid.
  const ir = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
  assert.equal(ir.schema_version, 1);
  assert.equal(ir.diagram_type, 'architecture');
  assert.equal(ir.components.length, 4);
  fs.unlinkSync(tmpOut);
});

test('CLI import command exits non-zero for malformed input', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const fixture = path.join(fixturesDir, 'malformed-unclosed-subgraph.mmd');
  const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', fixture, '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0, 'Expected non-zero exit for malformed input');
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.length > 0);
  assert.ok(receipt.diagnostics[0].code.startsWith('import/'));
});

test('CLI import command exits non-zero for unsupported syntax', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const fixture = path.join(fixturesDir, 'unsupported-classDef.mmd');
  const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', fixture, '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.notEqual(result.status, 0, 'Expected non-zero exit for unsupported syntax');
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((d) => d.code.startsWith('import/unsupported')));
});

// --- Declaration-line remainder / subgraph endpoints / empty subgraphs ----

test('declaration-line remainder is rejected instead of silently dropping topology', () => {
  const result = parseFlowchart('flowchart LR; A[Lost] --> B[Lost]\nC[Kept]\n');
  assert.ok(!result.ok, 'Expected the statement after "flowchart LR;" to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/declaration-remainder'));
});

test('trailing semicolon on the declaration line is still accepted', () => {
  const result = parseFlowchart('flowchart TD;\nA[Alpha] --> B[Beta]\n');
  assert.ok(result.ok, `Expected a bare trailing semicolon to be accepted, got: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.components.length, 2);
  assert.equal(result.ir.connections.length, 1);
});

test('edge endpoint that names a subgraph is rejected instead of inventing a component', () => {
  const result = parseFlowchart('flowchart LR\nsubgraph Group\n  A[Inside]\nend\nB[Outside] --> Group\n');
  assert.ok(!result.ok, 'Expected an edge into a subgraph to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/edge-references-subgraph'));
});

test('edge source that names a subgraph is rejected too', () => {
  const result = parseFlowchart('flowchart LR\nsubgraph Group\n  A[Inside]\nend\nGroup --> B[Outside]\n');
  assert.ok(!result.ok, 'Expected an edge out of a subgraph to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/edge-references-subgraph'));
});

test('empty subgraph is rejected before emitting IR that violates the schema', () => {
  const result = parseFlowchart('flowchart LR\nsubgraph Empty\nend\nA[One] --> B[Two]\n');
  assert.ok(!result.ok, 'Expected the empty subgraph to be rejected');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/empty-subgraph'));
});

test('long labels widen the cell so the import passes the advertised validation handoff', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-long-label-'));
  const src = path.join(tmpDir, 'long.mmd');
  const out = path.join(tmpDir, 'long.json');
  fs.writeFileSync(src, 'flowchart LR\nA[Customer subscription management service] --> B[Backend]\n');
  try {
    const imported = spawnSync(process.execPath, [cli, 'import', 'flowchart', src, out, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(imported.status, 0, `import failed: ${imported.stderr}`);
    const ir = JSON.parse(fs.readFileSync(out, 'utf8'));
    const long = ir.components.find((c) => c.id === 'A');
    const est = Array.from(long.label).length * 6.6;
    assert.ok(long.size[0] + 8 >= est, `Expected component width ${long.size[0]} to fit the ~${Math.round(est)}px label`);
    const validated = spawnSync(process.execPath, [cli, 'validate', 'architecture', out, '--quality', 'showcase', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(validated.status, 0, `showcase validation failed: ${validated.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Output-path safety ---------------------------------------------------

test('CLI import rejects an output path that aliases the input and preserves the source', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-alias-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  try {
    const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', src, src, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit for an aliased output path');
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.ok, false);
    assert.ok(receipt.diagnostics.some((d) => d.code === 'input/output-alias'));
    assert.equal(
      fs.readFileSync(src, 'utf8'),
      'flowchart LR\n  A[Alpha] --> B[Beta]\n',
      'The Mermaid source must be preserved when the output aliases the input',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI import rejects a hard-linked output alias by inode identity', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-hardlink-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const linked = path.join(tmpDir, 'out.json');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  fs.linkSync(src, linked);
  try {
    const result = spawnSync(process.execPath, [cli, 'import', 'flowchart', src, linked, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit for a hard-linked output alias');
    const receipt = JSON.parse(result.stdout.trim());
    assert.ok(receipt.diagnostics.some((d) => d.code === 'input/output-alias'));
    assert.equal(
      fs.readFileSync(src, 'utf8'),
      'flowchart LR\n  A[Alpha] --> B[Beta]\n',
      'The Mermaid source must survive a hard-linked output alias',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI import returns a stable receipt when the output path is a directory', () => {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-eisdir-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  try {
    const jsonResult = spawnSync(process.execPath, [cli, 'import', 'flowchart', src, outDir, '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.notEqual(jsonResult.status, 0);
    const receipt = JSON.parse(jsonResult.stdout.trim());
    assert.equal(receipt.ok, false);
    assert.ok(receipt.diagnostics.some((d) => d.code === 'output/write'));
    const textResult = spawnSync(process.execPath, [cli, 'import', 'flowchart', src, outDir], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.notEqual(textResult.status, 0);
    assert.ok(!textResult.stderr.includes('    at '), 'Expected a formatted diagnostic, not a raw stack trace');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Output-commit race safety (source-preservation holds at commit time) -

function runCliImport(args) {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function runCliValidate(file) {
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  return spawnSync(process.execPath, [cli, 'validate', 'architecture', file, '--quality', 'showcase', '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('commitImportOutput refuses an output that resolves to the input at commit time', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-commit-alias-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const out = path.join(tmpDir, 'out.json');
  const source = 'flowchart LR\n  A[Alpha] --> B[Beta]\n';
  fs.writeFileSync(src, source);
  fs.symlinkSync(src, out);
  try {
    const commit = commitImportOutput(src, out, '{"ir":true}\n');
    assert.deepEqual(commit, { ok: false, reason: 'input/output-alias' });
    assert.equal(fs.readFileSync(src, 'utf8'), source, 'The Mermaid source must survive a swapped output symlink');
    assert.equal(fs.lstatSync(out).isSymbolicLink(), true, 'The refused commit must not touch the symlink');
    const leftovers = fs.readdirSync(tmpDir).filter((name) => name.startsWith('.archify-import-'));
    assert.equal(leftovers.length, 0, 'A refused commit must leave no candidate files behind');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('commitImportOutput replaces an output symlink without following it', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-commit-symlink-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const target = path.join(tmpDir, 'precious.txt');
  const out = path.join(tmpDir, 'out.json');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  fs.writeFileSync(target, 'user data that must survive');
  fs.symlinkSync(target, out);
  try {
    const commit = commitImportOutput(src, out, '{"ir":true}\n');
    assert.deepEqual(commit, { ok: true });
    assert.equal(fs.lstatSync(out).isSymbolicLink(), false, 'rename(2) must replace the symlink, not write through it');
    assert.equal(fs.readFileSync(out, 'utf8'), '{"ir":true}\n');
    assert.equal(
      fs.readFileSync(target, 'utf8'),
      'user data that must survive',
      'The symlink target must keep its original content',
    );
    const leftovers = fs.readdirSync(tmpDir).filter((name) => name.startsWith('.archify-import-'));
    assert.equal(leftovers.length, 0, 'A committed output must leave no candidate files behind');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('commitImportOutput removes the candidate and throws when the output cannot be renamed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-commit-eisdir-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const outDir = path.join(tmpDir, 'out');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  fs.mkdirSync(outDir);
  try {
    assert.throws(() => commitImportOutput(src, outDir, '{"ir":true}\n'));
    const leftovers = fs.readdirSync(tmpDir).filter((name) => name.startsWith('.archify-import-'));
    assert.equal(leftovers.length, 0, 'A failed commit must clean up its candidate file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI import through a symlinked output preserves the symlink target (race-safe end to end)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ioctl-race-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const target = path.join(tmpDir, 'precious.txt');
  const out = path.join(tmpDir, 'out.json');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  fs.writeFileSync(target, 'user data that must survive');
  fs.symlinkSync(target, out);
  try {
    const result = runCliImport(['import', 'flowchart', src, out]);
    assert.equal(result.status, 0, `Expected import to succeed: ${result.stderr}`);
    assert.equal(
      fs.readFileSync(target, 'utf8'),
      'user data that must survive',
      'Writing the output must never follow a symlink out of the source-preservation contract',
    );
    const ir = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(ir.diagram_type, 'architecture');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('importOutputAliasesInput still detects same-path and hard-link aliases', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-alias-detect-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const linked = path.join(tmpDir, 'linked.json');
  const other = path.join(tmpDir, 'other.json');
  fs.writeFileSync(src, 'flowchart LR\n  A[Alpha] --> B[Beta]\n');
  fs.writeFileSync(other, '{}');
  fs.linkSync(src, linked);
  try {
    assert.equal(importOutputAliasesInput(src, src), true);
    assert.equal(importOutputAliasesInput(src, linked), true);
    assert.equal(importOutputAliasesInput(src, other), false);
    assert.equal(importOutputAliasesInput(src, path.join(tmpDir, 'missing.json')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Authored subgraph identity -------------------------------------------

test('an edge to an authored subgraph id is rejected instead of inventing a component', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph G [Group Label]',
    '    A[Alpha]',
    '  end',
    '  B[Beta]',
    '  B --> G',
  ].join('\n'));
  assert.equal(result.ok, false, 'The import must not report ok with an invented component for the subgraph id');
  assert.ok(result.diagnostics.some((d) => d.code === 'import/edge-references-subgraph'));
});

test('subgraph boundary labels carry the title alone, not the raw declaration text', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph G [Group Label]',
    '    A[Alpha]',
    '  end',
  ].join('\n'));
  assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.boundaries.length, 1);
  assert.equal(result.ir.boundaries[0].label, 'Group Label');
  assert.equal(result.ir.components.length, 1, 'No component may be invented from the subgraph id or title');
});

test('quoted subgraph titles parse to the quoted text', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph G["Group Label"]',
    '    A[Alpha]',
    '  end',
  ].join('\n'));
  assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.ir.boundaries[0].label, 'Group Label');
});

test('an authored node named sg1 imports as an ordinary component after a subgraph', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph Outer [Stuff]',
    '    A[Alpha]',
    '  end',
    '  sg1[Small Node]',
    '  A --> sg1',
  ].join('\n'));
  assert.ok(result.ok, `A Mermaid-unreserved name must not be rejected: ${JSON.stringify(result.diagnostics)}`);
  const sg = result.ir.components.find((c) => c.id === 'sg1');
  assert.ok(sg, 'Expected the sg1 component to be imported');
  assert.equal(sg.label, 'Small Node');
  assert.ok(result.ir.connections.some((c) => c.from === 'A' && c.to === 'sg1'));
});

test('an explicitly declared node sharing a subgraph identity keeps the node for its edges', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph X [Gate]',
    '    A[Alpha]',
    '  end',
    '  Gate[Real Node]',
    '  Gate --> B[Beta]',
  ].join('\n'));
  assert.ok(result.ok, `Expected the explicit node declaration to win: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.ir.components.some((c) => c.id === 'Gate' && c.label === 'Real Node'));
  assert.ok(result.ir.connections.some((c) => c.from === 'Gate' && c.to === 'B'));
});

test('a subgraph with an empty title is rejected', () => {
  const result = parseFlowchart([
    'flowchart TD',
    '  subgraph []',
    '    A[Alpha]',
    '  end',
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'import/subgraph-empty-title'));
});

test('CLI import rejects the subgraph-edge case end to end and preserves the source', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subgraph-edge-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const out = path.join(tmpDir, 'out.json');
  const source = [
    'flowchart TD',
    '  subgraph G [Group Label]',
    '    A[Alpha]',
    '  end',
    '  B[Beta]',
    '  B --> G',
    '',
  ].join('\n');
  fs.writeFileSync(src, source);
  try {
    const result = runCliImport(['import', 'flowchart', src, out, '--json']);
    assert.notEqual(result.status, 0, 'The subgraph-edge topology must not import as ok');
    const receipt = JSON.parse(result.stdout.trim());
    assert.ok(receipt.diagnostics.some((d) => d.code === 'import/edge-references-subgraph'));
    assert.equal(fs.existsSync(out), false, 'A rejected import must not write an output file');
    assert.equal(fs.readFileSync(src, 'utf8'), source, 'The Mermaid source must be preserved');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Import -> validate handoff (gate-valid geometry) ----------------------

const LONG_LABEL = 'This is an extremely long relationship label that is likely wider than the available route gap';

function importThenValidateShowcase(mmd, expectLabelDy = undefined) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-handoff-'));
  const src = path.join(tmpDir, 'diagram.mmd');
  const out = path.join(tmpDir, 'out.json');
  fs.writeFileSync(src, mmd);
  try {
    const imported = runCliImport(['import', 'flowchart', src, out]);
    assert.equal(imported.status, 0, `Expected import to succeed: ${imported.stderr}`);
    const validated = runCliValidate(out);
    assert.equal(
      validated.status,
      0,
      `A supported import must pass the advertised validation handoff: ${validated.stdout}`,
    );
    if (expectLabelDy !== undefined) {
      const ir = JSON.parse(fs.readFileSync(out, 'utf8'));
      const labeled = ir.connections.find((c) => c.label === LONG_LABEL);
      assert.ok(labeled, 'Expected the long-labeled connection');
      assert.equal(labeled.labelDy, expectLabelDy);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('a long horizontal edge label imports to gate-valid geometry (LR)', () => {
  importThenValidateShowcase(`flowchart LR\n  A[Alpha] -->|${LONG_LABEL}| B[Beta]\n`, 54);
});

test('a long horizontal edge label imports to gate-valid geometry (RL)', () => {
  importThenValidateShowcase(`flowchart RL\n  A[Alpha] -->|${LONG_LABEL}| B[Beta]\n`, 54);
});

test('a long vertical edge label imports to gate-valid geometry (TB)', () => {
  importThenValidateShowcase(`flowchart TB\n  A[Alpha] -->|${LONG_LABEL}| B[Beta]\n`);
});

test('a small cycle imports to gate-valid geometry (A-B-C-B)', () => {
  importThenValidateShowcase([
    'flowchart LR',
    '  A[Alpha] --> B[Beta]',
    '  B --> C[Gamma]',
    '  C --> B',
    '',
  ].join('\n'));
});

test('a shared-successor diamond imports to gate-valid geometry (A-B-D, A-D)', () => {
  importThenValidateShowcase([
    'flowchart LR',
    '  A[Alpha] --> B[Beta]',
    '  B --> D[Delta]',
    '  A --> D',
    '',
  ].join('\n'));
});

// --- Existing behavior unchanged ----------------------------------------

test('importFlowchart receipt has stable schemaVersion and command fields', () => {
  const result = importFlowchart(readFixture('valid-simple.mmd'));
  assert.ok(result.ok);
  assert.equal(result.receipt.schemaVersion, 1);
  assert.equal(result.receipt.command, 'import');
  assert.equal(result.receipt.source, 'mermaid-flowchart');
});
