import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const renderer = fileURLToPath(new URL('../archify/renderers/timeline/render-timeline.mjs', import.meta.url));
const hour = 60 * 60 * 1000;

function fixture(timezone, first, last, width = 480) {
  return {
    schema_version: 1, diagram_type: 'timeline',
    meta: { title: 'Recorded local calendar boundaries', evidence: 'observed', timezone },
    layout: { width, breaks: 'none' },
    events: [
      { id: 'start', at: first, title: 'Start' },
      { id: 'end', at: last, title: 'End' },
    ],
  };
}

function run(t, document) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-timeline-dst-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.timeline.json');
  const output = path.join(directory, 'output.html');
  const original = JSON.stringify(document);
  fs.writeFileSync(input, original);
  const command = (args) => {
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const report = JSON.parse(command([renderer, input, output, '--layout-json']));
  command([cli, 'render', 'timeline', input, output]);
  assert.equal(fs.readFileSync(input, 'utf8'), original, '时区刻度不能改写作者时间或布局要求');
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const labels = [...svg.matchAll(/<text\b[^>]*\btl-tick\b[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
  const times = report.ticks.map(({ t: instant }) => instant);
  assert.ok(times.every((instant, index) => Number.isFinite(instant) && (!index || instant > times[index - 1])),
    '每个刻度必须对应唯一、递增的真实时刻');
  const expectedEvents = document.events.map(({ at }) => Date.parse(at)).sort((a, b) => a - b);
  assert.deepEqual(report.events.map(({ t: instant }) => instant), expectedEvents, '事件的绝对时间不能随刻度修复移动');
  for (const tick of report.ticks) {
    const segment = report.segments.find(({ start, end }) => tick.t >= start && tick.t <= end);
    assert.ok(segment, '刻度只能落在真实时间段内');
    if (segment.start !== segment.end) {
      const expected = segment.x0 + (tick.t - segment.start) / (segment.end - segment.start) * (segment.x1 - segment.x0);
      assert.ok(Math.abs(tick.x - expected) <= 0.011, '刻度位置仍按实际流逝时间线性计算');
    }
  }
  return { report, svg, labels, command, input };
}

for (const scenario of [
  {
    name: 'spring forward', first: '2026-03-07T00:00:00-05:00', last: '2026-03-10T00:00:00-04:00',
    expected: ['2026-03-07T00:00:00-05:00', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', '2026-03-10T00:00:00-04:00'],
    elapsed: [24, 23, 24],
  },
  {
    name: 'fall back', first: '2026-10-31T00:00:00-04:00', last: '2026-11-03T00:00:00-05:00',
    expected: ['2026-10-31T00:00:00-04:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', '2026-11-03T00:00:00-05:00'],
    elapsed: [24, 25, 24],
  },
]) {
  test(`timeline: daily local ticks survive ${scenario.name} without moving the time axis`, (t) => {
    const { report, labels, command, input } = run(t, fixture('America/New_York', scenario.first, scenario.last));
    assert.deepEqual(report.ticks.map(({ t: instant }) => instant), scenario.expected.map(Date.parse));
    assert.deepEqual(report.ticks.slice(1).map((tick, index) => (tick.t - report.ticks[index].t) / hour), scenario.elapsed);
    assert.ok(labels.length >= 2);
    assert.ok(labels.every((label) => label.endsWith('00:00')), labels.join(' | '));
    assert.equal(JSON.parse(command([cli, 'validate', 'timeline', input, '--quality', 'showcase', '--json'])).ok, true);
  });
}

for (const scenario of [
  {
    name: 'skips the nonexistent spring hour', timezone: 'America/New_York', width: 600,
    expected: ['2026-03-08T00:00:00-05:00', '2026-03-08T01:00:00-05:00', '2026-03-08T03:00:00-04:00', '2026-03-08T04:00:00-04:00', '2026-03-08T05:00:00-04:00'],
    labels: ['00:00', '01:00', '03:00', '04:00', '05:00'],
  },
  {
    name: 'retains both real occurrences of the repeated fall hour', timezone: 'America/New_York', width: 600,
    expected: ['2026-11-01T00:00:00-04:00', '2026-11-01T01:00:00-04:00', '2026-11-01T01:00:00-05:00', '2026-11-01T02:00:00-05:00', '2026-11-01T03:00:00-05:00'],
    labels: ['00:00', '01:00', '01:00', '02:00', '03:00'],
  },
  {
    name: 'aligns whole hours across the Lord Howe half-hour jump', timezone: 'Australia/Lord_Howe', width: 640,
    expected: ['2026-10-04T00:00:00+10:30', '2026-10-04T01:00:00+10:30', '2026-10-04T03:00:00+11:00', '2026-10-04T04:00:00+11:00', '2026-10-04T05:00:00+11:00'],
    labels: ['00:00', '01:00', '03:00', '04:00', '05:00'],
  },
]) {
  test(`timeline: hourly ticks ${scenario.name}`, (t) => {
    const { report, labels, svg } = run(t, fixture(scenario.timezone, scenario.expected[0], scenario.expected.at(-1), scenario.width));
    assert.deepEqual(report.ticks.map(({ t: instant }) => instant), scenario.expected.map(Date.parse));
    assert.deepEqual(labels, scenario.labels);
    if (scenario.name.includes('repeated')) {
      assert.match(svg, /data-node-id="start"[^>]*UTC-04:00/);
      assert.match(svg, /data-node-id="end"[^>]*UTC-05:00/);
    }
  });
}

test('timeline: a skipped civil date in Apia does not invent or duplicate an instant', (t) => {
  const expected = ['2011-12-28T00:00:00-10:00', '2011-12-29T00:00:00-10:00', '2011-12-31T00:00:00+14:00', '2012-01-01T00:00:00+14:00'];
  const { report, labels } = run(t, fixture('Pacific/Apia', expected[0], expected.at(-1)));
  assert.deepEqual(report.ticks.map(({ t: instant }) => instant), expected.map(Date.parse));
  assert.ok(labels.every((label) => !label.includes('12-30')), labels.join(' | '));
});

test('timeline: equal endpoint offsets do not hide the daylight-saving season inside a long segment', (t) => {
  const timezone = 'America/New_York';
  const { report } = run(t, fixture(timezone, '2026-01-01T00:00:00-05:00', '2026-12-31T00:00:00-05:00'));
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.ok(report.ticks.length > 2);
  assert.ok(report.ticks.every(({ t: instant }) => local.format(instant) === '00:00'));
  assert.deepEqual(new Set(report.ticks.map(({ t: instant }) => new Date(instant).getUTCHours())), new Set([4, 5]),
    '冬夏两个偏移都必须参与真实刻度生成');
});

test('timeline: a short segment keeps its start tick and automatic breaks retain real local dates', (t) => {
  const single = fixture('America/New_York', '2026-11-01T01:30:00-05:00', '2026-11-01T01:30:00-05:00');
  const short = run(t, single).report;
  assert.deepEqual(short.ticks.map(({ t: instant }) => instant), [Date.parse(single.events[0].at)]);
  const document = fixture('America/New_York', '2026-03-06T00:00:00-05:00', '2026-05-12T00:00:00-04:00', 960);
  document.layout.breaks = 'auto';
  document.events = [
    '2026-03-06T00:00:00-05:00', '2026-03-07T00:00:00-05:00', '2026-03-09T00:00:00-04:00',
    '2026-03-12T00:00:00-04:00', '2026-05-11T00:00:00-04:00', '2026-05-12T00:00:00-04:00',
  ].map((at, index) => ({ id: `event_${index}`, at, title: `Event ${index}` }));
  const { report } = run(t, document);
  assert.ok(report.breaks.length > 0);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: document.meta.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.ok(report.ticks.every(({ t: instant }) => clock.format(instant) === '00:00'), '压缩段内仍使用真实的当地午夜');
});
