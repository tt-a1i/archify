import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildChangeQuestion, captureChangeSide, captureChangeQuestion } from '../lib/change-question.mjs';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { parseTaskArgs } from '../bin/task.mjs';

const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
const source = 'export function selected(){return 1}\nexport function untouched(){return 3}\n';
const caller = 'import {selected} from "./entry.mjs"; export function caller(){return selected()}\n';
function setup(t, a = { 'entry.mjs': source, 'caller.mjs': caller }, b = { 'entry.mjs': source.replace('return 1', 'return 2'), 'caller.mjs': caller }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-change-question-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, files] of [['base', a], ['head', b]]) {
    fs.mkdirSync(path.join(dir, name));
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, name, file), text);
    }
  }
  return { dir, baseRoot: path.join(dir, 'base'), root: path.join(dir, 'head'), entry: 'entry.mjs', question: 'What changed and where should I read next?' };
}
function capture(args) {
  const config = loadConfig(null);
  return { ...args, config, base: captureChangeSide(args.baseRoot, config), head: captureChangeSide(args.root, config) };
}
function run(args, extra = []) {
  return spawnSync(process.execPath, [cli, 'code-analysis', 'task', '--question', args.question, '--base-root', args.baseRoot, '--root', args.root, '--entry', args.entry, '--format', 'json', ...extra], { encoding: 'utf8' });
}

test('optional capture observation leaves raw facts and their revision/snapshot fingerprints unchanged', t => {
  const args = setup(t), config = loadConfig(null);
  const plain = extractFacts(args.root, { language: 'ts', config });
  let observed;
  const watched = extractFacts(args.root, { language: 'ts', config, onCapture: input => { observed = input; } });
  assert.ok(observed.options); assert.ok(observed.reads instanceof Map);
  assert.deepEqual(watched.facts, plain.facts);
});

test('public paired question captures dirty working trees, preserves side coordinates and original task modes', t => {
  const defaultSource = source.replace('export function selected', 'export default function selected');
  const defaultCaller = 'import selected from "./entry.mjs"; export function caller(){return selected()}\n';
  const args = setup(t, { 'entry.mjs': defaultSource, 'caller.mjs': defaultCaller },
    { 'entry.mjs': defaultSource.replace('return 1', 'return 2'), 'caller.mjs': defaultCaller });
  const git = (...command) => spawnSync('git', ['-C', args.root, ...command], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '.').status, 0);
  assert.equal(git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture').status, 0);
  fs.writeFileSync(path.join(args.root, 'entry.mjs'), '\n' + defaultSource.replace('return 1', 'return 2'));
  const result = run(args); assert.equal(result.status, 0, result.stderr);
  const brief = JSON.parse(result.stdout);
  assert.equal(brief.kind, 'archify-change-question'); assert.equal(brief.stage, 'orientation-only');
  assert.equal(brief.changedDefinitions.total, 1); assert.equal(brief.positionOnlyDefinitions.total, 1);
  const change = brief.changedDefinitions.items[0];
  assert.equal(change.base.definition.line, 1); assert.equal(change.head.definition.line, 2);
  for (const side of ['base', 'head']) {
    assert.equal(brief.sides[side].callModel, 'js-ts-lexical-v2');
    const ref = change[side].knownReferences.items[0];
    assert.equal(ref.fact.target.line, change[side].definition.line);
    assert.equal(ref.navigation.location.file, 'caller.mjs'); assert.equal(ref.side, side);
    assert.equal(ref.snapshotId, brief.sides[side].snapshot.snapshotId);
  }
  assert.equal(brief.sides.head.sourceIdentity, 'valid'); assert.equal(brief.sides.head.snapshot.revision, null);
  // Existing mode parser contracts remain unchanged; full behavior is owned by
  // explain.test and task.test, which run alongside this suite.
  assert.equal(parseTaskArgs(['analysis', '--finding', 'F-1']).dir, 'analysis');
  assert.equal(parseTaskArgs(['--question', 'q', '--root', args.root, '--entry', args.entry, '--function', 'selected']).options['--function'], 'selected');
});

