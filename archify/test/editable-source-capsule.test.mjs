import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-source-capsule-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function sourcePayload(html) {
  const match = html.match(/<script id="archify-source-capsule" type="application\/json" data-source-filename="([^"]*)" data-source-sha256="([a-f0-9]{64})">([\s\S]*?)<\/script>/);
  assert.ok(match, 'source capsule script missing');
  return { filename: match[1], digest: match[2], diagram: JSON.parse(match[3]) };
}

function copyInstalledSkill(target) {
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(skillRoot, source);
      return relative !== 'node_modules' && !relative.startsWith(`node_modules${path.sep}`)
        && relative !== 'test' && !relative.startsWith(`test${path.sep}`)
        && !relative.startsWith('.validator-check-');
    },
  });
}

test('source capsule is opt-in and absent from every default renderer output', () => {
  for (const [type, example] of Object.entries(CASES)) {
    const input = path.join(skillRoot, 'examples', example);
    const output = path.join(tmp, `default-${type}.html`);
    const result = run(['render', type, input, output]);

    assert.equal(result.status, 0, `${type}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /id="archify-source-capsule"/, type);
    assert.match(html, /data-action="source-json"[^>]*hidden[^>]*disabled/, type);
  }
});

test('cli default fails closed even when a parent process exports the internal renderer variable', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'inherited-env-stays-private.html');
  const result = run(['render', 'architecture', input, output], {
    env: { ...process.env, ARCHIFY_INCLUDE_SOURCE: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /id="archify-source-capsule"/);

  const demoRoot = path.join(tmp, 'poisoned-demo');
  const demoResult = run(['demo', demoRoot], {
    env: { ...process.env, ARCHIFY_INCLUDE_SOURCE: '1' },
  });
  assert.equal(demoResult.status, 0, demoResult.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(demoRoot, 'archify-demo.html'), 'utf8'), /id="archify-source-capsule"/);
});

test('--with-source carries validated JSON and only the input basename across all five modes', () => {
  for (const [type, example] of Object.entries(CASES)) {
    const input = path.join(skillRoot, 'examples', example);
    const output = path.join(tmp, `editable-${type}.html`);
    const result = run(['render', type, input, output, '--with-source']);

    assert.equal(result.status, 0, `${type}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    const capsule = sourcePayload(html);
    const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.equal(capsule.filename, example, type);
    assert.deepEqual(capsule.diagram, JSON.parse(fs.readFileSync(input, 'utf8')), type);
    assert.equal(
      capsule.digest,
      createHash('sha256').update(JSON.stringify(capsule.diagram, null, 2), 'utf8').digest('hex'),
      `${type}: capsule digest`,
    );
    assert.doesNotMatch(html, new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${type}: absolute input path leaked`);
    assert.doesNotMatch(svg, /archify-source-capsule|source-json|Source JSON/, `${type}: source leaked into canonical SVG`);
  }
});

test('source capsule escapes script-closing input while preserving the decoded source', () => {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Safe </script><script id="source-injection"> title';
  const input = path.join(tmp, 'hostile.architecture.json');
  const output = path.join(tmp, 'hostile.html');
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'architecture', input, output, '--with-source']);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const capsule = sourcePayload(html);

  assert.equal(capsule.diagram.meta.title, source.meta.title);
  assert.doesNotMatch(html, /<script id="source-injection">/);
  assert.match(html, /Safe &lt;\/script&gt;&lt;script id=&quot;source-injection&quot;&gt; title/);
  assert.ok(html.includes('Safe \\u003c/script\\u003e\\u003cscript id=\\"source-injection\\"\\u003e title'));
});

test('deliver reports an editable capsule only when explicitly requested', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const defaultOutput = path.join(tmp, 'delivered-default.html');
  const editableOutput = path.join(tmp, 'delivered-editable.html');

  const defaultResult = run(['deliver', 'workflow', input, defaultOutput, '--json']);
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.equal('sourceCapsule' in JSON.parse(defaultResult.stdout), false);
  assert.doesNotMatch(fs.readFileSync(defaultOutput, 'utf8'), /id="archify-source-capsule"/);

  const editableResult = run(['deliver', 'workflow', input, editableOutput, '--with-source', '--json']);
  assert.equal(editableResult.status, 0, editableResult.stderr);
  const receipt = JSON.parse(editableResult.stdout);
  assert.deepEqual(receipt.sourceCapsule, {
    included: true,
    filename: 'agent-tool-call.workflow.json',
  });
  assert.equal(receipt.validation.checksPassed, receipt.validation.checkCount);
  assert.deepEqual(sourcePayload(fs.readFileSync(editableOutput, 'utf8')).diagram, JSON.parse(fs.readFileSync(input, 'utf8')));
});

test('editable delivery works from the zero-install skill without node_modules', () => {
  const installedRoot = path.join(tmp, 'installed-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const input = path.join(installedRoot, 'examples/agent-run.lifecycle.json');
  const output = path.join(tmp, 'installed-editable.html');
  const result = spawnSync(process.execPath, [
    installedCli, 'deliver', 'lifecycle', input, output, '--with-source', '--json',
  ], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sourceCapsule.included, true);
  assert.equal(sourcePayload(fs.readFileSync(output, 'utf8')).diagram.diagram_type, 'lifecycle');
});

test('bundled examples stay source-free under a poisoned parent environment', () => {
  const installedRoot = path.join(tmp, 'poisoned-examples-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const result = spawnSync(process.execPath, [installedCli, 'examples'], {
    cwd: installedRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_INCLUDE_SOURCE: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  for (const output of [
    'workflow-agent-tool-call-rendered.html',
    'sequence-cache-miss-request.html',
    'dataflow-product-analytics.html',
    'lifecycle-agent-run.html',
    'web-app-rendered.html',
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(installedRoot, 'examples', output), 'utf8'), /id="archify-source-capsule"/, output);
  }
});

test('editable source uses one portable basename in both artifact and receipt', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'));
  const input = path.join(tmp, ' odd\\name.json ');
  const output = path.join(tmp, 'portable-filename.html');
  fs.writeFileSync(input, source);

  const result = run(['deliver', 'architecture', input, output, '--with-source', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const capsule = sourcePayload(fs.readFileSync(output, 'utf8'));
  assert.equal(receipt.sourceCapsule.filename, 'odd-name.json');
  assert.equal(capsule.filename, receipt.sourceCapsule.filename);
});

test('viewer exposes a bounded source JSON download only when a valid capsule exists', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'viewer-source.html');
  const result = run(['render', 'architecture', input, output, '--with-source']);

  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /Source JSON[\s\S]*?<span class="hint">editable<\/span>/);
  assert.match(html, /function readSourceCapsule\(\)/);
  assert.match(html, /data-source-sha256/);
  assert.match(html, /requiredArrays: \['lanes', 'nodes', 'edges'\]/);
  assert.match(html, /requiredArrays: \['stages', 'nodes', 'flows'\]/);
  assert.match(html, /requiredArrays: \['lanes', 'states', 'transitions'\]/);
  assert.match(html, /sha256Hex\(sourceCandidate\.canonicalJson\)/);
  assert.match(html, /actualDigest !== sourceCandidate\.expectedDigest/);
  assert.match(html, /diagram\.diagram_type !== renderedType/);
  assert.match(html, /Object\.keys\(renderedNodes\)\.length !== sourceNodes\.length/);
  assert.match(html, /Object\.keys\(renderedEdges\)\.length !== sourceEdges\.length/);
  assert.match(html, /renderedEdge\.getAttribute\('data-edge-from'\) !== sourceEdge\.from/);
  assert.match(html, /sourceItem\.hidden = false;/);
  assert.match(html, /new Blob\(\[sourceCapsule\.json\], \{ type: 'application\/json;charset=utf-8' \}\)/);
  assert.match(html, /recordExportReceipt\('source-json', blob, true\)/);
  assert.match(html, /download\(blob, sourceCapsule\.filename\)/);
  assert.match(html, /['"]source-json['"]:\s*runSourceJson/);
  assert.match(html, /if \(!sourceCapsule\)[\s\S]*?Source JSON was not included in this artifact/);
});

test('cli help presents --with-source as an explicit privacy choice', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--with-source/);
  assert.match(result.stdout, /opt-in/i);
});

test('skill and concise READMEs keep editable source behind a user choice', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /--with-source/);
  assert.match(skill, /default(?:s)? (?:to )?off/i);
  assert.match(skill, /absolute path/i);
  assert.match(skill, /ask|offer the choice/i);

  for (const readme of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const text = fs.readFileSync(path.join(repoRoot, readme), 'utf8');
    assert.match(text, /--with-source/, readme);
    assert.match(text, /default|默认/i, readme);
    assert.match(text, /source JSON|源 JSON/i, readme);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
