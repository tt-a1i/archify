import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreview } from '../bin/preview.mjs';
import { loadDiagram, writeDiagram } from '../renderers/shared/cli.mjs';
import { pathsAlias } from '../renderers/shared/output-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const workflowFixture = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
const baseFixture = path.join(skillRoot, 'examples/checkout-platform.base.architecture.json');
const headFixture = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function copyInstalledSkill(target) {
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(skillRoot, source);
      return relative !== 'node_modules'
        && !relative.startsWith(`node_modules${path.sep}`)
        && relative !== 'test'
        && !relative.startsWith(`test${path.sep}`);
    },
  });
}

function directoryAliasesNames(directory, authoredName, lookupName) {
  const authoredPath = path.join(directory, authoredName);
  const lookupPath = path.join(directory, lookupName);
  fs.writeFileSync(authoredPath, 'filesystem semantics probe', { flag: 'wx' });
  try {
    let authored;
    let lookup;
    try {
      authored = fs.statSync(authoredPath);
      lookup = fs.statSync(lookupPath);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    return authored.dev === lookup.dev && authored.ino === lookup.ino;
  } finally {
    fs.unlinkSync(authoredPath);
  }
}

test('future-path aliases follow the containing directory case and Unicode semantics', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-semantics-'));
  const caseInsensitive = directoryAliasesNames(cwd, 'ArchifyCaseProbe', 'archifycaseprobe');
  const normalizationInsensitive = directoryAliasesNames(
    cwd,
    'archify-norm-\u00e9-probe',
    'archify-norm-e\u0301-probe',
  );

  assert.equal(
    pathsAlias(path.join(cwd, 'Future.HTML'), path.join(cwd, 'future.html')),
    caseInsensitive,
  );
  assert.equal(
    pathsAlias(path.join(cwd, 'Caf\u00e9.html'), path.join(cwd, 'Cafe\u0301.html')),
    normalizationInsensitive,
  );
});

test('compare rejects case-only future targets before input work when the directory aliases case', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-case-'));
  const caseInsensitive = directoryAliasesNames(cwd, 'ArchifyCaseProbe', 'archifycaseprobe');
  const output = path.join(cwd, 'Future.HTML');
  const receiptPath = path.join(cwd, 'future.html');

  const result = run([
    'compare', 'architecture',
    path.join(cwd, 'missing-base.json'),
    path.join(cwd, 'missing-head.json'),
    output,
    '--receipt', receiptPath,
    '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(
    receipt.diagnostics[0].code,
    caseInsensitive ? 'output/target-alias' : 'delta/base-input',
  );
  assert.equal(receipt.stage, caseInsensitive ? 'prepare' : 'input');
});

test('render reports an output symlink cycle as a structured output diagnostic', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-cycle-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'cycle-a.html');
  const otherLink = path.join(cwd, 'cycle-b.html');
  fs.copyFileSync(workflowFixture, input);
  fs.symlinkSync(otherLink, output, 'file');
  fs.symlinkSync(output, otherLink, 'file');

  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'), input, output],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    },
  );

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.diagnostics[0].code, 'output/symlink-cycle');
  assert.equal(failure.diagnostics[0].subject.output, output);
  assert.ok(failure.diagnostics[0].supportedFixes.length > 0);
});

test('render rejects an output symlink that aliases its JSON input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'diagram.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);
  fs.symlinkSync(input, output, 'file');

  const result = run(['render', 'workflow', input, output], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output must not replace an input/i);
  assert.deepEqual(fs.readFileSync(input), source);
});

test('render rejects an existing output hard link to its JSON input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-hardlink-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'diagram.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);
  fs.linkSync(input, output);

  const result = run(['render', 'workflow', input, output], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output must not replace an input/i);
  assert.deepEqual(fs.readFileSync(input), source);
});

test('render rejects an absolute meta.output when no CLI output is provided', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-absolute-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = output;
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must be a relative path/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a relative meta.output that escapes the working directory', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-parent-'));
  const cwd = path.join(parent, 'work');
  fs.mkdirSync(cwd);
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(parent, 'escaped.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = '../escaped.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must stay inside the current working directory/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a meta.output that escapes through a directory symlink', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-link-'));
  const cwd = path.join(parent, 'work');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(cwd);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(cwd, 'linked'), 'dir');
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(outside, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'linked/authored.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must stay inside the current working directory/i);
  assert.equal(fs.existsSync(output), false);
});

test('render requires a meta.output target with an html extension', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-extension-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.json');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'authored.json';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must target an? \.html file/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a meta.output symlink that resolves to a non-html target', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-extension-link-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const target = path.join(cwd, 'authored.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'authored.html';
  fs.writeFileSync(input, JSON.stringify(source));
  fs.writeFileSync(target, 'trusted target');
  fs.symlinkSync(target, output, 'file');

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must resolve to an? \.html file/i);
  assert.equal(fs.readFileSync(target, 'utf8'), 'trusted target');
});

