import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, draft, SOURCE_HASH, digest, INDICES } from './build.mjs';
const raw = fs.readFileSync(new URL('./upstream/flow.json', import.meta.url));
const selected = JSON.parse(fs.readFileSync(new URL('./selection.json', import.meta.url), 'utf8'));

test('published full fixture and exact six record fields are preserved', () => {
  const v = audit(raw, selected);
  assert.equal(digest(raw), SOURCE_HASH);
  assert.equal(v.originalEventCount, 5017);
  assert.equal(v.selectedCount, 6);
  assert.equal(v.notProjectedCount, 5011);
  assert.deepEqual(v.phases, { s: 866, B: 1625, E: 1622, f: 886, M: 18 });
  assert.deepEqual(v.records, selected.events);
});

test('flow direction and complete-file uniqueness use explicit raw identity', () => {
  const v = audit(raw, selected);
  assert.deepEqual(v.link.allMatchingFlowIndices, [2078, 2082]);
  assert.deepEqual(v.link.key, { cat: 'task', name: 'MessageLoop::PostTask', id: '0xafbe9607544ea9db' });
  assert.equal(v.records.find(r => r.index === 2078).event.tid, 23924);
  assert.equal(v.records.find(r => r.index === 2082).event.tid, 23930);
  const reversed = structuredClone(selected); reversed.link = { from: 2082, to: 2078 };
  assert.throws(() => audit(raw, reversed), /selected s to selected f/);
});

test('endpoint difference stays separate from raw queue_duration and slice intervals', () => {
  const v = audit(raw, selected);
  assert.equal(v.endpointDifferenceUs, 78);
  assert.equal(v.sourceQueueDurationField, 0);
  assert.match(v.timeMeaning, /Timestamp difference/);
  const page = draft(v);
  assert.match(page, /78微秒不是工作耗时/);
  assert.match(page, /queue_duration=0/);
  const edges = page.split('\n').filter(line => /^\| flow-start >/.test(line));
  assert.equal(edges.length, 1);
  assert.ok(page.includes('同名、时间先后和相关ID都不能单独生成额外因果边'));
});

test('changed source, missing field and changed selection cannot inherit source evidence', () => {
  assert.throws(() => audit(Buffer.concat([raw, Buffer.from('\n')]), selected), /digest mismatch/);
  const changed = structuredClone(selected); changed.events[1].event.ts++;
  assert.throws(() => audit(raw, changed), /fields differ/);
  const missing = structuredClone(selected); delete missing.events[4].event.args;
  assert.throws(() => audit(raw, missing), /fields differ/);
  const reordered = structuredClone(selected); reordered.indices = [...INDICES].reverse();
  assert.throws(() => audit(raw, reordered), /explicit raw indices/);
});

test('a nearby non-flow record cannot be substituted as the causal endpoint', () => {
  const wrong = structuredClone(selected); wrong.link.to = 2083;
  assert.throws(() => audit(raw, wrong), /selected s to selected f/);
});

test('builder refuses an occupied output directory and preserves content', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-flow-existing-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'keep.txt'), 'user content');
  const run = spawnSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname, out], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.deepEqual(fs.readdirSync(out), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8'), 'user content');
});