test('added and deleted files/functions are normal, and file moves do not infer identity', t => {
  const args = setup(t, { 'entry.mjs': 'export function oldName(){return 1}', 'gone.mjs': source }, { 'entry.mjs': 'export function newName(){return 1}', 'moved.mjs': source });
  const brief = captureChangeQuestion(args);
  assert.equal(brief.status, 'ready'); assert.equal(brief.changedDefinitions.total, 0);
  assert.deepEqual(brief.fileChanges.items.map(x => [x.file, x.status]), [['entry.mjs', 'text-changed'], ['gone.mjs', 'base-only'], ['moved.mjs', 'head-only']]);
  assert.deepEqual(brief.unpairedDefinitions.items.map(x => x.reason), ['base-only', 'head-only']);
  const deleted = captureChangeQuestion({ ...args, entry: 'gone.mjs' });
  assert.equal(deleted.status, 'ready'); assert.equal(deleted.unpairedDefinitions.total, 2);
  assert.ok(deleted.unpairedDefinitions.items.every(x => x.side === 'base'));
  const added = captureChangeQuestion({ ...args, entry: 'moved.mjs' });
  assert.ok(added.unpairedDefinitions.items.every(x => x.side === 'head'));
});

test('same-line functions use exact ranges and duplicate qualified slots remain unpaired', t => {
  const args = setup(t, { 'entry.mjs': 'function a(){ obj.first() } function b(){ obj.second() }' }, { 'entry.mjs': 'function a(){ obj.changed() } function b(){ obj.second() }' });
  const brief = captureChangeQuestion(args), change = brief.changedDefinitions.items[0];
  assert.equal(change.head.definition.name, 'a'); assert.equal(brief.changedDefinitions.total, 1);
  assert.equal(change.head.unresolvedWithinSourceRange.total, 1);
  assert.ok(change.head.unresolvedWithinSourceRange.items[0].fact.endColumn < brief.positionOnlyDefinitions.items[0].head.definition.column);
  for (const root of [args.baseRoot, args.root]) fs.writeFileSync(path.join(root, 'entry.mjs'), '{function f(){return 1}} {function f(){return 2}}');
  const duplicate = captureChangeQuestion(args);
  assert.equal(duplicate.changedDefinitions.total, 0); assert.equal(duplicate.unpairedDefinitions.total, 4);
  assert.ok(duplicate.unpairedDefinitions.items.every(x => x.reason === 'duplicate-slot'));
});

test('both sides lose stale definition navigation; stale caller retains evidence but no live location', t => {
  const args = setup(t), captured = capture(args);
  for (const root of [args.baseRoot, args.root]) fs.appendFileSync(path.join(root, 'entry.mjs'), '\n// drift');
  const drift = buildChangeQuestion(captured);
  assert.equal(drift.status, 'partial'); assert.equal(drift.changedDefinitions.total, 0);
  for (const side of ['base', 'head']) assert.equal(drift.sides[side].unavailableFiles.items[0].status, 'changed');
  const fresh = capture(args);
  fs.unlinkSync(path.join(args.root, 'caller.mjs'));
  const changed = buildChangeQuestion(fresh).changedDefinitions.items[0];
  const ref = changed.head.knownReferences.items[0];
  assert.equal(ref.navigation.status, 'missing'); assert.equal(ref.navigation.location, null); assert.ok(ref.fact.target);
  fs.writeFileSync(path.join(args.baseRoot, 'tsconfig.json'), '{}');
  assert.ok(buildChangeQuestion(fresh).comparison.reasons.some(x => x.code === 'resolution-input-changed' && x.side === 'base'));
});

test('parse errors are partial and suppress affected definitions without losing valid regions', t => {
  const args = setup(t, { 'entry.mjs': source, 'broken.mjs': 'function invalid( {' }, { 'entry.mjs': source.replace('return 1', 'return 2'), 'broken.mjs': 'function invalid( {' });
  const r = run(args); assert.equal(r.status, 1, r.stderr);
  const brief = JSON.parse(r.stdout); assert.equal(brief.changedDefinitions.total, 1);
  assert.equal(brief.sides.base.parseErrors, 1); assert.equal(brief.sides.head.parseErrors, 1);
  const broken = captureChangeQuestion({ ...args, entry: 'broken.mjs' });
  assert.equal(broken.status, 'partial'); assert.equal(broken.changedDefinitions.total, 0); assert.equal(broken.unpairedDefinitions.total, 0);
});

