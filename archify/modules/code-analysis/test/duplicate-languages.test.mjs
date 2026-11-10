// Opt-in acceptance against the real jscpd executable. These are authored
// source pairs and independent controls; no fixture program is executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildGraph, evaluateGraph, extractFacts, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildTask } from '../lib/task.mjs';
import { verifyTask } from '../lib/evidence.mjs';
import { baselineFrom, reviewFindings } from '../lib/review.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const BINARY = process.env.ARCHIFY_TEST_JSCPD;
const REAL = { skip: !BINARY && 'set ARCHIFY_TEST_JSCPD to a real jscpd 5.4.3 executable' };
const CODE = 'redundancy/duplicate-block';

const JAVASCRIPT = `export function finish(total, accepted) {
  return total + accepted;
}
export function summarize(values, floor) {
  let total = 0;
  let accepted = 0;
  for (const value of values) {
    if (value > floor) {
      total += value;
      accepted += 1;
    } else {
      total -= floor;
    }
  }
  if (accepted === 0) return -1;
  const average = Math.floor(total / accepted);
  if (average > 100) total = 100;
  const adjustment = average % 7;
  if (adjustment === 0) total += 1;
  return finish(total, accepted);
}
`;
const JS_CONTROL = `export function rotate(point, scale, angle) {
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
const TYPESCRIPT = JAVASCRIPT
  .replace('finish(total, accepted) {', 'finish(total: number, accepted: number) {')
  .replace('summarize(values, floor) {', 'summarize(values: number[], floor: number) {');
const PYTHON = `def finish(total, accepted):
    return total + accepted

def summarize(values, floor):
    total = 0
    accepted = 0
    for value in values:
        if value > floor:
            total += value
            accepted += 1
        else:
            total -= floor
    if accepted == 0:
        return -1
    average = total // accepted
    if average > 100:
        total = 100
    adjustment = average % 7
    if adjustment == 0:
        total += 1
    return finish(total, accepted)
`;
const JAVA = `    private static int finish(int total, int accepted) {
        return total + accepted;
    }
    private static final String LABEL = "SIDE😀"; public static int summarize(int[] values, int floor) {
        int total = 0;
        int accepted = 0;
        for (int value : values) {
            if (value > floor) {
                total += value;
                accepted += 1;
            } else {
                total -= floor;
            }
        }
        if (accepted == 0) return -1;
        int average = total / accepted;
        if (average > 100) total = 100;
        int adjustment = average % 7;
        if (adjustment == 0) total += 1;
        return finish(total, accepted);
    }
`;
const GO = `func finish(total int, accepted int) int {
    return total + accepted
}
var label = "SIDE😀"; func Summarize(values []int, floor int) int {
    total := 0
    accepted := 0
    for _, value := range values {
        if value > floor {
            total += value
            accepted += 1
        } else {
            total -= floor
        }
    }
    if accepted == 0 { return -1 }
    average := total / accepted
    if average > 100 { total = 100 }
    adjustment := average % 7
    if adjustment == 0 { total += 1 }
    return finish(total, accepted)
}
`;
const RUST = `fn finish(total: i32, accepted: i32) -> i32 {
    total + accepted
}
const LABEL: &str = "SIDE😀"; pub fn summarize(values: &[i32], floor: i32) -> i32 {
    let mut total = 0;
    let mut accepted = 0;
    for &value in values {
        if value > floor {
            total += value;
            accepted += 1;
        } else {
            total -= floor;
        }
    }
    if accepted == 0 { return -1; }
    let average = total / accepted;
    if average > 100 { total = 100; }
    let adjustment = average % 7;
    if adjustment == 0 { total += 1; }
    finish(total, accepted)
}
`;

const SAMPLES = [
  {
    name: 'JavaScript', language: 'ts', left: 'left.mjs', right: 'right.mjs', control: 'negative.mjs',
    files: {
      'left.mjs': 'const north = "北😀";\n' + JAVASCRIPT,
      'right.mjs': 'const south = "南🦀";\n' + JAVASCRIPT,
      'negative.mjs': JS_CONTROL,
    },
  },
  {
    name: 'TypeScript', language: 'ts', left: 'left.ts', right: 'right.ts', control: 'negative.ts',
    files: {
      'left.ts': 'const north = "北😀";\n' + TYPESCRIPT,
      'right.ts': 'const south = "南🦀";\n' + TYPESCRIPT,
      'negative.ts': JS_CONTROL.replace('point, scale, angle', 'point: { x: number; y: number }, scale: number, angle: number'),
    },
  },
  {
    name: 'Python', language: 'py', left: 'left.py', right: 'right.py', control: 'negative.py',
    files: {
      'left.py': 'north = "北😀"\n' + PYTHON,
      'right.py': 'south = "南🦀"\n' + PYTHON,
      'negative.py': `def decorate(records, prefix):
    labels = {}
    for index, record in enumerate(records):
        key = str(record.get('id', index))
        value = str(record.get('name', 'unknown')).strip().upper()
        labels[key] = prefix + ':' + value
    keys = sorted(labels, reverse=True)
    result = '|'.join(labels[key] for key in keys)
    return result.encode('utf-8').hex()
