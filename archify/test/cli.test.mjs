import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';
import { extractSvgs, parseXml } from './helpers/xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cli-'));
const cli = path.join(skillRoot, 'bin/archify.mjs');

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || skillRoot,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeFakeOpeners(name, { exitCode = 0 } = {}) {
  const bin = path.join(tmp, name);
  const log = path.join(bin, 'open-log.json');
  fs.mkdirSync(bin, { recursive: true });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const target = process.argv[process.argv.length - 1];
fs.writeFileSync(process.env.ARCHIFY_TEST_OPEN_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  target,
  existed: fs.existsSync(target),
}));
process.exit(${exitCode});
`;
  for (const command of ['open', 'xdg-open']) {
    const executable = path.join(bin, command);
    fs.writeFileSync(executable, source);
    fs.chmodSync(executable, 0o755);
  }
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      ARCHIFY_TEST_OPEN_LOG: log,
    },
  };
}

function copyInstalledSkill(target) {
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(skillRoot, source);
      return rel !== 'node_modules' && !rel.startsWith(`node_modules${path.sep}`)
        && rel !== 'test' && !rel.startsWith(`test${path.sep}`)
        // Another test creates this short-lived directory under skillRoot so
        // Ajv resolves from the checkout. Never copy a concurrently removed
        // test fixture into an installed-skill simulation.
        && !rel.startsWith('.validator-check-');
    },
  });
}

test('cli: help lists commands and diagram types', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /archify render <type>/);
  assert.match(result.stdout, /archify compare architecture <base\.json> <head\.json>/);
  assert.match(result.stdout, /archify deliver <type>/);
  assert.match(result.stdout, /archify preview <type>/);
  assert.match(result.stdout, /archify visual-check <output\.html>/);
  assert.match(result.stdout, /--open/);
  assert.match(result.stdout, /--repo-root path \(architecture only\)/);
  assert.match(result.stdout, /archify guide \[scenario or question\]/);
  assert.match(result.stdout, /archify doctor/);
  assert.match(result.stdout, /archify demo \[output-directory\]/);
  assert.match(result.stdout, /archify bundle <dir>/);
  assert.match(result.stdout, /archify locate <base>\.\.<head>/);
  assert.match(result.stdout, /architecture, workflow, sequence, dataflow, lifecycle/);
});

test('cli: doctor reports a complete installation is ready', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] Node\.js v\d+/);
  assert.match(result.stdout, /\[ok\] Core template/);
  assert.match(result.stdout, /\[ok\] Example renderer/);
  assert.match(result.stdout, /\[ok\] Live preview runtime/);
  assert.match(result.stdout, /\[ok\] Scenario recipe guide/);
  assert.match(result.stdout, /\[ok\] Progressive authoring references/);
  assert.match(result.stdout, /\[ok\] Architecture compare runtime and proof fixtures/);
  assert.match(result.stdout, /\[ok\] Standalone schema validators/);
  assert.match(result.stdout, /\[ok\] architecture renderer, schema, and example/);
  assert.match(result.stdout, /\[ok\] lifecycle renderer, schema, and example/);
  assert.match(result.stdout, /Archify is ready\./);
});

test('cli: doctor identifies an incomplete installation', () => {
  const incompleteRoot = path.join(tmp, 'incomplete-skill');
  const incompleteBin = path.join(incompleteRoot, 'bin');
  fs.mkdirSync(incompleteBin, { recursive: true });
  fs.copyFileSync(cli, path.join(incompleteBin, 'archify.mjs'));

  const result = spawnSync(process.execPath, [path.join(incompleteBin, 'archify.mjs'), 'doctor'], {
    cwd: incompleteRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[missing\] Core template/);
  assert.match(result.stdout, /\[missing\] Scenario recipe guide/);
  assert.match(result.stdout, /\[missing\] workflow renderer, schema, and example/);
  assert.match(result.stderr, /Archify is not ready: \d+ required files? missing\./);
});

test('cli: doctor rejects a corrupt standalone validator', () => {
  const corruptRoot = path.join(tmp, 'corrupt-skill');
  copyInstalledSkill(corruptRoot);
  fs.writeFileSync(path.join(corruptRoot, 'renderers/shared/generated-validators.mjs'), 'export const workflow = ;\n');

  const result = spawnSync(process.execPath, [path.join(corruptRoot, 'bin/archify.mjs'), 'doctor'], {
    cwd: corruptRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[invalid\] Standalone schema validators/);
  assert.match(result.stderr, /Archify is not ready: 1 runtime check failed\./);
});

test('cli: examples renders from an installed skill', () => {
  const installedRoot = path.join(tmp, 'installed-skill');
  copyInstalledSkill(installedRoot);

  const result = spawnSync(process.execPath, [path.join(installedRoot, 'bin/archify.mjs'), 'examples'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  for (const output of [
    'workflow-agent-tool-call-rendered.html',
    'sequence-cache-miss-request.html',
    'dataflow-product-analytics.html',
    'lifecycle-agent-run.html',
    'web-app-rendered.html',
  ]) {
    assert.equal(fs.existsSync(path.join(installedRoot, 'examples', output)), true, output);
  }
});

test('cli: guide lists all scenario recipes by diagram type', () => {
  const result = run(['guide']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Archify scenario recipes \(11\)/);
  for (const type of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']) {
    assert.match(result.stdout, new RegExp(`\\[${type}\\]`));
  }
});

test('cli: guide recommends a scenario as structured json', () => {
  const result = run(['guide', 'Show an API request with Redis cache miss', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lang, 'en');
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.recommendation.id, 'api-request');
  assert.equal(parsed.recommendation.type, 'sequence');
});

test('cli: guide detects Chinese and explains the recommendation boundary', () => {
  const result = run(['guide', '展示 Kafka topic 消费者组和死信队列']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /推荐: 事件流拓扑  \[dataflow\]/);
  assert.match(result.stdout, /不要这样用:/);
  assert.match(result.stdout, /必须包含:/);
  assert.match(result.stdout, /可直接复制的提示词:/);
});

test('cli: guide works from an installed skill without node_modules', () => {
  const installedRoot = path.join(tmp, 'installed-guide-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');

  const result = spawnSync(process.execPath, [installedCli, 'guide', 'incident-runbook', '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).recommendation.id, 'incident-runbook');
});

test('cli: demo creates a ready-to-open diagram in a chosen directory', () => {
  const outputDirectory = path.join(tmp, 'my-demo');
  const output = path.join(outputDirectory, 'archify-demo.html');
  const result = run(['demo', outputDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(output), true);
  assert.match(fs.readFileSync(output, 'utf8'), /Sample Web App Diagram/);
  assert.match(result.stdout, new RegExp(`Demo ready: ${output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(result.stdout, /Next: open the HTML in your browser/);
  assert.match(result.stdout, /archify render architecture/);
});

