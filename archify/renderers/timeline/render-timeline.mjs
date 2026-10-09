import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, measureLegend, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: tl, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'timeline',
  defaultExample: 'payment-incident.timeline.json',
  argv: cliArgs,
});
const locale = tl.meta.locale;
const ADVANCE = nodeTextFit.widthFactor;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const layout = {
  margin: 28,
  top: 52,
  axisH: 60,
  // The lane column fits its longest label (13px bold), so a lane name never
  // runs into the axis.
  laneLabelW: asArray(tl.lanes).length
    ? Math.ceil(Math.max(88, ...tl.lanes.map((lane) => textUnits(lane.label) * 13 * nodeTextFit.widthFactor * 1.06 + 24)))
    : 0,
  axisWidth: tl.layout?.width ?? 960,
  edgePad: 72,
  breakW: 60,
  laneGap: 10,
  lanePad: 14,
  // Room between the lane's time line and the nearest card on either side,
  // which the stem crosses.
  stemGap: 16,
  rowGap: 8,
  cardMaxW: 200,
  cardPadX: 10,
  cardAccent: 12,
  titleFont: 12.5,
  titleLine: 15,
  timeFont: 10.5,
  minTickPx: 84,
};

// ---- Input checks --------------------------------------------------------------
// Time is the one fact this diagram draws, so every timestamp must parse and
// state its own offset (the schema requires Z or ±HH:MM); the display zone must
// be a real IANA zone, and every event must sit in a declared lane.
// Date.parse normalizes some impossible dates (February 30 becomes March 2).
// Check the authored calendar date independently of its UTC offset first.
function validCalendarDate(timestamp) {
  const [year, month, day] = timestamp.slice(0, 10).split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
const timezone = tl.meta.timezone || 'UTC';
{
  const problems = [];
  const details = [];
  const fail = (code, message, subject, evidence, supportedFixes) => {
    problems.push(message);
    details.push({ code, severity: 'error', message, subject: { diagramType: 'timeline', ...subject }, evidence, supportedFixes });
  };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    fail('timeline/invalid-timezone', `meta.timezone "${timezone}" is not a recognised IANA time zone.`,
      { path: '/meta/timezone' }, { timezone }, ['Use an IANA zone such as "UTC", "Europe/Berlin", or "Asia/Shanghai".']);
  }
  const laneIds = new Set(asArray(tl.lanes).map((lane) => lane.id));
  const seen = new Set();
  for (const [index, event] of asArray(tl.events).entries()) {
    if (seen.has(event.id)) fail('timeline/duplicate-id', `Event id "${event.id}" is declared twice.`, { path: `/events/${index}/id` }, { id: event.id }, ['Give every event a unique id.']);
    seen.add(event.id);
    if (!validCalendarDate(event.at) || !Number.isFinite(Date.parse(event.at))) {
      fail('timeline/invalid-timestamp', `Event "${event.id}" timestamp "${event.at}" is not a valid date and time.`,
        { path: `/events/${index}/at`, nodeId: event.id }, { at: event.at }, ['Use ISO 8601 with an explicit offset, e.g. "2026-10-01T10:05:00+08:00".']);
    }
    if (laneIds.size && !laneIds.has(event.lane)) {
      fail('timeline/unknown-lane', event.lane === undefined
        ? `Event "${event.id}" has no lane, but the timeline declares lanes.`
        : `Event "${event.id}" names lane "${event.lane}", which is not declared.`,
      { path: `/events/${index}/lane`, nodeId: event.id }, { lane: event.lane ?? null, lanes: [...laneIds] },
      ['Set lane to one of the declared lane ids.', 'Declare the missing lane.']);
    }
  }
  if (problems.length) throwDiagnosticProblems('Timeline validation failed', problems, { code: 'timeline/input', subject: { diagramType: 'timeline' }, diagnostics: details });
}

