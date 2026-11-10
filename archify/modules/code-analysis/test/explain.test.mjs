import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { extractFacts } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';

const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
function setup(t, { language = 'ts', entry = 'entry.mjs', symbol = 'entry', sources = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-question-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source'); fs.mkdirSync(root);
  sources ||= { 'entry.mjs': 'import { value } from "./dep.mjs";\nexport function entry() { return value; }\nexport const lazy = (p) => import(p);\n', 'dep.mjs': 'export const value = 1;\n' };
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const { facts } = extractFacts(root, { language });
  const analysis = path.join(dir, 'analysis'); fs.mkdirSync(analysis);
  fs.writeFileSync(path.join(analysis, 'raw-facts.json'), JSON.stringify(facts));
  return { root, facts, analysis, dir, question: 'Where does the returned value come from?', entry, symbol };
}

const SAVED_LANGUAGES = [
  { language: 'py', entry: 'entry.py', symbol: 'chosen', adapter: /^python@/, startLine: 4, endLine: 5, dependency: 'dep.py',
    sources: { 'entry.py': Buffer.from("# coding: latin-1\nfrom dep import value\n\ndef chosen():\n    return 'café' + value\n", 'latin1'), 'dep.py': "value = '!'\n" } },
  { language: 'java', entry: 'Entry.java', symbol: 'Entry.chosen()', adapter: /^java-parser@/, startLine: 3, endLine: 3, dependency: 'p/Dep.java',
    sources: { 'Entry.java': 'import p.Dep;\nclass Entry {\n  static Dep chosen() { return null; }\n}\n', 'p/Dep.java': 'package p; public class Dep {}\n' } },
];

for (const sample of SAVED_LANGUAGES) test(`saved ${sample.language} question uses captured source and functions with explicit call-model coverage`, t => {
  const args = setup(t, sample);
  assert.equal(args.facts.repository.language, sample.language);
  assert.match(args.facts.repository.adapter, sample.adapter, 'use real adapter output, not relabeled JS facts');
  const brief = buildQuestion(args);
  assert.equal(brief.entry.factsStatus, 'valid');
  assert.deepEqual(brief.entry.location, { file: sample.entry, symbol: sample.symbol, startLine: sample.startLine, endLine: sample.endLine });
  assert.equal(brief.imports.find(i => i.to === sample.dependency).target.factsStatus, 'valid');
  for (const model of [undefined, 'js-ts-lexical-v1', 'js-ts-lexical-v2']) {
    const facts = { ...args.facts, callModel: model, repository: { ...args.facts.repository, adapterRevision: 11 } };
    const calls = buildQuestion({ ...args, facts }).calls;
    assert.equal(calls.coverage, 'unavailable'); assert.equal(calls.reason, 'unsupported-or-unknown-call-model');
    assert.equal(calls.total, null); assert.equal(calls.omitted, null); assert.deepEqual(calls.records, []);
    assert.equal(calls.selection.range, null);
  }
  const output = path.join(args.dir, 'question.json');
  const command = [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry,
    '--function', args.symbol, '--root', args.root, '--format', 'json', '--out', output, '--json'];
  const run = () => spawnSync(process.execPath, command, { encoding: 'utf8' });
  const prepared = run(); assert.equal(prepared.status, 0, prepared.stderr);
  const receipt = JSON.parse(prepared.stdout);
  assert.equal(receipt.evidence, 'valid');
  assert.equal(receipt.calls.coverage, 'available');
  assert.equal(receipt.calls.total, brief.calls.total);
  const saved = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(saved.entry.location, brief.entry.location);
  assert.equal(saved.calls.provenance.rawFactsPath, path.join(args.analysis, 'raw-facts.json'));
  assert.equal(saved.scope.facts.language, sample.language);
  fs.appendFileSync(path.join(args.root, sample.dependency), '\n');
  assert.equal(buildQuestion(args).imports.find(i => i.to === sample.dependency).target.factsStatus, 'changed');
  fs.appendFileSync(path.join(args.root, sample.entry), '\n');
  const changed = run(); assert.equal(changed.status, 1, changed.stderr);
  const stale = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(stale.entry.factsStatus, 'changed'); assert.equal(stale.entry.location, null);
  assert.equal(stale.calls.coverage, 'unavailable'); assert.equal(stale.calls.total, null);
});

test('saved language admission requires matching captured producer and implementation inventory', t => {
  for (const sample of SAVED_LANGUAGES) {
    const args = setup(t, sample);
    for (const facts of [null, { ...args.facts, repository: undefined },
      { ...args.facts, repository: { ...args.facts.repository, language: 'ts' } },
      { ...args.facts, repository: { ...args.facts.repository, adapter: 'unknown@1' } },
      { ...args.facts, repository: { ...args.facts.repository, adapter: sample.language === 'py' ? 'java-parser@3.0.1' : 'python@3.13' } },
      { ...args.facts, files: [] }]) {
      assert.throws(() => buildQuestion({ ...args, facts }), e => e.diagnostics?.[0]?.code === 'task/entry-invalid');
    }
    for (const entry of ['entry.pyi', 'entry.txt']) {
      const facts = { ...args.facts, files: args.facts.files.map(f => ({ ...f, path: entry })) };
      assert.throws(() => buildQuestion({ ...args, entry, facts }), e => e.diagnostics?.[0]?.code === 'task/entry-invalid');
    }
    fs.writeFileSync(path.join(args.root, sample.entry), sample.language === 'py' ? 'def chosen(:\n' : 'class Entry {');
    const broken = extractFacts(args.root, { language: sample.language }).facts;
    const partial = buildQuestion({ ...args, facts: broken });
    assert.equal(partial.entry.factsStatus, 'valid'); assert.ok(partial.entry.parseErrors.length);
    assert.equal(partial.entry.location, null); assert.equal(partial.calls.reason, 'entry-parse-errors');
    assert.equal(partial.calls.total, null);
    const outside = `../${sample.entry}`;
    const facts = { ...args.facts, files: args.facts.files.map(f => ({ ...f, path: outside })) };
    assert.throws(() => buildQuestion({ ...args, entry: outside, facts }), e => e.diagnostics?.[0]?.code === 'task/entry-unreadable');
    fs.unlinkSync(path.join(args.root, sample.entry));
    assert.throws(() => buildQuestion(args), e => e.diagnostics?.[0]?.code === 'task/entry-unreadable');
  }
});

test('saved Python overload records and Java method overload names retain explicit ambiguity', t => {
  const py = setup(t, { language: 'py', entry: 'entry.py', symbol: 'chosen', sources: {
    'entry.py': 'from typing import overload\n@overload\ndef chosen(x: int) -> int: ...\n@overload\ndef chosen(x: str) -> str: ...\ndef chosen(x):\n    return x\n',
  } });
  assert.equal(py.facts.functions.filter(f => f.qualname === 'chosen').length, 3);
  assert.throws(() => buildQuestion(py), e => e.diagnostics?.[0]?.code === 'task/function-unresolved');
  assert.equal(buildQuestion({ ...py, symbol: undefined }).entry.location, null);
  const java = setup(t, { ...SAVED_LANGUAGES[1], sources: {
    'Entry.java': 'class Entry {\n  static void chosen() {}\n  static void chosen(int value) {}\n}\n',
  } });
  assert.throws(() => buildQuestion({ ...java, symbol: 'chosen' }), e => e.diagnostics?.[0]?.code === 'task/function-unresolved');
  assert.equal(buildQuestion(java).entry.location.symbol, 'Entry.chosen()');
});

test('question locates a real function without findings and exposes unresolved dependencies', (t) => {
  const args = setup(t); const brief = buildQuestion(args);
  assert.equal(brief.entry.factsStatus, 'valid');
  assert.deepEqual(brief.entry.location, { file: 'entry.mjs', symbol: 'entry', startLine: 2, endLine: 2 });
  assert.equal(brief.imports.find((i) => i.to === 'dep.mjs').target.factsStatus, 'valid');
  assert.ok(brief.imports.some((i) => !i.resolved));
  assert.equal(brief.stage, 'orientation-only');
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--function', args.symbol, '--root', args.root, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const output = JSON.parse(r.stdout);
  assert.equal(output.entry.location.startLine, 2);
  assert.equal(output.calls.coverage, 'available'); assert.equal(output.calls.total, 0);
  assert.equal(output.calls.provenance.rawFactsPath, path.join(args.analysis, 'raw-facts.json'));
});

test('public receipts distinguish captured zero calls from import-only facts with the same current source', (t) => {
  const args = setup(t);
  const output = path.join(args.dir, 'question.json');
  const command = [cli, 'code-analysis', 'task', args.analysis, '--question', args.question,
    '--entry', args.entry, '--function', args.symbol, '--root', args.root, '--out', output, '--json'];
  const run = () => {
    const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.stage, 'orientation-only');
    assert.equal(receipt.evidence, 'valid');
    return receipt.calls;
  };
  const captured = run();
  assert.equal(captured.coverage, 'available'); assert.equal(captured.total, 0);
  const legacy = structuredClone(args.facts);
  legacy.repository.adapterRevision = 6; legacy.calls = []; delete legacy.callModel;
  fs.writeFileSync(path.join(args.analysis, 'raw-facts.json'), JSON.stringify(legacy));
  const absent = run();
  assert.equal(absent.coverage, 'unavailable'); assert.equal(absent.total, null);
  assert.equal(absent.model, null); assert.equal(absent.reason, 'unsupported-or-unknown-call-model');
});

