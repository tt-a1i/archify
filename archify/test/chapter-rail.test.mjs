import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-chapter-rail-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', CASES[mode]),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all guided renderers expose one runtime-built named chapter rail', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /<nav class="guided-view-index" id="guided-view-index" aria-label="Story chapters">/, mode);
    assert.match(html, /<ol class="guided-view-chapters" id="guided-view-chapters"><\/ol>/, mode);
    assert.match(html, /function buildChapterIndex\(\)/, mode);
    assert.match(html, /views\.forEach\(function \(view, index\)/, mode);
    assert.match(html, /position\.textContent = \(index \+ 1 < 10 \? '0' : ''\) \+ \(index \+ 1\)/, mode);
    assert.match(html, /title\.textContent = view\.label/, mode);
    assert.match(html, /stops\.textContent = view\.focus\.length \+ ' stop'/, mode);
    assert.doesNotMatch(canonicalSvg(html), /guided-view-chapter|data-chapter-position/, mode);
  }
});

test('chapter rail delegates selection and mirrors the existing activeIndex owner', () => {
  const html = render('architecture');
  assert.match(html, /activateById\(button\.getAttribute\('data-guided-view-id'\)\)/);
  assert.match(html, /var current = index === activeIndex/);
  assert.match(html, /activeIndex < 0 \? 'available' : \(current \? 'current' : \(index < activeIndex \? 'before' : 'after'\)\)/);
  assert.match(html, /button\.setAttribute\('aria-current', 'step'\)/);
  assert.match(html, /button\.removeAttribute\('aria-current'\)/);
  assert.match(html, /syncChapterIndex\(\);[\s\S]*renderShareCue\(\)/);
  assert.doesNotMatch(html, /selectedChapter|visitedChapters|completedChapters/);
});

test('chapter rail is keyboard-first and pauses playback on reader takeover', () => {
  const html = render('workflow');
  assert.match(html, /chapterIndex\.addEventListener\('focusin',[\s\S]*if \(playing\) pausePlayback\(\)/);
  assert.match(html, /event\.key === 'ArrowRight'/);
  assert.match(html, /event\.key === 'ArrowLeft'/);
  assert.match(html, /event\.key === 'Home'/);
  assert.match(html, /event\.key === 'End'/);
  assert.match(html, /focusChapterButton\(target\)/);
  assert.match(html, /button\.type = 'button'/);
  assert.doesNotMatch(html, /role="tab"|role="tabpanel"/);
});

test('chapter rail has positional, touch, mobile, motion, embed, and print boundaries', () => {
  const html = render('lifecycle');
  assert.match(html, /\.guided-view-chapter\[data-chapter-position="current"\][\s\S]*border: 2px solid/);
  assert.match(html, /data-chapter-position="before"[\s\S]*border-style: solid/);
  assert.match(html, /data-chapter-position="after"[\s\S]*border-style: dashed/);
  assert.match(html, /\.guided-view-chapter \{ min-height: 2\.75rem; \}/);
  assert.match(html, /scroll-snap-type: x proximity/);
  assert.match(html, /flex: 0 0 min\(14rem, 78vw\)/);
  assert.match(html, /behavior: 'auto'/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*\.guided-view-chapter \{ transition: none !important; \}/);
  assert.match(html, /html\[data-embed="true"\] \.guided-views \{ display: none !important; \}/);
  assert.match(html, /\.toolbar, \.diagram-nav, \.focus-chip, \.guided-views, \.archify-toast, \.no-print \{ display: none !important; \}/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
