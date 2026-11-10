// C6 evidence must keep both sides and must not mistake a surviving twin for
// deleted code. These fixtures exercise evidence identity, not jscpd's rules.
// The 5.4.2 engine metadata is a persisted historical evidence fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRangeDigest, checkLocation, digestMatches, verifyTask } from '../lib/evidence.mjs';
import { buildTask, rangeDigest, renderTaskMarkdown, splitLines, withExcerpt } from '../lib/task.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const ID = 'REDU-0123456789ab';
const BLOCK = 'value = normalize(value);\nconsume(value);';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const span = (file, line, endLine) => ({ file, line, endLine });

function captured(files, locations, { kind = 'exact', identifiers = 'exact' } = {}) {
  const sourceMap = new Map(Object.entries(files));
  const repository = { root: '.', language: 'ts', adapter: 'typescript@test', sourceKind: 'working-tree', snapshotId: 'a'.repeat(64) };
  const facts = { repository, files: [...sourceMap].map(([file, sourceText]) => ({ path: file, sourceText })) };
  const diagnostic = {
    id: ID, code: 'redundancy/duplicate-block', dimension: 'redundancy', severity: 'warning', confidence: 0.7,
    message: 'Two token sequences match; review both blocks in their own context.',
    subject: {
      files: [...new Set(locations.map((l) => l.file))],
      locations: locations.map((loc) => {
        const lines = splitLines(files[loc.file]);
        const start = lines.slice(0, loc.line - 1).reduce((n, line) => n + line.length + 1, 0);
        const end = start + lines.slice(loc.line - 1, loc.endLine).join('\n').length;
        return { ...loc, column: 1, endColumn: lines[loc.endLine - 1].length + 1, start, end };
      }),
    },
    evidence: { threshold: { minTokens: 10, minLines: 2 }, engine: { name: 'jscpd', version: '5.4.2' }, identifiers, kind, tokens: 14, lines: 2 },
    supportedFixes: ['Review both contexts before deciding whether to share an implementation.'],
    evidenceDigest: createRangeDigest(locations, sourceMap),
  };
  const findings = { schema_version: 1, repository, rules: ['redundancy/duplicate-block'], summary: { errors: 0, warnings: 1, info: 0, suppressed: 0 }, diagnostics: [diagnostic] };
  return { findings, facts, diagnostic, task: buildTask({ findings, facts, ids: [ID] }) };
}

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-duplicate-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  return root;
}

const pairFiles = () => ({ 'a.js': `// left\n${BLOCK}\n// left context\n`, 'b.js': `// right\n// note\n${BLOCK}\n// right context\n` });
const pairLocations = () => [span('a.js', 2, 3), span('b.js', 3, 4)];

test('duplicate tasks carry both ranges, detector facts and conservative acceptance', () => {
  const { findings, diagnostic, task } = captured(pairFiles(), pairLocations());
  assert.deepEqual(schemaErrors('findings', findings), []);
  assert.deepEqual(schemaErrors('ai-task', task), []);
  assert.deepEqual(task.locations.map((l) => [l.file, l.startLine, l.endLine, l.kind]), [['a.js', 2, 3, 'range'], ['b.js', 3, 4, 'range']]);
  assert.deepEqual(task.scope.modify, ['a.js', 'b.js']);
  assert.deepEqual(task.facts[0].evidence, diagnostic.evidence);
  assert.match(task.impact[0].statement, /does not establish semantic equivalence/);
  assert.ok(task.acceptance.some((s) => /retain separate implementations/.test(s)));
  assert.match(renderTaskMarkdown(task), /a\.js:2-3/);
  assert.match(renderTaskMarkdown(task), /b\.js:3-4/);
  const invalid = structuredClone(task);
  invalid.findings[0].evidenceDigest.ranges[0].capturedOccurrences = 0;
  assert.ok(schemaErrors('ai-task', invalid).length, 'persisted range metadata is validated when a task is read');
});

