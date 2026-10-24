import { test } from 'node:test';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textUnits } from '../archify/renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'timeline', 'render-timeline.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const small = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payment-incident.timeline.json'), 'utf8'));
const large = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'archify-dev-activity.timeline.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function run(diagram, extra = []) {
  const directory = createScratchDirectory(path.join(os.tmpdir(), 'archify-timeline-'));
  const input = path.join(directory, 'candidate.timeline.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { ...spawnSync(process.execPath, [renderer, input, output, ...extra], { cwd: directory, encoding: 'utf8' }), output };
}
function layoutOf(diagram) {
  const result = run(diagram, ['--layout-json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const overlap = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

test('timeline: subsecond events retain their time in cards and accessible context', () => {
  const diagram = clone(small);
  diagram.meta.timezone = 'Asia/Kolkata';
  diagram.events = [
    { id: 'sent', title: 'Request sent', at: '2026-10-01T10:00:00.007Z', lane: 'release' },
    { id: 'reply', title: 'Reply received', at: '2026-10-01T15:30:00.900+05:30', lane: 'release' },
    { id: 'done', title: 'Finished', at: '2026-10-01T10:00:01Z', lane: 'release' },
  ];
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  for (const [id, time] of [['sent', '15:30:00.007'], ['reply', '15:30:00.900'], ['done', '15:30:01']]) {
    const node = html.match(new RegExp(`<g [^>]*data-node-id="${id}"[^>]*>[\\s\\S]*?</g>`))?.[0];
    assert.ok(node, id);
    assert.ok(node.includes(`UTC+05:30`), node);
    assert.ok(node.includes(`10-01 ${time} UTC+05:30`), node);
    assert.ok(node.includes(`>${time}</text>`), node);
  }
  const axisLabels = [...html.matchAll(/<text [^>]*class="[^"]*\btl-tick\b[^"]*"[^>]*>([^<]*)<\/text>/g)].map(([, label]) => label);
  assert.ok(axisLabels.includes('15:30:00.007'), axisLabels.join(', '));
  const report = layoutOf(diagram);
  assert.equal(report.events[1].t - report.events[0].t, 893);
  assert.ok(report.events[1].x > report.events[0].x);
  for (const card of report.events) for (const other of report.events) {
    if (card.id < other.id) assert.ok(!overlap(card, other), `${card.id} overlaps ${other.id}`);
  }
});

test('timeline: both examples render and pass the showcase artifact checks', () => {
  for (const diagram of [small, large]) {
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' }).stdout);
    assert.equal(receipt.ok, true, JSON.stringify(receipt.checks.filter((entry) => !entry.ok)));
    assert.equal(receipt.composition.summary.errors, 0);
  }
});

test('timeline: duplicate lane IDs fail before visual and accessible ownership diverge', () => {
  const diagram = clone(small);
  diagram.lanes.push({ ...diagram.lanes[0], label: 'Conflicting lane' });
  const result = run(diagram);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /timeline\/duplicate-lane-id/);
  assert.match(result.stderr, /Give every lane a unique id/);
  assert.equal(fs.existsSync(result.output), false);
});

test('timeline: position is linear in time on one shared axis across lanes', () => {
  const report = layoutOf(small);
  assert.equal(report.breaks.length, 0);
  const [a, b, c] = report.events;
  // 10:00, 10:05, 10:10 in different lanes: equal time steps are equal x steps.
  assert.ok(Math.abs((b.x - a.x) - (c.x - b.x)) < 0.02);
  assert.notEqual(a.lane, b.lane);
  // Every tick sits at its own timestamp on the same scale.
  for (const tick of report.ticks) {
    assert.ok(Math.abs(tick.x - (a.x + (tick.t - a.t) * report.scalePxPerMinute / 60000)) < 0.05);
  }
});

test('timeline: events are drawn in chronological order whatever the authored order', () => {
  const diagram = clone(small);
  diagram.events.reverse();
  const report = layoutOf(diagram);
  const times = report.events.map((event) => event.t);
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
  assert.ok(report.events.every((event, index, all) => !index || event.x >= all[index - 1].x));
});

test('timeline: historical years retain the actual display-zone UTC offset', () => {
  for (const year of ['0000', '0001', '0099', '0100', '2026']) {
    const diagram = clone(small);
    diagram.meta.timezone = 'UTC';
    diagram.events = [{ id: 'event', at: `${year}-01-01T00:00:00Z`, title: 'Historical event', lane: diagram.lanes[0].id }];
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(result.output, 'utf8');
    assert.match(html, /UTC\+00:00/);
    assert.doesNotMatch(html, /UTC\+\d{3,}:/);
  }
});

test('timeline: offsets are honoured, so the same instant in two offsets aligns', () => {
  const diagram = clone(small);
  diagram.events.push({ id: 'same_instant', at: '2026-10-01T07:35:00+05:30', title: 'Same instant as the alert', lane: 'release' });
  const report = layoutOf(diagram);
  const alert = report.events.find((event) => event.id === 'alert');
  const same = report.events.find((event) => event.id === 'same_instant');
  assert.equal(same.t, alert.t);
  assert.equal(same.x, alert.x);
});

test('timeline: long quiet periods become disclosed breaks, proportional inside each segment', () => {
  const report = layoutOf(large);
  assert.ok(report.breaks.length >= 1);
  for (const gap of report.breaks) assert.ok(gap.x1 - gap.x0 >= 56);
  const result = run(large);
  const svg = fs.readFileSync(result.output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.equal((svg.match(/data-timeline-break=""/g) || []).length, report.breaks.length);
  assert.match(svg, /quiet period\(s\) compressed/);
  assert.match(svg, /data-timeline-evidence="observed"/);
  // Without breaks the axis is one proportional segment.
  const flat = clone(large);
  flat.layout = { breaks: 'none' };
  assert.equal(layoutOf(flat).breaks.length, 0);
});

test('timeline: multi-year spans keep the year in cards, ticks, and context', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: { title: 'Two launches', evidence: 'observed' },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'First launch' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'Second launch' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  assert.match(html, />2025-03-01 10:00</, 'first card states its year');
  assert.match(html, />2026-03-01 10:00</, 'second card states its year');
  assert.match(html, /data-node-context="2025-03-01 10:00:00 UTC\+00:00"/);
  assert.match(html, /data-node-context="2026-03-01 10:00:00 UTC\+00:00"/);
  // The axis dates carry the year, so the year boundary no longer reads backwards.
  assert.match(html, /2025-\d{2}-\d{2} 00:00/);
  assert.match(html, /2026-\d{2}-\d{2} 00:00/);
  // A dense axis can suppress individual tick labels; the header still states
  // the range.
  assert.match(html, /UTC · 2025–2026/);
});

test('timeline: a same-year multi-day span keeps its short date labels', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: { title: 'Same year', evidence: 'observed' },
    events: [
      { id: 'a', at: '2026-10-01T10:00:00Z', title: 'A' },
      { id: 'b', at: '2026-10-05T10:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  assert.match(html, />10-01 10:00</);
  assert.match(html, />10-05 10:00</);
  assert.doesNotMatch(html, />2026-10-0/, 'the year is only added when the span crosses one');
});

test('timeline: the header range stays inside the canvas at the narrowest axis', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: { title: 'Long zone', evidence: 'illustrative', timezone: 'America/Argentina/Buenos_Aires' },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2024-01-01T00:00:00Z', title: 'A' },
      { id: 'b', at: '2026-01-01T00:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  // Display-zone years: the UTC instants fall on 2023-12-31 and 2025-12-31 there.
  assert.match(html, /America\/Argentina\/Buenos_Aires \(UTC-03:00\) · 2023–2025/);
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  const [, x, caption] = html.match(/<text data-timeline-axis-caption="" x="([\d.]+)"[^>]*>([^<]*)<\/text>/);
  // The renderer's own metric for header text (font 11.5, widthFactor 0.6).
  const right = Number(x) + textUnits(caption) * 11.5 * 0.6;
  assert.ok(right <= viewWidth, `caption ends at ${right}px, beyond the ${viewWidth}px canvas`);
  assert.equal(viewWidth, Math.ceil(right + 28), 'the clipped caption earns one trailing margin');
  // A caption that already fits the authored canvas must not move it. This
  // zone's caption ends at 519px: inside the 536px canvas, but past its right
  // margin, so an unconditional reservation would widen the canvas to 547.
  const sameYear = clone(diagram);
  sameYear.meta.timezone = 'America/Argentina/ComodRivadavia';
  sameYear.events = [
    { id: 'a', at: '2024-06-01T00:00:00Z', title: 'A' },
    { id: 'b', at: '2024-06-02T00:00:00Z', title: 'B' },
  ];
  const control = run(sameYear);
  assert.equal(control.status, 0, control.stderr);
  assert.match(fs.readFileSync(control.output, 'utf8'), /<svg viewBox="0 0 536 /);
  // A caption that clears the canvas by less than the 4px fallback inset still
  // earns the margin; this one ends at 532.8px inside the 536px canvas.
  const nearEdge = clone(diagram);
  nearEdge.meta.timezone = 'America/Cambridge_Bay';
  nearEdge.events = [
    { id: 'a', at: '2024-06-01T10:00:00Z', title: 'A' },
    { id: 'b', at: '2024-06-01T11:00:00Z', title: 'B' },
  ];
  const near = run(nearEdge);
  assert.equal(near.status, 0, near.stderr);
  const nearHtml = fs.readFileSync(near.output, 'utf8');
  const [, nearX, nearCaption] = nearHtml.match(/<text data-timeline-axis-caption="" x="([\d.]+)"[^>]*>([^<]*)<\/text>/);
  const nearRight = Number(nearX) + textUnits(nearCaption) * 11.5 * 0.6;
  assert.ok(nearRight > 532 && nearRight <= 536, `fixture sits in the inset band (${nearRight}px)`);
  const nearWidth = Number(nearHtml.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  assert.equal(nearWidth, Math.ceil(nearRight + 28));
});

test('timeline: display-zone years outside 0000-9999 keep at least four digits', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: { title: 'BC shift', evidence: 'observed', timezone: 'America/New_York' },
    events: [
      { id: 'a', at: '0000-01-01T01:00:00Z', title: 'A' },
      { id: 'b', at: '0000-01-02T01:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  // The negative offset moves both instants into 2 BC (year -1).
  assert.match(html, />-0001-12-31 20:0/);
  assert.match(html, />0000-01-01 20:0/);
  assert.match(html, /UTC-04:56\) · -0001–0000/);
});

test('timeline: extreme translations cannot stretch the canvas past the reader pane', () => {
  // meta.translations permits 400-character messages per key; the header must
  // not let them scale the whole diagram down past the declared minimum text.
  const axis = 'A'.repeat(400);
  const evidence = 'E'.repeat(400);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: {
      title: 'Long overrides',
      evidence: 'observed',
      locale: 'en',
      translations: { 'timeline.axis': axis, 'timeline.evidence.observed': evidence },
    },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  assert.equal(viewWidth, 1920, 'header growth stops at the reader pane width');
  // The full strings survive as descriptions, while the visible strings are
  // shortened and keep the renderer-owned zone/date suffix.
  assert.match(html, new RegExp(`<title>${axis}: UTC · 2025–2026</title>`));
  assert.match(html, /<title>E{400}<\/title>E+…<\/text>/);
  const [, captionX, captionVisible] = html.match(/data-timeline-axis-caption="" x="([\d.]+)"[^>]*aria-label="([^"]*)"/);
  assert.match(captionVisible, /^A+…: UTC · 2025–2026$/);
  assert.ok(Number(captionX) + textUnits(captionVisible) * 11.5 * 0.6 <= viewWidth - 28, 'the visible caption stays in frame');
  const [, pillWidth] = html.match(/<rect x="28" y="14" width="(\d+)"/);
  const [, evidenceX, evidenceVisible] = html.match(/<text x="([\d.]+)" y="29"[^>]*aria-label="([^"]*)"/);
  assert.match(evidenceVisible, /^E+…$/);
  assert.ok(Number(evidenceX) + textUnits(evidenceVisible) * 10.5 * 0.6 / 2 <= 28 + Number(pillWidth), 'the visible evidence stays inside its pill');
});

test('timeline: a long evidence override uses the header slack', () => {
  const evidence = 'E'.repeat(400);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: {
      title: 'Long evidence',
      evidence: 'observed',
      locale: 'en',
      translations: { 'timeline.evidence.observed': evidence },
    },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  assert.match(html, /<title>E{400}<\/title>E+…<\/text>/);
  const [, evidenceX, evidenceVisible] = html.match(/<text x="([\d.]+)" y="29"[^>]*aria-label="([^"]*)"/);
  // With the caption short, the chip is not held to a fixed 30% share.
  assert.ok(textUnits(evidenceVisible) > 150, `the chip shows ${textUnits(evidenceVisible)} units`);
  const [, pillWidth] = html.match(/<rect x="28" y="14" width="(\d+)"/);
  assert.ok(Number(evidenceX) + textUnits(evidenceVisible) * 10.5 * 0.6 / 2 <= 28 + Number(pillWidth));
});

test('timeline: header bounds leave the legend its required width', () => {
  const long = 'L'.repeat(400);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: {
      title: 'Long legend',
      evidence: 'observed',
      locale: 'en',
      translations: { 'timeline.axis': 'A'.repeat(400), 'legend.timeline.default': long },
    },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A', kind: 'default' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B', kind: 'change' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  assert.ok(viewWidth > 1920, `the legend keeps its width (${viewWidth}px)`);
  assert.ok(html.includes(long), 'the legend label is not truncated');
});

test('timeline: emoji headers reserve the fallback advance and split by grapheme', () => {
  const emoji = '😀'.repeat(400);
  const family = '👨‍👩‍👧‍👦'.repeat(57);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: { title: 'Emoji header', evidence: 'observed', locale: 'en', translations: { 'timeline.axis': emoji } },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  assert.equal(viewWidth, 1920);
  const [, captionX, captionVisible] = html.match(/data-timeline-axis-caption="" x="([\d.]+)"[^>]*aria-label="([^"]*)"/);
  // Chrome lays emoji out ~14% wider than the mono metric; the 1.15 reserve
  // keeps the visible string inside the right margin.
  assert.ok(Number(captionX) + textUnits(captionVisible) * 11.5 * 0.6 * 1.15 <= viewWidth - 28);
  const familyDiagram = clone(diagram);
  familyDiagram.meta.translations = { 'timeline.axis': family };
  const familyResult = run(familyDiagram);
  assert.equal(familyResult.status, 0, familyResult.stderr);
  const familyHtml = fs.readFileSync(familyResult.output, 'utf8');
  assert.doesNotMatch(familyHtml, /\u200d…/, 'truncation does not leave a dangling joiner');
});

test('timeline: emoji legend labels reserve the fallback advance', () => {
  const emoji = '😀'.repeat(400);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: {
      title: 'Emoji legend',
      evidence: 'observed',
      locale: 'en',
      translations: { 'legend.timeline.default': emoji },
    },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A', kind: 'default' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B', kind: 'change' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  // The legend metric assumes the mono advance; Chrome's emoji fallback is
  // ~1.142x wider, so the reserved width must clear that bound.
  const fallbackRight = textUnits(emoji) * 13 * 0.62 * 1.142 + 56;
  assert.ok(viewWidth >= fallbackRight, `viewBox ${viewWidth} clears ${fallbackRight}`);
  // A short emoji label stays on the same row as the next entry; the layout
  // must position that entry past the fallback width, not the mono width.
  const short = clone(diagram);
  short.meta.translations = { 'legend.timeline.default': '😀'.repeat(12) };
  const shortResult = run(short);
  assert.equal(shortResult.status, 0, shortResult.stderr);
  const shortHtml = fs.readFileSync(shortResult.output, 'utf8');
  const [, defaultWidth] = shortHtml.match(/data-legend-semantic-kind="default"[^>]*data-legend-width="([\d.]+)"/);
  const [, changeX] = shortHtml.match(/data-legend-semantic-kind="change"[^>]*data-legend-x="([\d.]+)"/);
  const [, defaultTextX] = shortHtml.match(/data-legend-semantic-kind="default"[\s\S]*?<text x="([\d.]+)"/);
  assert.ok(Number(changeX) >= Number(defaultTextX) + textUnits('😀'.repeat(12)) * 13 * 0.62 * 1.142, 'the next entry clears the fallback width');
  assert.ok(Number(defaultWidth) >= textUnits('😀'.repeat(12)) * 13 * 0.62 * 1.142, 'the entry reserves the fallback width');
});

test('timeline: emoji in the evidence label does not truncate an ASCII caption', () => {
  const axis = 'A'.repeat(240);
  const diagram = {
    schema_version: 1,
    diagram_type: 'timeline',
    meta: {
      title: 'Split advance',
      evidence: 'observed',
      locale: 'en',
      translations: { 'timeline.axis': axis, 'timeline.evidence.observed': '😀' },
    },
    layout: { width: 480 },
    events: [
      { id: 'a', at: '2025-03-01T10:00:00Z', title: 'A' },
      { id: 'b', at: '2026-03-01T10:00:00Z', title: 'B' },
    ],
  };
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const viewWidth = Number(html.match(/<svg viewBox="0 0 ([\d.]+)/)[1]);
  assert.ok(viewWidth < 1920, `the caption decides the width (${viewWidth}px)`);
  const caption = html.match(/<text data-timeline-axis-caption=""[^>]*>([^<]*)<\/text>/);
  assert.ok(caption, 'the ASCII caption is not truncated');
  assert.match(caption[1], new RegExp(`^${axis}: UTC · 2025–2026$`));
});

test('timeline: simultaneous and close events stack instead of overprinting', () => {
  const diagram = clone(small);
  diagram.events.push(
    { id: 'page_1', at: '2026-10-01T10:05:00+08:00', title: 'Page primary on-call', lane: 'monitoring' },
    { id: 'page_2', at: '2026-10-01T10:05:20+08:00', title: 'Page secondary on-call', lane: 'monitoring' },
  );
  const report = layoutOf(diagram);
  const cards = report.events;
  for (const card of cards) for (const other of cards) if (card.id < other.id) assert.ok(!overlap(card, other), `${card.id} overlaps ${other.id}`);
  assert.equal(report.events.find((event) => event.id === 'page_1').x, report.events.find((event) => event.id === 'alert').x);
});

function failure(mutate) {
  const diagram = clone(small);
  mutate(diagram);
  const result = run(diagram);
  assert.notEqual(result.status, 0, 'renderer accepted invalid input');
  return result.stderr;
}

test('timeline: ambiguous or invalid time input is refused', () => {
  assert.match(failure((d) => { d.events[0].at = '2026-10-01T10:00:00'; }), /\/events\/0\/at/);
  assert.match(failure((d) => { d.events[0].at = '2026-02-30T25:00:00Z'; }), /timeline\/invalid-timestamp/);
  assert.match(failure((d) => { d.meta.timezone = 'Mars/Olympus'; }), /timeline\/invalid-timezone/);
  assert.match(failure((d) => { d.events[0].lane = 'billing'; }), /timeline\/unknown-lane/);
  assert.match(failure((d) => { delete d.meta.evidence; }), /evidence/);
});

test('timeline: invalid calendar dates are rejected before Date.parse can normalize them', () => {
  for (const at of ['2026-02-30T10:00:00Z', '2025-02-29T10:00:00+05:30', '2100-02-29T10:00:00Z', '2026-04-31T10:00:00-04:00']) {
    assert.match(failure((diagram) => { diagram.events[0].at = at; }), /timeline\/invalid-timestamp/);
  }
  for (const at of ['2024-02-29T10:00:00+05:30', '2000-02-29T10:00:00Z']) {
    const diagram = clone(small);
    diagram.events[0].at = at;
    const event = layoutOf(diagram).events.find((entry) => entry.id === diagram.events[0].id);
    assert.equal(event.t, Date.parse(at));
  }
});

function crowdedBreaksDiagram() {
  const diagram = clone(small);
  diagram.layout = { width: 480, breaks: 'auto' };
  const start = Date.parse('2026-01-01T00:00:00Z');
  // Nine short bursts separated by eight eligible quiet periods. Their labels
  // and segment floors previously exhausted a 480px axis and set scale to 0.
  diagram.events = Array.from({ length: 18 }, (_, index) => ({
    id: `event_${index}`,
    at: new Date(start + Math.floor(index / 2) * (35 * 60 * 60000) + (index % 2) * 10 * 60000).toISOString(),
    title: `Event ${index}`,
    lane: 'release',
  }));
  return diagram;
}

test('timeline: automatic breaks leave room for proportional time on a narrow axis', () => {
  const report = layoutOf(crowdedBreaksDiagram());
  assert.ok(report.breaks.length > 0, 'eligible quiet periods still compress');
  assert.ok(report.scalePxPerMinute > 0, 'distinct instants must retain a positive scale');
  assert.ok(report.events.every((event, index, all) => !index || event.x > all[index - 1].x), 'distinct instants must not collapse to one x');
  for (const segment of report.segments) {
    assert.ok(segment.x0 <= segment.x1);
    assert.ok(segment.x1 <= report.viewBox[0] - 28 - 72, 'segments stay within the authored axis');
  }
  for (const gap of report.breaks) assert.ok(gap.x1 <= report.viewBox[0] - 28 - 72, 'breaks stay within the authored axis');
  const result = run(crowdedBreaksDiagram());
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  assert.equal((html.match(/data-timeline-break=""/g) || []).length, report.breaks.length);
  const receipt = JSON.parse(spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' }).stdout);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.checks.filter((entry) => !entry.ok)));
});