test('root/extended compiler settings and package contents limit binding attribution, even with one analysis config', t => {
  const args = setup(t);
  for (const root of [args.baseRoot, args.root]) {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"extends":"./settings.json"}');
    fs.writeFileSync(path.join(root, 'settings.json'), '{"compilerOptions":{"customConditions":["first"]}}');
  }
  assert.equal(captureChangeQuestion(args).comparison.bindingAttribution, 'same-observed-settings');
  fs.writeFileSync(path.join(args.root, 'settings.json'), '{"compilerOptions":{"customConditions":["second"]}}');
  let brief = captureChangeQuestion(args);
  assert.equal(brief.status, 'partial'); assert.equal(brief.changedDefinitions.total, 1);
  assert.equal(brief.comparison.bindingAttribution, 'limited');
  assert.ok(brief.comparison.reasons.some(x => x.code === 'resolution-settings-differ'));
  assert.ok(brief.comparison.resolutionChanges.optionChanges.items.some(x => x.option === 'customConditions'));
  assert.ok(brief.comparison.resolutionChanges.inputChanges.items.some(x => x.file === '<root>/settings.json'));
  assert.equal(brief.changedDefinitions.items[0].head.knownReferences.items[0].bindingAttribution, 'limited');
  const textReceipt = run(args, ['--out', path.join(args.dir, 'partial.json')]);
  assert.equal(textReceipt.status, 1); assert.match(textReceipt.stderr, /resolution-settings-differ/);
  assert.match(textReceipt.stderr, /capture\/configuration limits, not a finding gate/);
  const captured = capture(args);
  fs.appendFileSync(path.join(args.baseRoot, 'settings.json'), '\n');
  brief = buildChangeQuestion(captured);
  assert.ok(brief.comparison.reasons.some(x => x.code === 'resolution-input-changed' && x.side === 'base'));
  assert.equal(brief.changedDefinitions.items[0].base.knownReferences.items[0].navigation.location, null);
  // Package "imports" are resolver inputs despite not being captured source.
  for (const root of [args.baseRoot, args.root]) {
    fs.writeFileSync(path.join(root, 'settings.json'), '{}');
    fs.writeFileSync(path.join(root, 'entry.mjs'), 'import "#local"; export function selected(){return 1}');
    fs.writeFileSync(path.join(root, 'package.json'), '{"imports":{"#local":"./caller.mjs"}}');
  }
  fs.writeFileSync(path.join(args.root, 'package.json'), '{"imports":{"#local":"./entry.mjs"}}');
  brief = captureChangeQuestion(args);
  assert.equal(brief.comparison.bindingAttribution, 'limited');
});

test('new source candidates may change known binding without a configuration mismatch', t => {
  const args = setup(t, { 'entry.js': 'export function f(){return 1}', 'caller.mjs': 'import {f} from "./entry.js"; f()' }, { 'entry.js': 'export function f(){return 2}', 'caller.mjs': 'import {f} from "./entry.js"; f()', 'entry.ts': 'export function f(){return 3}' });
  const brief = captureChangeQuestion({ ...args, entry: 'entry.js' });
  assert.equal(brief.status, 'ready');
  assert.equal(brief.changedDefinitions.items[0].base.knownReferences.total, 1);
  assert.equal(brief.changedDefinitions.items[0].head.knownReferences.total, 0);
  assert.ok(brief.fileChanges.items.some(x => x.file === 'entry.ts' && x.status === 'head-only'));
});

test('fresh mode rejects incompatible options and protects either root from output overwrite', t => {
  const args = setup(t);
  for (const extra of [['analysis'], ['--function', 'selected'], ['--finding', 'F-1'], ['--verify', 'task.json']]) {
    const r = run(args, [...extra, '--json']); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).diagnostics[0].code, 'cli/usage');
  }
  for (const root of [args.baseRoot, args.root]) {
    const original = fs.readFileSync(path.join(root, 'entry.mjs'));
    const r = run(args, ['--out', path.join(root, 'entry.mjs'), '--json']);
    assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).diagnostics[0].code, 'task/output-conflict');
    assert.deepEqual(fs.readFileSync(path.join(root, 'entry.mjs')), original);
  }
  const configPath = path.join(args.dir, 'analysis.json'); fs.writeFileSync(configPath, '{"exclude":["**/caller.mjs"]}');
  const conflict = run(args, ['--config', configPath, '--out', configPath, '--json']);
  assert.equal(conflict.status, 2); assert.equal(JSON.parse(conflict.stdout).diagnostics[0].code, 'task/output-conflict');
  const r = run(args, ['--config', configPath]); assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).changedDefinitions.items[0].head.knownReferences.total, 0);
});

test('bounded orientation counts omitted references and missing entry never looks successful', t => {
  const manyCalls = 'import {selected} from "./entry.mjs";\n' + 'selected();\n'.repeat(45);
  const args = setup(t, { 'entry.mjs': source, 'caller.mjs': manyCalls }, { 'entry.mjs': source.replace('return 1', 'return 2'), 'caller.mjs': manyCalls });
  const refs = captureChangeQuestion(args).changedDefinitions.items[0].head.knownReferences;
  assert.equal(refs.total, 45); assert.equal(refs.included, 40); assert.equal(refs.omitted, 5);
  assert.equal(captureChangeQuestion({ ...args, entry: 'absent.mjs' }).status, 'partial');
});

