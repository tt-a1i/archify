import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-presentation-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers ship the same presentation stage contract', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="btn-present"[^>]+aria-label="Enter presentation stage"[^>]+aria-pressed="false"/, mode);
    assert.match(html, /Archify\.presentation = \(function \(\)/, mode);
    assert.match(html, /enter: function \(\) \{ return setActive\(true\); \}/, mode);
    assert.match(html, /exit: function \(\) \{ return setActive\(false\); \}/, mode);
    assert.match(html, /html\[data-present="true"\]:not\(\[data-embed="true"\]\) \.diagram-container/, mode);
    assert.match(html, /height: 100dvh/, mode);
    assert.match(html, /\.cards,[\s\S]+\.footer \{ display: none; \}/, mode);
    assert.doesNotMatch(html.match(/<html[^>]*>/)?.[0] || '', /data-present=/, mode);
    assert.doesNotMatch(svg(html), /data-present|btn-present|Presentation Stage/, mode);
  }
});

test('presentation stage supports direct links and preserves view hashes', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /get\('present'\) === '1'/);
  assert.match(html, /document\.documentElement\.setAttribute\('data-present', 'true'\)/);
  assert.match(html, /url\.searchParams\.set\('present', '1'\)/);
  assert.match(html, /url\.searchParams\.delete\('present'\)/);
  assert.match(html, /url\.pathname \+ url\.search \+ url\.hash/);
  assert.match(html, /Embed mode wins when both query parameters are present/);
});

test('presentation keyboard behavior exits in layers and remains accessible', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /e\.defaultPrevented\) return/);
  assert.match(html, /e\.key === 'f' \|\| e\.key === 'F'/);
  assert.match(html, /Archify\.presentation\.toggle\(\)/);
  assert.match(html, /e\.key === 'Escape' && Archify\.focus\.active\(\)/);
  assert.match(html, /e\.key === 'Escape' && Archify\.presentation\.active\(\)/);
  assert.match(html, /btn\.setAttribute\('aria-pressed', next \? 'true' : 'false'\)/);
  assert.match(html, /Exit presentation stage \(F or Escape\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