test('question entries support captured TS and JSX implementations while declaration files remain unsupported', (t) => {
  const args = setup(t);
  for (const extension of ['ts', 'mts', 'cts', 'tsx', 'jsx']) {
    const entry = `typed.${extension}`;
    const body = extension.endsWith('x') ? 'return <section>{helper()}</section>' : 'return helper()';
    fs.writeFileSync(path.join(args.root, entry), `function helper() { return 1; }\nexport function chosen() { ${body} }\n`);
    const facts = extractFacts(args.root, { language: 'ts' }).facts;
    const brief = buildQuestion({ ...args, facts, entry, symbol: 'chosen' });
    assert.equal(brief.entry.factsStatus, 'valid');
    assert.equal(brief.calls.coverage, 'available'); assert.equal(brief.calls.total, 1);
    assert.equal(brief.calls.records[0].fact.target.name, 'helper');
  }
  for (const extension of ['d.ts', 'd.mts', 'd.cts']) {
    const entry = `ambient.${extension}`;
    fs.writeFileSync(path.join(args.root, entry), 'export declare function chosen(): void;\n');
    assert.throws(() => buildQuestion({ ...args, entry, symbol: undefined }),
      error => error.diagnostics?.[0]?.code === 'task/entry-invalid');
  }
});

test('changed entry loses captured location; changed dependencies have their own status', (t) => {
  const args = setup(t);
  fs.writeFileSync(path.join(args.root, 'dep.mjs'), 'export const value = 2;\n');
  let brief = buildQuestion(args);
  assert.equal(brief.entry.factsStatus, 'valid'); assert.equal(brief.imports.find((i) => i.to).target.factsStatus, 'changed');
  fs.appendFileSync(path.join(args.root, args.entry), '// updated\n');
  brief = buildQuestion(args); assert.equal(brief.entry.factsStatus, 'changed'); assert.equal(brief.entry.location, null);
  assert.ok(brief.imports.every((i) => i.originStatus === 'changed'));
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--function', args.symbol, '--root', args.root, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).entry.location, null);
});

