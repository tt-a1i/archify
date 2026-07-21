import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-shelf-'));

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

test('all five renderers inherit one compact cold-open Story Shelf', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /\.guided-views\[data-active-view="all"\]\s*\{/, mode);
    assert.match(html, /panel\.setAttribute\('data-active-view', view \? view\.id : 'all'\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /Story Shelf|data-active-view|guided-view-index/, mode);
  }
});

test('cold shelf keeps chapter identity and Play while removing only unavailable duplicate controls', () => {
  assert.match(template, /\.guided-views\[data-active-view="all"\] > #guided-view-prev,[\s\S]*#guided-view-next,[\s\S]*\.guided-view-beat-link,[\s\S]*\.guided-view-all\s*\{\s*display: none;\s*\}/);
  assert.doesNotMatch(template, /\.guided-views\[data-active-view="all"\][^{]*(?:\.guided-view-play|\.guided-view-index)[^{]*\{\s*display:\s*none/);
  assert.match(template, /<button class="guided-view-play"/);
  assert.match(template, /<nav class="guided-view-index"/);
});

test('desktop shelf follows DOM order and returns vertical space to the diagram', () => {
  const rule = template.match(/\.guided-views\[data-active-view="all"\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /grid-template-columns:\s*minmax\(11rem,\s*\.72fr\)\s+auto\s+minmax\(0,\s*2fr\)/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-copy\s*\{[^}]*grid-column:\s*1/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-actions\s*\{[^}]*grid-column:\s*2/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-index\s*\{[^}]*grid-column:\s*3/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-copy > #guided-view-note\s*\{\s*display:\s*none/);
});

test('mobile shelf preserves 44px controls, horizontal chapters, and honest expansion', () => {
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-views\[data-active-view="all"\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-index\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2/);
  assert.match(template, /\.guided-views\[data-active-view="all"\] \.guided-view-play\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(template, /\.guided-view-chapters\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(template, /\.guided-view-chapter\s*\{[^}]*min-height:\s*2\.75rem/);
});

test('active stories expand through existing state without storage or a second interaction owner', () => {
  assert.match(template, /panel\.setAttribute\('data-active-view', 'all'\);\s*panel\.hidden = false/);
  assert.match(template, /data-active-view', view \? view\.id : 'all'/);
  assert.match(template, /if \(activeIndex < 0\) activate\(0, \{ playback: true \}\)/);
  assert.match(template, /showAll\([\s\S]*activeIndex = -1;[\s\S]*render\(\)/);
  assert.doesNotMatch(template, /storyShelf(?:Open|Expanded|Storage)|archify-story-shelf|localStorage[^\n]*shelf/i);
});

test('Story Shelf remains viewer-only, embed-safe, print-safe, and motion-neutral', () => {
  assert.match(template, /html\[data-embed="true"\] \.guided-views \{ display: none !important; \}/);
  assert.match(template, /\.toolbar, \.diagram-nav, \.focus-chip, \.guided-views, \.archify-toast, \.no-print \{ display: none !important; \}/);
  assert.doesNotMatch(canonicalSvg(render('workflow')), /Story Shelf|guided-view|data-active-view/);
  assert.doesNotMatch(template, /@keyframes\s+archify-story-shelf|animation:[^;]*story-shelf/i);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