test('duplicate evidence survives independent moves and unrelated edits on both sides', (t) => {
  const files = pairFiles(), locations = pairLocations();
  const { task, diagnostic } = captured(files, locations);
  const root = tree(t, files);
  assert.equal(verifyTask(task, root).evidence.status, 'valid');
  const movedFiles = { 'a.js': `// first added comment\n${files['a.js']}const unrelated = 1;\n`, 'b.js': `// first\n// second\n${files['b.js'].replace('right context', 'new context')}` };
  for (const [file, text] of Object.entries(movedFiles)) fs.writeFileSync(path.join(root, file), text);
  const checked = verifyTask(task, root);
  assert.equal(checked.evidence.status, 'valid');
  assert.deepEqual(checked.locations.map((l) => [l.currentStartLine, l.currentEndLine]), [[3, 4], [5, 6]]);
  assert.equal(checked.evidence.findings[ID].digestMatches, true);
  const again = captured(movedFiles, [span('a.js', 3, 4), span('b.js', 5, 6)]);
  assert.equal(again.diagnostic.evidenceDigest.sha256, diagnostic.evidenceDigest.sha256);
  assert.equal(again.task.taskId, task.taskId, 'line positions and unrelated code do not change the task identity');
});

test('each duplicate side can invalidate or become missing independently', (t) => {
  for (const file of ['a.js', 'b.js']) {
    const files = pairFiles(), { task } = captured(files, pairLocations()), root = tree(t, files);
    fs.writeFileSync(path.join(root, file), files[file].replace('consume(value)', 'consume(other)'));
    const changed = verifyTask(task, root);
    assert.equal(changed.evidence.status, 'changed', file);
    assert.equal(changed.evidence.findings[ID].digestMatches, false);
    assert.equal(changed.locations.find((l) => l.file !== file).status, 'valid');
    fs.rmSync(path.join(root, file));
    assert.equal(verifyTask(task, root).evidence.status, 'missing', file);
  }
});

test('same-file renamed ranges remain separate and can move by different amounts', (t) => {
  const other = BLOCK.replaceAll('value', 'other');
  const files = { 'both.js': `${BLOCK}\n// between\n${other}\n` };
  const { diagnostic, task } = captured(files, [span('both.js', 1, 2), span('both.js', 4, 5)], { kind: 'renamed' });
  assert.deepEqual(diagnostic.evidenceDigest.files, ['both.js']);
  assert.equal(diagnostic.evidenceDigest.ranges.length, 2);
  assert.equal(task.locations.length, 2);
  assert.deepEqual(task.scope.modify, ['both.js']);
  const root = tree(t, files);
  fs.writeFileSync(path.join(root, 'both.js'), `// above\n${BLOCK}\n// between\n// extra one\n// extra two\n${other}\n`);
  const checked = verifyTask(task, root);
  assert.equal(checked.evidence.status, 'valid');
  assert.deepEqual(checked.locations.map((l) => l.currentStartLine), [2, 7]);
});

test('deleting a twin invalidates evidence even when both original positions still match', (t) => {
  const files = { 'twins.js': `${BLOCK}\n${BLOCK}\n${BLOCK}\n` };
  const locations = [span('twins.js', 1, 2), span('twins.js', 3, 4)];
  const { task, diagnostic } = captured(files, locations);
  assert.deepEqual(diagnostic.evidenceDigest.ranges.map((r) => r.capturedOccurrences), [3, 3]);
  const root = tree(t, files);
  const afterDeletion = `${BLOCK}\n${BLOCK}\n`;
  fs.writeFileSync(path.join(root, 'twins.js'), afterDeletion);
  assert.ok(task.locations.every((loc) => checkLocation(loc, { status: 'ok', text: afterDeletion }).status === 'valid'), 'without the new multiplicity guard, the old-position fast path falsely accepts both twins');
  const checked = verifyTask(task, root);
  assert.equal(checked.evidence.status, 'changed');
  assert.ok(checked.locations.every((loc) => loc.status === 'changed'));
  assert.equal(checked.evidence.findings[ID].digestMatches, false);
  const remaining = captured({ 'twins.js': afterDeletion }, locations);
  assert.notEqual(remaining.diagnostic.evidenceDigest.sha256, diagnostic.evidenceDigest.sha256);
});

test('a new twin or ambiguous movement cannot silently refresh a duplicate task', (t) => {
  const files = { 'twins.js': `${BLOCK}\n${BLOCK}\n` };
  const { task } = captured(files, [span('twins.js', 1, 2), span('twins.js', 3, 4)]);
  const root = tree(t, files);
  fs.writeFileSync(path.join(root, 'twins.js'), `${files['twins.js']}${BLOCK}\n`);
  assert.equal(verifyTask(task, root).evidence.status, 'changed', 'an additional identical range changes captured multiplicity');
  fs.writeFileSync(path.join(root, 'twins.js'), `// inserted\n${files['twins.js']}`);
  const moved = verifyTask(task, root);
  assert.equal(moved.evidence.status, 'changed', 'two identical ranges cannot be identified independently after a move');
  assert.match(moved.locations[0].reason, /cannot be told apart/);
});