`,
    },
  },
  {
    name: 'Java', language: 'java', left: 'left/Left.java', right: 'right/Right.java', control: 'control/Negative.java', crlf: true,
    files: {
      'left/Left.java': 'package left;\npublic class Left {\n' + JAVA.replace('SIDE', '左') + '}\n',
      'right/Right.java': 'package right;\npublic class Right {\n' + JAVA.replace('SIDE', '右') + '}\n',
      'control/Negative.java': `package control;
public class Negative {
    public static String decorate(String text) {
        StringBuilder output = new StringBuilder();
        for (int index = text.length() - 1; index >= 0; index--) {
            char symbol = text.charAt(index);
            if (Character.isWhitespace(symbol)) output.append('_');
            else output.append(Character.toUpperCase(symbol));
        }
        output.append(':').append(text.length());
        return output.reverse().toString();
    }
}
`,
    },
  },
  {
    name: 'Go', language: 'go', left: 'left/copy.go', right: 'right/copy.go', control: 'control/negative.go', crlf: true,
    files: {
      'go.mod': 'module example.org/c6languages\n\ngo 1.18\n',
      'left/copy.go': 'package left\n' + GO.replace('SIDE', '左'),
      'right/copy.go': 'package right\n' + GO.replace('SIDE', '右'),
      'control/negative.go': `package control
