import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// Static regression for tt-a1i/archify#1040: Passport, Finder and Figure-index
// reader text must meet WCAG 2.2 SC 1.4.3 (4.5:1) in every light preset.
// Browser pixel measurement is the ground truth; this test models the same
// paint stack statically (token foregrounds composited over the reader
// surfaces) so the floor is enforced without a browser.

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, '..', 'viewer', 'viewer.css'), 'utf8');

const FLOOR = 4.5;

function blockDeclarations(blockSelector) {
  const start = css.indexOf(blockSelector);
  assert.ok(start >= 0, `preset block missing: ${blockSelector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  assert.fail(`unterminated block: ${blockSelector}`);
}

function token(block, name, fallbackBlock) {
  const m = block.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  if (m) return m[1].trim();
  // Tokens not redefined in a preset block inherit from the base light theme
  // via the CSS cascade (e.g. signal-flow reuses the default menu surface).
  assert.ok(fallbackBlock, `--${name} missing`);
  return token(fallbackBlock, name);
}

function parseColor(value) {
  let m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    return [0, 2, 4].map((o) => parseInt(m[1].slice(o, o + 2), 16) / 255).concat(1);
  }
  m = value.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    return [0, 1, 2].map((o) => parseInt(m[1][o] + m[1][o], 16) / 255).concat(1);
  }
  m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  assert.ok(m, `unparseable color: ${value}`);
  return [m[1] / 255, m[2] / 255, m[3] / 255, m[4] === undefined ? 1 : Number(m[4])];
}

// color-mix(in srgb, a P%, transparent) then composite over an opaque base.
function mixOver(color, percent, base) {
  const [r, g, b, a] = parseColor(color);
  const t = percent / 100;
  const fg = [r, g, b, a * t];
  const [br, bg2, bb] = parseColor(base);
  const alpha = fg[3] + (1 - fg[3]) * 1;
  return [
    (fg[0] * fg[3] + br * (1 - fg[3])) / alpha,
    (fg[1] * fg[3] + bg2 * (1 - fg[3])) / alpha,
    (fg[2] * fg[3] + bb * (1 - fg[3])) / alpha,
  ];
}

function luminance(rgb) {
  const lin = rgb.slice(0, 3).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const [a, b] = [luminance(parseColor(fg)), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const PRESETS = [
  { name: 'classic', block: '[data-theme="light"]' },
  { name: 'signal-flow', block: '[data-preset="signal-flow"][data-theme="light"]' },
  { name: 'blueprint', block: '[data-preset="blueprint"][data-theme="light"]' },
  { name: 'editorial', block: '[data-preset="editorial"][data-theme="light"]' },
];

for (const preset of PRESETS) {
  const block = blockDeclarations(preset.block);
  const base = preset.name === 'classic' ? null : blockDeclarations('[data-theme="light"]');
  const faint = token(block, 'text-faint', base);
  const panel = token(block, 'panel', base);
  const bg = token(block, 'bg', base);
  const menuBg = token(block, 'toolbar-menu-bg', base);
  // Small bold semantic reader text (Passport direction chip, Finder count)
  // resolves through --reader-accent where a preset needs it darker than the
  // diagram's --frontend-stroke, which must stay untouched. Resolve like the
  // CSS cascade: the preset's own --reader-accent, else the base light theme's
  // (inherited), else the var() fallback --frontend-stroke. A preset that only
  // inherits the accent (blueprint) must test the inherited token: testing the
  // fallback instead would pass even if a regression broke the accent the
  // rule actually paints.
  const hasOwnAccent = /--reader-accent:/.test(block);
  const hasBaseAccent = base && /--reader-accent:/.test(base);
  const accent = hasOwnAccent
    ? token(block, 'reader-accent', base)
    : hasBaseAccent
      ? token(base, 'reader-accent')
      : token(block, 'frontend-stroke', base);

  // Paint stack mirrors the issue's composited-pixel measurement:
  // chips paint color-mix(panel 68%, transparent) over the passport panel,
  // Finder rows paint color-mix(panel 54%, transparent) over the Finder
  // panel, the Figure index paints directly on the page background.
  const chipBg = mixOver(panel, 68, menuBg);
  const finderBg = mixOver(panel, 54, menuBg);
  // The Figure index paints on the reader surface, not the page background:
  // composited RGB values measured with real Chrome in tt-a1i/archify#1040
  // (HengYangDS's follow-up table). Using the measured surface keeps this
  // test honest instead of guessing the paint stack.
  const OUTLINE_BG = {
    classic: [255, 255, 255],
    'signal-flow': [253, 254, 254],
    blueprint: [248, 253, 255],
    editorial: [251, 247, 240],
  };
  const outlineBg = OUTLINE_BG[preset.name].map((c) => c / 255);

  test(`${preset.name} light: Passport secondary text reaches 4.5:1`, () => {
    const r = ratio(faint, chipBg);
    assert.ok(r >= FLOOR, `--text-faint ${faint} on passport chips is ${r.toFixed(2)}:1`);
  });

  test(`${preset.name} light: Finder secondary text reaches 4.5:1`, () => {
    const r = ratio(faint, finderBg);
    assert.ok(r >= FLOOR, `--text-faint ${faint} in finder rows is ${r.toFixed(2)}:1`);
  });

  test(`${preset.name} light: Figure index secondary text reaches 4.5:1`, () => {
    const r = ratio(faint, outlineBg);
    assert.ok(r >= FLOOR, `--text-faint ${faint} on figure index is ${r.toFixed(2)}:1`);
  });

  test(`${preset.name} light: Passport direction and Finder count reach 4.5:1`, () => {
    const chip = ratio(accent, chipBg);
    const finder = ratio(accent, finderBg);
    assert.ok(chip >= FLOOR, `accent ${accent} on passport chips is ${chip.toFixed(2)}:1`);
    assert.ok(finder >= FLOOR, `accent ${accent} in finder rows is ${finder.toFixed(2)}:1`);
  });
}

test('reader accent override is wired to the failing selectors', () => {
  assert.ok(css.includes('var(--reader-accent'), '--reader-accent is never consumed');
  assert.ok(
    /\.semantic-passport-meta \[data-passport="kind"\][\s\S]{0,400}var\(--reader-accent/.test(css),
    'passport direction chip does not resolve --reader-accent',
  );
  assert.ok(
    /\.node-finder-result em[\s\S]{0,400}var\(--reader-accent/.test(css),
    'finder count does not resolve --reader-accent',
  );
});