test('cli: demo defaults to the current directory', () => {
  const workingDirectory = path.join(tmp, 'default-demo');
  fs.mkdirSync(workingDirectory);
  const result = run(['demo'], { cwd: workingDirectory });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(workingDirectory, 'archify-demo.html')), true);
});

test('cli: render writes a diagram html file', () => {
  const out = path.join(tmp, 'workflow.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['render', 'workflow', input, out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(out), true);
  assert.match(fs.readFileSync(out, 'utf8'), /Agent Tool Call Workflow/);
});

test('cli: visual-check returns a skipped receipt with exit 2 when Chrome is unavailable', () => {
  const out = path.join(tmp, 'visual-check-skipped.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const missingChrome = path.join(tmp, 'missing-chrome');
  const result = run(['visual-check', out, '--json'], {
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.evidenceKind, 'automated-browser');
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.chrome.status, 'unavailable');
  assert.equal(fs.existsSync(out.replace(/\.html$/, '.visual-check.json')), true);
});

test('cli: visual-check describes human output as automated browser evidence, not visual approval', () => {
  const out = path.join(tmp, 'visual-check-browser-evidence.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const missingChrome = path.join(tmp, 'missing-browser-evidence-chrome');
  const result = run(['visual-check', out], {
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /automated browser evidence skipped:/i);
  assert.match(result.stdout, /perceptual visual review pending/i);
  assert.doesNotMatch(result.stdout, /^visual-check skipped:/m);
});

test('cli: visual-check keeps automated and perceptual claims separate on input failure', () => {
  const result = run(['visual-check', path.join(tmp, 'missing-browser-evidence.html')]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /automated browser evidence failed:/i);
  assert.match(result.stderr, /perceptual visual review pending/i);
  assert.doesNotMatch(result.stderr, /^visual-check failed:/m);
});

test('cli: deliver atomically writes a checked artifact and structured receipt', () => {
  const out = path.join(tmp, 'delivered-workflow.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['deliver', 'workflow', input, out, '--quality', 'showcase', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(out), true);
  assert.match(fs.readFileSync(out, 'utf8'), /Agent Tool Call Workflow/);

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'deliver');
  assert.equal(receipt.type, 'workflow');
  assert.equal(receipt.input, input);
  assert.equal(receipt.output, out);
  assert.deepEqual(receipt.specification, {
    sha256: sha256(input),
    bytes: fs.statSync(input).size,
  });
  assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.artifact.sha256, sha256(out));
  assert.equal(receipt.artifact.bytes, fs.statSync(out).size);
  assert.deepEqual(receipt.validation, {
    checksPassed: 9,
    checkCount: 9,
    compositionProfile: 'showcase',
    compositionStatus: 'pass',
    errors: 0,
    warnings: 0,
  });
  assert.equal('open' in receipt, false);
});

test('cli: deliver --open launches only the committed absolute artifact as one argument', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('successful-open');
  const out = path.join(tmp, `-复杂 path 'quoted'`, 'verified diagram.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['deliver', 'workflow', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.open, {
    requested: true,
    status: 'opened',
    target: out,
    method: process.platform === 'darwin' ? 'open' : 'xdg-open',
  });
  const invocation = JSON.parse(fs.readFileSync(fake.log, 'utf8'));
  assert.equal(invocation.existed, true, 'the opener must run after the atomic commit');
  assert.deepEqual(invocation.argv, [out]);
  assert.equal(invocation.target, out);
  assert.equal(fs.existsSync(out), true);
});

test('cli: opener failure does not invalidate a verified delivery or pollute json stdout', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('failed-open', { exitCode: 17 });
  const out = path.join(tmp, 'open-failure-preserves-delivery.html');
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const result = run(['deliver', 'architecture', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.open.status, 'failed');
  assert.equal(receipt.open.target, out);
  assert.match(result.stderr, /Could not open the verified artifact/);
  assert.match(result.stderr, new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.existsSync(out), true);
  assert.equal(receipt.artifact.sha256, sha256(out));
});

test('cli: deliver failure never invokes the optional opener', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('never-open');
  const input = path.join(tmp, 'invalid-open-delivery.json');
  fs.writeFileSync(input, '{broken json');
  const out = path.join(tmp, 'must-not-open.html');
  const result = run(['deliver', 'architecture', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'input');
  assert.equal(fs.existsSync(fake.log), false);
  assert.equal(fs.existsSync(out), false);
});

test('cli: a missing optional opener module preserves verified delivery with a fallback receipt', () => {
  const installedRoot = path.join(tmp, 'missing-open-module-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  fs.rmSync(path.join(installedRoot, 'bin/open-artifact.mjs'));
  const input = path.join(installedRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'missing-open-module-delivery.html');

  const result = spawnSync(process.execPath, [installedCli, 'deliver', 'workflow', input, out, '--open', '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.open, {
    requested: true,
    status: 'unsupported',
    target: out,
    method: null,
  });
  assert.match(result.stderr, /Open it manually/);
  assert.equal(receipt.artifact.sha256, sha256(out));
});

test('cli: deliver preserves the renderer default output contract', () => {
  const workingDirectory = path.join(tmp, 'delivery-default-output');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'source.architecture.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.output = 'verified-default.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['deliver', 'architecture', input, '--json'], { cwd: workingDirectory });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.output, path.join(fs.realpathSync(workingDirectory), 'verified-default.html'));
  assert.equal(fs.existsSync(receipt.output), true);
});

