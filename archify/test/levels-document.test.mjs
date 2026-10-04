import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const { loadLevelsDocument } = await import(path.join(skillRoot, 'renderers/shared/levels-document.mjs'));

let caseCounter = 0;

function workspace() {
  caseCounter += 1;
  return fs.mkdtempSync(path.join(os.tmpdir(), `archify-levels-${caseCounter}-`));
}

// Smallest document that satisfies the architecture schema. Levels documents
// only schema-check their sources, so layout facts are deliberately absent.
function architecture(title, componentIds = ['a']) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title, output: 'level.html' },
    components: componentIds.map((id) => ({ id, type: 'backend', label: id })),
  };
}

function writeJson(dir, name, value) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
}

function manifest(dir, levels, meta = { title: 'Levels', output: 'levels.html' }) {
  return writeJson(dir, 'doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta,
    levels,
  });
}

function codesFrom(fn) {
  try {
    fn();
  } catch (error) {
    return {
      codes: (error.archifyDiagnostics || []).map((d) => d.code),
      diagnostics: error.archifyDiagnostics || [],
      message: String(error.message || error),
    };
  }
  assert.fail('expected loadLevelsDocument to throw');
}

test('levels: a valid chain resolves in breadth-first drill order', () => {
  const dir = workspace();
  writeJson(dir, 'l1.architecture.json', architecture('L1', ['system']));
  writeJson(dir, 'l2.architecture.json', architecture('L2', ['api', 'db']));
  writeJson(dir, 'l3.architecture.json', architecture('L3', ['handler']));
  const doc = manifest(dir, [
    // Deliberately out of order: resolution must not depend on array order.
    { id: 'l3', label: 'Components', source: 'l3.architecture.json', parent: { level: 'l2', node: 'api' } },
    { id: 'l1', label: 'Context', source: 'l1.architecture.json' },
    { id: 'l2', label: 'Containers', source: 'l2.architecture.json', parent: { level: 'l1', node: 'system' } },
  ]);

  const resolved = loadLevelsDocument(doc);

  assert.equal(resolved.root, 'l1');
  assert.deepEqual(resolved.order, ['l1', 'l2', 'l3']);
  assert.deepEqual(resolved.levels.map((l) => l.id), ['l1', 'l2', 'l3']);
  assert.deepEqual(resolved.levels[0].children, ['l2']);
  assert.deepEqual(resolved.levels[1].children, ['l3']);
  assert.deepEqual(resolved.levels[2].children, []);
  assert.equal(resolved.levels[0].parent, null);
  assert.deepEqual(resolved.levels[1].parent, { level: 'l1', node: 'system' });
  assert.equal(resolved.levels[2].diagram.meta.title, 'L3');
  assert.equal(resolved.meta.title, 'Levels');
});

test('levels: one parent may fan out to several child levels', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['web', 'api']));
  writeJson(dir, 'web.architecture.json', architecture('Web', ['page']));
  writeJson(dir, 'api.architecture.json', architecture('Api', ['route']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'web', label: 'Web', source: 'web.architecture.json', parent: { level: 'root', node: 'web' } },
    { id: 'api', label: 'Api', source: 'api.architecture.json', parent: { level: 'root', node: 'api' } },
  ]);

  const resolved = loadLevelsDocument(doc);

  assert.deepEqual(resolved.order, ['root', 'web', 'api']);
  assert.deepEqual(resolved.levels[0].children, ['web', 'api']);
});

test('levels: nested source directories are allowed', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'levels/child.architecture.json', architecture('Child', ['inner']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'child', label: 'Child', source: 'levels/child.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const resolved = loadLevelsDocument(doc);
  assert.equal(resolved.levels[1].diagram.meta.title, 'Child');
});

test('levels: source paths may not escape the manifest directory', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  fs.writeFileSync(path.join(path.dirname(dir), 'outside.json'), JSON.stringify(architecture('Outside')));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'escape', label: 'Escape', source: '../outside.json', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-path-escape'), codes.join(', '));
});

