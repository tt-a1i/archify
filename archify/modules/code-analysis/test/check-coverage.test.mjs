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
import { selectAdapter } from '../extract/index.mjs';
import { loadConfig } from '../lib/analysis.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check.mjs');
const ARCHIFY = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));

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

function prepare(root, out, args = []) {
  return spawnSync(process.execPath, [ARCHIFY, 'code-analysis', 'prepare', root, '--out', out, ...args],
    { encoding: 'utf8', timeout: 60000 });
}

test('prepare: a dominant adapter is selected and the workbench discloses other languages', (t) => {
  const root = fixture(t, {
    ...Object.fromEntries(Array.from({ length: 38 }, (_, i) => [`src/file${i}.ts`, 'export const value = 1;'])),
    'helpers/script.py': 'value = 1',
    'helpers/tool.rs': 'fn main() {}',
  });
  const out = path.join(root, 'out');
  const automatic = prepare(root, out);
  assert.equal(automatic.status, 0, automatic.stdout + automatic.stderr);
  const receipt = JSON.parse(automatic.stdout);
  const expected = [{ adapter: 'py', files: 1 }, { adapter: 'rust', files: 1 }];
  assert.deepEqual(receipt.summary.coverage.otherLanguages, expected);
  const facts = JSON.parse(fs.readFileSync(path.join(out, 'analysis', 'raw-facts.json'), 'utf8'));
  assert.equal(facts.repository.language, 'ts');
  const overview = JSON.parse(fs.readFileSync(path.join(out, 'analysis', 'overview.json'), 'utf8'));
  assert.deepEqual(overview.coverage.otherLanguages, expected);

  const explicit = check(root, ['--language', 'py', '--json']);
  assert.equal(explicit.status, 0, explicit.stdout + explicit.stderr);
  assert.deepEqual(JSON.parse(explicit.stdout).coverage.otherLanguages, [
    { adapter: 'ts', files: 38 }, { adapter: 'rust', files: 1 },
  ]);

  fs.unlinkSync(path.join(root, 'src/file37.ts'));
  const mixed = check(root, ['--json']);
  assert.equal(mixed.status, 2, mixed.stdout + mixed.stderr);
  assert.equal(JSON.parse(mixed.stdout).diagnostics[0].code, 'extract/adapter-ambiguous');
});

for (const [language, extension, source, manifest, manifestText, missingCode] of [
  ['go', 'go', 'package backend', 'go.mod', 'module example.test/backend\n', 'extract/go-module-missing'],
  ['rust', 'rs', 'pub fn run() {}', 'Cargo.toml', '[package]\nname = "backend"\nversion = "0.1.0"\n', 'extract/rust-manifest-missing'],
]) {
  test(`check: ${language} dominance requires a manifest at the analysis root`, (t) => {
    const root = fixture(t, {
      ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`backend/src/file${i}.${extension}`, source])),
      [`backend/${manifest}`]: manifestText,
      'frontend/index.ts': 'export const value = 1;',
    });

    const automatic = check(root, ['--json']);
    assert.equal(automatic.status, 2, automatic.stdout + automatic.stderr);
    const [diagnostic] = JSON.parse(automatic.stdout).diagnostics;
    assert.equal(diagnostic.code, 'extract/adapter-ambiguous');
    assert.ok(diagnostic.supportedFixes.includes('pass --language ts (1 file)'));

    const explicit = check(root, ['--language', language, '--json']);
    assert.equal(explicit.status, 2, explicit.stdout + explicit.stderr);
    assert.equal(JSON.parse(explicit.stdout).diagnostics[0].code, missingCode);

    const alternate = check(root, ['--language', 'ts', '--json']);
    assert.equal(alternate.status, 0, alternate.stdout + alternate.stderr);
    assert.deepEqual(JSON.parse(alternate.stdout).coverage.otherLanguages, [{ adapter: language, files: 19 }]);

    const config = loadConfig();
    const wrongCase = path.join(root, manifest.toUpperCase());
    fs.writeFileSync(wrongCase, manifestText);
    assert.throws(() => selectAdapter(root, config), error => error.diagnostics?.[0].code === 'extract/adapter-ambiguous');
    fs.unlinkSync(wrongCase);
    fs.renameSync(path.join(root, 'backend', manifest), path.join(root, manifest));
    assert.equal(selectAdapter(root, config).id, language);
  });
}