test('cli: deliver works from an installed skill without node_modules', () => {
  const installedRoot = path.join(tmp, 'installed-deliver-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const cases = [
    ['architecture-boundaries', 'architecture', 'production-deployment.architecture.json'],
    ['architecture-issue-110', 'architecture', 'brand-aware-delivery.architecture.json'],
    ['workflow', 'workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'lifecycle', 'agent-run.lifecycle.json'],
  ];

  for (const [label, type, example] of cases) {
    const input = path.join(installedRoot, 'examples', example);
    const out = path.join(tmp, `installed-${label}-delivery.html`);
    const result = spawnSync(process.execPath, [installedCli, 'deliver', type, input, out, '--json'], {
      cwd: installedRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).validation.checkCount, 9, label);
    assert.equal(fs.existsSync(out), true, label);
    const extracted = extractSvgs(fs.readFileSync(out, 'utf8'));
    assert.equal(extracted.direct.length, 1, `${label}: expected one delivered SVG`);
    assert.doesNotThrow(
      () => parseXml(extracted.direct[0]),
      `${label}: delivered SVG must be well-formed XML`,
    );
  }
});

test('cli: deliver XML guard parses markup instead of scanning attribute-like text', () => {
  assert.doesNotThrow(() => parseXml(
    '<svg xmlns="http://www.w3.org/2000/svg" aria-label="mentions data-node-label safely"/>',
  ));
  assert.throws(
    () => parseXml('<svg xmlns="http://www.w3.org/2000/svg" data-node-label></svg>'),
    /attribute without value/i,
  );
  assert.throws(
    () => parseXml('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
    /unexpected close tag/i,
  );
});

test('cli: preview runs from an installed skill without node_modules and exits cleanly', { timeout: 30000 }, async () => {
  const installedRoot = path.join(tmp, 'installed-preview-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const input = path.join(installedRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'installed-preview.html');
  const child = spawn(process.execPath, [installedCli, 'preview', 'architecture', input, output, '--quality', 'showcase', '--no-open'], {
    cwd: installedRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let previewUrl;
  const started = Date.now();
  while (!previewUrl && Date.now() - started < 8000) {
    previewUrl = stdout.match(/preview (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    if (!previewUrl) await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(previewUrl, `preview URL missing; stdout=${stdout}; stderr=${stderr}`);

  let state;
  while (Date.now() - started < 15000) {
    state = await fetch(new URL('/state', previewUrl)).then((response) => response.json());
    if (state.status === 'verified') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(state?.status, 'verified', `preview did not verify; stdout=${stdout}; stderr=${stderr}`);
  assert.equal(state.revision, 1);
  assert.equal(fs.existsSync(output), true);

  child.kill('SIGTERM');
  const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(stdout, /stopping preview/);
  await assert.rejects(fetch(previewUrl));
  assert.deepEqual(fs.readdirSync(path.dirname(output)).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('cli: deliver preserves the previous artifact when the final check fails', () => {
  const installedRoot = path.join(tmp, 'broken-deliver-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const templatePath = path.join(installedRoot, 'assets/template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(templatePath, template.replace('</body>', '<svg aria-label="accidental second svg"></svg>\n</body>'));

  const input = path.join(installedRoot, 'examples/web-app.architecture.json');
  const out = path.join(tmp, 'preserved-delivery.html');
  const trustedPriorArtifact = '<!doctype html><title>trusted prior artifact</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = spawnSync(process.execPath, [installedCli, 'deliver', 'architecture', input, out, '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'check');
  assert.equal(failure.diagnostics[0].code, 'artifact/single-svg');
  assert.equal(failure.diagnostics[0].subject.check, 'single_svg');
  assert.ok(failure.diagnostics[0].supportedFixes.some((fix) => fix.includes('exactly one diagram SVG')));
  assert.equal(failure.checker.checks.find((entry) => entry.name === 'single_svg').ok, false);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out)).filter((name) => name.includes('.archify-delivery-')),
    [],
  );
});

test('cli: deliver reports renderer failure as json and preserves the previous artifact', () => {
  const input = path.join(tmp, 'invalid-delivery.workflow.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  source.nodes[0].unexpected = true;
  fs.writeFileSync(input, JSON.stringify(source));

  const out = path.join(tmp, 'renderer-failure-preserved.html');
  const trustedPriorArtifact = '<!doctype html><title>last known good</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'render');
  assert.match(failure.error, /schema validation failed/i);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
});

test('cli: deliver reports unreadable input as json without touching the target', () => {
  const input = path.join(tmp, 'malformed-delivery.json');
  fs.writeFileSync(input, '{not valid json');
  const out = path.join(tmp, 'malformed-input-preserved.html');
  const trustedPriorArtifact = '<!doctype html><title>still trusted</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = run(['deliver', 'architecture', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'input');
  assert.match(failure.error, /Could not read delivery input/);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
});

test('cli: invalid source output metadata still fails inside the renderer', () => {
  const workingDirectory = path.join(tmp, 'invalid-output-metadata');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'source.architecture.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.output = 17;
  fs.writeFileSync(input, JSON.stringify(source));
  const out = path.join(workingDirectory, 'architecture.html');
  const trustedPriorArtifact = '<!doctype html><title>metadata did not replace me</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = run(['deliver', 'architecture', input, '--json'], { cwd: workingDirectory });
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'render');
  assert.match(failure.error, /schema validation failed/i);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
});

test('cli: deliver reports commit failure without a false success receipt', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const outputDirectory = path.join(tmp, 'commit-target-is-a-directory.html');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const result = run(['deliver', 'architecture', input, outputDirectory, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'commit');
  assert.match(failure.error, /Could not commit verified delivery/);
  assert.equal(fs.statSync(outputDirectory).isDirectory(), true);
  assert.equal(fs.readdirSync(outputDirectory).length, 0);
});

test('cli: deliver reports preparation failure as json without touching the blocker', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const blockingFile = path.join(tmp, 'delivery-parent-is-a-file');
  fs.writeFileSync(blockingFile, 'do not replace me');
  const out = path.join(blockingFile, 'cannot-write.html');

  const result = run(['deliver', 'architecture', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'prepare');
  assert.match(failure.error, /Could not create delivery directory/);
  assert.equal(fs.readFileSync(blockingFile, 'utf8'), 'do not replace me');
});

test('cli: check validates rendered html', () => {
  const out = path.join(tmp, 'workflow-check.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  assert.equal(run(['render', 'workflow', input, out]).status, 0);

  const result = run(['check', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok": true/);
});

test('cli: validate emits structured json without keeping html output', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const before = new Set(fs.readdirSync(tmp));
  const result = run(['validate', 'workflow', input, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'workflow');
  assert.equal(parsed.checks.length, 9);
  assert.equal(parsed.composition.profile, 'showcase');
  assert.deepEqual(parsed.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(parsed.composition.metrics.containerBorderRuns, 0);
  assert.equal(parsed.composition.metrics.ambiguousCorridors, 0);
  assert.deepEqual(new Set(fs.readdirSync(tmp)), before);
});

test('cli: validate JSON exposes only the primary v1 column-capacity diagnostic', () => {
  const input = path.join(tmp, 'pinned-column-capacity.workflow.json');
  fs.writeFileSync(input, `${JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Pinned issue 126 diagnostic boundary',
      viewBox: [720, 400],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      fromSide: 'top',
      toSide: 'top',
      via: [[220, 60], [300, 60]],
    }],
  }, null, 2)}\n`);

  const result = run(['validate', 'workflow', input, '--json'], {
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'validate');
  assert.equal(failure.stage, 'render');
  assert.equal(failure.type, 'workflow');
  assert.equal(failure.diagnostics.length, 1, JSON.stringify(failure.diagnostics, null, 2));
  const [primary] = failure.diagnostics;
  assert.equal(primary.code, 'workflow/column-capacity');
  assert.equal(primary.subject.edge, 'ab');
  assert.equal(primary.subject.fromCol, 1);
  assert.equal(primary.subject.toCol, 2);
  assert.ok(primary.supportedFixes.length > 0);
  assert.ok(failure.diagnostics.every(({ code }) => (
    code !== 'workflow/explicit-pin-conflict' && code !== 'workflow/viewbox-capacity'
  )));
});

test('cli: --quality overrides the source profile for render, validate, and deliver', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'workflow-standard.html');
  const rendered = run(['render', 'workflow', input, out, '--quality', 'standard']);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /data-quality-profile="standard"/);

  const validated = run(['validate', 'workflow', input, '--quality=standard', '--json']);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).composition.profile, 'standard');

  const deliveredOut = path.join(tmp, 'workflow-delivered-standard.html');
  const delivered = run(['deliver', 'workflow', input, deliveredOut, '--quality=standard', '--json']);
  assert.equal(delivered.status, 0, delivered.stderr);
  assert.equal(JSON.parse(delivered.stdout).validation.compositionProfile, 'standard');
});

test('cli: rejects an unknown quality profile', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['validate', 'workflow', input, '--quality', 'hero']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Expected standard or showcase/);
});

test('cli: rejects a quality flag without a value', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  for (const args of [
    ['validate', 'workflow', input, '--quality'],
    ['deliver', 'workflow', input, '--quality='],
    ['validate', 'workflow', input, '--quality='],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--quality requires standard or showcase/);
  }
});

test('cli: validate rejects unknown flags, layout-json assignment typos, and extra positionals', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const cases = [
    {
      args: ['validate', 'workflow', input, '--layout-json', '--bogus'],
      pattern: /Unknown validate option "--bogus"/,
    },
    {
      args: ['validate', 'workflow', input, '--layout-json=true'],
      pattern: /Unknown validate option "--layout-json=true"/,
    },
    {
      args: ['validate', 'workflow', input, 'unexpected-output.html', '--layout-json'],
      pattern: /Usage:/,
    },
  ];

  for (const { args, pattern } of cases) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, pattern);
  }
});

test('cli: validate and deliver keep argument failures machine-readable with --json', () => {
  const workflow = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const sequence = path.join(skillRoot, 'examples/cache-miss-request.sequence.json');
  const cases = [
    {
      args: ['validate', '--json'],
      command: 'validate',
      code: 'cli/usage',
    },
    {
      args: ['validate', '--json', 'workflow', workflow, '--quality', 'hero'],
      command: 'validate',
      code: 'cli/invalid-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--quality', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--quality=', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--layout-json=true', '--json'],
      command: 'validate',
      code: 'cli/unknown-option',
      subject: { option: '--layout-json=true' },
    },
    {
      args: ['validate', '--bogus', 'payload', 'workflow', workflow, '--json'],
      command: 'validate',
      code: 'cli/unknown-option',
      subject: { option: '--bogus' },
    },
    {
      args: ['validate', 'workflow', workflow, 'unexpected-output.html', '--json'],
      command: 'validate',
      code: 'cli/usage',
    },
    {
      args: ['validate', 'unknown', workflow, '--json'],
      command: 'validate',
      code: 'cli/unknown-diagram-type',
      subject: { type: 'unknown' },
    },
    {
      args: ['validate', 'workflow', workflow, '--repo-root', '.', '--json'],
      command: 'validate',
      code: 'cli/unsupported-option',
      subject: { option: '--repo-root', type: 'workflow' },
    },
    {
      args: ['validate', 'architecture', workflow, '--repo-root=', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--repo-root' },
    },
    {
      args: ['validate', 'sequence', sequence, '--layout-json', '--json'],
      command: 'validate',
      code: 'cli/unsupported-option',
      subject: { option: '--layout-json', type: 'sequence' },
    },
    {
      args: ['deliver', '--json', 'workflow', workflow, '--bogus'],
      command: 'deliver',
      code: 'cli/unknown-option',
      subject: { option: '--bogus' },
    },
    {
      args: ['deliver', '--json'],
      command: 'deliver',
      code: 'cli/usage',
    },
    {
      args: ['deliver', 'workflow', workflow, '--repo-root', '--json'],
      command: 'deliver',
      code: 'cli/missing-option-value',
      subject: { option: '--repo-root' },
    },
    {
      args: ['deliver', 'unknown', workflow, '--json'],
      command: 'deliver',
      code: 'cli/unknown-diagram-type',
      subject: { type: 'unknown' },
    },
    {
      args: ['deliver', 'workflow', workflow, 'diagram.html', 'extra.html', '--json'],
      command: 'deliver',
      code: 'cli/usage',
    },
  ];

  for (const { args, command, code, subject = {} } of cases) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, '');
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.schemaVersion, 1);
    assert.equal(failure.ok, false);
    assert.equal(failure.command, command);
    assert.equal(failure.stage, 'arguments');
    assert.equal('type' in failure, false);
    assert.equal('input' in failure, false);
    assert.equal(failure.diagnostics.length, 1);
    assert.equal(failure.diagnostics[0].code, code);
    assert.equal(failure.diagnostics[0].severity, 'error');
    assert.deepEqual(failure.diagnostics[0].subject, { command, ...subject });
    assert.ok(failure.diagnostics[0].supportedFixes.length > 0);
    assert.equal('stack' in failure, false);
    assert.equal('stack' in failure.diagnostics[0], false);
  }
});