test('missing facts are explicit; invalid function or entry is not a successful orientation', (t) => {
  const args = setup(t);
  const brief = buildQuestion({ ...args, facts: null });
  assert.equal(brief.factsAvailable, false); assert.equal(brief.entry.factsStatus, 'unverifiable'); assert.equal(brief.entry.location, null);
  assert.throws(() => buildQuestion({ ...args, symbol: 'absent' }), (e) => e.diagnostics[0].code === 'task/function-unresolved');
  for (const entry of ['missing.mjs', '../outside.mjs']) assert.throws(() => buildQuestion({ ...args, entry }), (e) => e.diagnostics[0].code === 'task/entry-unreadable');
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', '--question', args.question, '--entry', 'missing.mjs', '--root', args.root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).diagnostics[0].code, 'task/entry-unreadable');
});

test('question output cannot overwrite the source it identifies', (t) => {
  const args = setup(t); const entryPath = path.join(args.root, args.entry); const before = fs.readFileSync(entryPath);
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--root', args.root, '--out', entryPath, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).diagnostics[0].code, 'task/output-conflict'); assert.deepEqual(fs.readFileSync(entryPath), before);
});

test('unchanged but syntactically broken source exposes partial extraction instead of a trusted range', (t) => {
  const args = setup(t);
  fs.writeFileSync(path.join(args.root, args.entry), 'export function entry( {');
  const facts = extractFacts(args.root, { language: 'ts' }).facts;
  const brief = buildQuestion({ ...args, facts });
  assert.equal(brief.entry.factsStatus, 'valid');
  assert.ok(brief.entry.parseErrors.length); assert.equal(brief.entry.location, null);
  fs.writeFileSync(path.join(args.analysis, 'raw-facts.json'), JSON.stringify(facts));
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--root', args.root, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.ok(JSON.parse(r.stdout).entry.parseErrors.length);
});