test('explicit declaration entries disclose unsupported definitions separately from an available file with no functions', t => {
  const args = setup(t, { 'entry.mjs': 'export const version = 1;', 'types.d.mts': 'export declare function parse(value: string): string;' },
    { 'entry.mjs': 'export const version = 2;', 'types.d.mts': 'export declare function parse(value: string | number): string;' });
  const declaration = captureChangeQuestion({ ...args, entry: 'types.d.mts' });
  assert.equal(declaration.status, 'partial');
  assert.deepEqual(declaration.definitionCoverage, { base: 'declaration-file-unsupported', head: 'declaration-file-unsupported' });
  assert.ok(declaration.comparison.reasons.some(reason => reason.code === 'definition-regions-unsupported' && reason.count === 1));
  assert.equal(declaration.changedDefinitions.total, 0);
  const implementation = captureChangeQuestion(args);
  assert.equal(implementation.status, 'ready');
  assert.deepEqual(implementation.definitionCoverage, { base: 'available', head: 'available' });
  assert.equal(implementation.changedDefinitions.total, 0);
  const out = path.join(args.dir, 'question.json');
  const r = run({ ...args, entry: 'types.d.mts' }, ['--out', out, '--json']);
  assert.equal(r.status, 1, r.stderr);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.evidence, 'partial');
  assert.deepEqual(receipt.definitionCoverage, declaration.definitionCoverage);
  assert.ok(receipt.reasons.some(reason => reason.code === 'definition-regions-unsupported'));
  assert.deepEqual(JSON.parse(fs.readFileSync(out)).definitionCoverage, declaration.definitionCoverage);
});


test('module reading keeps resolved dependency kinds separate from calls and preserves bounded original facts', t => {
  const consumer = 'import "./entry.mjs";\nexport {selected} from "./entry.mjs";\nimport type {Something} from "./entry.mjs";\nfunction later(){return import("./entry.mjs")}\nimport "missing-external";\n';
  const args = setup(t, { 'entry.mjs': source, 'consumer.ts': consumer }, { 'entry.mjs': source.replace('return 1', 'return 2'), 'consumer.ts': consumer });
  const captured = capture(args), brief = buildChangeQuestion(captured);
  const reading = brief.moduleReading.head;
  assert.equal(reading.resolvedReferences.total, 4); assert.equal(reading.unresolvedImports, 1);
  assert.equal(brief.changedDefinitions.items[0].head.knownReferences.total, 0);
  for (const record of reading.resolvedReferences.items) {
    assert.deepEqual(record.fact, captured.head.facts.imports[record.factIndex]);
    assert.equal(record.side, 'head'); assert.equal(record.snapshotId, brief.sides.head.snapshot.snapshotId);
    assert.equal(record.navigation.location.file, 'consumer.ts');
  }
  assert.ok(reading.resolvedReferences.items.some(x => x.fact.kind === 'export'));
  assert.ok(reading.resolvedReferences.items.some(x => x.fact.typeOnly));
  assert.ok(reading.resolvedReferences.items.some(x => x.fact.kind === 'dynamic' && x.fact.lazy));
  for (const root of [args.baseRoot, args.root]) fs.writeFileSync(path.join(root, 'consumer.ts'), 'import "./entry.mjs";\n'.repeat(43));
  const many = captureChangeQuestion(args).moduleReading.head.resolvedReferences;
  assert.equal(many.total, 43); assert.equal(many.included, 40); assert.equal(many.omitted, 3);
});

test('dependency navigation requires fresh parseable origin/entry and resolution inputs on its own side', t => {
  const args = setup(t), captured = capture(args);
  fs.appendFileSync(path.join(args.baseRoot, 'caller.mjs'), '// changed');
  fs.appendFileSync(path.join(args.root, 'entry.mjs'), '// changed');
  const brief = buildChangeQuestion(captured);
  assert.equal(brief.moduleReading.base.resolvedReferences.items[0].navigation.location, null);
  assert.equal(brief.moduleReading.base.resolvedReferences.items[0].originStatus, 'changed');
  assert.equal(brief.moduleReading.head.resolvedReferences.items[0].navigation.status, 'entry-changed');
  const fresh = capture(args);
  fs.writeFileSync(path.join(args.root, 'tsconfig.json'), '{}');
  assert.equal(buildChangeQuestion(fresh).moduleReading.head.resolvedReferences.items[0].navigation.status, 'resolution-input-changed');
  fs.writeFileSync(path.join(args.root, 'entry.mjs'), 'export function selected( {');
  const broken = captureChangeQuestion(args);
  assert.equal(broken.moduleReading.head.resolvedReferences.items[0].navigation.status, 'entry-parse-error');
});