test('cli: inspect emits architecture layout json', () => {
  const input = path.resolve(skillRoot, '../examples/archify-repo-grid.architecture.json');
  const result = run(['inspect', 'architecture', input]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.diagram_type, 'architecture');
  assert.equal(parsed.layout.mode, 'grid');
  assert.ok(parsed.components.length >= 5);
  assert.ok(parsed.connections.length >= 1);
});

test('cli: inspect remains architecture-only while workflow uses validate --layout-json', () => {
  const input = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
  const result = run(['inspect', 'workflow', input]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inspect is currently supported for architecture diagrams only/);
  assert.equal(result.stdout, '');
});

test('cli: validate returns renderer errors for bad input', () => {
  const input = path.join(tmp, 'bad.workflow.json');
  const validateTmp = path.join(tmp, 'validate-failure-tmp');
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  doc.edges[0].to = 'ghost';
  fs.writeFileSync(input, JSON.stringify(doc));
  fs.mkdirSync(validateTmp);

  const result = run(['validate', 'workflow', input], {
    env: { ...process.env, TMPDIR: validateTmp },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown target "ghost"/);
  assert.deepEqual(fs.readdirSync(validateTmp), []);
});

test('cli: validate rejects an unknown type without leaking a temp directory', () => {
  const validateTmp = path.join(tmp, 'validate-unknown-type-tmp');
  fs.mkdirSync(validateTmp);

  const result = run(['validate', 'unknown', 'ignored.json'], {
    env: {
      ...process.env,
      TMPDIR: validateTmp,
      TMP: validateTmp,
      TEMP: validateTmp,
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown diagram type "unknown"/);
  assert.deepEqual(fs.readdirSync(validateTmp), []);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('render rejects a mistyped option instead of writing a file named after it', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'render-guard-'));
  const spec = path.join(dir, 'spec.json');
  fs.copyFileSync(path.join(skillRoot, '../examples/archify-repo.architecture.json'), spec);

  // Without the guard this wrote a 600KB file literally named `--json` and
  // never wrote out.html, exiting 0.
  const result = run(['render', 'architecture', spec, '--json', 'out.html'], { cwd: dir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown render option/);
  assert.deepEqual(fs.readdirSync(dir), ['spec.json']);
});

test('bundle --check --json exits non-zero on a stale child and names bundle/child-stale', () => {
  const dir = stageBundleFixture({ prefix: 'archify-cli-bundle-stale-' });
  try {
    const specPath = path.join(dir, 'payments.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    spec.meta.title = 'Stale child';
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const result = run(['bundle', dir, '--check', '--json']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /bundle\/child-stale/);
  } finally {
    disposeBundleFixture(dir);
  }
});

test('render rejects an extra positional argument', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'render-arity-'));
  const spec = path.join(dir, 'spec.json');
  fs.copyFileSync(path.join(skillRoot, '../examples/archify-repo.architecture.json'), spec);

  const result = run(['render', 'architecture', spec, 'out.html', 'extra.html'], { cwd: dir });

  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(dir), ['spec.json']);
});

