// Layered node card for architecture components: a white card with a logo
// tile on the left, a bold label and one muted context line on the right,
// and an optional ⓘ that points readers at the full description.
//
// Geometry is pure so validation, auto-sizing and rendering agree on the
// same numbers.
import { textUnits } from '../shared/utils.mjs';

export const cardMetrics = {
  pad: 10,
  tileMax: 32,
  tileMin: 20,
  tileGap: 10,
  infoReserve: 14,
  // Branded tiles move the semantic sigil to the top-right rail; the slot is
  // reserved whether or not an icon is drawn so icon overrides never move text.
  railSlot: 15,
  labelPreferred: 12,
  labelMinimum: 8,
  sublabelPreferred: 9.5,
  sublabelMinimum: 8,
  autoMinWidth: 120,
  autoMaxWidth: 240,
  // Card text is set in the sans UI stack, whose advance is narrower than the
  // monospace factor used elsewhere; CJK still measures a full em per glyph.
  widthFactor: 0.56,
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
  const rail = tiled && branded ? m.railSlot : 0;
  const firstPass = textRight - textX;
  const subFull = hasSub ? truncateToWidth(c.sublabel, firstPass, m.sublabelPreferred) : null;
  const info = hasExplanation || Boolean(subFull?.truncated);
  const labelWidth = Math.max(1, textRight - textX - rail - (info ? m.infoReserve : 0));
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
  const label = textWidth(c.label, m.labelPreferred) + m.infoReserve + (c.brand ? m.railSlot : 0);
  const sub = hasText(c.sublabel) ? textWidth(c.sublabel, m.sublabelPreferred) : 0;
  const need = Math.ceil(chrome + Math.max(label, sub));
  return Math.max(m.autoMinWidth, Math.min(cap, need));
}

// Paint for the layered card. Lives in the SVG so canonical exports keep it.
// Light: white card, hairline grey frame, faint lift. Dark: a raised slate
// card with a matching hairline. Brand tiles keep a light plate in both themes
// (vendor colours are tuned for light grounds); near-white marks get ink.
export function layeredCardStyle() {
  const card = 'svg[data-node-ui] [data-node-card="layered"]';
  const dark = ':is([data-theme="dark"] svg[data-node-ui], svg[data-node-ui][data-theme="dark"]) [data-node-card="layered"]';
  return `        <style>
          ${card} > rect.node-card { fill: var(--mask); stroke: color-mix(in srgb, var(--text) 14%, var(--mask)); stroke-dasharray: none; filter: drop-shadow(0 1px 1.5px rgba(15, 23, 42, 0.06)); }
          ${dark} > rect.node-card.node-card { fill: color-mix(in srgb, var(--text) 5%, var(--mask)); stroke: color-mix(in srgb, var(--text) 16%, var(--mask)); filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35)); }
          ${card} > .node-card-tile { fill: color-mix(in srgb, var(--text) 5%, var(--mask)); stroke: color-mix(in srgb, var(--text) 10%, var(--mask)); stroke-width: .8px; }
          ${dark} > .node-card-tile { fill: color-mix(in srgb, var(--text) 9%, var(--mask)); }
          ${card} > text { font-family: Inter, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
          ${card} > .semantic-sigil { opacity: .9; }
          ${card} > .brand-mark .brand-mark-badge { fill: #f6f8fb; }
          ${card} > .brand-mark .brand-mark-frame { stroke: #e2e8f0; }
          ${card} > .brand-mark.brand-mark-ink .brand-mark-badge { fill: #1f2937; }
          ${card} > .brand-mark.brand-mark-ink .brand-mark-frame { stroke: #1f2937; }
          ${card} > .node-card-info { fill: none; stroke: var(--text-muted); stroke-width: .9px; stroke-linecap: round; opacity: .75; cursor: help; }
        </style>`;
}
