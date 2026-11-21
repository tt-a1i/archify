// Real jscpd output must survive the public findings/task pipeline. These
// fixtures are authored source, not a simulated detector or copied report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildGraph, evaluateGraph, extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildTask } from '../lib/task.mjs';
import { verifyTask } from '../lib/evidence.mjs';

const BINARY = process.env.ARCHIFY_TEST_JSCPD;
const REAL = { skip: !BINARY && 'set ARCHIFY_TEST_JSCPD to a real jscpd 5.4.3 executable' };
const CODE = 'redundancy/duplicate-block';
const ALPHA = `function NAME(values, floor) {
    const label = "命中😀";
    let résultat = 0;
    let accepted = 0;
    for (const value of values) {
        if (value > floor) {
            résultat += value;
            accepted += 1;
        } else {
            résultat -= floor;
        }
    }
    return résultat + accepted + label.length; }
`;
const BETA = `function NAME(items, limit) {
    const chosen = [];
    let cursor = 0;
    while (cursor < items.length) {
        const entry = items[cursor];
        if (entry.active && entry.cost <= limit) {
            chosen.push({key: entry.key, weight: entry.cost * 2});
        } else {
            chosen.push({key: "missing", weight: -1});
        }
        cursor += 1;
    }
    return chosen.reverse();
}
`;
const LEFT = '// 前置😀 combining e\u0301\nconst north = "北😀e\u0301"; ' + ALPHA.replace('NAME', 'sumLeft');
const RIGHT = '// 另一侧🦀\nconst south = "南🦀"; ' + ALPHA.replace('NAME', 'sumRightLonger');
const INDEPENDENT = `export function transform(point, scale, angle) {
  const horizontal = point.x * scale;
  const vertical = point.y * scale;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const rotatedX = horizontal * cosine - vertical * sine;
  const rotatedY = horizontal * sine + vertical * cosine;
  const distance = Math.hypot(rotatedX, rotatedY);
  const direction = Math.atan2(rotatedY, rotatedX);
  const label = String(distance) + ':' + String(direction);
  return { x: rotatedX, y: rotatedY, distance, direction, label };
}
`;

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-c6-coordinates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source, 'utf8');
  }
  return root;
}

function scan(root, options = {}) {
  const config = { ...loadConfig(null), duplicates: {
    enabled: true, executable: path.resolve(BINARY), minTokens: 50, minLines: 5, identifiers: 'consistent',
    ...options,
  } };
  const { facts } = extractFacts(root, { language: 'ts', config });
  assert.deepEqual(facts.parse_errors ?? [], [], 'coordinate controls must be legal source');
  const findings = evaluateGraph(buildGraph(facts, config), config, facts);
  return { facts, findings, duplicates: findings.diagnostics.filter(finding => finding.code === CODE) };
}

// The fixed native fixture matches from the semicolon before the function to
// its closing brace. Derive byte bounds from markers, independently of C6.
function expectedRange(source) {
  const bytes = Buffer.from(source, 'utf8');
  const startByte = bytes.indexOf(Buffer.from('; function'));
  const endMarker = Buffer.from('label.length; }');
  const endByte = bytes.indexOf(endMarker) + endMarker.length;
  assert(startByte > 0 && endByte > startByte);
  const snippet = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(startByte, endByte));
  const start = source.indexOf(snippet);
  assert.equal(start, source.indexOf('; function'), 'the expected occurrence is unambiguous');
  const end = start + snippet.length;
  const precedingLines = source.slice(0, start).split(/\r?\n/);
  const throughEnd = source.slice(0, end).split(/\r?\n/);
  return { start, end, line: precedingLines.length, endLine: throughEnd.length,
    column: precedingLines.at(-1).length + 1, endColumn: throughEnd.at(-1).length + 1,
    startByte, snippet };
}

test('duplicates: native Unicode and CRLF ranges become precise UTF-16 finding locations', REAL, t => {
  for (const newline of ['\n', '\r\n']) {
    const files = { 'left.js': LEFT.replaceAll('\n', newline), 'right.js': RIGHT.replaceAll('\n', newline) };
    const result = scan(tree(t, files));
    assert.equal(result.duplicates.length, 1);
    const locations = result.duplicates[0].subject.locations;
    assert.equal(locations.length, 2);
    for (const location of locations) {
      const source = files[location.file];
      const expected = expectedRange(source);
      assert.notEqual(expected.start, expected.startByte, 'using byte offsets as JS string offsets must fail this control');
      assert.deepEqual(Object.fromEntries(['start', 'end', 'line', 'endLine', 'column', 'endColumn'].map(key => [key, location[key]])),
        Object.fromEntries(['start', 'end', 'line', 'endLine', 'column', 'endColumn'].map(key => [key, expected[key]])));
      assert.equal(source.slice(location.start, location.end), expected.snippet);
      assert.equal(result.facts.files.find(file => file.path === location.file).sourceText, source, 'capture preserves the source line endings');
    }
  }
});

