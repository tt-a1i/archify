import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: wf, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'waterfall',
  defaultExample: 'checkout-request.waterfall.json',
  argv: cliArgs,
});
const locale = wf.meta.locale;
const unit = wf.meta.unit || 'ms';
// The schema spells microseconds `us` for ASCII input; the canvas uses µs.
const unitLabel = unit === 'us' ? 'µs' : unit;
const ADVANCE = nodeTextFit.widthFactor;

const layout = {
  margin: 28,
  top: 52,
  axisH: 36,
  rowH: 25,
  barH: 14,
  indent: 18,
  nameFont: 12.5,
  durationFont: 11,
  axisWidth: wf.layout?.width ?? 760,
  columnGap: 28,
  minTickPx: 80,
};

// ---- Timing checks -------------------------------------------------------------
// Bars are drawn from recorded timing only. A span states `end` or `duration`
// (not both unless they agree); only `status: "incomplete"` may state neither,
// and it is drawn as an open bar up to the last recorded instant instead of
// with an invented end. Parents must exist and must not form a cycle.
const problems = [];
const details = [];
function fail(code, message, subject, evidence, supportedFixes) {
  problems.push(message);
  details.push({ code, severity: 'error', message, subject: { diagramType: 'waterfall', ...subject }, evidence, supportedFixes });
}
const raw = asArray(wf.spans);
const byId = new Map();
for (const [index, span] of raw.entries()) {
  if (byId.has(span.id)) fail('waterfall/duplicate-id', `Span id "${span.id}" is declared twice.`, { path: `/spans/${index}/id` }, { id: span.id }, ['Give every span a unique id.']);
  byId.set(span.id, span);
  const hasEnd = Number.isFinite(span.end);
  const hasDuration = Number.isFinite(span.duration);
  const timing = (message, fixes) => fail('waterfall/invalid-timing', `Span "${span.id}" ${message}`, { path: `/spans/${index}`, nodeId: span.id },
    { start: span.start, end: span.end ?? null, duration: span.duration ?? null, status: span.status ?? 'ok' }, fixes);
  if (hasEnd && span.end < span.start) timing(`ends (${span.end}) before it starts (${span.start}).`, ['Correct start or end from the recorded timing.']);
  if (hasEnd && hasDuration && Math.abs(span.end - span.start - span.duration) > 1e-9) {
    timing(`states end ${span.end} and duration ${span.duration}, which disagree with start ${span.start}.`, ['Keep only one of end or duration.']);
  }
  if (!hasEnd && !hasDuration && span.status !== 'incomplete') {
    timing('has neither end nor duration. A span without a recorded end must be marked status "incomplete".', ['Add the recorded end or duration.', 'Set status to "incomplete" if the trace has no end for it.']);
  }
}
for (const [index, span] of raw.entries()) {
  if (span.parent !== undefined && !byId.has(span.parent)) {
    fail('waterfall/missing-parent', `Span "${span.id}" names parent "${span.parent}", which is not declared.`,
      { path: `/spans/${index}/parent`, nodeId: span.id }, { parent: span.parent }, ['Declare the parent span.', 'Remove parent to make this a root span.']);
  }
}
{
  const reported = new Set();
  for (const [index, span] of raw.entries()) {
    const chain = [];
    let current = span;
    while (current && current.parent !== undefined && !chain.includes(current.id)) {
      chain.push(current.id);
      current = byId.get(current.parent);
    }
    if (current && chain.includes(current.id)) {
      const cycle = chain.slice(chain.indexOf(current.id));
      const key = [...cycle].sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      fail('waterfall/cycle', `Parent links form a cycle: ${[...cycle, cycle[0]].map((id) => `"${id}"`).join(' -> ')}.`,
        { path: `/spans/${index}/parent`, nodeId: span.id }, { cycle }, ['Point one span in the cycle at a parent outside it.']);
    }
  }
}
if (problems.length) throwDiagnosticProblems('Waterfall validation failed', problems, { code: 'waterfall/input', subject: { diagramType: 'waterfall' }, diagnostics: details });

