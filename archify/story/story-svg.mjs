import { softwareNotices } from '../renderers/shared/software-notices.mjs';
import {
  applyNodeRelabel,
  attachNodeMetricMarkup,
  boundsOf,
  buildSharedTransitionNode,
  escapeCssAttr,
  escapeXml,
  markEdgePathLength,
  prepareStageSvg,
  serializeXmlNode,
} from './component-stage.mjs';
import { failChoreography, validatePlanAgainstParts } from './choreography-plan.mjs';
import { highlightSourceLines } from './code-highlight.mjs';
import { BAKE_PRESETS, BAKE_THEMES, assertCamoSafeSvg, compileColorMix, loadViewerStyles, parseColor, resolveThemeVariables } from './svg-bake.mjs';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 560;
export const CAPTION_BAND_BOTTOM = 104;
const VIEWPORT = { x: 18, y: 112, width: 924, height: 432 };
const PLOT = { x: 38, y: 124, w: 884, h: 400 };
const LEFT_PLOT = { x: 28, y: 140, w: 440, h: 370 };
const DETAIL_CONTEXT_OPACITY = 0.16;
const CODE_X = 530;
const CODE_Y = 144;
const CODE_DIVIDER_X = 506;
const CODE_WIDTH = 396;
const CODE_FONT_FAMILY = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace";
const STORY_FONT_FALLBACK = "'JetBrains Mono', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

