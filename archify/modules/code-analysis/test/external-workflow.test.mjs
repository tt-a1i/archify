// C7 integration over real public entrypoints. Reports below are authored
// contract fixtures; separately recorded real-repository runs use actual linters.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { extractFacts, buildGraph, evaluateGraph, loadConfig } from '../lib/analysis.mjs';
import { RULES } from '../evaluate/index.mjs';
import { schemaErrors } from '../schemas/index.mjs';
import { startAnalysisView } from '../bin/serve.mjs';
import { formatText } from '../bin/check.mjs';
import { ARCHIFY_AVAILABLE } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, '..', 'bin', 'check.mjs');
const TASK = path.join(HERE, '..', 'bin', 'task.mjs');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-workflow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  const files = {
    'src/main.ts': 'export function greeting() { const unused = 1; return "hello"; }\n',
    'app/worker.py': `import os\n\nMESSAGE = "${'captured source context '.repeat(12)}"\nprint(MESSAGE)\n`,
  };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  const reports = {
    eslint: [{ filePath: 'src/main.ts', source: files['src/main.ts'], messages: [{ ruleId: 'no-unused-vars', severity: 2, message: "'unused' is assigned a value but never used.", line: 1, column: 36, endLine: 1, endColumn: 42 }] }],
    ruff: [{ code: 'F401', message: '`os` imported but unused', filename: 'app/worker.py', location: { row: 1, column: 8 }, end_location: { row: 1, column: 10 }, fix: null, url: 'https://docs.astral.sh/ruff/rules/unused-import/' }],
  };
  const sourceFiles = { eslint: ['src/main.ts'], ruff: ['app/worker.py'] };
  const manifest = (tool) => ({
    schema_version: 1, toolVersion: `fixture-${tool}-v1`, configDigest: hash(`original ${tool} configuration`),
    scope: { files: sourceFiles[tool], complete: true },
    files: Object.fromEntries(sourceFiles[tool].map((file) => [file, hash(fs.readFileSync(path.join(root, file)))])),
    command: tool === 'eslint' ? 'eslint src --format json --output-file reports/eslint.json' : 'ruff check app --output-format json --output-file reports/ruff.json', exitCode: 1,
  });
  for (const tool of ['eslint', 'ruff']) {
    write(path.join(root, `reports/${tool}.json`), reports[tool]);
    write(path.join(root, `reports/${tool}.manifest.json`), manifest(tool));
  }
  const config = {
    include: ['src/**/*.ts'], ignore: RULES.map((rule) => rule.code),
    external: { severity: 'source', sources: ['eslint', 'ruff'].map((format) => ({ id: `project-${format}`, format, file: `reports/${format}.json`, manifest: `reports/${format}.manifest.json` })) },
  };
  const configFile = path.join(dir, 'analysis.config.json');
  write(configFile, config);
  const out = path.join(dir, 'check');
  const baseline = path.join(dir, 'baseline.json');
  const args = ['--language', 'ts', '--config', configFile];
  const cli = (bin, arguments_, expected = 0) => {
    const result = spawnSync(process.execPath, [bin, ...arguments_, '--json'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, expected, `${path.basename(bin)} ${arguments_.join(' ')}\n${result.stderr}\n${result.stdout}`);
    return JSON.parse(result.stdout);
  };
  const check = (extra = [], expected = 0) => cli(CHECK, [root, ...args, ...extra], expected);
  return { dir, root, files, reports, config, configFile, out, baseline, args, cli, check, manifest };
}