// ---- Timing model --------------------------------------------------------------
const recordedEnd = (span) => (Number.isFinite(span.end) ? span.end : Number.isFinite(span.duration) ? span.start + span.duration : null);
const t0 = Math.min(...raw.map((span) => span.start));
const t1 = Math.max(...raw.map((span) => recordedEnd(span) ?? span.start));
const wall = t1 - t0;

const spans = raw.map((span, index) => {
  const end = recordedEnd(span);
  const open = end === null;
  // An incomplete span with no end is drawn to the last recorded instant of
  // the trace and labelled as a lower bound, never as a measured duration.
  return { ...span, index, status: span.status || 'ok', open, end: open ? t1 : end, duration: (open ? t1 : end) - span.start };
});
const children = new Map(spans.map((span) => [span.id, []]));
for (const span of spans) if (span.parent !== undefined) children.get(span.parent).push(span);
const byStart = (a, b) => a.start - b.start || a.index - b.index;
const rows = [];
(function visit(list, depth) {
  for (const span of [...list].sort(byStart)) {
    rows.push({ ...span, depth });
    visit(children.get(span.id), depth + 1);
  }
}(spans.filter((span) => span.parent === undefined), 0));

function number(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
const formatDuration = (value) => `${number(value)} ${unitLabel}`;
function percent(value) {
  if (!wall) return '100%';
  const share = (value / wall) * 100;
  return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`;
}

// ---- Tones ---------------------------------------------------------------------
// Colour states who did the work: each service gets its own palette family in
// order of first appearance, and a span without one inherits its parent's.
// A span no service owns stays neutral. Red is never a service colour: it is
// reserved for status "error", so a failure is never mistaken for a team.
const SERVICE_TONES = ['frontend', 'backend', 'database', 'cloud', 'messagebus'];
const services = [...new Set(rows.map((row) => row.service).filter(Boolean))];
const serviceOf = new Map();
for (const row of rows) serviceOf.set(row.id, row.service ?? (row.parent !== undefined ? serviceOf.get(row.parent) : undefined));
const serviceTone = (service) => (service === undefined ? 'external' : SERVICE_TONES[services.indexOf(service) % SERVICE_TONES.length]);
const STATUS_TONE = { error: 'security', cancelled: 'external' };
const toneOf = (row) => STATUS_TONE[row.status] ?? serviceTone(serviceOf.get(row.id));

// ---- Geometry ------------------------------------------------------------------
// Name column: tree indent, then a service dot, then the name.
const NAME_DOT = 14;
const nameWidth = (row) => row.depth * layout.indent + NAME_DOT + textUnits(row.name) * layout.nameFont * ADVANCE * 1.04;
const labelW = Math.ceil(Math.max(140, ...rows.map(nameWidth)));
const axisX0 = layout.margin + labelW + layout.columnGap;
const axisX1 = axisX0 + layout.axisWidth;
const scale = wall > 0 ? layout.axisWidth / wall : 0;
const xOf = (t) => Math.round((axisX0 + (t - t0) * scale) * 100) / 100;
const rowsTop = layout.top + layout.axisH;

const NICE = [1, 2, 2.5, 5];
const tickStep = (() => {
  if (!wall) return 1;
  const target = (layout.minTickPx / layout.axisWidth) * wall;
  let magnitude = 10 ** Math.floor(Math.log10(target));
  for (;;) {
    for (const factor of NICE) if (factor * magnitude >= target) return factor * magnitude;
    magnitude *= 10;
  }
})();
const ticks = [];
for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1 + 1e-9; t += tickStep) ticks.push({ t, x: xOf(t) });

const LABEL_GAP = 7;
const parentIds = new Set(rows.map((row) => row.parent).filter((id) => id !== undefined));
const placed = rows.map((row, index) => {
  const y = rowsTop + index * layout.rowH;
  const x0 = xOf(row.start);
  const x1 = xOf(row.end);
  const width = Math.max(2, x1 - x0);
  const label = row.open ? i18nText(locale, 'waterfall.incomplete', { duration: formatDuration(row.duration) }) : formatDuration(row.duration);
  const labelWidth = textUnits(label) * layout.durationFont * ADVANCE + 4;
  // Every duration reads at the same place, just after its bar; the canvas
  // reserves room past the axis for the widest one, so a short operation and
  // a bar that ends at the wall-clock edge are labelled the same way.
  return { ...row, y, x0, x1, width, label, labelWidth, placement: 'after', tone: toneOf(row), parentBar: parentIds.has(row.id) };
});

// ---- Legend & canvas -----------------------------------------------------------
// The legend names the services (when more than one does work) and any status
// that changes a bar's paint; a single-service trace with only ok spans needs
// no key.
const presentStatuses = new Set(placed.map((row) => row.status));
// Past five services the palette repeats. Services that share a colour share
// one entry, so the key never claims a colour belongs to a single service.
const serviceLegendEntries = [...services.reduce((byTone, service) => {
  const tone = serviceTone(service);
  byTone.set(tone, [...(byTone.get(tone) || []), service]);
  return byTone;
}, new Map())].map(([tone, owners]) => ({ kind: `service:${owners[0]}`, label: owners.join(' · '), tone, interactive: false }));
const legendEntries = [
  ...(services.length > 1 ? serviceLegendEntries : []),
  ...resolveLegend(undefined, ['error', 'cancelled', 'incomplete'].map((kind) => ({ kind, label: i18nText(locale, `legend.waterfall.${kind}`), tone: STATUS_TONE[kind] ?? 'external', interactive: false })), presentStatuses),
];
const contentBottom = rowsTop + placed.length * layout.rowH + 8;
const labelRoom = Math.ceil(Math.max(...placed.map((row) => row.x1 + LABEL_GAP + row.labelWidth)) - axisX1);
const width = Math.ceil(axisX1 + Math.max(24, labelRoom) + layout.margin);
const footprint = legendFootprint(legendEntries, { width: width - layout.margin * 2, fontSize: 11 });
const height = Math.ceil(contentBottom + layout.margin + (legendEntries.length ? 34 + footprint.extraHeight : 0));
const viewBox = [width, height];

// ---- Rendering -----------------------------------------------------------------
function renderHeader() {
  const evidence = i18nText(locale, `waterfall.evidence.${wf.meta.evidence}`);
  const evidenceW = Math.ceil(textUnits(evidence) * 10.5 * ADVANCE + 24);
  const tone = wf.meta.evidence === 'measured' ? 'backend' : 'messagebus';
  const wallText = i18nText(locale, 'waterfall.wall', { duration: formatDuration(wall) });
  const range = `${number(t0)} → ${number(t1)} ${unitLabel}`;
  const wallX = layout.margin + evidenceW + 14;
  return `        <g data-waterfall-evidence="${esc(wf.meta.evidence)}">
          <rect x="${layout.margin}" y="14" width="${evidenceW}" height="22" rx="11" class="c-${tone}" stroke-width="1"/>
          <circle cx="${layout.margin + 11}" cy="25" r="3" class="t-${tone}"/>
          <text x="${layout.margin + evidenceW / 2 + 5}" y="29" class="t-${tone}" font-size="10.5" font-weight="700" text-anchor="middle">${esc(evidence)}</text>
        </g>
        <text data-waterfall-total="${wall}" x="${wallX}" y="29.5" class="t-primary wf-num" font-size="13" font-weight="700">${esc(wallText)}<tspan class="t-muted" font-weight="500" dx="10">${esc(range)}</tspan></text>`;
}

function renderAxis() {
  const lineY = rowsTop - 6;
  return [
    `        <text x="${layout.margin}" y="${lineY - 10}" class="t-muted wf-caps" font-size="10" font-weight="700">${esc(i18nText(locale, 'waterfall.operation'))}</text>`,
    `        <line x1="${axisX0}" y1="${lineY}" x2="${axisX1}" y2="${lineY}" class="wf-axis" stroke-width="1"/>`,
    ...ticks.map((tick, index) => `        <line x1="${tick.x}" y1="${lineY}" x2="${tick.x}" y2="${contentBottom}" class="wf-grid${index ? '' : ' wf-grid-origin'}" stroke-width="1"/>
        <line x1="${tick.x}" y1="${lineY - 4}" x2="${tick.x}" y2="${lineY}" class="wf-axis" stroke-width="1"/>
        <text x="${tick.x}" y="${lineY - 10}" class="t-muted wf-num" font-size="10.5" text-anchor="middle">${esc(number(tick.t))} ${esc(unitLabel)}</text>`),
  ].join('\n');
}

// Tree guides in the name column state the parent/child structure; the bars
// themselves only ever state time.
const dotX = (row) => layout.margin + row.depth * layout.indent + 4;

function renderGuides() {
  const rowIndex = new Map(placed.map((row, index) => [row.id, index]));
  return placed.filter((row) => row.parent !== undefined).map((row) => {
    const parent = placed[rowIndex.get(row.parent)];
    const parentY = parent.y + layout.rowH / 2 + 6;
    const y = row.y + layout.rowH / 2;
    const x = dotX(parent);
    return `        <path ${focusEdgeAttrs(row.parent, row.id, undefined, row.index)} d="M ${x} ${parentY} V ${y - 4} Q ${x} ${y} ${x + 4} ${y} H ${dotX(row) - 7}" class="wf-guide" stroke-width="1" fill="none"/>`;
  }).join('\n');
}

// A span with children is drawn as a tinted, outlined bracket over its time;
// a span that does the work itself is a solid bar. Parent and child are never
// added together, and the paint says which bars are inclusive summaries.
function renderRow(row, order) {
  const parent = row.parent !== undefined ? placed.find((candidate) => candidate.id === row.parent) : null;
  const timing = `${number(row.start)}–${row.open ? '…' : number(row.end)} ${unitLabel} · ${row.label} · ${i18nText(locale, 'waterfall.share', { percent: percent(row.duration), total: formatDuration(wall) })}`;
  const service = serviceOf.get(row.id);
  const passport = { kind: row.tone, sublabel: [timing, row.detail].filter(Boolean).join(' — '), context: [service, parent?.name].filter(Boolean).join(' \u203a ') || undefined };
  const midY = row.y + layout.rowH / 2;
  const barY = midY - layout.barH / 2;
  const nameX = dotX(row) + 10;
  const paint = row.open ? 'wf-open' : row.parentBar ? 'wf-span' : 'wf-solid';
  const openTail = row.open ? `<path d="M ${row.x1 - 8} ${barY + 2} L ${row.x1 - 2} ${midY} L ${row.x1 - 8} ${barY + layout.barH - 2}" class="wf-open-edge t-${row.tone}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return `        <g ${focusNodeAttrs(row.id, row.name, passport, locale)} data-waterfall-start="${row.start}" data-waterfall-end="${row.open ? '' : row.end}" data-waterfall-duration="${row.duration}" data-waterfall-depth="${row.depth}" data-waterfall-status="${row.status}"${service ? ` data-waterfall-service="${esc(service)}"` : ''}>
          ${focusNodeTitle(row.name, passport)}
          <rect x="${layout.margin - 8}" y="${row.y + 1}" width="${width - layout.margin * 2 + 16}" height="${layout.rowH - 2}" rx="6" class="c-mask wf-row${order % 2 ? ' wf-row-alt' : ''}"/>
          <rect x="${row.x0}" y="${barY}" width="${row.width}" height="${layout.barH}" rx="${Math.min(4, row.width / 2)}" class="c-${row.tone} ${paint}"${animateAttr(wf.meta, 'node', order)} stroke-width="1.2"/>
          ${openTail}
          <circle cx="${dotX(row)}" cy="${midY}" r="${row.depth ? 3.5 : 4.5}" class="t-${row.tone} wf-dot"/>
          <text data-node-label="" x="${nameX}" y="${midY + 4.3}" class="t-primary" font-size="${layout.nameFont}" font-weight="${row.depth ? (row.parentBar ? 650 : 500) : 750}">${esc(row.name)}</text>
          <text x="${row.x1 + LABEL_GAP}" y="${midY + 3.8}" class="${row.parentBar ? 't-primary' : 't-muted'} wf-num" font-size="${layout.durationFont}" font-weight="${row.parentBar ? 700 : 600}">${esc(row.label)}</text>
        </g>`;
}

function legendSwatch(entry) {
  const paint = entry.kind === 'incomplete' ? 'wf-open' : 'wf-solid';
  return `<rect x="${entry.x}" y="${entry.baseline - 10}" width="14" height="10" rx="2.5" class="c-${entry.tone} ${paint}" stroke-width="1.2"/>`;
}

const SOLID_TONES = ['frontend', 'backend', 'database', 'cloud', 'messagebus', 'security', 'external'];

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(wf.meta)} data-waterfall-ui="" data-waterfall-unit="${esc(unit)}" data-reader-fit="width-first" data-reader-min-text="7.5">
${svgAccessibleText(wf.meta, 'waterfall')}
${renderDefinitions()}
        <style>
          svg[data-waterfall-ui] .wf-axis { stroke: var(--text-dim); }
          svg[data-waterfall-ui] .wf-grid { stroke: var(--lane-stroke); stroke-dasharray: 2 4; opacity: .7; }
          svg[data-waterfall-ui] .wf-grid-origin { stroke-dasharray: none; opacity: .9; }
          svg[data-waterfall-ui] .wf-row { fill: transparent; }
          svg[data-waterfall-ui] .wf-row-alt { fill: var(--lane-fill); fill-opacity: 1; opacity: .7; }
          svg[data-waterfall-ui] .wf-guide { stroke: var(--lane-stroke); }
          svg[data-waterfall-ui] .wf-span { fill-opacity: .9; }
          svg[data-waterfall-ui] .wf-open { stroke-dasharray: 3 2.5; fill-opacity: .6; }
          svg[data-waterfall-ui] .wf-open-edge { fill: none !important; }
          svg[data-waterfall-ui] .wf-num { font-variant-numeric: tabular-nums; }
          svg[data-waterfall-ui] .wf-caps { letter-spacing: .06em; }
          svg[data-waterfall-ui] .wf-solid { stroke: none; }
          /* Thin bars stay crisp: the classic preset's card shadow blurs their edges. */
          svg[data-waterfall-ui] [data-node-id] > rect { filter: none !important; }
${SOLID_TONES.map((tone) => `          svg[data-waterfall-ui] .wf-solid.c-${tone} { fill: var(--${tone}-stroke); }
          svg[data-waterfall-ui] .wf-open-edge.t-${tone} { stroke: var(--${tone}-stroke); }`).join('\n')}
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

${renderHeader()}

        <!-- Time axis (bar position and length come only from recorded timing) -->
${renderAxis()}

        <!-- Parent / child guides -->
${renderGuides()}

        <!-- Spans, depth-first by start time -->
${placed.map(renderRow).join('\n')}

        <!-- Legend -->
${legendEntries.length ? renderResolvedLegend({ entries: legendEntries, locale, layout: { x: layout.margin, baselineY: height - 16, width: width - layout.margin * 2, fontSize: 11, minTitleY: contentBottom + 8, diagramType: 'waterfall' }, renderSwatch: legendSwatch }) : ''}
      </svg>`;
}

function buildLayoutReport() {
  return {
    diagram_type: 'waterfall',
    unit,
    viewBox,
    origin: t0,
    wall,
    pxPerUnit: scale,
    axis: { x0: axisX0, x1: axisX1 },
    ticks,
    rows: placed.map((row) => ({ id: row.id, parent: row.parent ?? null, depth: row.depth, start: row.start, end: row.end, open: row.open, x0: row.x0, x1: row.x1, y: row.y, label: row.label, placement: row.placement })),
  };
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'waterfall',
  meta: wf.meta,
  svg: renderSvg(),
  cards: wf.cards,
  sourceEvidence,
});