function textUnits(text) {
  return [...String(text ?? '')].reduce((sum, ch) => sum + (/[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.58), 0);
}

function fitFontSize(text, maxWidth, preferred, minimum) {
  const units = Math.max(1, textUnits(text));
  const raw = maxWidth / units;
  return Math.max(minimum, Math.min(preferred, Math.floor(raw * 10) / 10));
}

function wrapLines(text, maxWidth, fontSize) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const maxUnits = maxWidth / fontSize;
  const lines = [];
  let line = '';
  let units = 0;
  for (const ch of [...raw]) {
    const step = /[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.58;
    if (units + step > maxUnits && line) {
      const cut = line.lastIndexOf(' ');
      if (cut > 6 && !/[\u2E80-\uFFFF]/.test(ch)) {
        lines.push(line.slice(0, cut).trimEnd());
        const carry = line.slice(cut + 1);
        line = `${carry}${ch}`;
        units = textUnits(line);
      } else {
        lines.push(line.trimEnd());
        line = ch === ' ' ? '' : ch;
        units = line ? step : 0;
      }
    } else {
      line += ch;
      units += step;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function layoutCaptionBody(body, maxWidth, subject) {
  for (const [fontSize, lineHeight] of [[14.5, 19], [13.2, 17.5], [12, 16]]) {
    const lines = wrapLines(body, maxWidth, fontSize);
    if (lines.length <= 2) return { fontSize, lineHeight, lines };
  }
  failChoreography('story/caption-overflow', 'manifest', 'Caption body exceeds two lines in the 960px story band.', {
    subject,
    supportedFixes: ['shorten caption body to fit two lines within 886px'],
  });
  return null;
}

function fitCamera(box, area, maxScale = 2) {
  const scale = Math.min(maxScale, area.w / (box.width + 28), area.h / (box.height + 28));
  return {
    scale,
    x: area.x + area.w / 2 - (box.x + box.width / 2) * scale,
    y: area.y + area.h / 2 - (box.y + box.height / 2) * scale,
  };
}

const formatTransform = (camera) => `translate(${camera.x.toFixed(3)}px,${camera.y.toFixed(3)}px) scale(${camera.scale.toFixed(5)})`;

function relativeLuminance(color) {
  const channels = parseColor(color).slice(0, 3).map(channel => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function codeColors(vars, { bg, text, accent, muted, amber }) {
  const highlightBg = compileColorMix(`color-mix(in srgb, ${accent} 10%, ${bg})`);
  const backgrounds = [bg, highlightBg].map(relativeLuminance);
  const seeds = {
    keyword: vars.get('--database-stroke') || text,
    string: accent,
    comment: muted,
    number: amber,
    function: vars.get('--frontend-stroke') || text,
    operator: vars.get('--security-stroke') || muted,
  };
  return Object.fromEntries(Object.entries(seeds).map(([kind, seed]) => {
    // Move the Viewer hue toward its text color until it reads on both row fills.
    for (let ink = 0; ink < 100; ink += 10) {
      const color = compileColorMix(`color-mix(in srgb, ${text} ${ink}%, ${seed})`);
      const value = relativeLuminance(color);
      if (backgrounds.every(bg => (Math.max(value, bg) + 0.05) / (Math.min(value, bg) + 0.05) >= 5)) return [kind, color];
    }
    return [kind, text];
  }));
}

export function storyPalette(theme, preset, styles) {
  const vars = resolveThemeVariables(styles.rules, { theme, preset });
  const bg = vars.get('--bg') || (theme === 'dark' ? '#0f172a' : '#ffffff');
  const text = vars.get('--text') || (theme === 'dark' ? '#eef2f8' : '#172033');
  const muted = vars.get('--text-muted') || (theme === 'dark' ? '#a6b4c8' : '#647184');
  const accent = vars.get('--backend-stroke') || (theme === 'dark' ? '#34d399' : '#159f88');
  const amber = vars.get('--cloud-stroke') || (theme === 'dark' ? '#f3b64f' : '#ac7007');
  const removed = vars.get('--security-stroke') || (theme === 'dark' ? '#f291a4' : '#c64458');
  const line = vars.get('--lane-stroke') || vars.get('--grid') || (theme === 'dark' ? '#293548' : '#e3e8ee');
  const palette = { bg, text, muted, accent, amber, removed, line };
  return { ...palette, code: codeColors(vars, palette) };
}

function storyStageColors(styles, theme, preset) {
  const { code, ...palette } = storyPalette(theme, preset, styles);
  return new Map([
    ...Object.entries(palette).map(([name, color]) => [`--story-${name}`, color]),
    ...Object.entries(code).map(([name, color]) => [`--story-code-${name}`, color]),
  ]);
}

function parseStyleDeclarations(styleText) {
  const decls = new Map();
  for (const part of String(styleText || '').split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return decls;
}

function easedProgress(easing, progress) {
  if (progress <= 0 || progress >= 1) return progress;
  if (easing === 'step-end') return 0;
  const controls = /^cubic-bezier\(([^)]+)\)$/.exec(easing)?.[1].split(',').map(Number);
  if (!controls || controls.length !== 4 || !controls.every(Number.isFinite)) return progress;
  const curve = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (curve(mid, controls[0], controls[2]) < progress) low = mid;
    else high = mid;
  }
  return curve((low + high) / 2, controls[1], controls[3]);
}

function interpolateCssValue(prop, a, b, alpha, easing) {
  if (a === b || alpha <= 0) return a;
  if (alpha >= 1) return b;
  if (easing === 'step-end' || prop === 'marker-end') return a;
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return String(Number((numA + (numB - numA) * alpha).toFixed(4)));
  }
  const pctA = /^(-?[\d.]+)%$/.exec(a);
  const pctB = /^(-?[\d.]+)%$/.exec(b);
  if (pctA && pctB) {
    return `${(Number(pctA[1]) + (Number(pctB[1]) - Number(pctA[1])) * alpha).toFixed(3)}%`;
  }
  if (prop === 'transform') {
    const numsA = a.match(/-?[\d.]+/g)?.map(Number);
    const numsB = b.match(/-?[\d.]+/g)?.map(Number);
    if (numsA && numsB && numsA.length === numsB.length && a.replace(/-?[\d.]+/g, '#') === b.replace(/-?[\d.]+/g, '#')) {
      let i = 0;
      return a.replace(/-?[\d.]+/g, () => {
        const va = numsA[i];
        const vb = numsB[i];
        i += 1;
        return Number((va + (vb - va) * alpha).toFixed(4));
      });
    }
  }
  return alpha < 0.5 ? a : b;
}

class StoryTimeline {
  constructor(duration, iteration, theme, switchable) {
    this.duration = duration;
    this.iteration = iteration;
    this.theme = theme;
    this.root = switchable ? 'svg[data-story-switchable]' : `svg[data-theme="${theme}"][data-archify-bake]`;
    this.keyframesCss = [];
    this.tracks = new Map();
    this.index = 0;
  }

  add(selector, channel, points, ease = 'cubic-bezier(.65,0,.35,1)') {
    if (!this.tracks.has(selector)) this.tracks.set(selector, new Map());
    const channels = this.tracks.get(selector);
    const existing = channels.get(channel);
    if (!existing) {
      channels.set(channel, { points: [...points], ease });
      return;
    }
    const anchor = points.find((p, idx) => idx > 0 && p.styleText !== points[0].styleText);
    const startIndex = anchor ? Math.max(0, points.indexOf(anchor) - 1) : 0;
    const anchorTime = points[startIndex].t;
    const kept = existing.points.filter((p) => p.t < anchorTime - 0.0001);
    const holdValue = kept.at(-1)?.styleText;
    const spliced = points.slice(startIndex).map((p, idx) => (idx === 0 && holdValue ? { ...p, styleText: holdValue } : p));
    existing.points = [...kept, ...spliced];
  }

  copyIdTracks(idMap) {
    for (const [selector, channels] of [...this.tracks]) {
      const mapped = selector.replace(/#([A-Za-z0-9_.:-]+)/g, (match, id) => idMap.has(id) ? `#${idMap.get(id)}` : match);
      if (mapped === selector) continue;
      for (const [channel, { points, ease }] of channels) this.add(mapped, channel, points, ease);
    }
  }

  emitCss() {
    const bindings = [];
    for (const [selector, channels] of this.tracks.entries()) {
      const anims = [];
      for (const { points, ease } of channels.values()) {
        const sorted = [...points].sort((a, b) => a.t - b.t);
        const name = `sf-${this.theme}-${this.index++}`;
        const stops = sorted.map(({ t, styleText, easing }) => {
          const pct = `${((Math.max(0, Math.min(this.duration, t)) / this.duration) * 100).toFixed(5)}%`;
          return `${pct}{${styleText};animation-timing-function:${easing || ease}}`;
        }).join('');
        this.keyframesCss.push(`@keyframes ${name}{${stops}}`);
        anims.push(`${name} ${this.duration}s linear ${this.iteration}`);
      }
      bindings.push(`${this.root} :is(${selector}){animation:${anims.join(',')}}`);
    }
    return [...this.keyframesCss, ...bindings];
  }

  // Evaluates every track at fixed timestamp `t` so static keyframe SVGs require zero animation.
  sampleCssAt(t) {
    const time = Math.max(0, Math.min(this.duration, t));
    const rules = [];
    for (const [selector, channels] of this.tracks.entries()) {
      const merged = new Map();
      for (const { points, ease } of channels.values()) {
        const sorted = [...points].sort((a, b) => a.t - b.t);
        if (!sorted.length) continue;
        let p0 = sorted[0];
        let p1 = sorted[sorted.length - 1];
        for (let i = 0; i < sorted.length - 1; i += 1) {
          if (time >= sorted[i].t && time <= sorted[i + 1].t) {
            p0 = sorted[i];
            p1 = sorted[i + 1];
            break;
          }
        }
        if (time <= sorted[0].t) p1 = p0;
        else if (time >= sorted.at(-1).t) p0 = sorted.at(-1);
        const span = p1.t - p0.t;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (time - p0.t) / span)) : 1;
        const declA = parseStyleDeclarations(p0.styleText);
        const declB = parseStyleDeclarations(p1.styleText);
        const easing = p0.easing || ease;
        for (const prop of new Set([...declA.keys(), ...declB.keys()])) {
          const valA = declA.get(prop) ?? declB.get(prop);
          const valB = declB.get(prop) ?? declA.get(prop);
          merged.set(prop, interpolateCssValue(prop, valA, valB, easedProgress(easing, alpha), easing));
        }
      }
      if (merged.size) {
        rules.push(`${selector}{${[...merged.entries()].map(([k, v]) => `${k}:${v}!important`).join(';')}}`);
      }
    }
    return rules;
  }
}

function wrapSourceLines(text, maxUnits = 27.5) {
  const rows = [];
  let remaining = String(text ?? '').replace(/\t/g, '  ');
  let start = 0;
  let prefix = '';
  const addRow = (text) => rows.push({ first: !prefix, text, start, prefix });
  while (textUnits(remaining) > maxUnits && remaining.length > 8) {
    let cut = 0;
    while (cut < remaining.length && textUnits(remaining.slice(0, cut + 1)) <= maxUnits) cut += 1;
    const boundary = Math.max(remaining.lastIndexOf(', ', cut), remaining.lastIndexOf(' ', cut));
    if (boundary > 8) cut = boundary + 1;
    if (cut <= 0) cut = 1;
    addRow(remaining.slice(0, cut));
    const carry = remaining.slice(cut).trimStart();
    start += remaining.length - carry.length - prefix.length;
    prefix = '      ';
    remaining = prefix + carry;
  }
  addRow(remaining);
  return rows;
}

function collectWrappedDetailRows(detail) {
  const fileLines = detail.fileLines;
  if (!fileLines) {
    failChoreography('story/source-not-found', 'views', `story detail source lines for "${detail.path}" were not loaded.`, {
      subject: { path: detail.path },
      supportedFixes: ['pass --repo-root or place the cited file relative to the choreography spec'],
    });
  }
  const rows = [];
  const highlights = new Set(detail.highlight || []);
  const rawMaxUnits = detail.lines.reduce((max, num) => Math.max(max, textUnits(fileLines[num - 1] ?? '')), 0);
  const wrapWidth = rawMaxUnits > 40 ? 33 : 28.5;
  for (const number of detail.lines) {
    const raw = fileLines[number - 1] ?? '';
    for (const part of wrapSourceLines(raw, wrapWidth)) {
      rows.push({ ...part, line: part.first ? number : '', sourceLine: number, highlighted: highlights.has(number) });
    }
  }
  const rowStartY = CODE_Y + (detail.note ? 62 : 44);
  const maxHeight = 532 - rowStartY;
  let font = rows.length > 14 ? 10.6 : rows.length > 10 ? 11.8 : 12.8;
  let gap = rows.length > 14 ? 19 : rows.length > 10 ? 22 : 25.5;
  if (rows.length * gap > maxHeight && rows.length > 0) {
    gap = Math.max(14.5, Math.floor((maxHeight / rows.length) * 10) / 10);
    font = Math.max(9.2, Math.min(font, Number((gap * 0.56).toFixed(1))));
  }
  if (wrapWidth > 30) font = Math.min(font, 10.2);
  return { rows, rowStartY, font, gap };
}

function addDetailHighlightTrack(id, sourceLine, selections, timeline, duration) {
  if (selections.length <= 1) return;
  let current = selections[0].lines.includes(sourceLine) ? 1 : 0;
  const pts = [{ t: 0, styleText: `opacity:${current}` }];
  for (const sel of selections.slice(1)) {
    const next = sel.lines.includes(sourceLine) ? 1 : 0;
    pts.push({ t: sel.at, styleText: `opacity:${current}` }, { t: Math.min(duration, sel.at + 0.45), styleText: `opacity:${next}` });
    current = next;
  }
  pts.push({ t: duration, styleText: `opacity:${current}` });
  timeline.add(`#${id}`, 'opacity', pts);
}

function buildDetailMarkup(detail, detailIndex, totalDetails, timeline, duration, palette) {
  const { rows, rowStartY, font, gap } = collectWrappedDetailRows(detail);
  const tokensByLine = highlightSourceLines(detail.path, detail.fileLines, detail.lines);
  const selections = detail.selections?.length
    ? detail.selections
    : [{ at: detail.start, lines: detail.highlight || [] }];

  const panelId = totalDetails === 1 ? 'story-source-detail' : `story-source-detail-${detailIndex}`;
  const hlPrefix = totalDetails === 1 ? 'story-source-hl' : `story-source-hl-${detailIndex}`;

  const backdropId = `${panelId}-backdrop`;
  let content = `<defs><linearGradient id="${backdropId}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${palette.bg}" stop-opacity="0"/><stop offset="1" stop-color="${palette.bg}" stop-opacity="1"/></linearGradient></defs>`;
  content += `<rect x="${CODE_DIVIDER_X - 34}" y="${VIEWPORT.y}" width="34" height="${VIEWPORT.height}" fill="url(#${backdropId})"/>`;
  content += `<rect x="${CODE_DIVIDER_X}" y="${VIEWPORT.y}" width="${CANVAS_WIDTH - CODE_DIVIDER_X}" height="${VIEWPORT.height}" fill="${palette.bg}"/>`;
  content += `<line x1="${CODE_DIVIDER_X}" x2="${CODE_DIVIDER_X}" y1="125" y2="528" stroke="${palette.line}" stroke-width="1"/>`;
  content += `<text x="${CODE_X}" y="${CODE_Y}" font-size="${fitFontSize(detail.title, CODE_WIDTH, 15, 11)}" fill="${palette.text}" font-weight="600">${escapeXml(detail.title)}</text>`;
  if (detail.note) {
    content += `<text x="${CODE_X}" y="${CODE_Y + 25}" font-size="${fitFontSize(detail.note, CODE_WIDTH, 11.5, 9)}" fill="${palette.muted}">${escapeXml(detail.note)}</text>`;
  }

  rows.forEach((row, index) => {
    const yy = rowStartY + index * gap;
    if (selections.some((sel) => sel.lines.includes(row.sourceLine))) {
      const id = `${hlPrefix}-${index}`;
      const initialOpacity = selections[0].lines.includes(row.sourceLine) ? 1 : 0;
      content += `<rect id="${id}" x="${CODE_X + 29}" y="${yy - Math.round(gap * 0.68)}" width="${CODE_WIDTH - 29}" height="${gap}" fill="${palette.accent}" fill-opacity="0.1" style="opacity:${initialOpacity}"/>`;
      addDetailHighlightTrack(id, row.sourceLine, selections, timeline, duration);
    }
    if (row.line) content += `<text x="${CODE_X}" y="${yy}" font-size="10.5" fill="${palette.muted}">${row.line}</text>`;
    let code = '';
    let cursor = 0;
    for (const token of tokensByLine.get(row.sourceLine) || []) {
      const start = Math.max(row.prefix.length, token.start - row.start + row.prefix.length);
      const end = Math.min(row.text.length, token.end - row.start + row.prefix.length);
      if (start >= end) continue;
      code += escapeXml(row.text.slice(cursor, start));
      code += `<tspan fill="${palette.code[token.kind]}">${escapeXml(row.text.slice(start, end))}</tspan>`;
      cursor = end;
    }
    code += escapeXml(row.text.slice(cursor));
    content += `<text x="${CODE_X + 34}" y="${yy}" font-size="${font}" fill="${palette.text}" xml:space="preserve" style="font-family:${CODE_FONT_FAMILY};white-space:pre">${code}</text>`;
  });

  const inAt = Math.min(duration, detail.start + 0.5);
  const inDone = Math.min(duration, detail.start + 1.5);
  const outAt = detail.end < duration ? detail.end : duration;
  const pts = [
    { t: 0, styleText: 'opacity:0;transform:translateX(22px)' },
    { t: inAt, styleText: 'opacity:0;transform:translateX(22px)' },
    { t: inDone, styleText: 'opacity:1;transform:translateX(0px)' },
    { t: outAt, styleText: 'opacity:1;transform:translateX(0px)' },
  ];
  if (detail.end < duration) {
    pts.push({ t: Math.min(duration, detail.end + 0.55), styleText: 'opacity:0;transform:translateX(12px)' });
  }
  pts.push({ t: duration, styleText: detail.end < duration ? 'opacity:0;transform:translateX(12px)' : 'opacity:1;transform:translateX(0px)' });
  timeline.add(`#${panelId}`, 'motion', pts);
  return `<g id="${panelId}" class="story-source-detail" style="opacity:0">${content}</g>`;
}

function buildCaptionHeader(step, index, totalSteps, pillStartX, pillPitch, pillW, chrome, mastheadBadge, palette) {
  const toneKind = step.tone || 'accent';
  const titleColor = toneKind === 'removed' ? palette.removed : toneKind === 'added' ? palette.accent : palette.text;
  const barColor = toneKind === 'removed' ? palette.removed : toneKind === 'modified' ? palette.amber : palette.accent;

  let inner = '';
  let titleX = 30;
  if (chrome !== 'minimal') {
    inner += `<line x1="30" x2="30" y1="29" y2="96" stroke="${barColor}" stroke-width="2"/>`;
    const badgeLabel = step.badge || String(index + 1).padStart(2, '0');
    const badgeW = Math.max(24, Math.round(textUnits(badgeLabel) * 10 + 12));
    inner += `<rect x="44" y="33" width="${badgeW}" height="18" rx="5" fill="${palette.line}" fill-opacity="0.7"/>`;
    inner += `<text x="${44 + badgeW / 2}" y="45.5" font-size="10.5" font-weight="650" fill="${palette.text}" text-anchor="middle">${escapeXml(badgeLabel)}</text>`;
    titleX = 44 + badgeW + 10;
  }

  const headlineBudget = Math.max(240, pillStartX - titleX - 18);
  const headlineFont = fitFontSize(step.title, headlineBudget, 20, 14);
  if (textUnits(step.title) * 13.5 > headlineBudget) {
    failChoreography('story/caption-overflow', 'manifest', `Step ${index} title "${step.title}" overflows caption header budget.`, {
      subject: { path: `/story/steps/${index}/title` },
      supportedFixes: ['shorten step title so it fits cleanly beside the progress pills'],
    });
  }
  inner += `<text x="${titleX}" y="49" font-size="${headlineFont}" fill="${titleColor}" font-weight="650" class="caption-title">${escapeXml(step.title)}</text>`;

  const bodyX = chrome === 'minimal' ? 30 : 44;
  const bodyLayout = layoutCaptionBody(step.body, 930 - bodyX, { path: `/story/steps/${index}/body` });
  if (bodyLayout.lines.length <= 1) {
    inner += `<text x="${bodyX}" y="79" font-size="${bodyLayout.fontSize}" fill="${palette.muted}" class="caption-body">${escapeXml(bodyLayout.lines[0] || '')}</text>`;
  } else {
    inner += `<text x="${bodyX}" y="73" font-size="${bodyLayout.fontSize}" fill="${palette.muted}" class="caption-body">`
      + `<tspan x="${bodyX}" dy="0">${escapeXml(bodyLayout.lines[0])}</tspan>`
      + `<tspan x="${bodyX}" dy="${bodyLayout.lineHeight}">${escapeXml(bodyLayout.lines[1])}</tspan>`
      + `</text>`;
  }

  if (mastheadBadge) {
    inner += `<text x="930" y="30" font-size="10" font-weight="600" fill="${palette.muted}" text-anchor="end">${escapeXml(mastheadBadge)}</text>`;
  }

  for (let p = 0; p < totalSteps; p += 1) {
    inner += `<rect x="${pillStartX + p * pillPitch}" y="42" width="${pillW}" height="3" rx="1.5" fill="${p <= index ? palette.accent : palette.line}"/>`;
  }
  return inner;
}

function prepareStageParts({ plan, bakedViews, viewTypes, theme, palette, isZh }) {
  const parts = {};
  for (const stage of plan.stages) {
    const rawSvg = bakedViews.get(stage.view)?.get(theme);
    if (!rawSvg) {
      failChoreography('story/missing-baked-view', 'export', `Baked ${theme} SVG for view "${stage.view}" was not generated before story compilation.`, {
        subject: { view: stage.view, theme },
        supportedFixes: [`ensure theme "${theme}" renders cleanly for view "${stage.view}"`],
      });
    }
    const viewIsZh = isZh || /lang="zh/i.test(rawSvg);
    const viewType = (viewTypes instanceof Map ? viewTypes.get(stage.view) : viewTypes?.[stage.view])
      || bakedViews.get(stage.view)?.type
      || stage.type
      || 'architecture';
    parts[stage.view] = prepareStageSvg({
      view: { id: `${theme}-${stage.view}`, type: viewType },
      rawSvg,
      statusBadges: plan.statusBadges,
      callouts: plan.viewCallouts?.[stage.view] || plan.callouts,
      palette,
      isZh: viewIsZh,
    });
  }
  return parts;
}

function attachStoryMetrics(plan, parts, timeline, duration, palette) {
  for (const [mi, item] of plan.metrics.entries()) {
    const part = parts[item.view];
    const node = part.nodes.find((n) => n.id === item.node);
    const x = node.x + node.width * (item.slot === 'left' ? 0.25 : item.slot === 'right' ? 0.75 : 0.5);
    // Sequence participants own the lifeline below their head, so their metric sits above the head instead.
    const above = part.type === 'sequence';
    const y = above ? node.y - 50 : node.y + node.height + 24;
    const prefix = `story-measure-${item.id || `${item.view}-${item.node}-${mi}`}`;
    const afterColor = item.tone === 'neutral' ? palette.text : palette.accent;
    const valueText = `${item.before} → ${item.after}`;
    const markup = `<g id="${prefix}-before" data-story-metric=""><text x="${x}" y="${y}" font-size="11" fill="${palette.muted}" font-weight="500" text-anchor="middle">${escapeXml(item.label)}</text><text x="${x}" y="${y + 24}" font-size="20" fill="${palette.text}" font-weight="600" text-anchor="middle">${escapeXml(String(item.before))}</text></g>`
      + `<g id="${prefix}-after" data-story-metric="" style="opacity:0"><text x="${x}" y="${y}" font-size="11" fill="${palette.muted}" font-weight="500" text-anchor="middle">${escapeXml(item.label)}</text><text x="${x}" y="${y + 24}" font-size="20" fill="${afterColor}" font-weight="650" text-anchor="middle">${escapeXml(valueText)}</text></g>`;
    attachNodeMetricMarkup(part, item.node, markup);
    const transitionEnd = Math.min(duration, item.at + 0.8);
    timeline.add(`#${prefix}-before`, 'opacity', [
      { t: 0, styleText: 'opacity:1' }, { t: item.at, styleText: 'opacity:1' }, { t: transitionEnd, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
    ]);
    timeline.add(`#${prefix}-after`, 'opacity', [
      { t: 0, styleText: 'opacity:0' }, { t: item.at, styleText: 'opacity:0' }, { t: transitionEnd, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
    ]);
    const metricHalfW = Math.max(textUnits(item.label) * 11, textUnits(valueText) * 20, textUnits(String(item.before)) * 20) / 2 + 10;
    const minX = Math.min(node.x, x - metricHalfW);
    const maxX = Math.max(node.x + node.width, x + metricHalfW);
    const extraBox = above
      ? { x: minX, y: y - 14, width: maxX - minX, height: node.y + node.height - (y - 14) }
      : { x: minX, y: node.y, width: maxX - minX, height: node.height + 64 };
    part.contentBox = boundsOf([part.contentBox, extraBox]);
    part.extraBoxes.push({ id: item.node, ...extraBox });
  }
}

function computeInitialCameras(plan, parts) {
  const pairTr = plan.transitions.find((tr) => tr.isPair);
  const pairCamera = pairTr
    ? fitCamera(boundsOf([parts[pairTr.from].contentBox, parts[pairTr.to].contentBox]), PLOT, 1.5)
    : null;
  const cameras = {};
  for (const stage of plan.stages) {
    const isPaired = pairTr && (stage.view === pairTr.from || stage.view === pairTr.to);
    cameras[stage.view] = isPaired ? pairCamera : fitCamera(parts[stage.view].contentBox, PLOT, 1.5);
  }
  return cameras;
}

function bindStageOpacityTrack(stage, inTr, outTr, timeline, duration) {
  if (stage.windows?.length) {
    const points = [{ t: 0, styleText: `opacity:${stage.windows[0].start === 0 ? 1 : 0}` }];
    for (const [i, window] of stage.windows.entries()) {
      if (window.start > 0) points.push(
        { t: window.start, styleText: 'opacity:0' },
        { t: Math.min(window.end, window.start + 1.1), styleText: 'opacity:1' },
      );
      points.push({ t: window.end, styleText: 'opacity:1' });
      if (window.end < duration) points.push({
        t: Math.min(duration, window.end + 0.85, stage.windows[i + 1]?.start ?? duration), styleText: 'opacity:0',
      });
    }
    points.push({ t: duration, styleText: `opacity:${stage.windows.at(-1).end === duration ? 1 : 0}` });
    timeline.add(`#view-${stage.view}`, 'opacity', points);
    return stage.windows[0].start === 0 ? 1 : 0;
  }
  if (inTr?.isPair || outTr?.isPair) {
    if (outTr?.isPair) {
      const outEnd = Math.min(duration, outTr.at + 0.9);
      timeline.add(`#view-${stage.view}`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: outTr.at, styleText: 'opacity:1' }, { t: outEnd, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
      ]);
      return 1;
    }
    const until = inTr.until ?? stage.end ?? duration;
    const inEnd = Math.min(duration, inTr.at + 1.15);
    const pts = [{ t: 0, styleText: 'opacity:0' }, { t: inTr.at, styleText: 'opacity:0' }, { t: inEnd, styleText: 'opacity:1' }, { t: until, styleText: 'opacity:1' }];
    if (until < duration) pts.push({ t: Math.min(duration, until + 0.9), styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' });
    else pts.push({ t: duration, styleText: 'opacity:1' });
    timeline.add(`#view-${stage.view}`, 'opacity', pts);
    return 0;
  }

  const start = inTr ? inTr.at : (stage.start ?? 0);
  const end = outTr ? outTr.at : (stage.end ?? duration);
  if (start > 0 || end < duration) {
    const pts = start > 0
      ? [{ t: 0, styleText: 'opacity:0' }, { t: start, styleText: 'opacity:0' }, { t: Math.min(duration, start + 1.1), styleText: 'opacity:1' }]
      : [{ t: 0, styleText: 'opacity:1' }];
    pts.push({ t: end, styleText: 'opacity:1' });
    if (end < duration) pts.push({ t: Math.min(duration, end + 0.85), styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' });
    else pts.push({ t: duration, styleText: 'opacity:1' });
    timeline.add(`#view-${stage.view}`, 'opacity', pts);
  }
  return start > 0 ? 0 : 1;
}

function applyStageOpacityTracks(plan, incomingTr, outgoingTr, timeline, duration) {
  const stageOpacity = {};
  for (const stage of plan.stages) {
    stageOpacity[stage.view] = bindStageOpacityTrack(stage, incomingTr.get(stage.view), outgoingTr.get(stage.view), timeline, duration);
  }
  return stageOpacity;
}

// The step window (same view) that contains a beat starting at `at`.
function stepWindowAt(plan, view, at) {
  const step = plan.steps.find((s) => s.view === view && at >= s.at - 0.01 && at < s.tEnd);
  return step ? { start: step.at, end: step.tEnd } : { start: at, end: at + 0.01 };
}

const inWindow = (t, win) => t >= win.start - 0.01 && t < win.end;

// Bounding box of an absolute-coordinate edge path; null when the path uses commands we cannot bound cheaply.
function pathBounds(d) {
  if (!d || /[a-zHVAhva]/.test(d.replace(/e[-+]?\d/gi, ''))) return null;
  const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  if (nums.length < 4 || nums.length % 2) return null;
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
}

// Visual box of a node for camera framing. Sequence participants own their lifeline below the head box.
function nodeFrameBox(part, node) {
  const box = { x: node.x, y: node.y - 12, width: node.width, height: node.height + 12 };
  if (part.type === 'sequence' && part.contentBox) {
    box.height = Math.max(box.height, part.contentBox.y + part.contentBox.height - box.y);
  }
  return box;
}

// Edges and nodes that a step actively narrates: focused nodes, detail nodes, traced edges and their endpoints.
function stepNarration(plan, part, view, win, { includeFocus = true } = {}) {
  const nodes = new Set();
  const edges = new Set();
  const edgeBoxes = [];
  const hops = [];
  if (includeFocus) {
    for (const f of plan.focus) if (f.view === view && inWindow(f.at, win)) f.nodes.forEach((n) => nodes.add(n));
  }
  for (const d of plan.details) {
    if (d.view === view && d.start < win.end && d.end > win.start) d.nodes.forEach((n) => nodes.add(n));
  }
  for (const trace of plan.traces) {
    if (trace.view !== view || !inWindow(trace.times[0], win)) continue;
    for (const [i, edgeId] of trace.edges.entries()) {
      const route = part.paths.get(edgeId);
      if (!route) continue;
      edges.add(route.id);
      if (route.from != null) nodes.add(route.from);
      if (route.to != null) nodes.add(route.to);
      const box = pathBounds(route.d);
      if (box) edgeBoxes.push(box);
      const ends = [route.from, route.to].map((id) => part.nodes.find((n) => n.id === id)).filter((n) => n && Number.isFinite(n.x));
      const hopBoxes = [...(box ? [box] : []), ...ends.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }))];
      if (hopBoxes.length) hops.push({ t: trace.times[i], travel: trace.travel ?? 1.4, box: boundsOf(hopBoxes) });
    }
  }
  hops.sort((a, b) => a.t - b.t);
  return { nodes, edges, edgeBoxes, hops };
}

// Below this scale native labels stop being readable at 960px; the camera crops instead of shrinking further.
const MIN_FOCUS_SCALE = 0.5;
const MAX_FOCUS_SCALE = 1.55;

function focusCamera(selection, anchor, area) {
  const pad = 14;
  const fit = fitCamera(selection, area, MAX_FOCUS_SCALE);
  if (fit.scale >= MIN_FOCUS_SCALE) return fit;
  const scale = MIN_FOCUS_SCALE;
  // Only crop at the readable-scale floor when the anchor itself fits in the viewport;
  // otherwise cropping around the midpoint can push every authored target off-screen.
  if (anchor.width + pad * 2 > area.w / scale || anchor.height + pad * 2 > area.h / scale) {
    return fit;
  }
  const axis = (start, size, anchorStart, anchorSize, areaSize) => {
    const visible = areaSize / scale;
    const lo = start - pad + visible / 2;
    const hi = start + size + pad - visible / 2;
    const wanted = anchorStart + anchorSize / 2;
    return lo > hi ? start + size / 2 : Math.min(hi, Math.max(lo, wanted));
  };
  const cx = axis(selection.x, selection.width, anchor.x, anchor.width, area.w);
  const cy = axis(selection.y, selection.height, anchor.y, anchor.height, area.h);
  return { scale, x: area.x + area.w / 2 - cx * scale, y: area.y + area.h / 2 - cy * scale };
}

function viewEntranceAt(plan, view) {
  const stage = plan.stages.find((s) => s.view === view);
  return stage?.windows?.[0]?.start ?? stage?.start ?? 0;
}

function applyFocusCameraTracks(plan, parts, cameras, timeline, duration) {
  const cameraMoves = Object.fromEntries(plan.stages.map((s) => [s.view, [{ t: 0, camera: cameras[s.view] }]]));
  const autoDetailFocus = plan.details
    .filter((d) => !plan.focus.some((f) => f.view === d.view && Math.abs(f.at - d.start) <= 0.35))
    .map((d) => ({ view: d.view, nodes: d.nodes, at: d.start, area: 'left', kind: 'detail' }));
  const focusOps = [
    ...plan.focus.map((f) => ({ ...f, kind: 'focus' })),
    ...autoDetailFocus,
  ].sort((a, b) => a.at - b.at);

  for (const op of focusOps) {
    const part = parts[op.view];
    const win = stepWindowAt(plan, op.view, op.at);
    // Keep separately timed focus operations within the same step independent of each other.
    const stepOps = focusOps.filter((other) => other.view === op.view && inWindow(other.at, win));
    const opIndex = stepOps.indexOf(op);
    const opWin = stepOps.length > 1
      ? {
          start: opIndex === 0 ? win.start : op.at,
          end: opIndex < stepOps.length - 1 ? stepOps[opIndex + 1].at : win.end,
        }
      : win;
    const narration = stepNarration(plan, part, op.view, opWin, { includeFocus: false });
    const selected = [...narration.edgeBoxes];
    const frameNode = (nodeId) => {
      const node = part.nodes.find((n) => n.id === nodeId);
      if (!node || !Number.isFinite(node.x)) return;
      selected.push(nodeFrameBox(part, node));
      for (const extra of part.extraBoxes.filter((b) => b.id === nodeId)) selected.push(extra);
    };
    op.nodes.forEach(frameNode);
    // Trace endpoints and active detail nodes of this beat stay in frame, not other timed focus ops.
    narration.nodes.forEach(frameNode);
    const selection = boundsOf(selected);
    const activeDetails = plan.details.filter((d) => d.view === op.view && d.start < opWin.end && d.end > opWin.start);
    const detailNodes = activeDetails.flatMap((d) => d.nodes);
    const anchorBoxes = detailNodes.map((id) => part.nodes.find((n) => n.id === id)).filter(Boolean).map((n) => nodeFrameBox(part, n));
    const anchor = anchorBoxes.length ? boundsOf(anchorBoxes) : selection;
    // When a code panel is active during this beat, frame inside LEFT_PLOT so the opaque code
    // backdrop never covers focused nodes or labels (even if focus.area was explicitly "center").
    const area = (op.area === 'left' || activeDetails.length > 0) ? LEFT_PLOT : PLOT;
    // When the selection cannot fit at a readable scale AND a sequential trace walks it hop by hop,
    // crop at MIN_FOCUS_SCALE to follow the trace and settle on the anchor. Without a sequential
    // trace, cropping would permanently hide explicit focus targets, so fit the entire selection.
    const fitSelection = fitCamera(selection, area, MAX_FOCUS_SCALE);
    const cropped = fitSelection.scale < MIN_FOCUS_SCALE;
    const sequential = narration.hops.length > 1 && narration.hops.every((h, i) => i === 0 || h.t - narration.hops[i - 1].t >= 0.5);
    let nextCamera = sequential ? focusCamera(selection, anchor, area) : fitSelection;
    if (area !== LEFT_PLOT) {
      // Focusing nearly the whole view would only crop its edges; keep the overview framing instead.
      const overview = fitCamera(part.contentBox, PLOT, 1.5);
      const spansView = selection.width >= part.contentBox.width * 0.75 || selection.height >= part.contentBox.height * 0.75;
      if (spansView && nextCamera.scale <= overview.scale * 1.15) nextCamera = overview;
    }
    const follow = cropped && sequential
      ? narration.hops.filter((h) => h.t < opWin.end).map((h) => ({ t: h.t, camera: focusCamera(selection, h.box, area), travel: h.travel }))
      : [];
    const firstCamera = follow.length ? follow[0].camera : nextCamera;
    const prevCamera = cameraMoves[op.view].at(-1).camera;
    const panEnd = Math.min(duration, op.at + 1.45);
    // A view's entrance focus frames it directly instead of panning while fading in;
    // explicit top-level focus times after entrance keep their scheduled pan from the overview.
    const entranceAt = viewEntranceAt(plan, op.view);
    const opensView = cameraMoves[op.view].length === 1
      && (op.at <= entranceAt || ((op.fromStep || op.kind === 'detail') && op.at <= entranceAt + 0.2));
    const moves = cameraMoves[op.view];
    if (opensView) {
      moves[0] = { t: 0, camera: firstCamera };
      cameras[op.view] = firstCamera;
    } else {
      moves.push({ t: op.at, camera: prevCamera }, { t: panEnd, camera: firstCamera });
    }
    if (follow.length) {
      const settleBy = Math.min(duration, opWin.end - 0.2);
      if (opensView) {
        const holdAt = Math.min(settleBy, follow[0].t);
        if (holdAt > moves.at(-1).t + 0.25) moves.push({ t: holdAt, camera: firstCamera });
      }
      for (const hop of follow.slice(1)) {
        const t = Math.min(settleBy, hop.t + hop.travel * 0.6);
        if (t > moves.at(-1).t + 0.25) moves.push({ t, camera: hop.camera });
      }
      const settleAt = Math.min(settleBy, moves.at(-1).t + 1.1);
      if (settleAt > moves.at(-1).t + 0.25) moves.push({ t: settleAt, camera: nextCamera });
    }
  }
  for (const [viewId, points] of Object.entries(cameraMoves)) {
    if (points.length <= 1) continue;
    points.push({ t: duration, camera: points.at(-1).camera });
    timeline.add(`#camera-${viewId}`, 'transform', points.map((p) => ({ t: p.t, styleText: `transform:${formatTransform(p.camera)}` })));
  }
  return cameraMoves;
}

function addSharedNodeOpacityTrack(layerId, fromIn, until, duration, timeline) {
  if (fromIn <= 0 && until >= duration) return;
  const opPts = fromIn > 0
    ? [{ t: 0, styleText: 'opacity:0' }, { t: fromIn, styleText: 'opacity:0' }, { t: Math.min(duration, fromIn + 0.8), styleText: 'opacity:1' }]
    : [{ t: 0, styleText: 'opacity:1' }];
  opPts.push({ t: until, styleText: 'opacity:1' });
  if (until < duration) opPts.push({ t: Math.min(duration, until + 0.85), styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' });
  else opPts.push({ t: duration, styleText: 'opacity:1' });
  timeline.add(`#${layerId}`, 'opacity', opPts);
}

function cameraAt(points, time) {
  let previous = points[0];
  for (const next of points.slice(1)) {
    if (next.t <= time) { previous = next; continue; }
    const progress = easedProgress('cubic-bezier(.65,0,.35,1)', (time - previous.t) / (next.t - previous.t));
    return Object.fromEntries(['x', 'y', 'scale'].map(key => [key, previous.camera[key] + (next.camera[key] - previous.camera[key]) * progress]));
  }
  return previous.camera;
}

function buildSharedTransitionNodeLayer({ tr, shared, fromPart, toPart, trPrefix, cameras, cameraMoves, afterCameraLater, fromIn, until, duration, palette, timeline }) {
  const built = buildSharedTransitionNode(fromPart, toPart, shared, trPrefix, palette);
  if (!built) return null;
  const layerId = `${trPrefix}-${shared.id}`;
  const poseFor = (camera) => {
    const scale = camera.scale * (built.toNode.width / built.fromNode.width);
    return {
      scale,
      x: camera.x + (built.toNode.x + built.toNode.width / 2) * camera.scale - (built.fromNode.x + built.fromNode.width / 2) * scale,
      y: camera.y + (built.toNode.y + built.toNode.height / 2) * camera.scale - (built.fromNode.y + built.fromNode.height / 2) * scale,
    };
  };
  const transitionDur = tr.duration ?? 1.6;
  const midAt = Math.min(duration, tr.at + transitionDur * 0.5);
  const doneAt = Math.min(duration, tr.at + transitionDur);
  timeline.copyIdTracks(built.idMap);

  if (built.newLabelId) {
    for (const id of built.oldLabelIds) timeline.add(`#${id}`, 'opacity', [
      { t: 0, styleText: 'opacity:1' }, { t: tr.at, styleText: 'opacity:1' }, { t: midAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
    ]);
    timeline.add(`#${built.newLabelId}`, 'opacity', [
      { t: 0, styleText: 'opacity:0' }, { t: midAt, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
    ]);
  }
  if (built.newSubId) {
    for (const id of built.oldSubIds) {
      timeline.add(`#${id}`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: tr.at, styleText: 'opacity:1' }, { t: doneAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
      ]);
    }
    timeline.add(`#${built.newSubId}`, 'opacity', [
      { t: 0, styleText: 'opacity:0' }, { t: tr.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
    ]);
  }
  if (built.badgeId) {
    timeline.add(`#${built.badgeId}`, 'opacity', [
      { t: 0, styleText: 'opacity:0' }, { t: tr.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
    ]);
  }

  const movePts = [
    ...cameraMoves[tr.from].filter(p => p.t < tr.at).map(p => ({ t: p.t, styleText: `transform:${formatTransform(p.camera)}` })),
    { t: tr.at, styleText: `transform:${formatTransform(cameraAt(cameraMoves[tr.from], tr.at))}` },
    { t: doneAt, styleText: `transform:${formatTransform(poseFor(cameraAt(cameraMoves[tr.to], doneAt)))}` },
    ...afterCameraLater.map((p) => ({ t: p.t, styleText: `transform:${formatTransform(poseFor(p.camera))}` })),
  ];
  movePts.push({ t: duration, styleText: movePts.at(-1).styleText });
  timeline.add(`#${layerId}`, 'transform', movePts);
  addSharedNodeOpacityTrack(layerId, fromIn, until, duration, timeline);

  const initOp = fromIn > 0 ? 0 : 1;
  return `<g data-native-key="${fromPart.key}"><g id="${layerId}" class="story-shared-layer" style="opacity:${initOp};transform:${formatTransform(cameras[tr.from])};transform-origin:0 0">${built.markup}</g></g>`;
}

function buildSharedTransitionLayers({ plan, parts, cameras, cameraMoves, incomingTr, outgoingTr, timeline, staticCss, duration, palette }) {
  const sharedLayers = [];
  const hiddenByView = new Map();
  const stageById = new Map(plan.stages.map((s) => [s.view, s]));

  for (const [ti, tr] of plan.transitions.entries()) {
    const fromPart = parts[tr.from];
    const toPart = parts[tr.to];
    if (!hiddenByView.has(tr.from)) hiddenByView.set(tr.from, new Set());
    if (!hiddenByView.has(tr.to)) hiddenByView.set(tr.to, new Set());
    const hiddenFrom = hiddenByView.get(tr.from);
    const hiddenTo = hiddenByView.get(tr.to);
    const transitionDur = tr.duration ?? 1.6;
    const trPrefix = plan.transitions.length === 1 ? 'story-shared' : `story-shared-t${ti}`;
    const afterCameraLater = cameraMoves[tr.to].filter((p) => p.t > tr.at + transitionDur);
    const prevIncoming = incomingTr.get(tr.from);
    const baseFromIn = prevIncoming?.at ?? (stageById.get(tr.from)?.start ?? 0);
    const until = tr.until ?? outgoingTr.get(tr.to)?.at ?? stageById.get(tr.to)?.end ?? duration;

    for (const shared of tr.shared) {
      const targetId = shared.targetId || shared.id;
      const carriedFromPrev = prevIncoming?.shared?.some((item) => (item.targetId || item.id) === shared.id);
      const fromIn = carriedFromPrev ? Math.max(0, tr.at - 0.15) : baseFromIn;
      hiddenFrom.add(shared.id);
      hiddenTo.add(targetId);
      staticCss.push(`#view-${tr.from} [data-node-id="${escapeCssAttr(shared.id)}"]{visibility:hidden}`);
      staticCss.push(`#view-${tr.to} [data-node-id="${escapeCssAttr(targetId)}"]{visibility:hidden}`);

      const markup = buildSharedTransitionNodeLayer({
        tr, shared, fromPart, toPart, trPrefix, cameras, cameraMoves, afterCameraLater, fromIn, until, duration, palette, timeline,
      });
      if (markup) sharedLayers.push(markup);
    }
  }
  return { sharedLayers, hiddenByView };
}

function applyRelabelOps(plan, parts, timeline, duration, palette) {
  for (const [index, op] of [...plan.relabel].sort((a, b) => a.at - b.at).entries()) {
    const part = parts[op.view];
    const node = part.nodes.find((n) => n.id === op.node);
    const ids = {
      oldLabelId: `story-relabel-lbl-old-${index}`,
      newLabelId: `story-relabel-lbl-new-${index}`,
      oldSubId: `story-relabel-old-${index}`,
      newSubId: `story-relabel-new-${index}`,
    };
    const res = applyNodeRelabel(part, op.node, node, op, ids, palette);
    const doneAt = Math.min(duration, op.at + 0.8);
    if (op.label) {
      if (res.hasLabel) {
        timeline.add(`#${res.oldLabelId}`, 'opacity', [{ t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' }]);
      }
      timeline.add(`#${ids.newLabelId}`, 'opacity', [{ t: 0, styleText: 'opacity:0' }, { t: op.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' }]);
    }
    if (op.subtitle) {
      if (res.hadOldSub) {
        timeline.add(`#${res.oldSubId}`, 'opacity', [{ t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' }]);
      }
      timeline.add(`#${ids.newSubId}`, 'opacity', [{ t: 0, styleText: 'opacity:0' }, { t: op.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' }]);
    }
  }
}

function applyEnterOps(plan, parts, timeline, staticCss, duration) {
  for (const op of plan.enter) {
    const part = parts[op.view];
    const stagger = op.stagger ?? 0.3;
    for (const [i, nodeId] of op.nodes.entries()) {
      const node = part.nodes.find((n) => n.id === nodeId);
      const start = Math.min(duration, op.at + i * stagger);
      const end = Math.min(duration, start + 1.05);
      const sel = `#view-${op.view} [data-node-id="${escapeCssAttr(nodeId)}"]`;
      staticCss.push(`${sel}{transform-origin:${node.x + node.width / 2}px ${node.y + node.height / 2}px}`);
      timeline.add(sel, 'opacity', [
        { t: 0, styleText: 'opacity:0' }, { t: start, styleText: 'opacity:0' }, { t: end, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
      ], 'cubic-bezier(.2,.8,.25,1)');
      timeline.add(sel, 'transform', [
        { t: 0, styleText: 'transform:translateY(14px) scale(.96)' }, { t: start, styleText: 'transform:translateY(14px) scale(.96)' }, { t: end, styleText: 'transform:translateY(0px) scale(1)' }, { t: duration, styleText: 'transform:translateY(0px) scale(1)' },
      ], 'cubic-bezier(.2,.8,.25,1)');
    }
  }
}

function applyConnectOps(plan, parts, timeline, duration) {
  for (const op of plan.connect) {
    const part = parts[op.view];
    const stagger = op.stagger ?? 0.4;
    for (const [i, edgeRef] of op.edges.entries()) {
      const route = part.paths.get(edgeRef);
      const start = Math.min(duration, op.at + i * stagger);
      const end = Math.min(duration, start + 1.1);
      const edgeKey = route.id;
      const escapedKey = escapeCssAttr(edgeKey);
      markEdgePathLength(part, edgeKey);
      const wrapSel = `#view-${op.view} [data-story-edge-wrap="${escapedKey}"], #view-${op.view} [data-edge-id="${escapedKey}"], #view-${op.view} [data-story-edge-id="${escapedKey}"]`;
      const strokeSel = `#view-${op.view} path[data-story-edge-id="${escapedKey}"]`;
      timeline.add(wrapSel, 'opacity', [
        { t: 0, styleText: 'opacity:0' }, { t: start, styleText: 'opacity:0' }, { t: Math.min(duration, start + 0.15), styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
      ]);
      timeline.add(strokeSel, 'dash', [
        { t: 0, styleText: 'stroke-dasharray:1;stroke-dashoffset:1' }, { t: start, styleText: 'stroke-dasharray:1;stroke-dashoffset:1' }, { t: end, styleText: 'stroke-dasharray:1;stroke-dashoffset:0' }, { t: duration, styleText: 'stroke-dasharray:1;stroke-dashoffset:0' },
      ]);
      if (route.marker) {
        timeline.add(strokeSel, 'marker', [
          { t: 0, styleText: 'marker-end:none', easing: 'step-end' },
          { t: Math.max(0, end - 0.02), styleText: 'marker-end:none', easing: 'step-end' },
          { t: end, styleText: `marker-end:${route.marker}`, easing: 'step-end' },
          { t: duration, styleText: `marker-end:${route.marker}`, easing: 'step-end' },
        ], 'step-end');
      }
    }
  }
}

function applyFadeOps(plan, parts, timeline, duration) {
  for (const op of plan.fade) {
    const part = parts[op.view];
    const doneAt = Math.min(duration, op.at + 1);
    for (const nodeId of op.nodes || []) {
      timeline.add(`#view-${op.view} [data-node-id="${escapeCssAttr(nodeId)}"]`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: `opacity:${op.to}` }, { t: duration, styleText: `opacity:${op.to}` },
      ]);
    }
    for (const edgeRef of op.edges || []) {
      const route = part.paths.get(edgeRef);
      const ek = escapeCssAttr(route.id);
      timeline.add(`#view-${op.view} [data-story-edge-wrap="${ek}"], #view-${op.view} [data-edge-id="${ek}"], #view-${op.view} [data-story-edge-id="${ek}"]`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: `opacity:${op.to}` }, { t: duration, styleText: `opacity:${op.to}` },
      ]);
    }
  }
}

function buildDetailOverlays(plan, parts, hiddenByView, timeline, duration, palette) {
  let detailMarkup = '';
  for (const [di, detail] of plan.details.entries()) {
    const part = parts[detail.view];
    // Keep everything the step narrates (focus, detail, traced edges and their endpoints) and only
    // recede the remaining context, so a code panel never hides the path its own trace is walking.
    const narration = stepNarration(plan, part, detail.view, stepWindowAt(plan, detail.view, detail.start));
    const focused = narration.nodes;
    const hidden = hiddenByView.get(detail.view) || new Set();
    const fadeOutAt = Math.min(duration, detail.start + 0.95);
    const fadeBackAt = detail.end < duration ? detail.end : null;
    const dim = `opacity:${DETAIL_CONTEXT_OPACITY}`;
    const addDetailFade = (selector) => {
      const pts = [{ t: 0, styleText: 'opacity:1' }, { t: detail.start, styleText: 'opacity:1' }, { t: fadeOutAt, styleText: dim }];
      if (fadeBackAt !== null) pts.push({ t: fadeBackAt, styleText: dim }, { t: Math.min(duration, fadeBackAt + 0.6), styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' });
      else pts.push({ t: duration, styleText: dim });
      timeline.add(selector, 'opacity', pts);
    };
    for (const node of part.nodes) {
      if (focused.has(node.id) || hidden.has(node.id)) continue;
      addDetailFade(`#view-${detail.view} [data-node-id="${escapeCssAttr(node.id)}"]`);
    }
    const seenEdgeIds = new Set();
    for (const route of part.paths.values()) {
      if (seenEdgeIds.has(route.id)) continue;
      seenEdgeIds.add(route.id);
      if (narration.edges.has(route.id)) continue;
      if (focused.has(route.from) && focused.has(route.to)) continue;
      const ek = escapeCssAttr(route.id);
      // Exclude nested descendants carrying the same edge attributes so opacity dims each edge once.
      const notNestedEdge = `:not([data-story-edge-wrap="${ek}"] *):not([data-edge-id="${ek}"] *):not([data-story-edge-id="${ek}"] *)`;
      addDetailFade(
        `#view-${detail.view} [data-story-edge-wrap="${ek}"]${notNestedEdge}, `
        + `#view-${detail.view} [data-edge-id="${ek}"]${notNestedEdge}, `
        + `#view-${detail.view} [data-story-edge-id="${ek}"]${notNestedEdge}`,
      );
    }
    addDetailFade(`#view-${detail.view} text.t-dim, #view-${detail.view} [data-graph-role="structural-frame"], #view-${detail.view} [data-domain-band]`);
    detailMarkup += buildDetailMarkup(detail, di, plan.details.length, timeline, duration, palette);
  }
  return detailMarkup;
}

function addTraceTokenHopTracks({ tokenId, isFirst, hopStart, hopMoveEnd, nextStart, hopHideAt, duration, timeline }) {
  const opacityPts = [];
  if (isFirst && hopStart === 0) {
    opacityPts.push({ t: 0, styleText: 'opacity:1' });
  } else {
    opacityPts.push({ t: 0, styleText: 'opacity:0' });
    if (isFirst) {
      const fadeIn = Math.max(0, hopStart - 0.25);
      if (fadeIn > 0) opacityPts.push({ t: fadeIn, styleText: 'opacity:0' });
      opacityPts.push({ t: hopStart, styleText: 'opacity:1' });
    } else {
      opacityPts.push({ t: Math.max(0, hopStart - 0.01), styleText: 'opacity:0' }, { t: hopStart, styleText: 'opacity:1' });
    }
  }
  opacityPts.push({ t: hopHideAt, styleText: 'opacity:1' });
  if (nextStart !== null) {
    opacityPts.push({ t: Math.min(duration, hopHideAt + 0.01), styleText: 'opacity:0' });
  } else {
    opacityPts.push({ t: Math.min(duration, hopHideAt + 0.3), styleText: 'opacity:0' });
  }
  opacityPts.push({ t: duration, styleText: 'opacity:0' });
  timeline.add(`#${tokenId}`, 'opacity', opacityPts);

  timeline.add(`#${tokenId}`, 'offsetDistance', [
    { t: 0, styleText: 'offset-distance:0%' },
    { t: hopStart, styleText: 'offset-distance:0%' },
    { t: hopMoveEnd, styleText: 'offset-distance:100%' },
    { t: duration, styleText: 'offset-distance:100%' },
  ], 'cubic-bezier(.4,0,.2,1)');
}

function buildTraceTokenLayers(plan, parts, timeline, staticCss, duration, palette) {
  const tokenMarkupByView = new Map();
  for (const [ti, trace] of plan.traces.entries()) {
    const part = parts[trace.view];
    const travel = trace.travel ?? 1.5;
    const hopCircles = [];
    for (let i = 0; i < trace.edges.length; i += 1) {
      const hopStart = trace.times[i];
      const route = part.paths.get(trace.edges[i]);
      const tokenId = `story-token-${ti}-${i}`;
      const cleanPath = route.d.replace(/[^0-9A-Za-z.,\s+-]/g, ' ').trim();
      const hopMoveEnd = Math.min(duration, hopStart + travel);
      const nextStart = i + 1 < trace.times.length ? trace.times[i + 1] : null;
      const hopHideAt = nextStart !== null ? Math.max(nextStart, hopMoveEnd) : Math.min(duration, trace.end ?? hopMoveEnd + 0.25);

      addTraceTokenHopTracks({
        tokenId,
        isFirst: i === 0,
        hopStart,
        hopMoveEnd,
        nextStart,
        hopHideAt,
        duration,
        timeline,
      });

      staticCss.push(`#${tokenId}{offset-path:path("${escapeCssAttr(cleanPath)}");offset-rotate:0deg}`);
      hopCircles.push(`<circle id="${tokenId}" data-story-token="" cx="0" cy="0" r="5" fill="${palette.accent}" stroke="${palette.bg}" stroke-width="2" style="opacity:0"/>`);
    }
    tokenMarkupByView.set(trace.view, (tokenMarkupByView.get(trace.view) || '') + hopCircles.join(''));
  }
  return tokenMarkupByView;
}

function buildStageLayers(plan, parts, cameras, stageOpacity, tokenMarkupByView) {
  return plan.stages.map((stage) => {
    const part = parts[stage.view];
    const tokens = tokenMarkupByView.get(stage.view) || '';
    const tokenWrap = tokens ? `<g data-story-tokens="">${tokens}</g>` : '';
    return (
      `<g id="view-${stage.view}" class="view-stage" data-native-key="${part.key}" style="opacity:${stageOpacity[stage.view]}">`
      + `<g id="camera-${stage.view}" style="transform:${formatTransform(cameras[stage.view])};transform-origin:0 0">${serializeXmlNode(part.svgNode)}${tokenWrap}</g></g>`
    );
  });
}

function buildCaptionLayers(plan, timeline, duration, palette) {
  const totalSteps = plan.steps.length;
  const pillPitch = totalSteps > 7 ? Math.floor(136 / totalSteps) : 19;
  const pillW = Math.max(6, Math.min(13, pillPitch - 5));
  const pillStartX = 930 - (totalSteps - 1) * pillPitch - pillW;

  return plan.steps.map((step, index) => {
    const id = `story-caption-${index}`;
    const fadesOut = index + 1 < totalSteps || step.tEnd < duration;
    const end = fadesOut ? Math.max(step.at + 0.5, step.tEnd - 0.55) : duration;
    const inner = buildCaptionHeader(step, index, totalSteps, pillStartX, pillPitch, pillW, plan.chrome, plan.badge, palette);

    const pts = step.at === 0
      ? [{ t: 0, styleText: 'opacity:1;transform:translateY(0px)' }]
      : [
          { t: 0, styleText: 'opacity:0;transform:translateY(8px)' },
          { t: step.at, styleText: 'opacity:0;transform:translateY(8px)' },
          { t: Math.min(duration, step.at + 0.6), styleText: 'opacity:1;transform:translateY(0px)' },
        ];
    pts.push({ t: end, styleText: 'opacity:1;transform:translateY(0px)' });
    if (fadesOut) {
      const hiddenAt = Math.min(duration, end + 0.4);
      pts.push({ t: hiddenAt, styleText: 'opacity:0;transform:translateY(-6px)' }, { t: duration, styleText: 'opacity:0;transform:translateY(-6px)' });
    } else {
      pts.push({ t: duration, styleText: 'opacity:1;transform:translateY(0px)' });
    }
    timeline.add(`#${id}`, 'motion', pts, 'cubic-bezier(.22,.7,.2,1)');
    return `<g id="${id}" class="story-caption" style="opacity:${step.at === 0 ? 1 : 0}">${inner}</g>`;
  });
}

function buildReducedMotionRule(plan, cameras) {
  const repView = plan.steps.at(-1)?.view || plan.transitions.at(-1)?.to || plan.stages.at(-1).view;
  const repCaptionIdx = Math.max(0, plan.steps.length - 1);
  return [
    `@media(prefers-reduced-motion:reduce){`,
    `*,*::before,*::after{animation:none!important}`,
    `[data-story-tokens],[data-story-token],.story-shared-layer,.story-source-detail{display:none!important}`,
    `.view-stage{opacity:0!important}`,
    `#view-${repView}{opacity:1!important}`,
    `#camera-${repView}{transform:${formatTransform(cameras[repView])}!important}`,
    `#view-${repView} [data-node-id],#view-${repView} [data-edge-id],#view-${repView} [data-story-edge-id],#view-${repView} [data-story-edge-wrap]{opacity:1!important;visibility:visible!important;transform:none!important;stroke-dashoffset:0!important}`,
    `.story-caption{opacity:0!important}`,
    `#story-caption-${repCaptionIdx}{opacity:1!important;transform:none!important}`,
    `}`,
  ].join('');
}

function assembleStorySvgMarkup({ plan, theme, preset, palette, staticCss, timelineCss, stageLayers, sharedLayers, detailMarkup, captionLayers, stillAt, switchable }) {
  const css = [...staticCss, ...timelineCss].join('\n');
  if (css.includes(']]>')) {
    throw new Error('story-svg: generated stylesheet contains forbidden CDATA terminator');
  }
  const storyTitle = plan.title || 'Story Walkthrough';
  const storyDesc = `${storyTitle}: ${plan.steps.map((s) => s.title).join(' -> ')}`;
  const metadata = `<metadata id="archify-software-notices">${escapeXml(softwareNotices)}</metadata>`;
  const bakeKind = stillAt === null ? 'story' : 'story-still';
  const loopAttr = stillAt === null ? ` data-story-loop="${plan.loop ? 'infinite' : 'finite'}"` : ` data-story-still="${stillAt}"`;
  const switchableAttr = switchable ? ' data-story-switchable=""' : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" role="img" aria-labelledby="archify-story-title archify-story-desc" data-theme="${theme}" data-preset="${escapeXml(preset)}" data-archify-bake="${bakeKind}"${loopAttr}${switchableAttr}>`
    + `<title id="archify-story-title">${escapeXml(storyTitle)}</title>`
    + `<desc id="archify-story-desc">${escapeXml(storyDesc)}</desc>`
    + `<style><![CDATA[\n${css}\n]]></style>`
    + `<defs><clipPath id="story-diagram-viewport" clipPathUnits="userSpaceOnUse"><rect x="${VIEWPORT.x}" y="${VIEWPORT.y}" width="${VIEWPORT.width}" height="${VIEWPORT.height}"/></clipPath></defs>`
    + `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${palette.bg}"/>`
    + `<g data-story-layer="diagram" clip-path="url(#story-diagram-viewport)">${stageLayers.join('')}${sharedLayers.join('')}${detailMarkup}</g>`
    + `<g data-story-layer="captions">${captionLayers.join('')}</g>`
    + `${metadata}</svg>\n`;

  assertCamoSafeSvg(svg, { assert: true });
  return {
    svg,
    id: plan.id || 'walkthrough',
    title: storyTitle,
    duration: plan.duration,
    loop: plan.loop,
    steps: plan.steps.map((s) => ({ at: s.at, title: s.title, body: s.body })),
    captionBandBottom: CAPTION_BAND_BOTTOM,
    viewportTop: VIEWPORT.y,
  };
}

// Compiles stage AST, transforms, shared layers, and CSS timeline tracks once per theme,
// allowing animated SVG and arbitrary static still snapshots without repeating AST passes.
export function createCompiledStoryTheme({
  plan, bakedViews, viewTypes = new Map(), theme, preset = 'classic',
  styles = loadViewerStyles(), reducedMotionFallback = true, switchable = false,
}) {
  const duration = plan.duration;
  const iteration = plan.loop === false ? '1 both' : 'infinite';
  const colors = storyPalette(theme, preset, styles);
  const palette = switchable ? {
    ...Object.fromEntries(Object.keys(colors).filter(key => key !== 'code').map(key => [key, `var(--story-${key})`])),
    code: Object.fromEntries(Object.keys(colors.code).map(key => [key, `var(--story-code-${key})`])),
  } : colors;
  const isZh = (plan.locale || '').toLowerCase().startsWith('zh');

  const parts = prepareStageParts({ plan, bakedViews, viewTypes, theme, palette, isZh });
  validatePlanAgainstParts(plan, parts);

  const timeline = new StoryTimeline(duration, iteration, theme, switchable);
  const staticCss = [
    styles.fontCss,
    `svg{font-family:${STORY_FONT_FALLBACK}}`,
    `[data-native-key] [data-legend]{display:none}`,
    `[data-story-node-badge] text{font-size:10.5px!important}`,
    `[data-story-metric]{visibility:visible}`,
    ...Object.values(parts).flatMap((part) => part.scopedCss),
  ];
  if (switchable) {
    // Keep the entire palette in the SVG so a frozen frame can be decoded as
    // an independent image without inheriting anything from the Stage page.
    for (const preset of BAKE_PRESETS) {
      for (const theme of BAKE_THEMES) {
        const variables = new Map([
          ...resolveThemeVariables(styles.rules, { theme, preset }),
          ...storyStageColors(styles, theme, preset),
        ]);
        const declarations = [...variables].map(([key, value]) => `${key}:${value}`).join(';');
        staticCss.push(`svg[data-story-switchable][data-theme="${theme}"][data-preset="${preset}"]{${declarations}}`);
      }
    }
  }

  attachStoryMetrics(plan, parts, timeline, duration, palette);
  const cameras = computeInitialCameras(plan, parts);
  const overviewCameras = { ...cameras };
  const incomingTr = new Map(plan.transitions.map((tr) => [tr.to, tr]));
  const outgoingTr = new Map(plan.transitions.map((tr) => [tr.from, tr]));
  const stageOpacity = applyStageOpacityTracks(plan, incomingTr, outgoingTr, timeline, duration);
  const cameraMoves = applyFocusCameraTracks(plan, parts, cameras, timeline, duration);
  applyRelabelOps(plan, parts, timeline, duration, palette);
  const { sharedLayers, hiddenByView } = buildSharedTransitionLayers({
    plan, parts, cameras, cameraMoves, incomingTr, outgoingTr, timeline, staticCss, duration, palette,
  });

  applyEnterOps(plan, parts, timeline, staticCss, duration);
  applyConnectOps(plan, parts, timeline, duration);
  applyFadeOps(plan, parts, timeline, duration);

  const detailMarkup = buildDetailOverlays(plan, parts, hiddenByView, timeline, duration, palette);
  const tokenMarkupByView = buildTraceTokenLayers(plan, parts, timeline, staticCss, duration, palette);
  const stageLayers = buildStageLayers(plan, parts, cameras, stageOpacity, tokenMarkupByView);
  const captionLayers = buildCaptionLayers(plan, timeline, duration, palette);
  let cachedAnimatedCss = null;
  const baseMarkup = { plan, theme, preset, palette, staticCss, stageLayers, sharedLayers, detailMarkup, captionLayers, switchable };

  return {
    meta: {
      id: plan.id || 'walkthrough',
      title: plan.title || 'Story Walkthrough',
      duration,
      loop: plan.loop,
      steps: plan.steps.map((s) => ({ at: s.at, title: s.title, body: s.body })),
      captionBandBottom: CAPTION_BAND_BOTTOM,
      viewportTop: VIEWPORT.y,
    },
    renderAnimatedSvg() {
      if (!cachedAnimatedCss) {
        cachedAnimatedCss = timeline.emitCss();
        if (reducedMotionFallback) cachedAnimatedCss.push(buildReducedMotionRule(plan, overviewCameras));
      }
      return assembleStorySvgMarkup({ ...baseMarkup, timelineCss: cachedAnimatedCss, stillAt: null });
    },
    renderStillSvg(atTime = null) {
      const target = atTime !== null ? atTime : Math.max(0, duration - 0.5);
      return assembleStorySvgMarkup({ ...baseMarkup, timelineCss: timeline.sampleCssAt(target), stillAt: target });
    },
  };
}

export function compileStorySvg(options) {
  return createCompiledStoryTheme(options).renderAnimatedSvg();
}

export function compileStoryStillSvg({ plan, bakedViews, viewTypes, theme, preset = 'classic', styles = loadViewerStyles(), atTime = null }) {
  return createCompiledStoryTheme({ plan, bakedViews, viewTypes, theme, preset, styles }).renderStillSvg(atTime);
}