func Decorate(values map[string]string, prefix string) string {
    output := prefix + ":"
    for key, text := range values {
        if len(key) == 0 { continue }
        output += key + "=" + text + ";"
    }
    size := len(output)
    if size > 48 { output = output[:48] }
    if size < 4 { output += "empty" }
    return "[" + output + "]"
}
`,
    },
  },
  {
    name: 'Rust', language: 'rust', left: 'src/left.rs', right: 'src/right.rs', control: 'src/negative.rs', crlf: true,
    expectedOmissions: [{ file: 'src/lib.rs', reason: 'not-reported-by-engine' }],
    files: {
      'Cargo.toml': '[package]\nname = "c6-six-languages"\nversion = "0.0.0"\nedition = "2021"\n',
      'Cargo.lock': 'version = 3\n\n[[package]]\nname = "c6-six-languages"\nversion = "0.0.0"\n',
      'src/lib.rs': 'pub mod left;\npub mod right;\npub mod negative;\n',
      'src/left.rs': RUST.replace('SIDE', '左'),
      'src/right.rs': RUST.replace('SIDE', '右'),
      'src/negative.rs': `pub fn decorate(bytes: &[u8], prefix: &str) -> String {
    let mut output = String::from(prefix);
    for (index, byte) in bytes.iter().enumerate() {
        if index > 12 { break; }
        output.push_str(&format!("{:02x}", byte));
    }
    let remaining = bytes.len().saturating_sub(12);
    if remaining > 0 { output.push_str("..."); }
    output.push(':');
    output.push_str(&remaining.to_string());
    output
}
`,
    },
  },
];

function fixture(t, sample) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-c6-six-languages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sample.files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), sample.crlf && /\.(?:java|go|rs)$/.test(file) ? text.replaceAll('\n', '\r\n') : text);
  }
  return root;
}

function scan(root, language) {
  const config = mergeConfig(loadConfig(null), {
    include: ['**'], exclude: [], modules: { excludeRoles: [] },
    go: { stdlib: false, tests: false }, rust: { offline: true, tests: false },
    duplicates: { enabled: true, executable: path.resolve(BINARY), minTokens: 50, minLines: 5, identifiers: 'exact' },
  });
  const { facts } = extractFacts(root, { language, config });
  assert.deepEqual(facts.parse_errors || [], [], 'the real language extractor accepted the authored source');
  const captured = structuredClone(facts);
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts);
  assert.deepEqual(facts, captured, 'C6 preserves captured source, functions, calls and language metadata');
  return { facts, findings, duplicates: findings.diagnostics.filter(finding => finding.code === CODE) };
}

function checkRange(location, source) {
  assert(Number.isInteger(location.start) && Number.isInteger(location.end));
  assert(location.start >= 0 && location.end > location.start && location.end <= source.length);
  const before = source.slice(0, location.start).split('\n');
  const through = source.slice(0, location.end).split('\n');
  assert.equal(location.line, before.length);
  assert.equal(location.endLine, through.length);
  assert.equal(location.column, before.at(-1).length + 1, 'finding columns count UTF-16 source units');
  assert.equal(location.endColumn, through.at(-1).length + 1);
  const text = source.slice(location.start, location.end);
  assert.match(text, /total \+= value/, 'the range includes the authored repeated algorithm');
  assert.match(text, /finish\(total, accepted\)/);
  assert.notEqual(Buffer.byteLength(source.slice(0, location.start), 'utf8'), location.start,
    'a byte offset used directly as a JS string offset would not locate this Unicode source');
}

for (const sample of SAMPLES) {
  test(`duplicates: ${sample.name} keeps real pairs, source facts and two-sided task evidence`, REAL, t => {
    const root = fixture(t, sample);
    const before = scan(root, sample.language);
    const sourceFiles = Object.keys(sample.files).filter(file => /\.(?:mjs|ts|py|java|go|rs)$/.test(file)).sort();
    assert.deepEqual(before.facts.files.map(file => file.path).sort(), sourceFiles);
    assert.deepEqual(before.findings.analysis.duplicates.engine, { name: 'jscpd', version: '5.4.3', adapterRevision: 2 });
    const coverage = before.findings.analysis.duplicates.coverage;
    const expectedOmissions = sample.expectedOmissions || [];
    const omittedFiles = new Set(expectedOmissions.map(row => row.file));
    assert.equal(coverage.complete, expectedOmissions.length === 0);
    assert.deepEqual(coverage.selected, sourceFiles);
    assert.deepEqual(coverage.analyzed, sourceFiles.filter(file => !omittedFiles.has(file)));
    assert.deepEqual(coverage.omitted, expectedOmissions);
    assert(before.facts.calls.some(call => call.file === sample.left && call.target?.name === 'finish'),
      'the standard language call extractor still supplies a real same-file target');
    assert(before.duplicates.length > 0, 'the real engine finds the authored A/B repetition');
    assert(before.duplicates.every(finding => !finding.subject.files.includes(sample.control)),
      'the independently authored control is analyzed without being called a duplicate');
    const duplicate = before.duplicates.find(finding => {
      const pair = [...finding.subject.files].sort();
      return pair.length === 2 && pair.includes(sample.left) && pair.includes(sample.right);
    });
    assert(duplicate, 'one real pair covers both complete authored algorithm excerpts');
    assert.equal(duplicate.subject.locations.length, 2);
    for (const location of duplicate.subject.locations) {
      const source = before.facts.files.find(file => file.path === location.file).sourceText;
      assert.equal(source, fs.readFileSync(path.join(root, location.file), 'utf8'));
      if (sample.crlf) assert(source.includes('\r\n'), 'Java/Go/Rust retain original CRLF capture');
      checkRange(location, source);
    }
    const task = buildTask({ findings: before.findings, facts: before.facts, ids: [duplicate.id] });
    assert.deepEqual(task.scope.modify, [sample.left, sample.right].sort());
    assert.equal(task.locations.length, 2);
    assert.deepEqual(schemaErrors('ai-task', task), []);
    assert.equal(verifyTask(task, root).evidence.status, 'valid');

    // The evidence/review lifecycle is shared. Exercise it once on a newly
    // supported language rather than repeating re-analysis for every parser.
    if (sample.language !== 'java') return;
    const baseline = baselineFrom([duplicate], { reason: 'Review these two intentional copies together.' });
    const newline = '\r\n';
    for (const file of [sample.left, sample.right]) {
      fs.writeFileSync(path.join(root, file), '// unrelated preface 😀' + newline + newline + fs.readFileSync(path.join(root, file), 'utf8'));
    }
    const moved = verifyTask(task, root);
    assert.equal(moved.evidence.status, 'valid');
    for (const location of moved.locations) assert.equal(location.currentStartLine, location.startLine + 2);
    const relocated = scan(root, sample.language);
    assert(relocated.duplicates.some(finding => finding.id === duplicate.id), 'moving both source ranges preserves the finding identity');
    const accepted = reviewFindings(relocated.findings.diagnostics, {
      baseline, previous: before.findings, analysis: relocated.findings.analysis,
      files: relocated.facts.files.map(file => file.path),
    });
    assert(accepted.baseline.accepted.includes(duplicate.id));
    assert.equal(accepted.comparison.comparable, true);
    assert.equal(accepted.findings[duplicate.id].since, 'unchanged');

    const replacement = `package right;
public class Right {
    public static int checksum(int[] bytes, int seed) {
        int mixed = seed ^ 0x45d9f3b;
        for (int index = bytes.length - 1; index >= 0; index--) {
            mixed = (mixed << 5) | (mixed >>> 27);
            mixed ^= bytes[index] * (index + 17);
            if ((mixed & 255) == 0) mixed ^= 0x7f4a7c15;
        }
        mixed ^= bytes.length << 11;
        mixed *= 31;
        return mixed ^ (mixed >>> 16);
    }
}
`;
    fs.writeFileSync(path.join(root, sample.right), replacement.replaceAll('\n', newline));
    const changed = verifyTask(task, root);
    assert.equal(changed.evidence.status, 'changed');
    assert.equal(changed.locations.find(location => location.file === sample.left).status, 'valid');
    const after = scan(root, sample.language);
    assert.equal(after.duplicates.length, 0, 'the replacement and independent control share no authored duplicate block');
    const review = reviewFindings(after.findings.diagnostics, {
      baseline, previous: relocated.findings, analysis: after.findings.analysis,
      files: after.facts.files.map(file => file.path),
    });
    assert.equal(review.comparison.comparable, true);
    assert(review.comparison.notDetected.some(finding => finding.id === duplicate.id));
    assert(review.baseline.stale.some(finding => finding.id === duplicate.id));
  });
}