function locateCliRepo() {
  const root = fs.mkdtempSync(path.join(tmp, 'locate-cli-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', root, 'init']);
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin/cli.mjs'), 'console.log(1)\n');
  fs.writeFileSync(path.join(root, 'src/main.mjs'), 'export const n = 1\n');
  const map = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Locate CLI' },
    components: [
      { id: 'cli', type: 'frontend', label: 'CLI', pos: [40, 80], size: [120, 60] },
      { id: 'core', type: 'backend', label: 'Core', pos: [240, 80], size: [120, 60] },
    ],
    connections: [{ id: 'cli-core', from: 'cli', to: 'core' }],
  };
  const ownership = {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    excluded: ['vendor/**'],
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  };
  fs.writeFileSync(path.join(root, 'map.architecture.json'), `${JSON.stringify(map, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'map.architecture.ownership.json'), `${JSON.stringify(ownership, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'bin/cli.mjs'), 'console.log(2)\n');
  git('add', '.');
  git('commit', '-m', 'head');
  const head = git('rev-parse', 'HEAD');
  return { root, base, head };
}

function locateMapEditedRepo() {
  const { root, base } = locateCliRepo();
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const map = JSON.parse(fs.readFileSync(path.join(root, 'map.architecture.json'), 'utf8'));
  map.components[0].label = 'CLI edited';
  fs.writeFileSync(path.join(root, 'map.architecture.json'), `${JSON.stringify(map, null, 2)}\n`);
  git('add', 'map.architecture.json');
  git('commit', '-m', 'edit map');
  return { root, base, head: git('rev-parse', 'HEAD') };
}