test('external workflow: evaluateGraph validates combined findings and records checked sources even for valid empty reports', (t) => {
  const f = fixture(t);
  const config = loadConfig(f.configFile);
  const { facts } = extractFacts(f.root, { language: 'ts', config });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts, { root: f.root });
  assert.deepEqual(schemaErrors('findings', findings), []);
  assert.equal(findings.diagnostics.length, 2);
  assert.deepEqual([findings.summary.errors, findings.summary.warnings, findings.summary.info], [1, 1, 0]);
  assert.deepEqual(findings.externalEvidence.map((file) => file.path), ['app/worker.py']);
  assert.ok(findings.analysis.external.every((source) => source.binding === 'verified' && source.coverage.complete));
  assert.deepEqual(evaluateGraph(graph, config, facts, { root: f.root }).diagnostics.map((d) => d.id), findings.diagnostics.map((d) => d.id), 're-reading a report replaces its result rather than appending duplicates');
  for (const tool of ['eslint', 'ruff']) write(path.join(f.root, `reports/${tool}.json`), []);
  const empty = evaluateGraph(graph, config, facts, { root: f.root });
  assert.deepEqual(schemaErrors('findings', empty), []);
  assert.equal(empty.diagnostics.length, 0);
  for (const code of ['conventions/eslint', 'conventions/ruff']) {
    assert.ok(empty.rules.includes(code), `${code} ran even though it found no issue`);
    assert.equal(empty.analysis.ruleVersions[code], 1);
  }
  const checked = f.check(['--out', f.out]);
  assert.equal(checked.counts.findings, 0);
  assert.equal(checked.coverage.external.length, 2);
  assert.equal(read(path.join(f.out, 'overview.json')).coverage.rules.run.includes('conventions/ruff'), true);
  assert.match(formatText(checked), /External project-eslint: .*coverage complete \(1 declared file\).*source binding verified/);
  assert.doesNotMatch(formatText(checked), /do not establish a clean scan/);

  delete f.config.external.sources[0].manifest;
  write(f.configFile, f.config);
  const partial = f.manifest('ruff');
  partial.scope.complete = false;
  write(path.join(f.root, 'reports/ruff.manifest.json'), partial);
  const uncertain = f.check();
  assert.equal(uncertain.counts.findings, 0, 'an empty imported report keeps its coverage limitations');
  assert.match(formatText(uncertain), /External project-eslint: .*coverage unknown .*source binding unverified/);
  assert.match(formatText(uncertain), /External project-ruff: .*coverage incomplete .*source binding verified/);
  assert.match(formatText(uncertain), /Empty external reports .*do not establish a clean scan/);
  for (const external of [false, 0, '']) assert.throws(
    () => evaluateGraph(graph, { ...config, external }, facts, { root: f.root }),
    (error) => error.diagnostics?.[0]?.code === 'external/config-invalid',
    'malformed external configuration must not silently disable the import',
  );
});

test('external workflow: warning defaults preserve CLI gates and require re-review when the source policy changes', (t) => {
  const f = fixture(t);
  write(path.join(f.root, 'reports/ruff.json'), []);
  const sourceOut = path.join(f.dir, 'source-policy');
  f.check(['--out', sourceOut, '--fail-on', 'error'], 1);
  const before = read(path.join(sourceOut, 'findings.json'));
  const original = before.diagnostics[0];
  assert.equal(original.severity, 'error');
  f.check(['--baseline', f.baseline, '--accept', original.id, '--reason', 'Reviewed under explicit source severity.']);
  const baselineBefore = read(f.baseline);

  delete f.config.external.severity;
  write(f.configFile, f.config);
  const normal = f.check(['--out', f.out], 1);
  assert.deepEqual([normal.counts.error, normal.counts.warning], [0, 1], 'default fail-on warning still fails an open capped diagnostic');
  const after = read(path.join(f.out, 'findings.json'));
  assert.equal(after.diagnostics[0].severity, 'warning');
  assert.equal(after.diagnostics[0].external.originalSeverity, 2);
  assert.equal(after.diagnostics[0].id, original.id);
  assert.deepEqual(after.diagnostics[0].evidenceDigest, original.evidenceDigest);
  assert.ok(after.analysis.external.every(source => source.severityPolicy === 'warning'));
  f.check(['--fail-on', 'error']);

  f.check(['--out', f.out, '--baseline', f.baseline, '--compare', path.join(sourceOut, 'findings.json')], 1);
  const reviewed = read(path.join(f.out, 'review.json'));
  assert.equal(reviewed.findings[original.id].status, 'accepted-changed');
  assert.equal(reviewed.findings[original.id].since, 'evidence-changed');
  assert.equal(reviewed.comparison.comparable, false);
  assert.ok(reviewed.comparison.reasons.some(reason => reason.code === 'external-import-settings-changed'));
  assert.deepEqual(reviewed.comparison.notDetected, []);
  assert.deepEqual(read(f.baseline), baselineBefore, 'changing the default never silently rewrites acceptance');
  const refused = f.check(['--baseline', f.baseline, '--compare', path.join(sourceOut, 'findings.json'), '--new-only'], 2);
  assert.equal(refused.diagnostics[0].code, 'external/comparison-unverified');

  for (const [input, code] of [['{', 'external/input-not-json'], [{}, 'external/report-invalid'], [null, 'external/input-unreadable']]) {
    const reportFile = path.join(f.root, 'reports/eslint.json');
    if (input === null) fs.rmSync(reportFile);
    else if (typeof input === 'string') fs.writeFileSync(reportFile, input);
    else write(reportFile, input);
    const failed = f.check([], 2);
    assert.equal(failed.diagnostics[0].code, code, 'input failures remain analysis errors under the warning default');
  }
});

