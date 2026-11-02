// Layered node card for architecture components: a white card with a logo
// tile on the left, a bold label and one muted context line on the right,
// and an optional ⓘ that points readers at the full description.
//
// Geometry is pure so validation, auto-sizing and rendering agree on the
// same numbers.
import { textUnits } from '../shared/utils.mjs';

export const cardMetrics = {
  pad: 10,
  tileMax: 36,
  tileMin: 20,
  tileGap: 10,
  infoReserve: 14,
  labelPreferred: 12,
  labelMinimum: 10.5,
  sublabelPreferred: 9.5,
  sublabelMinimum: 8,
  autoMinWidth: 120,
  autoMaxWidth: 240,
  // Card text uses the bundled viewer font (JetBrains Mono) like every other
  // node, so offline layout never depends on a locally installed sans face.
  widthFactor: 0.6,
};

const ELLIPSIS = '…';

export function textWidth(text, fontSize) {
  return textUnits(text) * fontSize * cardMetrics.widthFactor;
}

// Cut `text` so that, with a trailing ellipsis, it fits `width` at `fontSize`.
export function truncateToWidth(text, width, fontSize) {
  const value = String(text ?? '');
  if (textWidth(value, fontSize) <= width) return { text: value, truncated: false };
  const budget = width - textWidth(ELLIPSIS, fontSize);
  let out = '';
  for (const ch of Array.from(value)) {
    if (textWidth(out + ch, fontSize) > budget) break;
    out += ch;
  }
  return { text: `${out.trimEnd()}${ELLIPSIS}`, truncated: true };
}

function tileSizeFor(height) {
  return Math.max(0, Math.min(cardMetrics.tileMax, height - 20));
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// Lay out one card inside its (already sized) box.
export function cardLayout(c, { branded = false } = {}) {
  const m = cardMetrics;
  const hasSub = hasText(c.sublabel);
  const hasExplanation = hasText(c.explanation);
  const tile = tileSizeFor(c.height);
  const textRight = c.x + c.width - m.pad;
  const labelNeed = textWidth(c.label, m.labelMinimum);
  // The tile needs room for the label at its legible minimum; otherwise the
  // card falls back to a text-only layout instead of squeezing the label.
  const tiled = tile >= m.tileMin && (textRight - (c.x + m.pad + tile + m.tileGap)) >= labelNeed;
  const textX = c.x + m.pad + (tiled ? tile + m.tileGap : 0);
  // The ⓘ lives in the top-right corner, beside the label row.
  const rail = 0;
  const firstPass = textRight - textX;
  const subFull = hasSub ? truncateToWidth(c.sublabel, firstPass, m.sublabelPreferred) : null;
  const info = hasExplanation || Boolean(subFull?.truncated);
  // The ⓘ sits in the top-right corner; it only narrows the label when the
  // label's cap height would reach the corner row (short cards).
  const labelTop = c.y + c.height / 2 - (hasSub ? 2 : -m.labelPreferred * 0.35) - m.labelPreferred * 0.75;
  const infoClear = labelTop >= c.y + 17;
  const labelWidth = Math.max(1, textRight - textX - rail - (info && !infoClear ? m.infoReserve : 0));
  const labelFont = Math.max(m.labelMinimum, Math.min(m.labelPreferred,
    Math.floor((labelWidth / Math.max(1, textUnits(c.label) * m.widthFactor)) * 10) / 10));
  const sub = hasSub ? truncateToWidth(c.sublabel, firstPass, m.sublabelPreferred) : null;
  const cy = c.y + c.height / 2;
  return {
    tiled,
    tile: tiled ? { x: c.x + m.pad, y: cy - tile / 2, size: tile } : null,
    textX,
    labelFont,
    labelY: hasSub ? cy - 2 : cy + labelFont * 0.35,
    sub: sub ? { ...sub, font: m.sublabelPreferred, y: cy + 12 } : null,
    rail: rail ? { x: c.x + c.width - 17, y: c.y + 6 } : null,
    info: info ? { cx: c.x + c.width - 11 - rail, cy: c.y + 11 } : null,
  };
}

// Width an unsized component needs so its label (and, when it fits within the
// auto cap, its context line) reads without shrinking.
export function autoCardWidth(c, cap = cardMetrics.autoMaxWidth) {
  const m = cardMetrics;
  const chrome = m.pad * 2 + m.tileMax + m.tileGap;
  const label = textWidth(c.label, m.labelPreferred) + m.infoReserve;
  const sub = hasText(c.sublabel) ? textWidth(c.sublabel, m.sublabelPreferred) : 0;
  const need = Math.ceil(chrome + Math.max(label, sub));
  return Math.max(m.autoMinWidth, Math.min(cap, need));
}

// Width a layered card needs so its context line reads on one line at the
// preferred size beside the tile (0 when it has no context line).
export function sublabelCardWidth(c) {
  const m = cardMetrics;
  if (!hasText(c.sublabel)) return 0;
  return Math.ceil(m.pad * 2 + m.tileMax + m.tileGap + textWidth(c.sublabel, m.sublabelPreferred));
}

// Paint for the layered card. Lives in the SVG so canonical exports keep it.
// Light: white card, hairline grey frame, faint lift. Dark: a raised slate
// card with a matching hairline. Brand tiles keep a light plate in both themes
// (vendor colours are tuned for light grounds); near-white marks get ink.
export function layeredCardStyle() {
  // Compact cards (boxes too small for the tile) share the same paint.
  const card = 'svg[data-node-ui] [data-node-card]';
  // Editorial keeps its flat card styling, so the dark lift skips it.
  const dark = ':is([data-theme="dark"] svg[data-node-ui]:not([data-preset="editorial"]), svg[data-node-ui][data-theme="dark"]:not([data-preset="editorial"])) [data-node-card]';
  return `        <style>
          ${card} > rect.node-card { fill: var(--mask); stroke: color-mix(in srgb, var(--text) 14%, var(--mask)); stroke-dasharray: none; }
          ${dark} > rect.node-card.node-card { fill: color-mix(in srgb, var(--text) 5%, var(--mask)); stroke: color-mix(in srgb, var(--text) 16%, var(--mask)); }
          ${card} > .node-card-tile { fill: color-mix(in srgb, var(--text) 5%, var(--mask)); stroke: color-mix(in srgb, var(--text) 10%, var(--mask)); stroke-width: .8px; }
          ${dark} > .node-card-tile { fill: color-mix(in srgb, var(--text) 9%, var(--mask)); }
          ${card} > .semantic-sigil { opacity: .9; }
          ${card} > .brand-mark .brand-mark-badge { fill: #f6f8fb; }
          ${card} > .brand-mark .brand-mark-frame { stroke: #e2e8f0; }
          ${card} > .brand-mark.brand-mark-ink .brand-mark-badge { fill: #1f2937; }
          ${card} > .brand-mark.brand-mark-ink .brand-mark-frame { stroke: #1f2937; }
          ${card} .generic-icon { fill: none; stroke: color-mix(in srgb, var(--text) 78%, var(--mask)); stroke-width: 1.7px; stroke-linecap: round; stroke-linejoin: round; }
          ${['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'].map((t) => `${card} .generic-icon.gi-${t} { --gi-fill: color-mix(in srgb, var(--${t}-stroke) 22%, transparent); }`).join('\n          ')}
          svg[data-node-ui] symbol[id^="gi-"] .f { fill: var(--gi-fill, none); }
          ${card} > .node-card-info { fill: none; stroke: var(--text-muted); stroke-width: .9px; stroke-linecap: round; opacity: .75; cursor: help; }
        </style>`;
}