test('prepare: an unresolved TypeScript config names the dependency and a working exclusion', (t) => {
  const root = fixture(t, {
    'src/main.ts': 'export const main = 1;',
    'website/index.ts': 'export const website = 1;',
    'website/tsconfig.json': '{"extends":"missing-framework/tsconfigs/strict"}',
    'analysis-config.json': '{"exclude":["website/**"]}',
  });
  const out = path.join(root, 'out');
  const result = prepare(root, out);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const [diagnostic] = JSON.parse(result.stdout).diagnostics;
  assert.equal(diagnostic.code, 'extract/tsconfig-invalid');
  assert.equal(diagnostic.subject.file, path.join(root, 'website/tsconfig.json'));
  assert.match(diagnostic.message, /website\/tsconfig\.json.*missing-framework\/tsconfigs\/strict/);
  assert.ok(diagnostic.evidence.errors.some(error => error.includes('missing-framework/tsconfigs/strict')));
  assert.ok(diagnostic.supportedFixes.some(fix => fix.includes("install the target project's dependencies")));
  assert.ok(diagnostic.supportedFixes.some(fix => fix.includes('exclude') && fix.includes('"website/**"') && fix.includes('--config')));
  assert.ok(diagnostic.supportedFixes.some(fix => fix.includes('<repo-root>')));
  assert.ok(!fs.existsSync(path.join(out, 'analysis')));

  const repaired = prepare(root, out, ['--config', path.join(root, 'analysis-config.json')]);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  const facts = JSON.parse(fs.readFileSync(path.join(out, 'analysis', 'raw-facts.json'), 'utf8'));
  assert.deepEqual(facts.files.map(file => file.path), ['src/main.ts']);
});

test('check: terminal diagnostics escape controls in a TypeScript config error', (t) => {
  const missingConfig = 'missing-framework/strict\tconfig';
  const root = fixture(t, {
    'main.ts': 'export const value = 1;',
    'tsconfig.json': JSON.stringify({ extends: missingConfig }),
  });
  const text = check(root, []);
  assert.equal(text.status, 2, text.stdout + text.stderr);
  assert.match(text.stderr, /\[extract\/tsconfig-invalid\] .*tsconfig\.json/);
  assert.ok(text.stderr.includes('missing-framework/strict\\u0009config'));
  assert.doesNotMatch(text.stderr, /\t/);

  const json = check(root, ['--json']);
  assert.equal(json.status, 2, json.stdout + json.stderr);
  const [diagnostic] = JSON.parse(json.stdout).diagnostics;
  assert.ok(diagnostic.message.includes(missingConfig));
  assert.ok(diagnostic.evidence.errors.some(error => error.includes(missingConfig)));
});

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
  assert.equal(receipt.coverage.analyzedFiles, 1);
  assert.deepEqual(receipt.coverage.otherLanguages, [{ adapter: 'java', files: 1 }]);

  const overview = JSON.parse(fs.readFileSync(path.join(out, 'overview.json'), 'utf8'));
  assert.deepEqual(receipt.coverage.parseErrors, overview.coverage.files.parseErrors);
  assert.equal(receipt.coverage.analyzedFiles, overview.coverage.files.analyzed);
  assert.deepEqual(receipt.coverage.otherLanguages, overview.coverage.otherLanguages);

  const text = check(root, ['--language', 'py']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Not analyzed, parse failed: src\/broken\.py/);
  assert.match(text.stdout, /Not analyzed, other language: 1 java/);
});

test('check: a retained TypeScript source with only recovery facts is excluded from analyzed coverage', (t) => {
  const root = fixture(t, { 'src/broken.ts': 'export const broken = ;\n' });
  const out = path.join(root, 'out');
  const args = ['--language', 'ts', '--out', out];
  const result = check(root, [...args, '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  const overview = JSON.parse(fs.readFileSync(path.join(out, 'overview.json'), 'utf8'));
  assert.equal(receipt.files, 1, 'the source is still captured');
  assert.equal(receipt.verdict, 'none-found');
  const { languageScope, ...coverage } = receipt.coverage;
  assert.deepEqual(coverage, { parseErrors: ['src/broken.ts'], analyzedFiles: 0, otherLanguages: [] });
  assert.equal(languageScope.language, 'ts');
  assert.deepEqual(languageScope.projects.flatMap(project => project.files), ['src/broken.ts']);
  assert.equal(overview.coverage.files.analyzed, 0);
  assert.match(formatText(receipt), /Graph\/rule scope: 0 source files analyzed/);
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
      analyzedFiles: 1,
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
    ambiguousModules: [],
    offDiagramFindings: 1,
    undeclaredEdges: [{ from: 'app', to: 'auth', weight: 1, sample: 'src/app/main.py:1' }],
  });

  const failed = check(root, ['--language', 'py', '--config', config, '--ir', ir, '--json']);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  const failingReceipt = JSON.parse(failed.stdout);
  assert.ok(failingReceipt.gate.adopt, 'baseline guidance also accompanies a diagram-aligned failed gate');
  assert.deepEqual(failingReceipt.diagram, receipt.diagram);
  assert.deepEqual(failingReceipt.investigation.architecture, receipt.investigation.architecture);
  assert.deepEqual(failingReceipt.coverage, receipt.coverage);

  const text = check(root, ['--language', 'py', '--config', config, '--ir', ir, '--fail-on', 'never']);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /Diagram alignment: 2\/3 components mapped · 1 unmapped module · 1 finding off diagram/);
  assert.match(text.stdout, /undeclared component imports: app -> auth \(1\)/);
});