test('deliver rejects a future-path alias of its JSON input with a structured diagnostic', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-deliver-'));
  const realDirectory = path.join(cwd, 'real');
  const linkedDirectory = path.join(cwd, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  const input = path.join(realDirectory, 'diagram.workflow.json');
  const output = path.join(linkedDirectory, 'diagram.workflow.json');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);

  const result = run(['deliver', 'workflow', input, output, '--json'], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
});

test('deliver rechecks aliases immediately before committing a verified candidate', { timeout: 10000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-deliver-race-'));
  const installedRoot = path.join(cwd, 'skill');
  const installedBin = path.join(installedRoot, 'bin');
  const installedShared = path.join(installedRoot, 'renderers/shared');
  const installedRenderer = path.join(installedRoot, 'renderers/workflow');
  const installedScripts = path.join(installedRoot, 'scripts');
  fs.mkdirSync(installedBin, { recursive: true });
  fs.mkdirSync(installedShared, { recursive: true });
  fs.mkdirSync(installedRenderer, { recursive: true });
  fs.mkdirSync(installedScripts, { recursive: true });
  fs.copyFileSync(cli, path.join(installedBin, 'archify.mjs'));
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/output-path.mjs'),
    path.join(installedShared, 'output-path.mjs'),
  );
  fs.writeFileSync(path.join(installedRenderer, 'render-workflow.mjs'), `
import fs from 'node:fs';
const [, output] = process.argv.slice(2);
fs.writeFileSync(process.env.ARCHIFY_TEST_RENDER_STARTED, output);
await new Promise((resolve) => setTimeout(resolve, 500));
fs.writeFileSync(output, '<!doctype html><title>verified candidate</title><svg></svg>');
`);
  fs.writeFileSync(path.join(installedScripts, 'check-render-output.mjs'), `
console.log(JSON.stringify({
  ok: true,
  checks: [{ name: 'single_svg', ok: true }],
  composition: {
    profile: 'showcase',
    status: 'pass',
    summary: { errors: 0, warnings: 0 }
  }
}));
`);

  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const input = path.join(inputDirectory, 'diagram.json');
  const output = path.join(linkedDirectory, 'diagram.json');
  const source = Buffer.from('{"meta":{"title":"race input"}}');
  fs.writeFileSync(input, source);
  const marker = path.join(cwd, 'renderer-started');

  const child = spawn(process.execPath, [
    path.join(installedBin, 'archify.mjs'),
    'deliver', 'workflow', input, output, '--json',
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_TEST_RENDER_STARTED: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const started = Date.now();
  while (!fs.existsSync(marker) && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(marker), true, `renderer did not start; stderr=${stderr}`);
  const candidatePath = fs.readFileSync(marker, 'utf8');
  const candidateRelative = path.relative(linkedDirectory, candidatePath);
  fs.mkdirSync(path.dirname(path.join(inputDirectory, candidateRelative)), { recursive: true });
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');

  const status = await new Promise((resolve) => child.once('close', resolve));

  assert.equal(status, 1, stderr);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
});

test('compare rejects an artifact path that aliases either architecture input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-'));
  const realDirectory = path.join(cwd, 'real');
  const linkedDirectory = path.join(cwd, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  const base = path.join(realDirectory, 'review.html');
  const output = path.join(linkedDirectory, 'review.html');
  const baseSource = fs.readFileSync(baseFixture);
  fs.writeFileSync(base, baseSource);

  const result = run(['compare', 'architecture', base, headFixture, output, '--json'], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), baseSource);
});

test('compare rejects a receipt path that aliases either architecture input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-receipt-'));
  const base = path.join(cwd, 'base.json');
  const output = path.join(cwd, 'delta.html');
  const baseSource = fs.readFileSync(baseFixture);
  fs.writeFileSync(base, baseSource);

  const result = run([
    'compare', 'architecture', base, headFixture, output,
    '--receipt', base, '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), baseSource);
  assert.equal(fs.existsSync(output), false);
});

test('compare rejects a dangling receipt symlink to the future artifact path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-pair-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  fs.symlinkSync(output, receiptPath, 'file');

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/target-alias');
  assert.equal(fs.lstatSync(receiptPath).isSymbolicLink(), true);
  assert.equal(fs.existsSync(output), false);
});

test('preview applies the meta.output relative-path boundary before starting a server', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-preview-meta-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = output;
  fs.writeFileSync(input, JSON.stringify(source));

  const failure = await startPreview({
    type: 'workflow',
    input,
    open: false,
    watch: false,
    cwd,
  }).then(async (preview) => {
    await preview.stop();
    return null;
  }, (error) => error);

  assert.ok(failure instanceof Error);
  assert.match(failure.message, /meta\.output must be a relative path/i);
  assert.equal(fs.existsSync(output), false);
});