test('range counts preserve overlaps, full lines, newline normalization and Unicode', () => {
  const examples = [
    { text: 'same\nsame\nsame', endLine: 2, cited: 'same\nsame', count: 2 },
    { text: '值😀();\n\nfinish();\n// context\r\n值😀();\r\n\r\nfinish();', endLine: 3, cited: '值😀();\n\nfinish();', count: 2 },
    { text: 'value\nvalue-extra\nprefix-value\nvalue', endLine: 1, cited: 'value', count: 2 },
    { text: 'value\rinside\nvalueinside', endLine: 1, cited: 'value\rinside', count: 1 },
    { text: '\n', endLine: 1, cited: '', count: 1 },
    { text: 'x\n\n', endLine: 2, cited: 'x\n', count: 1 },
  ];
  for (const { text, endLine, cited, count } of examples) {
    const digest = createRangeDigest([span('a.js', 1, endLine)], new Map([['a.js', text]]));
    assert.equal(digest.ranges[0].capturedOccurrences, count, JSON.stringify(text));
    assert.equal(digest.ranges[0].sha256, hash(cited));
  }
  assert.equal(createRangeDigest([span('a.js', 1, 1)], new Map([['a.js', '']])), null);
  assert.equal(createRangeDigest([span('a.js', 2, 2)], new Map([['a.js', 'x\n']])), null);
});

test('JSON source strings retain UTF-8 evidence semantics when written to disk', (t) => {
  // All three strings have the same UTF-8 bytes: Node replaces lone surrogates
  // with U+FFFD when hashing or writing them. Count them the way verification does.
  const files = { 'unicode.js': 'x\uD800\nx\uFFFD\nx\uDC00\n' };
  const { diagnostic, task } = captured(files, [span('unicode.js', 1, 1), span('unicode.js', 2, 2)]);
  assert.deepEqual(diagnostic.evidenceDigest.ranges.map((r) => r.capturedOccurrences), [3, 3]);
  assert.ok(diagnostic.evidenceDigest.ranges.every((r) => r.sha256 === hash('x\uFFFD')));
  const root = tree(t, files);
  const checked = verifyTask(task, root);
  assert.equal(checked.evidence.status, 'valid');
  assert.equal(checked.evidence.findings[ID].digestMatches, true);
});

test('range capture refuses partial evidence and long excerpts still hash the entire range', () => {
  const source = new Map([['a.js', BLOCK]]);
  assert.equal(createRangeDigest([span('a.js', 1, 2), span('missing.js', 1, 2)], source), null);
  assert.equal(createRangeDigest([span('a.js', 1, 3)], source), null);
  assert.equal(createRangeDigest([span('a.js', 2, 1)], source), null);
  const lines = Array.from({ length: 140 }, (_, i) => `consume(${i});`);
  const location = withExcerpt({ findingId: ID, file: 'long.js', kind: 'range', startLine: 1, endLine: 140 }, lines);
  assert.equal(location.sha256, hash(lines.join('\n')));
  assert.equal(location.excerpt.complete, false);
  assert.ok(location.excerpt.segments.reduce((n, s) => n + s.lines.length, 0) < 60);
  const changed = [...lines];
  changed[70] = 'consume("changed outside excerpt");';
  assert.equal(checkLocation(location, { status: 'ok', text: changed.join('\n') }, { strictOccurrences: true }).status, 'changed');
});

test('legacy file and function digests keep their original verification contracts', () => {
  const original = `// context\n${BLOCK}\n`;
  const wholeFile = { files: ['a.js'], sha256: hash(JSON.stringify([['a.js', hash(original)]])) };
  const reader = (text) => () => ({ status: 'ok', text });
  assert.equal(digestMatches(wholeFile, reader(original)), true);
  assert.equal(digestMatches(wholeFile, reader(`${original}// unrelated\n`)), false);
  const functionDigest = { files: ['a.js'], lines: [2, 3], sha256: hash(JSON.stringify([['a.js', rangeDigest(splitLines(original), 2, 3)]])) };
  assert.equal(digestMatches(functionDigest, reader(`// inserted\n${original}`), [3, 4]), true);
});