test('question scope distinguishes a subdirectory from its Git root and works in a linked worktree', (t) => {
  const args = setup(t);
  const git = (...command) => {
    const r = spawnSync('git', ['-C', args.dir, ...command], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-q');
  for (const dir of ['viewer', 'scripts', 'website', 'integrations']) {
    fs.mkdirSync(path.join(args.dir, dir)); fs.writeFileSync(path.join(args.dir, dir, 'entry.mjs'), 'export {};\n');
  }
  fs.writeFileSync(path.join(args.dir, 'README.md'), 'Fixture');
  git('add', '--', 'source', 'viewer', 'scripts', 'website', 'integrations', 'README.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
  fs.writeFileSync(path.join(args.dir, 'untracked.mjs'), 'export {};\n');
  const scope = buildQuestion(args).scope;
  assert.equal(scope.git.status, 'known');
  assert.equal(scope.git.repositoryRoot, fs.realpathSync(args.dir));
  assert.equal(scope.git.analysisPath, 'source');
  assert.deepEqual(scope.facts.files, ['dep.mjs', 'entry.mjs']);
  assert.deepEqual(scope.git.outsideAnalysisRoot.map((x) => x.region), ['README.md', 'integrations/', 'scripts/', 'viewer/', 'website/']);
  assert.equal(scope.git.trackedPathCount, 7, 'untracked input is not silently included');
  // Only the entry is in these root-relative facts: matching roots must not imply coverage.
  const partial = { ...args.facts, files: args.facts.files.filter((f) => f.path === 'entry.mjs').map((f) => ({ ...f, path: 'source/entry.mjs' })), functions: [], imports: [] };
  const rootBrief = buildQuestion({ ...args, root: args.dir, entry: 'source/entry.mjs', symbol: undefined, facts: partial });
  assert.deepEqual(rootBrief.scope.git.outsideAnalysisRoot, []);
  assert.equal(rootBrief.scope.git.analysisPath, '.');
  assert.deepEqual(rootBrief.scope.facts.files, ['source/entry.mjs']);
  assert.ok(rootBrief.scope.limitations.some((s) => /when both roots match/.test(s)));
  const linked = path.join(args.dir, 'linked'); git('worktree', 'add', '--detach', linked, 'HEAD');
  const linkedBrief = buildQuestion({ ...args, root: path.join(linked, 'source') });
  assert.equal(linkedBrief.scope.git.repositoryRoot, fs.realpathSync(linked));
  assert.equal(linkedBrief.scope.git.analysisPath, 'source');
  assert.deepEqual(linkedBrief.scope.git.outsideAnalysisRoot, scope.git.outsideAnalysisRoot);
});

test('optional Git scope remains unknown in non-Git directories or without Git, preserving entry orientation', (t) => {
  const args = setup(t);
  const noGit = buildQuestion(args);
  assert.equal(noGit.entry.factsStatus, 'valid'); assert.equal(noGit.scope.git.status, 'unknown');
  assert.equal(noGit.scope.git.outsideAnalysisRoot, null);
  const missingFacts = buildQuestion({ ...args, facts: null });
  assert.deepEqual(missingFacts.scope.facts, { status: 'unknown', language: null, files: null });
  const r = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--root', args.root, '--format', 'json'], { encoding: 'utf8', env: { ...process.env, PATH: path.join(args.dir, 'no-programs') } });
  assert.equal(r.status, 0, r.stderr);
  const brief = JSON.parse(r.stdout);
  assert.equal(brief.entry.factsStatus, 'valid'); assert.equal(brief.scope.git.status, 'unknown');
  const init = spawnSync('git', ['-C', args.dir, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const badIndex = path.join(args.dir, 'invalid-index'); fs.writeFileSync(badIndex, 'not a Git index');
  const failedList = spawnSync(process.execPath, [cli, 'code-analysis', 'task', args.analysis, '--question', args.question, '--entry', args.entry, '--root', args.root, '--format', 'json'], { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: badIndex } });
  assert.equal(failedList.status, 0, failedList.stderr);
  const partial = JSON.parse(failedList.stdout);
  assert.equal(partial.scope.git.repositoryRoot, fs.realpathSync(args.dir));
  assert.equal(partial.scope.git.status, 'unknown');
  assert.equal(partial.scope.git.outsideAnalysisRoot, null);
  assert.equal(partial.entry.factsStatus, 'valid');
});