test('the shared renderer rechecks its guarded output immediately before writing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-race-'));
  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const input = path.join(inputDirectory, 'diagram.workflow.json');
  const output = path.join(linkedDirectory, 'diagram.workflow.json');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);

  const loaded = loadDiagram({
    rendererDir: path.join(skillRoot, 'renderers/workflow'),
    diagramType: 'workflow',
    defaultExample: 'agent-tool-call.workflow.json',
    argv: ['node', 'render-workflow.mjs', input, output],
  });
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');

  assert.throws(
    () => writeDiagram({
      outPath: loaded.outPath,
      template: loaded.template,
      diagramType: 'workflow',
      meta: loaded.diagram.meta,
      footerLabel: 'Workflow',
      svg: '<svg role="img"></svg>',
      cards: [],
    }),
    /output must not replace an input/i,
  );
  assert.deepEqual(fs.readFileSync(input), source);
});

test('compare rechecks every target immediately before committing the artifact pair', { timeout: 10000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-race-'));
  const installedRoot = path.join(cwd, 'skill');
  const installedBin = path.join(installedRoot, 'bin');
  const installedShared = path.join(installedRoot, 'renderers/shared');
  const installedRenderer = path.join(installedRoot, 'renderers/architecture');
  const installedScripts = path.join(installedRoot, 'scripts');
  const installedDelta = path.join(installedRoot, 'delta');
  for (const directory of [installedBin, installedShared, installedRenderer, installedScripts, installedDelta]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.copyFileSync(cli, path.join(installedBin, 'archify.mjs'));
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/output-path.mjs'),
    path.join(installedShared, 'output-path.mjs'),
  );
  fs.writeFileSync(path.join(installedRenderer, 'render-architecture.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
const [, output] = process.argv.slice(2);
if (path.basename(output) === 'head.html') {
  const marker = process.env.ARCHIFY_TEST_RENDER_STARTED;
  const markerCandidate = marker + '.tmp';
  fs.writeFileSync(markerCandidate, output);
  fs.renameSync(markerCandidate, marker);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
fs.writeFileSync(output, '<!doctype html><svg role="img"></svg>');
`);
  fs.writeFileSync(path.join(installedScripts, 'check-render-output.mjs'), `
console.log(JSON.stringify({
  ok: true,
  checks: [{ name: 'single_svg', ok: true }],
  composition: {
    profile: 'showcase',
    status: 'pass',
    summary: { errors: 0, warnings: 0 }
  }
}));
`);
  fs.writeFileSync(path.join(installedDelta, 'architecture-delta.mjs'), `
export class ArchitectureDeltaError extends Error {}
export const annotateArchitectureSideSvg = (svg) => svg;
export const buildDeltaSvg = () => '<svg role="img"></svg>';
export const canonicalArchitecture = (value) => value;
export const canonicalArchitectureJson = (value) => JSON.stringify(value);
export const compareArchitecture = () => ({
  command: 'compare',
  base: {},
  head: {},
  completeness: 'complete',
  proofLevel: 'authored'
});
export const extractArchitectureSvg = () => '<svg role="img"></svg>';
export const extractArtifactCss = () => '';
export const renderArchitectureDeltaHtml = () => '<!doctype html><svg role="img"></svg>';
export const validateArchitectureDeltaHtml = () => ({ checksPassed: 1, checkCount: 1 });
`);

  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const base = path.join(inputDirectory, 'diagram.json');
  const head = path.join(cwd, 'head.json');
  const output = path.join(linkedDirectory, 'diagram.json');
  const source = Buffer.from('{"side":"base"}');
  fs.writeFileSync(base, source);
  fs.writeFileSync(head, '{"side":"head"}');
  const marker = path.join(cwd, 'renderer-started');

  const child = spawn(process.execPath, [
    path.join(installedBin, 'archify.mjs'),
    'compare', 'architecture', base, head, output, '--json',
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_TEST_RENDER_STARTED: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const started = Date.now();
  while (!fs.existsSync(marker) && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(marker), true, `renderer did not start; stderr=${stderr}`);
  const candidatePath = fs.readFileSync(marker, 'utf8');
  const candidateRelative = path.relative(linkedDirectory, candidatePath);
  fs.mkdirSync(path.dirname(path.join(inputDirectory, candidateRelative)), { recursive: true });
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');

  const status = await new Promise((resolve) => child.once('close', resolve));

  assert.equal(status, 1, stderr);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), source);
});

test('doctor reports a missing output-path safety runtime in an installed skill', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-doctor-'));
  const installedRoot = path.join(cwd, 'skill');
  copyInstalledSkill(installedRoot);
  fs.rmSync(path.join(installedRoot, 'renderers/shared/output-path.mjs'));

  const result = spawnSync(process.execPath, [path.join(installedRoot, 'bin/archify.mjs'), 'doctor'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[missing\] Output path safety runtime/);
});
