// A2: the CLI summary repeats the coverage the overview already records.
// A parse failure or a file in another language must be visible in both the
// text and the JSON receipt. Showing it does not change the gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatText } from '../bin/check.mjs';
import { buildTask } from '../lib/task.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check.mjs');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-check-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

function check(root, args) {
  return spawnSync(process.execPath, [CHECK, root, ...args], { encoding: 'utf8', timeout: 60000 });
}

test('check: the summary shows a parse failure and a language that was not analyzed', (t) => {
  const root = fixture(t, {
    'src/ok.py': 'value = 1\n',
    'src/broken.py': 'value = 1\0\n',
    'src/Note.java': 'class Note {}',
  });
  const out = path.join(root, 'out');

  const json = check(root, ['--language', 'py', '--out', out, '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.deepEqual(receipt.coverage.parseErrors, ['src/broken.py']);
  assert.deepEqual(receipt.coverage.otherLanguages, [{ adapter: 'java', files: 1 }]);

  const overview = JSON.parse(fs.readFileSync(path.join(out, 'overview.json'), 'utf8'));
  assert.deepEqual(receipt.coverage.parseErrors, overview.coverage.files.parseErrors);
  assert.deepEqual(receipt.coverage.otherLanguages, overview.coverage.otherLanguages);

  const text = check(root, ['--language', 'py']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Not analyzed, parse failed: src\/broken\.py/);
  assert.match(text.stdout, /Not analyzed, other language: 1 java/);
});

test('check: a clean run says nothing about coverage and the gate is unchanged', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n' });
  const json = check(root, ['--language', 'py', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.deepEqual(receipt.coverage, { parseErrors: [], otherLanguages: [] });
  assert.equal(receipt.status, 'ok');

  const text = check(root, ['--language', 'py']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.doesNotMatch(text.stdout, /Not analyzed/);
});

test('check: threshold errors stay errors and partial coverage does not change the finding gate', (t) => {
  const root = fixture(t, {
    'src/ok.py': 'def answer():\n    return 42\n',
    'src/broken.py': 'value = 1\0\n',
    'src/Note.java': 'class Note {}',
  });
  const config = path.join(root, 'analysis.json');
  const configure = (complexity) => fs.writeFileSync(config, JSON.stringify({
    rules: { complexity: { function: { warning: { complexity } } } },
  }));
  const args = ['--language', 'py', '--config', config, '--json'];
  configure('oops');
  const invalid = check(root, [...args, '--fail-on', 'never']);
  assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr);
  const error = JSON.parse(invalid.stdout);
  assert.equal(error.status, 'error');
  assert.equal(error.diagnostics[0].code, 'config/threshold-invalid');

  configure(0);
  for (const [failOn, exit] of [['warning', 1], ['never', 0]]) {
    const result = check(root, [...args, '--fail-on', failOn]);
    assert.equal(result.status, exit, result.stdout + result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.ok(receipt.counts.warning > 0, 'the valid zero threshold still reports the function');
    assert.deepEqual(receipt.coverage, {
      parseErrors: ['src/broken.py'],
      otherLanguages: [{ adapter: 'java', files: 1 }],
    });
  }
});

test('check: investigation leads carry the message, location and a task command', (t) => {
  const root = fixture(t, { 'src/app.py': 'def f(x):\n    if x:\n        return 1\n    return 0\n' });
  const out = path.join(root, 'out');
  const config = path.join(root, 'analysis.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { warning: { complexity: 0 } } } } }));

  const json = check(root, ['--language', 'py', '--config', config, '--out', out, '--json']);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.investigation.leads.length, receipt.priorities.length);
  const lead = receipt.investigation.leads[0];
  assert.equal(lead.id, receipt.priorities[0]);
  assert.equal(lead.where, 'src/app.py:1');
  assert.match(lead.message, /maintenance signal, not a defect/);
  assert.match(lead.task, /--finding COMP-[0-9a-f]{12}$/);
  assert.match(lead.task, /--format json /);
  assert.equal(receipt.investigation.shell, process.platform === 'win32' ? 'cmd.exe' : 'POSIX sh');
  assert.match(receipt.investigation.drillDown, /--finding ['"]<id>['"]/);
  assert.deepEqual(receipt.ruleCounts, [{ code: 'complexity/function', severity: 'warning', count: 1 }]);

  const overview = JSON.parse(fs.readFileSync(path.join(out, 'overview.json'), 'utf8'));
  assert.deepEqual(overview.investigation.leads.map((l) => l.id), receipt.priorities);
  assert.equal(overview.investigation.leads[0].where, 'src/app.py:1');

  const text = check(root, ['--language', 'py', '--config', config, '--out', path.join(root, 'text-out')]);
  assert.match(text.stdout, /Start here: 1 ranked lead\./);
  assert.match(text.stdout, /Drill down \((?:cmd\.exe|POSIX sh)\): node .*code-analysis task /);

  const noOut = check(root, ['--language', 'py', '--config', config]);
  assert.match(noOut.stdout, /Re-run with --out <dir>/);
});

function textWithParseError(parseError) {
  return formatText({
    verdict: 'ok',
    counts: { findings: 0, error: 0, warning: 0, info: 0, accepted: 0 },
    language: 'py',
    files: 1,
    rules: [],
    coverage: { parseErrors: [parseError], otherLanguages: [] },
    review: {},
    staleBaseline: [],
    status: 'ok',
    gate: { failOn: 'warning', newOnly: false, failing: [] },
  });
}

test('check: the text summary escapes control characters in parse-failure paths', () => {
  const text = textWithParseError('src/\u001b[2Jbroken.py');
  assert.match(text, /src\/\\u001b\[2Jbroken\.py/);
  assert.doesNotMatch(text, /\u001b/);
});

test('check: parse paths with literal escapes remain distinct from control characters', () => {
  const controlCharacter = textWithParseError('src/bad\n.py');
  const literalEscape = textWithParseError('src/bad\\u000a.py');
  assert.match(controlCharacter, /src\/bad\\u000a\.py/);
  assert.match(literalEscape, /src\/bad\\\\u000a\.py/);
  assert.notEqual(controlCharacter, literalEscape);
});

test('check: imports bounded SARIF findings without running the external tool', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n' });
  const sarif = path.join(root, 'results.sarif');
  fs.writeFileSync(sarif, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'ruff' } }, results: [{ ruleId: 'X001', level: 'error', message: { text: 'review this' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/ok.py' }, region: { startLine: 1 } } }] }] }] }));
  const json = check(root, ['--language', 'py', '--sarif', sarif, '--json']);
  assert.equal(json.status, 1, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.gate.failing[0].code, 'external/ruff');
  assert.equal(receipt.gate.failing[0].severity, 'warning');
  assert.equal(receipt.rules.includes('external/ruff'), true);
});

test('check: digit-bearing SARIF tool names still produce a schema-valid combined document', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n' });
  const sarif = path.join(root, 'results.sarif');
  const out = path.join(root, 'out');
  fs.writeFileSync(sarif, JSON.stringify({
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'tool2' } },
      results: [{
        ruleId: 'X001',
        message: { text: 'review this' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/ok.py' }, region: { startLine: 1 } } }],
      }],
    }],
  }));

  const run = check(root, ['--language', 'py', '--sarif', sarif, '--out', out, '--fail-on', 'never', '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const findings = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
  assert.deepEqual(schemaErrors('findings', findings), []);
  const finding = findings.diagnostics.find((item) => item.evidence.tool === 'tool2');
  assert.ok(finding, 'the original tool identity remains visible in the evidence');
  assert.match(finding.code, /^external\/[a-z-]+$/);
});

test('check: imports native ESLint and Ruff JSON without executing either tool', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n', 'src/app.js': 'alert(1)\n' });
  const eslint = path.join(root, 'eslint.json');
  fs.writeFileSync(eslint, JSON.stringify([{ filePath: path.join(root, 'src/app.js'), messages: [{ ruleId: 'no-alert', severity: 2, message: 'Avoid alert', line: 1, column: 1 }] }]));
  const eslintRun = check(root, ['--language', 'py', '--eslint', eslint, '--json']);
  assert.equal(eslintRun.status, 1, eslintRun.stdout + eslintRun.stderr);
  const eslintReceipt = JSON.parse(eslintRun.stdout);
  assert.equal(eslintReceipt.gate.failing[0].code, 'external/eslint');
  const ruff = path.join(root, 'ruff.json');
  fs.writeFileSync(ruff, JSON.stringify([{ filename: 'src/ok.py', code: 'F401', message: 'unused import', location: { row: 1, column: 1 } }]));
  const ruffRun = check(root, ['--language', 'py', '--ruff', ruff, '--json']);
  assert.equal(ruffRun.status, 1, ruffRun.stdout + ruffRun.stderr);
  assert.equal(JSON.parse(ruffRun.stdout).gate.failing[0].code, 'external/ruff');
});

test('check: imports ESLint and Ruff together without dropping either input', (t) => {
  const root = fixture(t, { 'src/ok.py': 'value = 1\n', 'src/app.js': 'alert(1)\n' });
  const eslint = path.join(root, 'eslint.json');
  const ruff = path.join(root, 'ruff.json');
  fs.writeFileSync(eslint, JSON.stringify([{ filePath: path.join(root, 'src/app.js'), messages: [{ ruleId: 'no-alert', severity: 2, message: 'Avoid alert', line: 1, column: 1 }] }]));
  fs.writeFileSync(ruff, JSON.stringify([{ filename: 'src/ok.py', code: 'F401', message: 'unused import', location: { row: 1, column: 1 } }]));
  const run = check(root, ['--language', 'py', '--eslint', eslint, '--ruff', ruff, '--json']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.gate.failing.length, 2);
  assert.deepEqual(receipt.rules.filter((rule) => rule.startsWith('external/')), ['external/eslint', 'external/ruff']);
});

test('check: external diagnostics participate in a comparable follow-up run', (t) => {
  const root = fixture(t, { 'src/app.js': 'alert(1)\n', 'analysis config.json': '{}\n' });
  const report = path.join(root, 'external report.json');
  const config = path.join(root, 'analysis config.json');
  const out = path.join(root, 'out');
  fs.writeFileSync(report, JSON.stringify([{ filePath: path.join(root, 'src/app.js'), messages: [{ ruleId: 'no-alert', severity: 2, message: 'Avoid alert', line: 1, column: 1 }] }]));
  const first = check(root, ['--language', 'ts', '--config', config, '--eslint', report, '--out', out, '--json', '--fail-on', 'never']);
  assert.equal(first.status, 0, JSON.stringify({ error: first.error?.message, signal: first.signal, stdout: first.stdout, stderr: first.stderr }));
  const previous = path.join(out, 'findings.json');
  fs.writeFileSync(path.join(root, 'src/app.js'), 'alert(2)\n');
  const second = check(root, ['--language', 'ts', '--config', config, '--eslint', report, '--compare', previous, '--json', '--fail-on', 'never']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const receipt = JSON.parse(second.stdout);
  assert.equal(receipt.review.comparison.comparable, true);
  assert.equal(receipt.review.comparison.evidenceChanged, 1);

  const findings = JSON.parse(fs.readFileSync(previous, 'utf8'));
  const facts = JSON.parse(fs.readFileSync(path.join(out, 'raw-facts.json'), 'utf8'));
  const finding = findings.diagnostics.find((item) => item.code === 'external/eslint');
  const task = buildTask({ findings, facts, ids: [finding.id] });
  assert.equal(findings.analysis.externalDiagnostics[0].file, report);
  const command = task.verification.reanalyze.command
    .replace('archify code-analysis check', `"${process.execPath}" "${CHECK}"`)
    .replace('<repo-root>', `"${root}"`)
    .replace('<same config>', `"${config}"`)
    .replace("<this run's findings.json>", `"${previous}"`);
  const replay = spawnSync(`${command} --fail-on never --json`, { shell: true, encoding: 'utf8', timeout: 60000 });
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  assert.equal(JSON.parse(replay.stdout).review.comparison.comparable, true);
});