test('external workflow: check, task, explicit acceptance, revocation and changed source share one captured result', (t) => {
  const f = fixture(t);
  const first = f.check(['--out', f.out], 1);
  assert.equal(first.counts.findings, 2);
  const findings = read(path.join(f.out, 'findings.json'));
  assert.deepEqual(schemaErrors('findings', findings), []);
  const ruff = findings.diagnostics.find((d) => d.code === 'conventions/ruff');
  const eslint = findings.diagnostics.find((d) => d.code === 'conventions/eslint');
  const exported = path.join(f.dir, 'task.json');
  assert.equal(f.cli(TASK, [f.out, '--finding', ruff.id, '--root', f.root, '--format', 'json', '--out', exported, '--require-valid']).evidence, 'valid');
  const task = read(exported);
  assert.equal(task.findings[0].external.ruleId, 'F401');
  assert.match(task.locations[0].excerpt.segments[0].lines.join('\n'), /import os/);
  assert.match(task.verification.commands[0].command, /^ruff check/);

  f.check(['--baseline', f.baseline, '--accept', eslint.id], 2);
  f.check(['--baseline', f.baseline, '--accept', eslint.id, '--reason', 'Reviewed the existing convention in this integration fixture.']);
  const oneAccepted = f.check(['--out', f.out, '--baseline', f.baseline], 1);
  assert.equal(oneAccepted.counts.accepted, 1);
  assert.match(formatText(oneAccepted), /accepted error is still present: .*the finding remains/);
  const baselineBefore = fs.readFileSync(f.baseline, 'utf8');
  assert.equal(f.check(['--baseline', f.baseline, '--update-baseline'], 2).diagnostics[0].code, 'baseline/reason-required');
  assert.equal(fs.readFileSync(f.baseline, 'utf8'), baselineBefore);
  f.check(['--baseline', f.baseline, '--update-baseline', '--reason', 'Reviewed both source claims; retain until follow-up.']);
  const accepted = f.check(['--out', f.out, '--baseline', f.baseline]);
  assert.equal(accepted.counts.accepted, 2);
  assert.ok(read(f.baseline).accepted.every((entry) => /^[0-9a-f]{64}$/.test(entry.externalReviewDigest)));

  fs.rmSync(path.join(f.root, 'reports/ruff.json'));
  f.check(['--baseline', f.baseline, '--revoke', ruff.id]);
  assert.deepEqual(read(f.baseline).accepted.map((entry) => entry.id), [eslint.id], 'revocation works without a readable report or a new scan');
  write(path.join(f.root, 'reports/ruff.json'), f.reports.ruff);
  f.check(['--baseline', f.baseline, '--accept', ruff.id, '--reason', 'Reviewed this source claim again.']);
  fs.appendFileSync(path.join(f.root, 'app/worker.py'), '# later code changed, outside the matching anchor\n');
  const changed = f.check(['--out', f.out, '--baseline', f.baseline], 1);
  assert.equal(changed.review.baseline.changed, 1);
  const current = read(path.join(f.out, 'findings.json')).diagnostics.find((d) => d.code === 'conventions/ruff');
  assert.equal(current.id, ruff.id, 'a source change away from the location does not turn the same source claim into a new issue');
  assert.equal(current.external.binding, 'changed');
  assert.equal(read(path.join(f.out, 'review.json')).findings[ruff.id].status, 'accepted-changed');
  assert.equal(f.cli(TASK, ['--verify', exported, '--root', f.root, '--require-valid'], 1).evidence, 'changed');
});

