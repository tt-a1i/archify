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

function render(mode, preset) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode]), 'utf8'));
  if (preset === undefined) delete source.meta.visual_preset;
  else source.meta.visual_preset = preset;
  source.meta.animation = 'none';
  const fixtureName = preset || 'default';
  const input = path.join(tmp, `${mode}-${fixtureName}.json`);
  const output = path.join(tmp, `${mode}-${fixtureName}.html`);
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

test('all five renderers expose one reader-controlled visual style picker', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /id="btn-preset"[^>]+aria-haspopup="menu"[^>]+aria-controls="preset-menu"/, mode);
    assert.match(html, /id="preset-label"/, mode);
    assert.match(html, /title="Choose visual style \(S cycles\)"/, mode);
    assert.match(html, /id="preset-menu" role="menu" aria-label="Visual style"/, mode);
    for (const preset of ['classic', 'signal-flow', 'blueprint', 'editorial']) {
      assert.match(html, new RegExp(`data-preset-value="${preset}"[^>]+role="menuitemradio"`), `${mode}: ${preset}`);
    }
    assert.match(html, /Archify\.preset = \(function \(\)/, mode);
    assert.match(html, /S -> cycle visual style/, mode);
  }
});

test('style selection synchronizes page, picker, and canonical SVG without touching geometry', () => {
  const html = render('architecture');
  const runtime = presetRuntime(html);
  assert.match(runtime, /\['classic', 'signal-flow', 'blueprint', 'editorial'\]/);
  assert.match(runtime, /html\.setAttribute\('data-preset', preset\)/);
  assert.match(runtime, /svg\.setAttribute\('data-preset', preset\)/);
  assert.match(runtime, /data-preset-option/);
  assert.match(runtime, /option\.setAttribute\('aria-checked', String\(selected\)\)/);
  assert.match(runtime, /return \{ cycle: cycle, apply: apply, current: current, authored: authored, open: open, close: close, isOpen: isOpen \}/);
});

test('omitted visual preset opens as Classic and theme switching cannot change it', () => {
  const html = render('architecture');
  const themeRuntime = html.match(/Archify\.theme = \(function \(\) \{[\s\S]*?\n    \}\)\(\);/)?.[0] || '';
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="classic"/);
  assert.match(svgBlock(html), /<svg\b[^>]* data-preset="classic"/);
  assert.match(themeRuntime, /html\.setAttribute\('data-theme', theme\)/);
  assert.doesNotMatch(themeRuntime, /data-preset|Archify\.preset/);
});

test('style picker follows the accessible menu-button interaction contract', () => {
  const html = render('architecture');
  const runtime = presetRuntime(html);
  assert.match(runtime, /function open\(focusLast\)/);
  assert.match(runtime, /function close\(focusTrigger\)/);
  assert.match(runtime, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  assert.match(runtime, /e\.key === 'Escape'/);
  assert.match(runtime, /e\.key === 'Tab'/);
  assert.match(runtime, /case 'Home':/);
  assert.match(runtime, /case 'End':/);
  assert.match(runtime, /document\.addEventListener\('click'/);
  assert.match(html, /\.preset-option-swatch\.editorial/);
  assert.match(
    html,
    /@media \(max-width: 720px\)[\s\S]*?\.toolbar \{[\s\S]*?position: relative;/,
    'the mobile toolbar must preserve its stacking context so the fixed preset menu stays above guided views',
  );
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