function locateTypedCliRepo(type) {
  const root = fs.mkdtempSync(path.join(tmp, `locate-cli-${type}-`));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', root, 'init']);
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin/cli.mjs'), 'console.log(1)\n');
  fs.writeFileSync(path.join(root, 'src/main.mjs'), 'export const n = 1\n');
  const mapFile = `map.${type}.json`;
  const map = type === 'workflow'
    ? {
      schema_version: 2,
      diagram_type: 'workflow',
      meta: { title: 'Locate workflow' },
      lanes: [{ id: 'main', label: 'Main' }],
      nodes: [
        { id: 'start', lane: 'main', col: 0, type: 'frontend', label: 'Start' },
        { id: 'end', lane: 'main', col: 1, type: 'backend', label: 'End' },
      ],
      edges: [{ id: 'start-end', from: 'start', to: 'end' }],
    }
    : {
      schema_version: 1,
      diagram_type: 'lifecycle',
      meta: { title: 'Locate lifecycle' },
      lanes: [{ id: 'main', label: 'Main' }],
      states: [
        { id: 'begin', type: 'start', label: 'Begin', lane: 'main', col: 0 },
        { id: 'done', type: 'success', label: 'Done', lane: 'main', col: 1 },
      ],
      transitions: [{ from: 'begin', to: 'done' }],
    };
  const nodeIds = type === 'workflow' ? map.nodes.map((node) => node.id) : map.states.map((state) => state.id);
  const ownership = {
    schema_version: 1,
    kind: 'ownership',
    map: mapFile,
    components: nodeIds.map((id, index) => ({
      id,
      globs: [index === 0 ? 'bin/**' : 'src/**'],
    })),
  };
  fs.writeFileSync(path.join(root, mapFile), `${JSON.stringify(map, null, 2)}\n`);
  fs.writeFileSync(path.join(root, `${mapFile.replace(/\.json$/i, '')}.ownership.json`), `${JSON.stringify(ownership, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'bin/cli.mjs'), 'console.log(2)\n');
  git('add', '.');
  git('commit', '-m', 'head');
  return { root, base, head: git('rev-parse', 'HEAD'), mapPath: path.join(root, mapFile) };
}

test('cli: locate range happy path writes receipt and html', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  const result = run([
    'locate', `${base}..${head}`,
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'locate');
  assert.equal(receipt.ok, true);
  assert.ok(fs.existsSync(path.join(out, 'locate.receipt.json')));
  assert.ok(fs.existsSync(path.join(out, 'locate.html')));
  assert.deepEqual(fs.readdirSync(out).sort(), ['locate.html', 'locate.receipt.json']);
});

test('cli: locate invalid maps identify the field and preserve existing outputs', async (t) => {
  const { root, base, head } = locateCliRepo();
  const mapPath = path.join(root, 'map.architecture.json');
  const original = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'locate.html'), 'trusted HTML');
  fs.writeFileSync(path.join(out, 'locate.receipt.json'), 'trusted receipt');
  const cases = [
    { name: 'invalid JSON', raw: '{broken', message: /Could not parse map/, fix: /JSON syntax/ },
    { name: 'missing diagram_type', field: 'diagram_type', message: /missing required field diagram_type/, fix: /set diagram_type/ },
    ...[null, 7, ''].map((value) => ({ name: `invalid diagram_type ${JSON.stringify(value)}`,
      field: 'diagram_type', value, message: /diagram_type is invalid/, fix: /set diagram_type/ })),
    { name: 'unsupported diagram_type', field: 'diagram_type', value: 'unsupported',
      message: /diagram_type "unsupported" is not a supported Archify diagram type/, fix: /set diagram_type/ },
    { name: 'missing schema_version', field: 'schema_version', message: /schema_version is missing/, fix: /schema_version/ },
    ...[null, '1', 999].map((value) => ({ name: `invalid schema_version ${JSON.stringify(value)}`,
      field: 'schema_version', value, message: /schema_version is invalid/, fix: /schema_version/ })),
    { name: 'invalid map body', field: 'components', value: [], message: /must NOT have fewer than 1 items/, fix: /at least 1 item/ },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const map = structuredClone(original);
      if (Object.hasOwn(entry, 'value')) map[entry.field] = entry.value;
      else if (entry.field) delete map[entry.field];
      const raw = entry.raw ?? JSON.stringify(map);
      fs.writeFileSync(mapPath, raw);
      for (const command of [['--lint', 'HEAD'], [`${base}..${head}`]]) {
        const result = run(['locate', ...command, '--map', mapPath,
          '--repo-root', root, '--out', out, '--json']);
        assert.equal(result.status, 1, result.stderr + result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.equal(payload.command, 'locate');
        const diagnostic = payload.diagnostics[0];
        assert.equal(diagnostic.code, 'locate/map-invalid');
        assert.match(diagnostic.message, entry.message);
        assert.equal(diagnostic.evidence.path, mapPath);
        assert.ok(diagnostic.supportedFixes.some((fix) => entry.fix.test(fix)), JSON.stringify(diagnostic));
        if (['diagram_type', 'schema_version'].includes(entry.field)) {
          assert.equal(diagnostic.subject.path, `/${entry.field}`);
        }
        if (entry.field === 'schema_version' && Object.hasOwn(entry, 'value')) {
          assert.ok(diagnostic.supportedFixes.includes('set schema_version to 1 for architecture'));
        }
        assert.equal(fs.readFileSync(mapPath, 'utf8'), raw);
        assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'trusted HTML');
        assert.equal(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8'), 'trusted receipt');
        assert.deepEqual(fs.readdirSync(out).sort(), ['locate.html', 'locate.receipt.json']);
      }
    });
  }
});

test('cli: locate permits a child map without its optional ownership sidecar', () => {
  const { root, base, head } = locateCliRepo();
  const mapPath = path.join(root, 'map.architecture.json');
  const ownershipPath = path.join(root, 'map.architecture.ownership.json');
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
  ownership.components[0].child_map = 'child.architecture.json';
  fs.writeFileSync(ownershipPath, JSON.stringify(ownership));
  fs.copyFileSync(mapPath, path.join(root, 'child.architecture.json'));
  const out = path.join(root, 'out');
  const result = run(['locate', `${base}..${head}`, '--map', mapPath, '--repo-root', root, '--out', out, '--json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  const component = receipt.components.find((entry) => entry.id === 'cli');
  assert.equal(component.state, 'touched');
  assert.equal(component.childMap, 'child.architecture.json');
  assert.equal(Object.hasOwn(component, 'inside'), false);
  assert.equal(fs.existsSync(path.join(root, 'child.architecture.ownership.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8')), receipt);
  assert.ok(fs.existsSync(path.join(out, 'locate.html')));
});

test('cli: locate reports import_edges_unmapped only when a changed import endpoint lacks ownership', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  const before = path.join(root, 'before.facts.json');
  const after = path.join(root, 'after.facts.json');
  fs.writeFileSync(before, JSON.stringify({ imports: [] }));
  for (const [from, to, fromComponent, toComponent] of [
    ['bin/cli.mjs', 'src/main.mjs', 'cli', 'core'],
    ['docs/entry.mjs', 'src/main.mjs', null, 'core'],
    ['bin/cli.mjs', 'docs/main.mjs', 'cli', null],
  ]) {
    fs.writeFileSync(after, JSON.stringify({ imports: [
      { from, to, specifier: `../${to}`, kind: 'static', line: 1, resolved: true },
    ] }));
    const result = run(['locate', `${base}..${head}`, '--map', path.join(root, 'map.architecture.json'),
      '--repo-root', root, '--out', out, '--facts', before, after, '--json']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const receipt = JSON.parse(result.stdout);
    const unmapped = fromComponent === null || toComponent === null;
    assert.equal(receipt.ok, true);
    assert.deepEqual(receipt.review, {
      required: false, blocking: [], advisory: unmapped ? ['import_edges_unmapped'] : [],
    });
    const imports = receipt.facts.filter((fact) => fact.kind === 'import_edge_change');
    assert.equal(imports.length, 1);
    assert.equal(imports[0].change, 'added');
    assert.deepEqual(imports[0].from, { path: from, componentId: fromComponent });
    assert.deepEqual(imports[0].to, { path: to, componentId: toComponent });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8')), receipt);
    assert.ok(fs.existsSync(path.join(out, 'locate.html')));
  }
});

test('cli: locate map edited in range attaches compare artifacts', () => {
  const { root, base, head } = locateMapEditedRepo();
  const out = path.join(root, 'out');
  const result = run([
    'locate', `${base}..${head}`,
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'locate');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.mapDelta.status, 'compared');
  assert.ok(receipt.mapDelta.receiptPath);
  assert.ok(fs.existsSync(path.join(out, receipt.mapDelta.receiptPath)));
  assert.ok(fs.existsSync(path.join(out, 'compare', 'map-delta.receipt.json')));
});

test('cli: locate changed workflow map retains its receipt when compare has unsupported-type', () => {
  const { root, base, mapPath } = locateTypedCliRepo('workflow');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  map.nodes[0].label = 'Edited start';
  fs.writeFileSync(mapPath, JSON.stringify(map));
  execFileSync('git', ['-C', root, 'add', mapPath]);
  execFileSync('git', ['-C', root, 'commit', '-m', 'edit workflow map']);
  const out = path.join(root, 'out');
  const result = run(['locate', `${base}..HEAD`, '--map', mapPath, '--repo-root', root, '--out', out, '--json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.map.diagramType, 'workflow');
  assert.equal(receipt.mapDelta.status, 'unsupported-type');
  assert.equal(receipt.mapDelta.htmlPath, undefined);
  assert.equal(receipt.mapDelta.receiptPath, undefined);
  assert.ok(receipt.review.blocking.includes('map_changed'));
  assert.equal(receipt.review.required, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8')), receipt);
  assert.match(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), /Locate receipt only\./);
  assert.deepEqual(fs.readdirSync(out).sort(), ['locate.html', 'locate.receipt.json']);
});

test('cli: locate workflow map writes receipt-only html', () => {
  const { root, base, head, mapPath } = locateTypedCliRepo('workflow');
  const out = path.join(root, 'out');
  const result = run([
    'locate', `${base}..${head}`,
    '--map', mapPath,
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'locate');
  assert.equal(receipt.map.diagramType, 'workflow');
  const html = fs.readFileSync(path.join(out, 'locate.html'), 'utf8');
  assert.match(html, /Locate receipt only\./);
  assert.ok(fs.existsSync(path.join(out, 'locate.receipt.json')));
});

test('cli: locate lifecycle map writes receipt-only html', () => {
  const { root, base, head, mapPath } = locateTypedCliRepo('lifecycle');
  const out = path.join(root, 'out');
  const result = run([
    'locate', `${base}..${head}`,
    '--map', mapPath,
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'locate');
  assert.equal(receipt.map.diagramType, 'lifecycle');
  const html = fs.readFileSync(path.join(out, 'locate.html'), 'utf8');
  assert.match(html, /Locate receipt only\./);
  assert.ok(fs.existsSync(path.join(out, 'locate.receipt.json')));
});

test('cli: locate treats an absent pinned map revision as advisory', async () => {
  const { measureMapBehind } = await import('../locate/cli.mjs');
  const { root, base, head } = locateCliRepo();
  const fake = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.deepEqual(measureMapBehind(root, fake, head), { mapRevisionUnavailable: true });
  const receipt = (await import('../locate/locate.mjs')).locateRange({
    base,
    head,
    map: {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Locate CLI', repository: { url: 'https://github.com/example/repo', revision: fake } },
      components: [
        { id: 'cli', type: 'frontend', label: 'CLI' },
        { id: 'core', type: 'backend', label: 'Core' },
      ],
    },
    ownership: {
      components: [
        { id: 'cli', globs: ['bin/**'] },
        { id: 'core', globs: ['src/**'] },
      ],
    },
    changes: [{ changeType: 'M', path: 'bin/cli.mjs' }],
    headTree: ['bin/cli.mjs', 'src/main.mjs'],
    mapRevisionUnavailable: true,
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(receipt.map.revision, fake);
  assert.equal(receipt.map.mapBehindBy, undefined);
  assert.ok(receipt.review.advisory.includes('map_revision_unavailable'));
  assert.ok(!receipt.review.advisory.includes('map_behind'));
});

test('cli: locate --lint accepts a safe/ path segment', () => {
  const { root } = locateCliRepo();
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(root, 'tpl/safe'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tpl/safe/safe.go'), 'package safe\n');
  execFileSync('git', ['-C', root, 'add', 'tpl/safe/safe.go']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'safe']);
  const result = run([
    'locate', '--lint', 'HEAD',
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8'));
  assert.equal(receipt.files.some((file) => file.path === 'tpl/safe/safe.go'), true);
  assert.equal(receipt.summary.files.ambiguous, 0);
});

test('cli: locate --lint ambiguous exits 1', () => {
  const { root } = locateCliRepo();
  const out = path.join(root, 'out');
  const ownership = JSON.parse(fs.readFileSync(path.join(root, 'map.architecture.ownership.json'), 'utf8'));
  ownership.components = [
    { id: 'cli', globs: ['src/**'] },
    { id: 'core', globs: ['src/**'] },
  ];
  fs.writeFileSync(path.join(root, 'map.architecture.ownership.json'), `${JSON.stringify(ownership, null, 2)}\n`);
  const result = run([
    'locate', '--lint', 'HEAD',
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostics[0].code, 'locate/ambiguous-ownership');
  assert.ok(payload.diagnostics.some((item) => item.subject.path === 'src/main.mjs'));
});

test('cli: locate invalid range exits 2', () => {
  const result = run(['locate', 'not-a-range', '--map', 'map.architecture.json']);
  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /locate\/range-invalid/);
});

test('cli: locate three-dot range is range-invalid, not a dotted revision', () => {
  const result = run(['locate', 'abc...def', '--map', 'map.architecture.json', '--json']);
  assert.equal(result.status, 2, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.diagnostics[0].code, 'locate/range-invalid');
  assert.match(payload.error, /two-dot/);
  assert.doesNotMatch(payload.error, /"\.def"/);
});

test('cli: locate unknown revision is range-invalid exit 2', () => {
  const { root } = locateCliRepo();
  const out = path.join(root, 'out');
  const result = run([
    'locate', 'this-rev-does-not-exist..HEAD',
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--json',
  ]);
  assert.equal(result.status, 2, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.diagnostics[0].code, 'locate/range-invalid');
  assert.equal(typeof payload.diagnostics[0].evidence.stderr, 'string');
  assert.ok(payload.diagnostics[0].evidence.stderr.length > 0);
});

test('cli: locate without --out exits 2', () => {
  const { root, base, head } = locateCliRepo();
  const result = run([
    'locate', `${base}..${head}`,
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
  ]);
  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /--out/);
});

test('cli: locate failing run does not leak staging', () => {
  const { root, base, head } = locateCliRepo();
  const cwd = fs.mkdtempSync(path.join(tmp, 'locate-cwd-'));
  const out = path.join(root, 'out');
  const result = run([
    'locate', `${base}..${head}`,
    '--map', path.join(root, 'map.architecture.json'),
    '--repo-root', root,
    '--out', out,
    '--facts', path.join(root, 'missing-before.json'), path.join(root, 'missing-after.json'),
    '--json',
  ], { cwd });
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const cwdEntries = fs.readdirSync(cwd);
  assert.equal(cwdEntries.some((name) => name.startsWith('.archify-locate-')), false);
  assert.equal(cwdEntries.includes('locate.html'), false);
  assert.equal(cwdEntries.includes('locate.receipt.json'), false);
  const outEntries = fs.existsSync(out) ? fs.readdirSync(out) : [];
  assert.equal(outEntries.some((name) => name.startsWith('.archify-locate-')), false);
});


test('cli: locate accepts a map first added in the requested range', () => {
  const { root, head } = locateCliRepo();
  const tree = execFileSync('git', ['-C', root, 'mktree'], { input: '', encoding: 'utf8' }).trim();
  const base = execFileSync('git', ['-C', root, 'commit-tree', tree, '-m', 'empty baseline'], { encoding: 'utf8' }).trim();
  const out = path.join(root, 'added-out');
  const result = run(['locate', `${base}..${head}`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.mapDelta.status, 'added');
  assert.ok(receipt.review.blocking.includes('map_changed'));
  assert.equal(fs.existsSync(path.join(out, 'compare')), false);
  assert.ok(fs.existsSync(path.join(out, 'locate.receipt.json')));
});


test('cli: incomplete bundle fails before replacing existing locate outputs', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'locate.html'), 'previous HTML');
  fs.writeFileSync(path.join(out, 'locate.receipt.json'), 'previous receipt');
  const manifest = {
    schema_version: 1, bundle_type: 'drilldown', entry: 'parent',
    diagrams: ['parent', 'child'].map((id, level) => ({ id, file: `${id}.html`, title: id,
      diagram_type: 'architecture', level, spec_sha256: 'a'.repeat(64), artifact_sha256: 'b'.repeat(64) })),
    drilldowns: [{ parent: 'parent', component: 'cli', child: 'child' }],
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const result = run(['locate', `${base}..${head}`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--bundle', root, '--json']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'locate/bundle-invalid');
  assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'previous HTML');
  assert.equal(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8'), 'previous receipt');
});

test('cli: malformed bundle returns diagnostics without publishing outputs', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  fs.writeFileSync(path.join(root, 'manifest.json'), '{broken');
  const result = run(['locate', `${base}..${head}`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--bundle', root, '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'locate/bundle-invalid');
  assert.deepEqual(fs.readdirSync(out), []);
});


test('cli: a failed output rename restores the previous locate pair', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'locate.html'), 'old html');
  fs.writeFileSync(path.join(out, 'locate.receipt.json'), 'old receipt');
  const preload = path.join(root, 'rename-failure.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const rename = fs.renameSync;
let failed = false;
fs.renameSync = function (source, target) {
  if (!failed && String(source).endsWith('/locate.receipt.json') && String(target) === ${JSON.stringify(path.join(out, 'locate.receipt.json'))}) {
    failed = true;
    throw new Error('injected receipt rename failure');
  }
  return rename.apply(this, arguments);
};`);
  const result = run(['locate', `${base}..${head}`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--json'],
  { env: { ...process.env, NODE_OPTIONS: `--import=${preload}` } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'locate/internal');
  assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'old html');
  assert.equal(fs.readFileSync(path.join(out, 'locate.receipt.json'), 'utf8'), 'old receipt');
});