// ---- Time zone formatting ------------------------------------------------------
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function wall(ms) {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour, mi: parts.minute, s: parts.second };
}
// Offset of the display zone at an instant, in ms (local wall clock - UTC).
function zoneOffset(ms) {
  const w = wall(ms);
  return Date.UTC(+w.y, +w.mo - 1, +w.d, +w.h, +w.mi, +w.s) - Math.floor(ms / 1000) * 1000;
}
function offsetLabel(ms) {
  const minutes = Math.round(zoneOffset(ms) / MINUTE);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// ---- Events in time order -------------------------------------------------------
const events = asArray(tl.events)
  .map((event, index) => ({ ...event, index, t: Date.parse(event.at) }))
  .sort((a, b) => a.t - b.t || a.index - b.index);
const times = [...new Set(events.map((event) => event.t))];
const first = times[0];
const last = times.at(-1);
const span = last - first;

const showSeconds = events.some((event) => new Date(event.t).getUTCSeconds() !== 0 || new Date(event.t).getUTCMilliseconds() !== 0);
const multiDay = (() => {
  const a = wall(first);
  const b = wall(last);
  return a.y !== b.y || a.mo !== b.mo || a.d !== b.d;
})();
function clockLabel(ms, { seconds = showSeconds, date = multiDay } = {}) {
  const w = wall(ms);
  return `${date ? `${w.mo}-${w.d} ` : ''}${w.h}:${w.mi}${seconds ? `:${w.s}` : ''}`;
}

function durationLabel(ms) {
  const units = [['d', DAY], ['h', HOUR], ['min', MINUTE], ['s', 1000]];
  const parts = [];
  let rest = ms;
  for (const [unit, size] of units) {
    const value = Math.floor(rest / size);
    if (value) parts.push(`${value} ${unit}`);
    rest -= value * size;
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0 s';
}

// The visible break label is approximate (it carries ≈), so it rounds to the
// two most significant adjacent units: "15 h", never "15 h 3 s".
function approximateDuration(ms) {
  const units = [['d', DAY], ['h', HOUR], ['min', MINUTE], ['s', 1000]];
  const index = units.findIndex(([, size]) => ms >= size);
  if (index === -1) return '0 s';
  const [major, majorSize] = units[index];
  if (index === units.length - 1) return `${Math.round(ms / majorSize)} ${major}`;
  const [minor, minorSize] = units[index + 1];
  let whole = Math.floor(ms / majorSize);
  let rest = Math.round((ms - whole * majorSize) / minorSize);
  if (rest * minorSize >= majorSize) { whole += 1; rest = 0; }
  return rest ? `${whole} ${major} ${rest} ${minor}` : `${whole} ${major}`;
}

// ---- Axis segments and disclosed breaks ----------------------------------------
// A quiet period much longer than the timeline's ordinary rhythm would squeeze
// every other event into a sliver. With `layout.breaks: "auto"` (the default)
// such a gap is drawn as a fixed-width break that states the omitted duration,
// so the axis stays proportional inside each segment and never hides that it
// was compressed. A gap is a break when it is longer than eight times the
// median gap and longer than a tenth of the whole span; at most eight are
// drawn (the longest), so bursts of activity get readable room.
const gaps = times.slice(1).map((time, index) => ({ from: times[index], to: time, length: time - times[index] }));
const sortedGaps = gaps.map((gap) => gap.length).sort((a, b) => a - b);
const medianGap = sortedGaps.length ? sortedGaps[Math.floor((sortedGaps.length - 1) / 2)] : 0;
const SEGMENT_FLOOR = 28;
const candidates = tl.layout?.breaks === 'none' ? [] : gaps
  .filter((gap) => gap.length > 8 * medianGap && gap.length > 0.1 * span)
  .sort((a, b) => b.length - a.length)
  .slice(0, 8);

// Reserve room for proportional time before accepting a break. If fixed-width
// labels would exhaust the authored axis, leave shorter quiet periods on the
// linear scale instead of collapsing all distinct instants to one position.
const breaks = [];
let fixedWidth = layout.edgePad * 2 + SEGMENT_FLOOR;
for (const gap of candidates) {
  gap.label = `≈ ${approximateDuration(gap.length)}`;
  gap.width = Math.max(layout.breakW, Math.ceil(textUnits(gap.label) * 10.5 * ADVANCE + 18));
  const addedWidth = gap.width + SEGMENT_FLOOR;
  if (fixedWidth + addedWidth + layout.minTickPx > layout.axisWidth) continue;
  breaks.push(gap);
  fixedWidth += addedWidth;
}
breaks.sort((a, b) => a.from - b.from);

const segments = [];
{
  let start = first;
  for (const gap of breaks) {
    segments.push({ start, end: gap.from });
    start = gap.to;
  }
  segments.push({ start, end: last });
}
const linearTime = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
const axisX0 = layout.margin + layout.laneLabelW;
// A break is as wide as its duration label; every segment gets a small floor
// width so a lone event between two breaks never shares their x, and the rest
// of the axis is shared in proportion to time. Inside a segment the scale is
// one constant, so distances there are exact.
const drawable = layout.axisWidth - layout.edgePad * 2
  - breaks.reduce((sum, gap) => sum + gap.width, 0) - SEGMENT_FLOOR * segments.length;
const scale = linearTime > 0 ? Math.max(0, drawable) / linearTime : 0;
{
  let x = axisX0 + layout.edgePad;
  const share = linearTime > 0 ? 0 : Math.max(0, drawable) / segments.length;
  for (const [index, segment] of segments.entries()) {
    const inner = (segment.end - segment.start) * scale + share;
    segment.x0 = x + SEGMENT_FLOOR / 2 + (segment.end === segment.start ? inner / 2 : 0);
    segment.x1 = segment.end === segment.start ? segment.x0 : segment.x0 + inner;
    x += SEGMENT_FLOOR + inner;
    if (index < breaks.length) {
      breaks[index].x0 = x;
      breaks[index].x1 = x + breaks[index].width;
      x += breaks[index].width;
    }
  }
}
const axisX1 = axisX0 + layout.axisWidth;

function xOf(time) {
  const segment = segments.find((candidate) => time >= candidate.start && time <= candidate.end) ?? segments[0];
  return Math.round((segment.x0 + (time - segment.start) * scale) * 100) / 100;
}

// Ticks fall on the display zone's wall clock, so a +05:30 zone still ticks
// on its own whole hours.
const TICKS = [1000, 2000, 5000, 10_000, 15_000, 30_000, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
const ticks = [];
for (const segment of segments) {
  const length = segment.end - segment.start;
  if (length <= 0 || scale <= 0) {
    ticks.push({ t: segment.start, x: segment.x0 });
    continue;
  }
  const interval = TICKS.find((candidate) => candidate * scale >= layout.minTickPx) ?? TICKS.at(-1);
  const offset = zoneOffset(segment.start);
  let t = Math.ceil((segment.start + offset) / interval) * interval - offset;
  const before = ticks.length;
  for (; t <= segment.end; t += interval) ticks.push({ t, x: xOf(t), interval });
  // A segment too short for a regular tick still states where it starts.
  if (ticks.length === before) ticks.push({ t: segment.start, x: segment.x0, interval });
}
const tickSeconds = ticks.some((tick) => tick.interval < MINUTE);

// ---- Lanes and event cards ------------------------------------------------------
const lanes = asArray(tl.lanes).length ? tl.lanes : [{ id: '__all', label: '' }];
const laneOf = (event) => (asArray(tl.lanes).length ? event.lane : '__all');

function wrapTitle(text, maxWidth) {
  const limit = Math.max(6, Math.floor(maxWidth / (layout.titleFont * ADVANCE * 1.05)));
  const words = String(text).split(/(\s+)/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (textUnits((current + word).trim()) <= limit) { current += word; continue; }
    if (current.trim()) lines.push(current.trim());
    current = word.trimStart();
    while (textUnits(current) > limit) {
      const chars = Array.from(current);
      let cut = 0;
      for (let units = 0; cut < chars.length && units + textUnits(chars[cut]) <= limit; cut += 1) units += textUnits(chars[cut]);
      lines.push(chars.slice(0, Math.max(1, cut)).join(''));
      current = chars.slice(Math.max(1, cut)).join('');
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

const cards = events.map((event) => {
  const time = clockLabel(event.t);
  const padLeft = layout.cardAccent + 2;
  const natural = Math.max(textUnits(event.title) * layout.titleFont * ADVANCE * 1.05, textUnits(time) * layout.timeFont * ADVANCE);
  const width = Math.ceil(Math.min(layout.cardMaxW, natural + padLeft + layout.cardPadX));
  const lines = wrapTitle(event.title, width - padLeft - layout.cardPadX);
  const height = 9 + 12 + lines.length * layout.titleLine + 7;
  const x = xOf(event.t);
  // The card is centred on its instant but never leaves the axis area.
  const left = Math.min(Math.max(x - width / 2, axisX0 + 4), axisX1 - width - 4);
  return { ...event, time, width, height, lines, x, left, padLeft };
});

// Within a lane, cards sit on either side of the lane's time line and pack
// into rows outward from it: a card takes whichever side lets it sit closest
// to the line without touching an earlier card, so simultaneous and close
// events stack instead of overprinting, and a burst spreads both ways rather
// than growing one tall column. Ties go below the line. The dot always stays
// on the line, at the event's exact instant.
const laneLayout = [];
{
  let y = layout.top + layout.axisH;
  for (const lane of lanes) {
    const members = cards.filter((card) => laneOf(card) === lane.id);
    const sides = { above: { ends: [], heights: [] }, below: { ends: [], heights: [] } };
    const fit = (side, card) => {
      const index = sides[side].ends.findIndex((end) => card.left >= end + 10);
      return index === -1 ? sides[side].ends.length : index;
    };
    for (const card of members) {
      const above = fit('above', card);
      const below = fit('below', card);
      card.side = above < below ? 'above' : 'below';
      card.row = card.side === 'above' ? above : below;
      const side = sides[card.side];
      side.ends[card.row] = card.left + card.width;
      side.heights[card.row] = Math.max(side.heights[card.row] || 0, card.height);
    }
    const extent = (side) => side.heights.reduce((sum, height) => sum + height + layout.rowGap, 0) - (side.heights.length ? layout.rowGap : 0);
    const aboveExtent = extent(sides.above);
    const lineY = y + layout.lanePad + (aboveExtent ? aboveExtent + layout.stemGap : 10);
    const offsets = (side) => {
      const out = [];
      side.heights.reduce((offset, height, row) => { out[row] = offset; return offset + height + layout.rowGap; }, layout.stemGap);
      return out;
    };
    const aboveOffset = offsets(sides.above);
    const belowOffset = offsets(sides.below);
    for (const card of members) {
      card.lineY = lineY;
      // Above the line a row is bottom-aligned to its edge nearest the line,
      // below it top-aligned, so every stem in a row has the same length.
      card.top = card.side === 'above' ? lineY - aboveOffset[card.row] - card.height : lineY + belowOffset[card.row];
    }
    const bottom = sides.below.heights.length ? lineY + belowOffset.at(-1) + sides.below.heights.at(-1) : lineY + 10;
    const height = Math.max(56, bottom - y + layout.lanePad);
    laneLayout.push({ ...lane, y, height, lineY });
    y += height + layout.laneGap;
  }
}

// ---- Legend ---------------------------------------------------------------------
const KIND_TONE = { default: 'external', change: 'frontend', alert: 'security', action: 'messagebus', recovery: 'backend' };
const kindOf = (event) => event.kind || 'default';
const legendEntries = resolveLegend(undefined,
  Object.keys(KIND_TONE).map((kind) => ({ kind, label: i18nText(locale, `legend.timeline.${kind}`), interactive: false })),
  new Set(events.map(kindOf)))
  .filter((entry, _, all) => all.length > 1);

const contentBottom = laneLayout.at(-1).y + laneLayout.at(-1).height;
const width = Math.ceil(axisX1 + layout.margin);
const footprint = legendFootprint(legendEntries, { width: width - layout.margin * 2, fontSize: 11 });
const height = Math.ceil(contentBottom + layout.margin + (legendEntries.length ? 34 + footprint.extraHeight : 0));
const viewBox = [width, height];

function legendLayout() {
  return { x: layout.margin, baselineY: height - 16, width: width - layout.margin * 2, fontSize: 11, minTitleY: contentBottom + 8, diagramType: 'timeline' };
}

// ---- Rendering ------------------------------------------------------------------
function renderAxis() {
  const top = layout.top;
  const bottom = contentBottom;
  const lineY = top + layout.axisH - 10;
  // Tick labels never overprint each other or a break's duration label. On a
  // multi-day axis a tick names its date only when the date changes from the
  // previous label, so the axis reads "09-29 15:00 · 18:00 · 21:00".
  const taken = [];
  let lastDate = null;
  const shown = ticks.flatMap((tick) => {
    const w = wall(tick.t);
    const date = `${w.mo}-${w.d}`;
    const label = clockLabel(tick.t, { seconds: tickSeconds, date: multiDay && date !== lastDate });
    const half = textUnits(label) * 10.5 * ADVANCE / 2 + 5;
    const box = [tick.x - half, tick.x + half];
    if (taken.some(([a, b]) => box[0] < b && a < box[1])) return [];
    taken.push(box);
    lastDate = date;
    return [{ ...tick, label }];
  });
  const grid = shown.map((tick) => `          <line x1="${tick.x}" y1="${lineY}" x2="${tick.x}" y2="${bottom}" class="tl-grid" stroke-width="1"/>
          <line x1="${tick.x}" y1="${lineY - 4}" x2="${tick.x}" y2="${lineY}" class="tl-axis" stroke-width="1"/>
          <text x="${tick.x}" y="${lineY - 10}" class="t-muted tl-tick" font-size="10.5" text-anchor="middle">${esc(tick.label)}</text>`).join('\n');
  const segmentLines = segments.map((segment, index) => {
    const from = index ? breaks[index - 1].x1 : axisX0 + 8;
    const to = index < breaks.length ? breaks[index].x0 : axisX1 - 8;
    return `          <line x1="${from}" y1="${lineY}" x2="${to}" y2="${lineY}" class="tl-axis" stroke-width="1"/>`;
  }).join('\n');
  const breakMarks = breaks.map((gap) => {
    const mid = (gap.x0 + gap.x1) / 2;
    const zig = (x) => `M ${x - 2.5} ${lineY - 6} L ${x + 2.5} ${lineY + 6}`;
    const omitted = i18nText(locale, 'timeline.break', { duration: durationLabel(gap.length) });
    return `          <g data-timeline-break="" data-break-ms="${gap.length}" aria-label="${esc(omitted)}" role="img">
            <rect x="${gap.x0 + 6}" y="${lineY}" width="${gap.width - 12}" height="${bottom - lineY}" fill="url(#tl-break-hatch)" class="tl-break-band"/>
            <path d="${zig(gap.x0 + 6)} ${zig(gap.x0 + 10)} ${zig(gap.x1 - 10)} ${zig(gap.x1 - 6)}" class="tl-break-zig" stroke-width="1.3" stroke-linecap="round" fill="none"/>
            <rect x="${mid - gap.width / 2 + 4}" y="${lineY - 41}" width="${gap.width - 8}" height="17" rx="8.5" class="tl-break-chip"/>
            <text x="${mid}" y="${lineY - 29}" class="t-muted" font-size="10" font-weight="700" text-anchor="middle">${esc(gap.label)}</text>
          </g>`;
  }).join('\n');
  return `${grid}\n${segmentLines}\n${breakMarks}`;
}

function renderHeader() {
  const evidence = i18nText(locale, `timeline.evidence.${tl.meta.evidence}`);
  const evidenceW = Math.ceil(textUnits(evidence) * 10.5 * ADVANCE + 24);
  const date = multiDay ? '' : ` · ${wall(first).y}-${wall(first).mo}-${wall(first).d}`;
  const zone = `${timezone === 'UTC' ? 'UTC' : `${timezone} (${offsetLabel(first)})`}${date}`;
  const disclosure = breaks.length ? ` · ${i18nText(locale, 'timeline.compressed', { count: breaks.length })}` : '';
  const caption = `${i18nText(locale, 'timeline.axis')}: ${zone}${disclosure}`;
  const tone = tl.meta.evidence === 'observed' ? 'backend' : 'messagebus';
  return `        <g data-timeline-evidence="${esc(tl.meta.evidence)}">
          <rect x="${layout.margin}" y="14" width="${evidenceW}" height="22" rx="11" class="c-${tone}" stroke-width="1"/>
          <circle cx="${layout.margin + 11}" cy="25" r="3" class="t-${tone}"/>
          <text x="${layout.margin + evidenceW / 2 + 5}" y="29" class="t-${tone}" font-size="10.5" font-weight="700" text-anchor="middle">${esc(evidence)}</text>
        </g>
        <text data-timeline-axis-caption="" x="${layout.margin + evidenceW + 14}" y="29.5" class="t-muted" font-size="11.5">${esc(caption)}</text>`;
}

function renderLanes() {
  return laneLayout.map((lane, index) => `        <g data-timeline-lane="${esc(lane.id)}">
          <rect x="${layout.margin - 8}" y="${lane.y}" width="${axisX1 - layout.margin + 8}" height="${lane.height}" rx="10" class="tl-lane${index % 2 ? ' tl-lane-alt' : ''}"/>
          <line x1="${axisX0 + 8}" y1="${lane.lineY}" x2="${axisX1 - 8}" y2="${lane.lineY}" class="tl-lane-line" stroke-width="1.5" stroke-linecap="round"/>
          ${lane.label ? `<text x="${layout.margin}" y="${lane.lineY + 4.5}" class="t-primary" font-size="13" font-weight="700">${esc(lane.label)}</text>` : ''}
        </g>`).join('\n');
}

function renderEvent(card, order) {
  const tone = KIND_TONE[kindOf(card)];
  const lane = laneLayout.find((entry) => entry.id === laneOf(card));
  // The Node index groups by the context before " › ", so the lane leads.
  const context = [lane?.label, `${clockLabel(card.t, { seconds: true, date: true })} ${offsetLabel(card.t)}`].filter(Boolean).join(' \u203a ');
  const passport = { kind: tone, sublabel: card.detail, context };
  const textX = card.left + card.padLeft;
  let y = card.top + 9 + 10;
  const time = `<text x="${textX}" y="${y}" class="t-muted tl-time" font-size="${layout.timeFont}" font-weight="600">${esc(card.time)}</text>`;
  y += 2;
  const title = card.lines.map((line) => {
    y += layout.titleLine;
    return `<tspan x="${textX}" y="${y}">${esc(line)}</tspan>`;
  }).join('');
  // A tone accent down the card's leading edge carries the event kind, so the
  // card body stays a quiet surface for the text.
  const accent = `<line x1="${card.left + 6}" y1="${card.top + 7}" x2="${card.left + 6}" y2="${card.top + card.height - 7}" class="tl-accent tl-accent-${tone}" stroke-width="3" stroke-linecap="round"/>`;
  return `        <g ${focusNodeAttrs(card.id, card.title, passport, locale)} data-timeline-at="${esc(card.at)}" data-timeline-ms="${card.t}" data-timeline-x="${card.x}">
          ${focusNodeTitle(card.title, passport)}
          <rect x="${card.left}" y="${card.top}" width="${card.width}" height="${card.height}" rx="7" class="c-mask"/>
          <rect x="${card.left}" y="${card.top}" width="${card.width}" height="${card.height}" rx="7" class="c-${tone} tl-card"${animateAttr(tl.meta, 'node', order)} stroke-width="1"/>
          ${accent}
          ${time}
          <text data-node-label="" class="t-primary" font-size="${layout.titleFont}" font-weight="650">${title}</text>
          <circle cx="${card.x}" cy="${card.lineY}" r="4.75" class="t-${tone}"/>
        </g>`;
}

function legendSwatch(entry) {
  return `<circle cx="${entry.x + 6}" cy="${entry.baseline - 4}" r="4.5" class="t-${KIND_TONE[entry.kind]} tl-dot" stroke-width="2"/>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(tl.meta)} data-timeline-ui="" data-reader-fit="intrinsic-height" data-reader-min-text="7.5">
${svgAccessibleText(tl.meta, 'timeline')}
${renderDefinitions(breaks.length ? `
          <pattern id="tl-break-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="tl-hatch" stroke-width="1"/></pattern>` : '')}
        <style>
          svg[data-timeline-ui] .tl-grid { stroke: var(--lane-stroke); stroke-dasharray: 2 4; opacity: .7; }
          svg[data-timeline-ui] .tl-axis { stroke: var(--text-dim); }
          svg[data-timeline-ui] .tl-lane { fill: var(--lane-fill); stroke: none; opacity: .75; }
          svg[data-timeline-ui] .tl-lane-alt { opacity: 0; }
          svg[data-timeline-ui] .tl-lane-line { stroke: var(--lane-stroke); }
          svg[data-timeline-ui] .tl-stem { stroke: var(--text-dim); }
          svg[data-timeline-ui] .tl-card { fill-opacity: .55; stroke-opacity: .5; }
          svg[data-timeline-ui] .tl-card.c-external { fill: var(--mask); stroke: var(--lane-stroke); stroke-opacity: 1; }
          svg[data-timeline-ui] .tl-dot { stroke: var(--mask); }
          svg[data-timeline-ui] .tl-halo { fill: var(--mask); }
          svg[data-timeline-ui] .tl-break-band { opacity: .55; }
          svg[data-timeline-ui] .tl-break-chip { fill: var(--mask); stroke: var(--lane-stroke); stroke-width: 1; }
          svg[data-timeline-ui] .tl-hatch { stroke: var(--lane-stroke); }
          svg[data-timeline-ui] .tl-break-zig { stroke: var(--text-dim); }
${Object.values(KIND_TONE).map((tone) => `          svg[data-timeline-ui] .tl-accent-${tone} { stroke: var(--${tone}-stroke); }`).join('\n')}
          svg[data-timeline-ui] .tl-tick, svg[data-timeline-ui] .tl-time { font-variant-numeric: tabular-nums; }
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

${renderHeader()}

        <!-- Lanes -->
${renderLanes()}

        <!-- Time axis (proportional within each segment; breaks are disclosed) -->
${renderAxis()}

        <!-- Stems sit behind every card, so a stacked card is never crossed by
             another event's connector -->
${cards.map((card) => `        <line data-detail="context" data-timeline-stem="${esc(card.id)}" x1="${card.x}" y1="${card.lineY}" x2="${card.x}" y2="${card.side === 'above' ? card.top + card.height : card.top}" class="tl-stem" stroke-width="1"/>`).join('\n')}

        <!-- One halo layer under every dot, so events seconds apart merge into
             one outlined capsule instead of cutting crescents into each other -->
${cards.map((card) => `        <circle data-detail="context" cx="${card.x}" cy="${card.lineY}" r="7.5" class="tl-halo"/>`).join('\n')}

        <!-- Events in time order -->
${cards.map(renderEvent).join('\n')}

        <!-- Legend -->
${legendEntries.length ? renderResolvedLegend({ entries: legendEntries, locale, layout: legendLayout(), renderSwatch: legendSwatch }) : ''}
      </svg>`;
}

function buildLayoutReport() {
  return {
    diagram_type: 'timeline',
    viewBox,
    timezone,
    scalePxPerMinute: Math.round(scale * MINUTE * 1000) / 1000,
    segments: segments.map(({ start, end, x0, x1 }) => ({ start, end, x0, x1 })),
    breaks: breaks.map(({ from, to, length, x0, x1 }) => ({ from, to, length, x0, x1 })),
    ticks: ticks.map(({ t, x }) => ({ t, x })),
    lanes: laneLayout.map(({ id, y, height, lineY }) => ({ id, y, height, lineY })),
    events: cards.map((card) => ({ id: card.id, t: card.t, lane: laneOf(card), x: card.x, left: card.left, top: card.top, width: card.width, height: card.height, row: card.row })),
  };
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'timeline',
  meta: tl.meta,
  svg: renderSvg(),
  cards: tl.cards,
  sourceEvidence,
});