test('external workflow: fresh empty reports remain comparable; removing a source cannot pass new-only gating', (t) => {
  const f = fixture(t);
  f.check(['--out', f.out], 1);
  const previous = path.join(f.out, 'findings.json');
  for (const tool of ['eslint', 'ruff']) write(path.join(f.root, `reports/${tool}.json`), []);
  const next = path.join(f.dir, 'empty');
  const empty = f.check(['--out', next, '--compare', previous, '--new-only']);
  assert.equal(empty.review.comparison.comparable, true, 'changing report content is expected and is not a tool/configuration change');
  const comparison = read(path.join(next, 'review.json')).comparison;
  assert.equal(comparison.notDetected.length, 2);
  assert.ok(comparison.notDetected.every((item) => !item.likelyCause), 'declared external scan scope covers a file even when no current finding needs its supplemental capture');
  f.config.external.sources = f.config.external.sources.filter((source) => source.format !== 'ruff');
  write(f.configFile, f.config);
  const missing = f.check(['--compare', previous, '--new-only'], 2);
  assert.equal(missing.diagnostics[0].code, 'external/comparison-unverified');
  assert.ok(missing.diagnostics[0].evidence.reasons.some((reason) => reason.code === 'external-source-missing' && reason.sourceId === 'project-ruff'));
});

test('external workflow: serve keeps the last complete analysis and tasks after malformed or missing native reports', { skip: !ARCHIFY_AVAILABLE && 'needs an Archify checkout' }, async (t) => {
  const f = fixture(t);
  const ir = path.join(f.dir, 'input.architecture.json');
  write(ir, {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'External import workflow', output: 'architecture.html', quality_profile: 'standard' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [],
  });
  const out = path.join(f.dir, 'view');
  const view = await startAnalysisView([f.root, '--ir', ir, '--out', out, ...f.args]);
  t.after(() => new Promise((resolve) => { view.server.close(resolve); view.server.closeAllConnections?.(); }));
  const headers = { Origin: view.url, 'X-Analysis-Token': view.token, 'Content-Type': 'application/json' };
  const analyze = (refresh = false) => fetch(`${view.url}/analyze`, { method: 'POST', headers: { ...headers, ...(refresh ? { 'X-Analysis-Refresh': '1' } : {}) } });
  const initial = await analyze();
  const html = await initial.text();
  assert.equal(initial.status, 200, html);
  const findingsFile = path.join(out, 'analysis/findings.json');
  const saved = fs.readFileSync(findingsFile, 'utf8');
  const findings = JSON.parse(saved);
  const ruff = findings.diagnostics.find((d) => d.code === 'conventions/ruff');
  assert.ok(ruff, 'the page path imports the same external sources as the CLI');
  const payload = JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
  assert.ok(payload.findings.some((finding) => finding.id === ruff.id));
  for (const [breakReport, expected] of [
    [() => fs.writeFileSync(path.join(f.root, 'reports/ruff.json'), '{broken'), 'external/input-not-json'],
    [() => fs.rmSync(path.join(f.root, 'reports/ruff.json')), 'external/input-unreadable'],
  ]) {
    breakReport();
    const failed = await analyze(true);
    assert.equal(failed.status, 500);
    assert.equal((await failed.json()).diagnostics[0].code, expected);
    assert.equal(fs.readFileSync(findingsFile, 'utf8'), saved);
    assert.equal(fs.readFileSync(path.join(out, 'analysis/repo.analysis.html'), 'utf8'), html);
    assert.equal(fs.readdirSync(out).some((name) => name.startsWith('analysis.next-')), false);
    const response = await fetch(`${view.url}/task`, { method: 'POST', headers, body: JSON.stringify({ ids: [ruff.id] }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).task.findings[0].external.ruleId, 'F401');
  }
  write(path.join(f.root, 'reports/ruff.json'), []);
  const recovered = await analyze(true);
  assert.equal(recovered.status, 200, await recovered.text());
  assert.equal(read(findingsFile).diagnostics.some((d) => d.code === 'conventions/ruff'), false);
  const stale = await fetch(`${view.url}/task`, { method: 'POST', headers, body: JSON.stringify({ ids: [ruff.id] }) });
  assert.equal(stale.status, 422, 'a retired source result cannot be exported as a current task');
});