test('cli: bundle output commits with the receipt and refuses non-file destinations', () => {
  const { root, base, head } = locateCliRepo();
  const out = path.join(root, 'out');
  const bundle = path.join(root, 'bundle');
  fs.mkdirSync(bundle);
  fs.copyFileSync(path.join(root, 'map.architecture.json'), path.join(bundle, 'entry.json'));
  const rendered = run(['render', 'architecture', path.join(bundle, 'entry.json'), path.join(bundle, 'entry.html')]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const built = run(['bundle', bundle, '--json']);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const args = ['locate', `${base}..${head}`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--bundle', bundle, '--json'];
  const first = run(args);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const projected = path.join(out, 'map.architecture.locate.html');
  assert.match(fs.readFileSync(projected, 'utf8'), /archify-locate-projection/);
  fs.unlinkSync(projected);
  fs.mkdirSync(projected);
  fs.writeFileSync(path.join(out, 'locate.html'), 'keep this HTML');
  const second = run(args);
  assert.equal(second.status, 1);
  assert.equal(JSON.parse(second.stdout).diagnostics[0].code, 'locate/out-directory');
  assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'keep this HTML');
});


test('cli: Locate accepts a changed filename containing Infinity', () => {
  const { root, base } = locateCliRepo();
  fs.writeFileSync(path.join(root, 'bin/Infinity.ts'), 'export const value = 1;');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'valid filename']);
  const out = path.join(root, 'out');
  const result = run(['locate', `${base}..HEAD`, '--repo-root', root,
    '--map', path.join(root, 'map.architecture.json'), '--out', out, '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(JSON.parse(result.stdout).files.some(file => file.path === 'bin/Infinity.ts'));
});


test('cli: a renamed map compares its old baseline path and retains the Locate receipt', () => {
  const { root, base } = locateCliRepo();
  execFileSync('git', ['-C', root, 'mv', 'map.architecture.json', 'renamed.architecture.json']);
  const ownership = JSON.parse(fs.readFileSync(path.join(root, 'map.architecture.ownership.json')));
  ownership.map = 'renamed.architecture.json';
  fs.writeFileSync(path.join(root, 'renamed.architecture.ownership.json'), JSON.stringify(ownership));
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'rename map']);
  const out = path.join(root, 'out');
  const args = ['locate', `${base}..HEAD`, '--repo-root', root,
    '--map', path.join(root, 'renamed.architecture.json'), '--out', out, '--json'];
  const first = run(args);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const receipt = JSON.parse(first.stdout);
  assert.equal(receipt.mapDelta.baseBlob, `${base}:map.architecture.json`);
  assert.equal(receipt.mapDelta.status, 'compared');
  assert.ok(receipt.review.blocking.includes('map_changed'));
  fs.rmSync(path.join(out, 'compare'), { recursive: true });
  fs.writeFileSync(path.join(out, 'compare'), 'reserved by user');
  const second = run(args);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(JSON.parse(second.stdout).mapDelta.status, 'compare-failed');
  assert.equal(fs.readFileSync(path.join(out, 'compare'), 'utf8'), 'reserved by user');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'locate.receipt.json'))).mapDelta.status, 'compare-failed');
});
