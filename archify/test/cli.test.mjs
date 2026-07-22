import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.match(result.stdout, /archify deliver <type>/);
  assert.match(result.stdout, /archify guide \[scenario or question\]/);
  assert.match(result.stdout, /archify doctor/);
  assert.match(result.stdout, /archify demo \[output-directory\]/);
  assert.match(result.stdout, /architecture, workflow, sequence, dataflow, lifecycle/);
});

test('cli: doctor reports a complete installation is ready', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] Node\.js v\d+/);
  assert.match(result.stdout, /\[ok\] Core template/);
  assert.match(result.stdout, /\[ok\] Example renderer/);
  assert.match(result.stdout, /\[ok\] Scenario recipe guide/);
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
  assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.artifact.sha256, sha256(out));
  assert.equal(receipt.artifact.bytes, fs.statSync(out).size);
  assert.deepEqual(receipt.validation, {
    checksPassed: 8,
    checkCount: 8,
    compositionProfile: 'showcase',
    compositionStatus: 'pass',
    errors: 0,
    warnings: 0,
  });
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
  const cases = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };

  for (const [type, example] of Object.entries(cases)) {
    const input = path.join(installedRoot, 'examples', example);
    const out = path.join(tmp, `installed-${type}-delivery.html`);
    const result = spawnSync(process.execPath, [installedCli, 'deliver', type, input, out, '--json'], {
      cwd: installedRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${type}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).validation.checkCount, 8, type);
    assert.equal(fs.existsSync(out), true, type);
  }
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
  const outputDirectory = path.join(tmp, 'commit-target-is-a-directory');
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
  assert.equal(parsed.checks.length, 8);
  assert.equal(parsed.composition.profile, 'showcase');
  assert.deepEqual(parsed.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(parsed.composition.metrics.containerBorderRuns, 0);
  assert.equal(parsed.composition.metrics.ambiguousCorridors, 0);
  assert.deepEqual(new Set(fs.readdirSync(tmp)), before);
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
