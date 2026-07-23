import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preset-tryon-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, preset = 'classic') {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode]), 'utf8'));
  source.meta.visual_preset = preset;
  source.meta.animation = 'none';
  const input = path.join(tmp, `${mode}-${preset}.json`);
  const output = path.join(tmp, `${mode}-${preset}.html`);
  fs.writeFileSync(input, JSON.stringify(source));
  execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output]);
  return fs.readFileSync(output, 'utf8');
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function presetRuntime(html) {
  return html.match(/Archify\.preset = \(function \(\) \{[\s\S]*?\n    \}\)\(\);/)?.[0] || '';
}

test('all five renderers expose one reader-controlled visual style cycle', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /id="btn-preset"/, mode);
    assert.match(html, /id="preset-label"/, mode);
    assert.match(html, /title="Cycle visual style \(S\)"/, mode);
    assert.match(html, /Archify\.preset = \(function \(\)/, mode);
    assert.match(html, /S -> cycle visual style/, mode);
  }
});

test('style cycle synchronizes page and canonical SVG without touching geometry', () => {
  const html = render('architecture');
  const runtime = presetRuntime(html);
  assert.match(runtime, /\['classic', 'signal-flow', 'blueprint', 'editorial'\]/);
  assert.match(runtime, /html\.setAttribute\('data-preset', preset\)/);
  assert.match(runtime, /svg\.setAttribute\('data-preset', preset\)/);
  assert.match(runtime, /data-preset-option/);
  assert.match(runtime, /return \{ cycle: cycle, apply: apply, current: current, authored: authored \}/);
});

test('style try-on is session-only and unavailable to passive embeds', () => {
  const html = render('workflow', 'signal-flow');
  const runtime = presetRuntime(html);
  assert.match(runtime, /html\.getAttribute\('data-embed'\) === 'true'/);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage|history\.|location\.|URLSearchParams/);
  assert.match(html, /html\[data-embed="true"\] \.toolbar/);
  assert.match(html, /@media print/);
});

test('same topology keeps identical canonical SVG geometry across all four styles', () => {
  const normalize = (svg) => svg.replace(/ data-preset="(?:classic|signal-flow|blueprint|editorial)"/, '');
  const variants = ['classic', 'signal-flow', 'blueprint', 'editorial'].map((preset) => normalize(svgBlock(render('architecture', preset))));
  assert.equal(variants[1], variants[0]);
  assert.equal(variants[2], variants[0]);
  assert.equal(variants[3], variants[0]);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