test('check: shared module sources report ambiguity without inventing a component import', (t) => {
  const root = fixture(t, {
    'src/client/index.mjs': 'import { a } from "../shared/a.mjs";\nexport const run = a;\n',
    'src/shared/a.mjs': 'export const a = 1;\n',
    'src/shared/b.mjs': 'export const b = 2;\n',
  });
  const ir = path.join(root, 'architecture.json');
  const components = [
    { id: 'client', sources: [{ path: 'src/client/index.mjs' }] },
    { id: 'a', sources: [{ path: 'src/shared/a.mjs' }] },
    { id: 'b', sources: [{ path: 'src/shared/b.mjs' }] },
  ];
  for (const order of [components, [components[0], components[2], components[1]]]) {
    fs.writeFileSync(ir, JSON.stringify({ diagram_type: 'architecture', components: order, connections: [{ from: 'client', to: 'a' }] }));
    const json = check(root, ['--language', 'ts', '--ir', ir, '--fail-on', 'never', '--json']);
    assert.equal(json.status, 0, json.stdout + json.stderr);
    const diagram = JSON.parse(json.stdout).diagram;
    assert.deepEqual(diagram.undeclaredEdges, []);
    assert.deepEqual(diagram.ambiguousModules, [{ id: 'src-shared', components: ['a', 'b'] }]);
  }
  const text = check(root, ['--language', 'ts', '--ir', ir, '--fail-on', 'never']);
  assert.match(text.stdout, /ambiguous component mapping: src-shared \(a, b\)/);
});

test('check --ir rejects malformed source references with actionable schema diagnostics', t => {
  const root = fixture(t, { 'src/cli/main.mjs': 'export const main = 1;\n' });
  const ir = path.join(root, 'architecture.json');
  for (const [sources, code, pointer] of [
    [['src/cli'], 'schema/type', '/components/0/sources/0'],
    [[{}], 'schema/required', '/components/0/sources/0'],
    [[{ path: 'src/cli', line: '1' }], 'schema/type', '/components/0/sources/0/line'],
    [[], 'schema/minItems', '/components/0/sources'],
    [[{ path: 'src/cli', endLine: 3 }], 'schema/additionalProperties', '/components/0/sources/0'],
  ]) {
    fs.writeFileSync(ir, JSON.stringify({ diagram_type: 'architecture', components: [{ id: 'cli', sources }] }));
    const result = check(root, ['--language', 'ts', '--ir', ir, '--fail-on', 'never', '--json']);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const diagnostic = JSON.parse(result.stdout).diagnostics.find(d => d.code === code);
    assert.equal(diagnostic?.subject.path, pointer);
    assert.ok(diagnostic.supportedFixes.length);
  }
  fs.writeFileSync(ir, JSON.stringify({ diagram_type: 'architecture', components: [{ id: 'cli', sources: [{ path: 'src/cli' }] }] }));
  const repaired = check(root, ['--language', 'ts', '--ir', ir, '--fail-on', 'never', '--json']);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.equal(JSON.parse(repaired.stdout).diagram.mappedComponents, 1);
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
  assert.deepEqual(err.diagnostics[0].supportedFixes, ['pass --language py (4 files)', 'pass --language ts (1 file)']);

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

test('architecture reading order puts substantial imported source ahead of a highly connected small script', t => {
  const root = fixture(t, {
    'src/server/main.mjs': 'export const server = 1;\n' + '// source context\n'.repeat(100),
    'src/shared/value.mjs': 'export const value = 1;\n' + '// shared context\n'.repeat(60),
    'scripts/build.mjs': "import '../src/server/main.mjs';\nimport '../src/shared/value.mjs';\nimport '../client/page/main.mjs';\n",
    'client/page/main.mjs': "import '../../src/server/main.mjs';\nimport '../../src/shared/value.mjs';\n",
  });
  const result = check(root, ['--language', 'ts', '--fail-on', 'never', '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const architecture = JSON.parse(result.stdout).investigation.architecture;
  assert.equal(architecture.hotspots[0].id, 'src-server');
  assert.equal(architecture.hotspots[1].id, 'src-shared');
  assert.ok(architecture.hotspots.findIndex(m => m.id === 'scripts') > 1);
  assert.ok(architecture.hotspots.every(m => Number.isFinite(m.readingWeight)));
  assert.match(architecture.hotspotRanking, /not inferred business importance/);
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