test('duplicates: real same-file occurrences both reach a task and a changed copy invalidates it', REAL, t => {
  const source = LEFT + '\nconst splitter = "不同隔断🐈";\n' + ALPHA.replace('NAME', 'sumAgain');
  const root = tree(t, { 'two.js': source });
  const { facts, findings, duplicates } = scan(root);
  assert.equal(duplicates.length, 1);
  const finding = duplicates[0];
  assert.deepEqual(finding.subject.files, ['two.js']);
  const locations = [...finding.subject.locations].sort((a, b) => a.start - b.start);
  assert.equal(locations.length, 2);
  assert(locations[0].end <= locations[1].start, 'same-file sides are distinct, non-overlapping occurrences');
  for (const location of locations) assert.match(source.slice(location.start, location.end), /return résultat \+ accepted \+ label\.length/);
  const task = buildTask({ findings, facts, ids: [finding.id] });
  assert.equal(task.locations.length, 2);
  assert.equal(verifyTask(task, root).evidence.status, 'valid');
  const secondFunction = source.indexOf('function sumAgain');
  const changed = source.slice(0, secondFunction) + source.slice(secondFunction).replace('résultat += value;', 'résultat += value * 2;');
  fs.writeFileSync(path.join(root, 'two.js'), changed);
  const verified = verifyTask(task, root);
  assert.equal(verified.evidence.status, 'changed');
  assert.equal(verified.evidence.findings[finding.id].digestMatches, false);
  assert.equal(verified.locations.filter(location => location.status === 'valid').length, 1, 'the untouched side remains independently valid');
});

test('duplicates: independent blocks in one file pair keep distinct IDs through added context', REAL, t => {
  const files = {
    'left.js': LEFT + '\nconst onlyLeft = Symbol("north-only");\n' + BETA.replace('NAME', 'selectLeft'),
    'right.js': RIGHT + '\nclass OnlyRight extends Object { constructor() { super(); } }\n' + BETA.replace('NAME', 'selectRight'),
  };
  const root = tree(t, files);
  const before = scan(root);
  assert.equal(before.duplicates.length, 2);
  const ids = before.duplicates.map(finding => finding.id).sort();
  assert.equal(new Set(ids).size, 2, 'pair paths alone cannot identify independent blocks');
  for (const finding of before.duplicates) assert.deepEqual([...finding.subject.files].sort(), ['left.js', 'right.js']);
  const task = buildTask({ findings: before.findings, facts: before.facts, ids });
  fs.writeFileSync(path.join(root, 'left.js'), '// 新注释😀\n\n' + files['left.js']);
  fs.writeFileSync(path.join(root, 'right.js'), '// independent context\n\n\n' + files['right.js']);
  fs.writeFileSync(path.join(root, '000-unrelated.js'), INDEPENDENT);
  const after = scan(root);
  assert.deepEqual(after.duplicates.map(finding => finding.id).sort(), ids);
  assert.equal(verifyTask(task, root).evidence.status, 'valid', 'leading context may move both pieces without changing their evidence');
  assert.equal(buildTask({ findings: after.findings, facts: after.facts, ids }).taskId, task.taskId);
});

test('duplicates: identical content across three files does not collapse distinct native pairs', REAL, t => {
  const { duplicates } = scan(tree(t, { 'a.js': LEFT, 'b.js': LEFT, 'c.js': LEFT }));
  assert.equal(duplicates.length, 2, 'jscpd reports a two-edge representative set for the three copies');
  assert.equal(new Set(duplicates.map(finding => finding.id)).size, 2, 'native content fingerprints can be shared by distinct pairs');
  assert.deepEqual([...new Set(duplicates.flatMap(finding => finding.subject.files))].sort(), ['a.js', 'b.js', 'c.js']);
});

test('duplicates: a relative executable keeps its caller-relative meaning after snapshot staging', REAL, t => {
  const root = tree(t, { 'left.js': LEFT, 'right.js': RIGHT });
  const relative = path.relative(process.cwd(), path.resolve(BINARY));
  assert(scan(root, { executable: relative }).duplicates.length > 0);
});

test('duplicates: vendored copies are reported as outside the C6 scan', REAL, t => {
  const root = tree(t, { 'original.js': LEFT, 'vendor/copy.js': LEFT, 'test/copy.test.js': LEFT });
  const result = scan(root);
  assert.equal(result.duplicates.length, 0);
  assert.deepEqual(result.findings.analysis.duplicates.coverage.analyzed, ['original.js']);
  assert.deepEqual(result.findings.analysis.duplicates.coverage.omitted, [{ file: 'vendor/copy.js', reason: 'vendored' }]);
  assert.equal(result.findings.analysis.duplicates.coverage.complete, false);
});
