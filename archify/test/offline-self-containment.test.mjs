import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFontCss, assertOfflineArtifact, inspectDocuments } from './helpers/offline-fonts.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(skillRoot, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const DIAGRAMS = [
  ['architecture', 'web-app.architecture.json', 'web-app-rendered.html'],
  ['workflow', 'agent-tool-call.workflow.json', 'workflow-agent-tool-call-rendered.html'],
  ['sequence', 'cache-miss-request.sequence.json', 'sequence-cache-miss-request.html'],
  ['dataflow', 'product-analytics.dataflow.json', 'dataflow-product-analytics.html'],
  ['lifecycle', 'agent-run.lifecycle.json', 'lifecycle-agent-run.html'],
];

test('the viewer template carries its own font and readable provenance', () => {
  assertOfflineArtifact(template, 'template');
  const license = fs.readFileSync(path.join(skillRoot, 'assets/JetBrainsMono-OFL.txt'), 'utf8').trim();
  assert.ok(inspectDocuments(template)[0].styles.some((css) => css.includes(license)), 'standalone font CSS must carry the full license');
  const notices = fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /## JetBrains Mono/);
  assert.match(notices, /assets\/JetBrainsMono-OFL\.txt/);
});

test('font checks accept equivalent CSS but reject missing bytes, coverage and local overrides', () => {
  const css = inspectDocuments(template)[0].styles.join('\n');
  const reordered = css.replaceAll("font-family: 'JetBrains Mono'; font-style: normal;", 'font-style:normal; font-family:"JetBrains Mono";');
  assertFontCss(reordered, 'equivalent CSS');
  assert.throws(() => assertFontCss(css.replace(/@font-face\s*\{[^}]+\}/, ''), 'missing face'));
  assert.throws(() => assertFontCss(css.replace('base64,', 'base64,A'), 'corrupt bytes'));
  assert.throws(() => assertFontCss(css.replace('U+0460-052F', 'U+0460-052E'), 'missing character'));
  assert.throws(() => assertFontCss(css.replace('src: url(', "src: local('JetBrains Mono'), url("), 'local override'));
});

test('each compare srcdoc must carry its own font and reject external resources', () => {
  const frame = (html) => `<iframe srcdoc="${html.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}"></iframe>`;
  const emptyFont = template.replace(/@font-face\s*\{[^}]+\}/g, '');
  assert.equal(assertOfflineArtifact(frame(template) + frame(template), 'compare'), 2);
  assert.throws(() => assertOfflineArtifact(frame(template) + frame(emptyFont), 'compare'), /srcdoc\[1\]/);
  for (const resource of ['<link rel="stylesheet" href="//fonts.example/font.css">', '<style>@import "https://fonts.example/font.css";</style>', '<img srcset="https://images.example/1.png 1x, https://images.example/2.png 2x">']) {
    assert.throws(() => assertOfflineArtifact(frame(template) + frame(template + resource), 'compare'), /external subresource/);
  }
  assertOfflineArtifact(template + '<!-- https://github.com/JetBrains/JetBrainsMono --><a href="https://github.com/JetBrains/JetBrainsMono">Source</a>', 'attribution');
});

test('a freshly delivered artifact of every type reaches no external origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-offline-'));
  try {
    for (const [type, input] of DIAGRAMS) {
      const output = path.join(dir, `${type}.html`);
      const result = spawnSync(process.execPath, [cli, 'deliver', type, path.join(skillRoot, 'examples', input), output, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${type}: ${result.stderr}`);
      assertOfflineArtifact(fs.readFileSync(output, 'utf8'), type);
    }
    const output = path.join(dir, 'compare.html');
    const result = spawnSync(process.execPath, [cli, 'compare', 'architecture', path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'), path.join(skillRoot, 'examples/checkout-platform.head.architecture.json'), output, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(assertOfflineArtifact(fs.readFileSync(output, 'utf8'), 'fresh compare'), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every checked-in viewer artifact carries its font and reaches no external origin', () => {
  // Delivery-chain roots only; frozen experiments are not maintained viewers.
  const tracked = spawnSync('git', ['ls-files', '-z', '--', 'archify/examples', 'docs', 'examples'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(tracked.status, 0, tracked.stderr);
  const artifacts = tracked.stdout.split('\0').filter((entry) => entry.endsWith('.html'))
    .filter((entry) => /Archify\.readerLayout/.test(fs.readFileSync(path.join(repoRoot, entry), 'utf8')));
  for (const required of ['examples/checkout-platform-delta.html', ...DIAGRAMS.map(([, , output]) => `archify/examples/${output}`)]) {
    assert.ok(artifacts.includes(required), `missing delivery-chain artifact: ${required}`);
  }
  for (const relative of artifacts) assertOfflineArtifact(fs.readFileSync(path.join(repoRoot, relative), 'utf8'), relative);
});