test('levels: a symlinked source pointing outside the manifest directory is rejected', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  const outside = path.join(path.dirname(dir), `outside-${path.basename(dir)}.json`);
  fs.writeFileSync(outside, JSON.stringify(architecture('Outside', ['x'])));
  fs.symlinkSync(outside, path.join(dir, 'linked.architecture.json'));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'linked', label: 'Linked', source: 'linked.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes, diagnostics } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-path-escape'), codes.join(', '));
  assert.equal(diagnostics.find((d) => d.code === 'levels/source-path-escape').evidence.resolvedOutside, true);
});

test('levels: a symlink that stays inside the manifest directory is allowed', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'real/child.architecture.json', architecture('Child', ['inner']));
  fs.symlinkSync(path.join(dir, 'real/child.architecture.json'), path.join(dir, 'alias.architecture.json'));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'child', label: 'Child', source: 'alias.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const resolved = loadLevelsDocument(doc);
  assert.equal(resolved.levels[1].diagram.meta.title, 'Child');
});

test('levels: absolute and backslash source paths are rejected', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'abs', label: 'Abs', source: '/etc/passwd', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-path-invalid'), codes.join(', '));
});

test('levels: a missing source file reports the level, not a crash', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'gone', label: 'Gone', source: 'nope.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-missing'), codes.join(', '));
});

test('levels: unparsable and wrongly-typed sources are distinguished', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['a', 'b']));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
  writeJson(dir, 'wrong.json', {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'W' },
    lanes: [],
    nodes: [],
    edges: [],
  });
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'broken', label: 'Broken', source: 'broken.json', parent: { level: 'root', node: 'a' } },
    { id: 'wrong', label: 'Wrong', source: 'wrong.json', parent: { level: 'root', node: 'b' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-unparsable'), codes.join(', '));
  assert.ok(codes.includes('levels/source-type'), codes.join(', '));
});

test('levels: a source failing the architecture schema is re-scoped onto its level', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'bad.architecture.json', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Bad' },
    components: [{ id: 'x', type: 'not-a-real-type', label: 'X' }],
  });
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'bad', label: 'Bad', source: 'bad.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes, diagnostics } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/source-schema'), codes.join(', '));
  const reported = diagnostics.find((d) => d.code === 'levels/source-schema');
  assert.equal(reported.subject.level, 'bad');
  assert.match(reported.message, /bad\.architecture\.json/);
});

test('levels: duplicate ids and duplicate sources are both reported', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['a', 'b']));
  writeJson(dir, 'child.architecture.json', architecture('Child', ['c']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'dup', label: 'One', source: 'child.architecture.json', parent: { level: 'root', node: 'a' } },
    { id: 'dup', label: 'Two', source: 'child.architecture.json', parent: { level: 'root', node: 'b' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/duplicate-id'), codes.join(', '));
  assert.ok(codes.includes('levels/duplicate-source'), codes.join(', '));
});

test('levels: parent must name a known level, a real node, and not itself', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'a.architecture.json', architecture('A', ['x']));
  writeJson(dir, 'b.architecture.json', architecture('B', ['y']));
  writeJson(dir, 'c.architecture.json', architecture('C', ['z']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'a', label: 'A', source: 'a.architecture.json', parent: { level: 'ghost', node: 'system' } },
    { id: 'b', label: 'B', source: 'b.architecture.json', parent: { level: 'root', node: 'missing' } },
    { id: 'c', label: 'C', source: 'c.architecture.json', parent: { level: 'c', node: 'z' } },
  ]);

  const { codes, diagnostics } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/parent-unknown-level'), codes.join(', '));
  assert.ok(codes.includes('levels/parent-unknown-node'), codes.join(', '));
  assert.ok(codes.includes('levels/parent-self'), codes.join(', '));
  const unknownNode = diagnostics.find((d) => d.code === 'levels/parent-unknown-node');
  assert.deepEqual(unknownNode.evidence.knownComponents, ['system']);
});

