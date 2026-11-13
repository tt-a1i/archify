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
  assert.equal(receipt.counts.offDiagram, null, 'without --ir no finding is claimed to be off a diagram');
});

test('check: --ir aligns findings and modules with architecture components and reports undeclared edges', (t) => {
  const root = fixture(t, {
    'src/app/main.py': 'from src.auth import token\n\ndef run(x):\n    if x:\n        return token.issue()\n    return None\n',
    'src/auth/token.py': 'def issue():\n    return "ok"\n',
    'tools/orphan.py': 'def helper(x):\n    if x:\n        return 1\n    return 0\n',
  });
  const ir = path.join(root, 'architecture.json');
  fs.writeFileSync(ir, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'demo', output: 'architecture.html' },
    components: [
      { id: 'app', type: 'backend', label: 'App', sources: [{ path: './src/app/' }] },
      { id: 'auth', type: 'security', label: 'Auth', sources: [{ path: 'src/auth' }] },
      { id: 'external-idp', type: 'external', label: 'IdP' },
    ],
    connections: [],
  }));
  const config = path.join(root, 'analysis.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { warning: { complexity: 0 } } } } }));

  assert.equal(check(root, ['--language', 'py', '--map', ir]).status, 2, '--map without --ir is rejected');

  const json = check(root, ['--language', 'py', '--config', config, '--ir', ir, '--fail-on', 'never', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.counts.offDiagram, 1, 'only the unmapped tools/orphan.py finding is off the diagram');
  assert.deepEqual(receipt.diagram, {
    components: 3,
    mappedComponents: 2,
    emptyComponents: ['external-idp'],
    unmappedModules: ['tools'],
    offDiagramFindings: 1,
    undeclaredEdges: [{ from: 'app', to: 'auth', weight: 1, sample: 'src/app/main.py:1' }],
  });

  const text = check(root, ['--language', 'py', '--config', config, '--ir', ir, '--fail-on', 'never']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Diagram alignment: 2\/3 components mapped · 1 unmapped module · 1 finding off diagram/);
  assert.match(text.stdout, /undeclared component imports: app -> auth \(1\)/);
});

test('check: role exclusions and ambiguous-language file counts are visible on first contact', (t) => {
  const root = fixture(t, {
    'src/app.py': 'value = 1\n',
    'src/extra.py': 'value = 2\n',
    'tests/test_app.py': 'def test_ok():\n    assert True\n',
    'vendor/bundled.py': 'bundled = True\n',
    'scripts/helper.ts': 'export const helper = 1;\n',
  });

  const ambiguous = check(root, ['--json']);
  assert.equal(ambiguous.status, 2);
  const err = JSON.parse(ambiguous.stdout);
  assert.equal(err.diagnostics[0].code, 'extract/adapter-ambiguous');
  assert.deepEqual(err.diagnostics[0].evidence.counts, [
    { adapter: 'py', files: 4 },
    { adapter: 'ts', files: 1 },
  ]);
  assert.equal(err.diagnostics[0].supportedFixes[0], 'pass --language py (4 files)');

  const pyJson = check(root, ['--language', 'py', '--json']);
  assert.equal(pyJson.status, 0, pyJson.stdout + pyJson.stderr);
  const receipt = JSON.parse(pyJson.stdout);
  assert.equal(receipt.files, 4);
  assert.equal(receipt.coverage.analyzedFiles, 2);
  assert.equal(receipt.coverage.excludedByRole, 2);
  assert.deepEqual(receipt.coverage.excludedRoleCounts, { generated: 1, test: 1 });

  const pyText = check(root, ['--language', 'py']);
  assert.equal(pyText.status, 0, pyText.stdout + pyText.stderr);
  assert.match(pyText.stdout, /Graph\/rule scope: 2 source files analyzed, 2 excluded by role \(1 generated, 1 test\)/);
});

test('check: investigation.architecture surfaces module topology and structural signals outside top complexity leads', (t) => {
  const root = fixture(t, {
    'src/app/a.py': 'from src.core import secret\n\ndef fa(x):\n    if x:\n        return secret.TOKEN\n    return ""\n',
    'src/app/b.py': 'def fb(x):\n    if x:\n        return 1\n    return 0\n',
    'src/app/c.py': 'def fc(x):\n    if x:\n        return 2\n    return 0\n',
    'src/core/__init__.py': 'PUBLIC = True\n',
    'src/core/secret.py': 'TOKEN = "internal"\n',
  });
  const out = path.join(root, 'out');
  const config = path.join(root, 'analysis.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { warning: { complexity: 0 } } } } }));

  const json = check(root, ['--language', 'py', '--config', config, '--out', out, '--fail-on', 'never', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.investigation.leads.length, 3);
  assert.ok(receipt.investigation.leads.every((lead) => lead.code === 'complexity/function'));

  const arch = receipt.investigation.architecture;
  assert.equal(arch.modules, 2);
  assert.equal(arch.edges, 1);
  assert.equal(arch.hotspots.length, 2);
  assert.deepEqual(arch.strongestEdges, [{ from: 'src-app', to: 'src-core', weight: 2, sample: 'src/app/a.py:1' }]);
  assert.equal(arch.structuralSignals.length, 1);
  assert.equal(arch.structuralSignals[0].code, 'coupling/internal-leak');
  assert.equal(arch.structuralSignals[0].severity, 'info');
  assert.equal(arch.structuralSignals[0].where, 'src/app/a.py:1');
  assert.match(arch.structuralSignals[0].task, /--finding [A-Z]+-[0-9a-f]{12}$/);

  const text = check(root, ['--language', 'py', '--config', config, '--out', path.join(root, 'text-out'), '--fail-on', 'never']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Architecture signals \(outside top leads\):/);
  assert.match(text.stdout, /- info\s+coupling\/internal-leak\s+src\/app\/a\.py:1\s+\[[A-Z]+-[0-9a-f]{12}\]/);
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
