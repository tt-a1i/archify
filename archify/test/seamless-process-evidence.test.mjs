import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectProcessEvidence } from './helpers/seamless-process-evidence.mjs';

function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-writer-test-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}
const readJson = (folder, name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const frame = at => ({ at, href: 'file:///test.html', frames: [{ diagram: 'system', visible: true }] });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('evidence retains acquired rAF data and action failure when capture and final drain fail', async t => {
  const folder = directory(t);
  const captured = deferred();
  let reads = 0;
  const result = await collectProcessEvidence({
    directory: folder,
    read: async () => {
      if (++reads > 1) throw new Error('Target detached before final drain');
      return { sample: frame(10), frames: [frame(8), frame(10)], events: [{ type: 'ready' }] };
    },
    capture: async () => { captured.resolve(); throw new Error('Screenshot failed'); },
    timestamp: async () => 11,
    action: async () => { await captured.promise; throw new Error('Wrong committed diagram'); },
    interval: async () => {}, settle: async () => {},
  });
  assert.deepEqual(readJson(folder, 'frames.json'), { frames: [frame(8), frame(10)], events: [{ type: 'ready' }] });
  assert.deepEqual(readJson(folder, 'captures.json'), []);
  assert.deepEqual(result.errors.map(item => item.error.message).sort(), ['Screenshot failed', 'Target detached before final drain', 'Wrong committed diagram']);
  assert.equal(readJson(folder, 'collection.json').complete, false);
});

test('PNG and its index survive a failure reading the post-capture timestamp', async t => {
  const folder = directory(t);
  const sampled = deferred();
  let reads = 0;
  const bytes = Buffer.from('already acquired PNG bytes');
  const result = await collectProcessEvidence({
    directory: folder,
    read: async () => ({ sample: frame(++reads), frames: [frame(reads)], events: [] }),
    capture: async () => ({ data: bytes.toString('base64') }),
    timestamp: async () => { sampled.resolve(); throw new Error('Execution context destroyed'); },
    action: async () => { await sampled.promise; }, interval: async () => {}, settle: async () => {},
  });
  assert.deepEqual(fs.readFileSync(path.join(folder, '0000.png')), bytes);
  assert.equal(readJson(folder, 'captures.json')[0].after, null);
  assert.equal(result.errors[0].phase, 'capture');
  assert.equal(readJson(folder, 'frames.json').frames.length, 2);
});

test('a successful collection includes final observations and marks transport complete', async t => {
  const folder = directory(t);
  const captured = deferred();
  const stop = deferred();
  let reads = 0;
  const result = await collectProcessEvidence({
    directory: folder,
    read: async () => ({ sample: frame(++reads), frames: [frame(reads)], events: [] }),
    capture: async () => ({ data: Buffer.from('PNG').toString('base64') }),
    timestamp: async () => { captured.resolve(); return 5; },
    action: async () => { await captured.promise; stop.resolve(); },
    interval: async () => { await stop.promise; }, settle: async () => {},
  });
  assert.deepEqual(result.errors, []);
  assert.ok(readJson(folder, 'captures.json').length >= 1);
  assert.equal(readJson(folder, 'frames.json').frames.length, reads);
  assert.equal(readJson(folder, 'collection.json').complete, true);
});
