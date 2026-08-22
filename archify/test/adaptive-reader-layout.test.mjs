import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_READABILITY_VIEWPORT,
  DESKTOP_READER_DIAGRAM_WIDTH,
  DESKTOP_READER_HORIZONTAL_CHROME,
  DESKTOP_READER_MIN_WIDTH,
  MIN_PROJECTED_NODE_TEXT_PX,
  minimumReadableSourceTextPx,
  projectedNodeTextPx,
} from '../renderers/shared/desktop-readability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const reader = template.slice(
  template.indexOf('Adaptive Reader Shell'),
  template.indexOf('Archify.view = (function ()'),
);

test('wide desktop diagrams use one height-budgeted reader shell instead of breakpoint jumps', () => {
  assert.match(template, /max-width: var\(--archify-reader-width, 1440px\)/);
  assert.doesNotMatch(template, /@media \(min-width: 1680px\)[\s\S]{0,180}\.container/);
  assert.doesNotMatch(template, /@media \(min-width: 1920px\)[\s\S]{0,180}\.container/);
  assert.match(reader, /var WIDE_RATIO = 1\.55/);
  assert.match(reader, /var MAX_READER_WIDTH = 1920/);
  assert.match(reader, /var availableSvgHeight = Math\.max\(1, window\.innerHeight - fixedHeight\)/);
  assert.match(reader, /var desiredWidth = availableSvgHeight \* ratio \+ chrome\.diagramX/);
  assert.match(reader, /html\.style\.setProperty\('--archify-reader-width', rounded \+ 'px'\)/);
});

test('desktop readability budget matches the minimum adaptive reader at 1440 by 900', () => {
  assert.deepEqual(DESKTOP_READABILITY_VIEWPORT, { width: 1440, height: 900 });
  assert.equal(DESKTOP_READER_MIN_WIDTH, 960);
  assert.equal(DESKTOP_READER_HORIZONTAL_CHROME, 30);
  assert.equal(DESKTOP_READER_DIAGRAM_WIDTH, 930);
  assert.match(reader, new RegExp(`var MIN_READER_WIDTH = ${DESKTOP_READER_MIN_WIDTH}`));
  assert.match(template, /@media \(min-width: 768px\) and \(max-height: 1100px\)[\s\S]*?\.diagram-container \{[\s\S]*?padding: 0\.875rem;[\s\S]*?padding-bottom: calc\(0\.875rem \+ var\(--archify-nav-reserve\)\);/);
  assert.match(template, /@media \(min-width: 768px\) and \(max-height: 920px\)[\s\S]*?body \{ padding-block: 1\.25rem; \}/);
  assert.match(template, /\.diagram-container \{[\s\S]*?border: 1px solid var\(--panel-border\)/);
});

test('desktop readability source floor is the inverse of the projected-size gate', () => {
  const sourceFloor = minimumReadableSourceTextPx(1376);
  assert.ok(Math.abs(sourceFloor - 8.87741935483871) < 1e-12);
  assert.ok(Math.abs(projectedNodeTextPx(sourceFloor, 1376) - MIN_PROJECTED_NODE_TEXT_PX) < 1e-12);
  assert.equal(minimumReadableSourceTextPx(DESKTOP_READER_DIAGRAM_WIDTH), MIN_PROJECTED_NODE_TEXT_PX);
  assert.equal(minimumReadableSourceTextPx(700), MIN_PROJECTED_NODE_TEXT_PX);
  assert.ok(Number.isNaN(minimumReadableSourceTextPx(0)));
});

test('adaptive width preserves canonical SVG geometry and yields to specialized viewer modes', () => {
  assert.match(reader, /window\.innerWidth >= MIN_DESKTOP_WIDTH/);
  assert.match(reader, /html\.getAttribute\('data-embed'\) !== 'true'/);
  assert.match(reader, /html\.getAttribute\('data-present'\) !== 'true'/);
  assert.match(reader, /window\.matchMedia\('print'\)\.matches/);
  assert.doesNotMatch(reader, /svg\.setAttribute\(['"](?:viewBox|width|height)/);
  assert.doesNotMatch(reader, /svg\.style\.(?:width|height)/);
  assert.doesNotMatch(reader, /overflow\s*=\s*['"]hidden/);
});

test('reader remeasures real content and reduces width before allowing desktop page overflow', () => {
  assert.match(reader, /document\.fonts\.ready\.then\(schedule\)/);
  assert.match(reader, /new ResizeObserver\(schedule\)/);
  assert.match(reader, /new MutationObserver\(schedule\)/);
  assert.match(reader, /document\.documentElement\.scrollHeight/);
  assert.match(reader, /lastWidth - overflow \* ratio - 4/);
  assert.match(skill, /1440×900, 1600×1000, and 1920×1080/);
  assert.match(skill, /2048×1320/);
  assert.match(skill, /Generate one responsive artifact for laptops and external displays/);
  assert.match(skill, /preserve the authored SVG\/viewBox, proportions, semantic geometry/);
});

test('reader exposes an explicit stable-dimensions contract for browser evidence', () => {
  assert.match(reader, /function stableSnapshot\(\)/);
  assert.match(reader, /function whenStable\(\)/);
  assert.match(reader, /document\.fonts && document\.fonts\.ready/);
  assert.match(reader, /Math\.ceil\(document\.body\.scrollHeight\)/);
  assert.match(reader, /stableFrames >= 3/);
  assert.match(reader, /whenStable: whenStable/);
});
