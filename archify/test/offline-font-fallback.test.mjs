import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression coverage for issue #277: when the bundled JetBrains Mono font
// has not yet decoded (common when the artifact opens offline or under a
// strict CSP), `ctx.measureText` would otherwise produce widths that don't
// match the SVG layer's rendered metrics — labels silently overflow. The
// fix detects the unloaded state with `document.fonts.check` and forces the
// fallback font so Canvas measurement and SVG layout stay in lockstep.
//
// These tests are static (string match) so they exercise the contract
// without needing a browser. The browser-side behavior is covered by
// offline-font-browser.test.mjs, which only runs when ARCHIFY_CHROME is set.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
const exportSource = fs.readFileSync(
  path.resolve(repoRoot, 'viewer', 'export.js'),
  'utf8',
);

test('fitCanvasText consults document.fonts before measuring', () => {
  // The helper must check whether the embedded face is actually loaded and
  // fall back to the system monospace stack so Canvas measurement and the
  // SVG layer agree on the string width. Without this guard the export
  // would overflow the share card title under offline / strict-CSP loads.
  assert.match(
    exportSource,
    /function fitCanvasText[\s\S]*?document\.fonts\.check/,
    'fitCanvasText must defer to document.fonts.check before measuring',
  );
});

test('the offline fallback uses the same monospace stack the SVG layer declares', () => {
  // If the fallback font list diverges from the SVG layer, the two will
  // disagree on glyph widths and the rasterized share card will spill past
  // the layout boundary. Pin both to the ui-monospace stack.
  const conditional = exportSource.match(/fontsLoaded\(\)[\s\S]{0,120}:\s*'([^']+)'/);
  assert.ok(conditional, 'fitCanvasText must switch fonts based on fontsLoaded()');
  const fallback = conditional[1];
  assert.ok(fallback.includes('ui-monospace'), `fallback stack missing ui-monospace: ${fallback}`);
  assert.ok(fallback.includes('Menlo'), `fallback stack missing Menlo: ${fallback}`);
  assert.ok(fallback.includes('Consolas'), `fallback stack missing Consolas: ${fallback}`);
});

test('fontsLoaded tolerates browsers without document.fonts', () => {
  // Older browsers (or jsdom in some configurations) expose no Font Loading
  // API at all. The helper must short-circuit to `true` rather than throw,
  // because the caller cannot distinguish "loaded" from "unknown" — both
  // mean "do not change the font". We assert the safe return path.
  const helperMatch = exportSource.match(/function fontsLoaded\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(helperMatch, 'fontsLoaded helper must exist');
  const body = helperMatch[1];
  assert.match(body, /document\.fonts/, 'helper must reference document.fonts');
  assert.match(body, /typeof fonts\.check/, 'helper must guard with typeof fonts.check');
  assert.match(body, /return true/, 'helper must return true when the Font Loading API is unavailable');
});