test('levels: two levels may not drill from the same parent node', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'a.architecture.json', architecture('A', ['x']));
  writeJson(dir, 'b.architecture.json', architecture('B', ['y']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'a', label: 'A', source: 'a.architecture.json', parent: { level: 'root', node: 'system' } },
    { id: 'b', label: 'B', source: 'b.architecture.json', parent: { level: 'root', node: 'system' } },
  ]);

  const { codes, diagnostics } = codesFrom(() => loadLevelsDocument(doc));
  assert.ok(codes.includes('levels/drill-target-conflict'), codes.join(', '));
  assert.equal(diagnostics.find((d) => d.code === 'levels/drill-target-conflict').evidence.claimedBy, 'a');
});

test('levels: a document needs exactly one root', () => {
  const dir = workspace();
  writeJson(dir, 'a.architecture.json', architecture('A', ['x']));
  writeJson(dir, 'b.architecture.json', architecture('B', ['y']));

  const twoRoots = manifest(dir, [
    { id: 'a', label: 'A', source: 'a.architecture.json' },
    { id: 'b', label: 'B', source: 'b.architecture.json' },
  ]);
  assert.ok(codesFrom(() => loadLevelsDocument(twoRoots)).codes.includes('levels/root-ambiguous'));

  const noRoot = manifest(dir, [
    { id: 'a', label: 'A', source: 'a.architecture.json', parent: { level: 'b', node: 'y' } },
    { id: 'b', label: 'B', source: 'b.architecture.json', parent: { level: 'a', node: 'x' } },
  ]);
  assert.ok(codesFrom(() => loadLevelsDocument(noRoot)).codes.includes('levels/root-missing'));
});

test('levels: a cycle detached from the root is reported as unreachable', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  writeJson(dir, 'a.architecture.json', architecture('A', ['x']));
  writeJson(dir, 'b.architecture.json', architecture('B', ['y']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'a', label: 'A', source: 'a.architecture.json', parent: { level: 'b', node: 'y' } },
    { id: 'b', label: 'B', source: 'b.architecture.json', parent: { level: 'a', node: 'x' } },
  ]);

  const { codes, diagnostics } = codesFrom(() => loadLevelsDocument(doc));
  const unreachable = diagnostics.filter((d) => d.code === 'levels/unreachable').map((d) => d.subject.level);
  assert.ok(codes.includes('levels/unreachable'), codes.join(', '));
  assert.deepEqual(unreachable.sort(), ['a', 'b']);
});

test('levels: the manifest itself is schema-checked', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));

  const wrongType = writeJson(dir, 'wrong.levels.json', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'X' },
    levels: [{ id: 'root', label: 'Root', source: 'root.architecture.json' }],
  });
  assert.ok(codesFrom(() => loadLevelsDocument(wrongType)).codes.some((c) => c.startsWith('schema/')));

  const unknownField = writeJson(dir, 'extra.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'X', output: 'levels.html' },
    levels: [{ id: 'root', label: 'Root', source: 'root.architecture.json', colour: 'red' }],
  });
  assert.ok(codesFrom(() => loadLevelsDocument(unknownField)).codes.includes('schema/additionalProperties'));
});

test('levels: every problem is reported, not just the first', () => {
  const dir = workspace();
  writeJson(dir, 'root.architecture.json', architecture('Root', ['system']));
  const doc = manifest(dir, [
    { id: 'root', label: 'Root', source: 'root.architecture.json' },
    { id: 'gone', label: 'Gone', source: 'missing-a.json', parent: { level: 'ghost', node: 'system' } },
    { id: 'gone2', label: 'Gone2', source: 'missing-b.json', parent: { level: 'ghost', node: 'system' } },
  ]);

  const { codes } = codesFrom(() => loadLevelsDocument(doc));
  assert.equal(codes.filter((c) => c === 'levels/source-missing').length, 2);
  assert.equal(codes.filter((c) => c === 'levels/parent-unknown-level').length, 2);
});
