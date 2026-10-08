import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'timeline', 'render-timeline.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const small = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payment-incident.timeline.json'), 'utf8'));
const large = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'archify-dev-activity.timeline.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function run(diagram, extra = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-timeline-'));
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

test('timeline: both examples render and pass the showcase artifact checks', () => {
  for (const diagram of [small, large]) {
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' }).stdout);
    assert.equal(receipt.ok, true, JSON.stringify(receipt.checks.filter((entry) => !entry.ok)));
    assert.equal(receipt.composition.summary.errors, 0);
  }
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
