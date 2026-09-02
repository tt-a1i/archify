import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.resolve(__dirname, '../assets/template.html'), 'utf8');

test('toolbar keeps four independent controls with explicit open states', () => {
  assert.match(template, /\.toolbar \{[\s\S]*?gap: 0\.5rem;[\s\S]*?padding: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.match(template, /\.toolbar button \{[\s\S]*?background: var\(--toolbar-bg\);[\s\S]*?border: 1px solid var\(--toolbar-border\);/);
  assert.match(template, /button\[aria-expanded="true"\]/);
  assert.doesNotMatch(template, /\.preset-wrap::before,[\s\S]*?\.export-wrap::before/);
  assert.match(template, /<span id="theme-icon" class="toolbar-icon"/);
  assert.match(template, /<span id="present-icon" class="toolbar-icon"/);
  assert.doesNotMatch(template.match(/<div class="toolbar"[\s\S]*?<div class="container">/)?.[0] || '', /<svg\b/);
  assert.doesNotMatch(template, /icon\.textContent =/);
});

test('export menu has grouped, single-column rows and a zoom-safe width', () => {
  const sectionCss = template.match(/\.export-menu-section \{[\s\S]*?\}/)?.[0] || '';
  assert.match(template, /class="export-menu-section" role="group" aria-label="\{\{i18n:viewer\.export\.share\}\}"/);
  assert.match(template, /class="export-menu-section" role="group" aria-label="\{\{i18n:viewer\.export\.raster\}\}"/);
  assert.match(template, /class="export-menu-section" role="group" aria-label="\{\{i18n:viewer\.export\.vectorMotion\}\}"/);
  assert.match(template, /class="export-menu-header" role="presentation"/);
  assert.match(template, /\.toolbar \.export-menu \{[\s\S]*?width: 19rem;[\s\S]*?max-width: calc\(100vw - 2rem\);/);
  assert.match(template, /\.export-menu-section \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(sectionCss, /repeat\(2/);
  assert.match(template, /\.toolbar \.export-menu button \{[\s\S]*?grid-template-columns: 1\.15rem minmax\(0, 1fr\);[\s\S]*?white-space: nowrap;/);
  assert.match(template, /\.export-item-copy strong,[\s\S]*?\.export-item-copy small \{ display: block; \}/);
});

test('mobile menus share one viewport-safe placement and disabled exports remain explicit', () => {
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*?\.toolbar \.preset-menu,[\s\S]*?\.toolbar \.export-menu \{[\s\S]*?position: fixed;/);
  assert.match(template, /\.toolbar \.export-menu button:disabled \{[\s\S]*?cursor: not-allowed;/);
  assert.doesNotMatch(template, /it\.style\.opacity = '0\.5'/);
});

test('diagram view dock stays compact on desktop and touch-safe on narrow screens', () => {
  assert.match(template, /\.diagram-nav \{[\s\S]*?padding: 0\.15rem;[\s\S]*?border-radius: 0\.58rem;/);
  assert.match(template, /\.diagram-nav button \{[\s\S]*?min-width: 2rem;[\s\S]*?height: 2rem;/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*?\.diagram-nav button \{[\s\S]*?min-width: 2\.75rem;[\s\S]*?height: 2\.75rem;/);
  assert.match(template, /class="diagram-nav-icon find"/);
  assert.match(template, /class="diagram-nav-icon guide"/);
  assert.match(template, /class="diagram-nav-icon minus"/);
  assert.match(template, /class="diagram-nav-icon plus"/);
});

test('diagram view reset separates semantic detail from zoom percentage', () => {
  assert.match(template, /data-view="reset"[\s\S]*?data-view-detail hidden>\{\{i18n:viewer\.nav\.read\}\}<[\s\S]*?data-view-percent>100%</);
  assert.match(template, /var resolvedLevel = semantic \? viewerText\('viewer\.nav\.level\.auto'\) : levelLabel;/);
  assert.match(template, /var showDetailLevel = semantic \|\| detail !== 'read';/);
  assert.match(template, /resetDetailLabel\.hidden = !showDetailLevel/);
  assert.match(template, /resetPercentLabel\.textContent = percent/);
  assert.match(template, /resetBtn\.toggleAttribute\('data-detail-visible', showDetailLevel\)/);
});
