import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, runVisualCheck } from '../bin/visual-check.mjs';

// Minimal 1x1 PNG so visual-check's capture path has bytes to persist.
const PNG_STUB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const template = fs.readFileSync(path.join(root, 'viewer/template.source.html'), 'utf8');
const helper = template.slice(template.indexOf('    const archifyLayoutOwners ='), template.indexOf('/* ARCHIFY:READER_LAYOUT */'));
const joint = template.slice(template.indexOf('    Archify.layoutStability ='), template.indexOf('/* ARCHIFY:CAMERA */'));

function fixture({ readerPending = () => false, chromePending = () => false,
  readerSnapshot = () => 'reader|original', chromeSnapshot = () => 'chrome|original', fonts } = {}) {
  let frame = 0;
  let nextId = 0;
  const frames = [];
  const scheduled = [];
  const context = vm.createContext({
    Archify: {},
    document: { fonts: fonts || { status: 'loaded', ready: Promise.resolve() } },
    requestAnimationFrame(callback) { frames.push(callback); return ++nextId; },
    owners: {
      reader: { schedule() { scheduled.push('reader'); }, pending: () => readerPending(frame), snapshot: () => readerSnapshot(frame) },
      viewerChrome: { schedule() { scheduled.push('chrome'); }, pending: () => chromePending(frame), snapshot: () => chromeSnapshot(frame) },
    },
  });
  vm.runInContext(helper + '\narchifyLayoutOwners.reader = owners.reader; archifyLayoutOwners.viewerChrome = owners.viewerChrome;\n' + joint, context);
  const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function tick(before = () => {}) {
    await microtasks();
    frame += 1;
    before(frame);
    const callbacks = frames.splice(0);
    for (const callback of callbacks) callback(frame * (1000 / 60));
    await microtasks();
  }
  async function settle(promise, { limit = 1000, before } = {}) {
    let done = false;
    let value;
    let error;
    promise.then(result => { done = true; value = result; }, reason => { done = true; error = reason; });
    for (let i = 0; i < limit && !done; i++) await tick(before);
    assert.ok(done, 'synthetic frame queue must settle within its explicit test budget');
    return { value, error, frame };
  }
  return { context, scheduled, frames, tick, settle, get frame() { return frame; },
    wait: () => context.Archify.layoutStability.whenStable(),
    local: owner => context.Archify.waitForStableLayout(context.owners[owner]),
  };
}

test('joint contract schedules both private owners and compares an unambiguous tuple for three equal comparisons', async () => {
  const f = fixture();
  const result = await f.settle(f.wait());
  assert.ifError(result.error);
  assert.deepEqual(f.scheduled, ['reader', 'chrome']);
  assert.equal(result.value.sampledFrames, 4);
  assert.deepEqual(JSON.parse(result.value.snapshot), [['reader', 'reader|original'], ['viewerChrome', 'chrome|original']]);
  assert.deepEqual(Object.keys(f.context.Archify.layoutStability), ['whenStable']);
  assert.equal(Object.hasOwn(f.context, 'archifyLayoutOwners'), false, 'descriptors must not become a window property');
});

for (const owner of ['reader', 'chrome']) {
  test(`joint contract blocks ${owner}-only pending work and restarts all stable comparisons`, async () => {
    const f = fixture({ [`${owner}Pending`]: frame => frame === 3 || frame === 4 });
    const result = await f.settle(f.wait());
    assert.ifError(result.error);
    assert.equal(result.value.sampledFrames, 8);
  });
  test(`joint contract resets comparisons when only the ${owner} snapshot changes without pending work`, async () => {
    const f = fixture({ [`${owner}Snapshot`]: frame => frame < 3 ? 'before' : 'after' });
    const result = await f.settle(f.wait());
    assert.ifError(result.error);
    assert.equal(result.value.sampledFrames, 6);
  });
}

test('joint sampling starts only after initial font readiness and handles an active later font cycle', async () => {
  let release;
  const fonts = { status: 'loading', ready: new Promise(resolve => { release = resolve; }) };
  const f = fixture({ fonts });
  const waiting = f.wait();
  await f.tick();
  await f.tick();
  assert.deepEqual(f.scheduled, []);
  fonts.status = 'loaded';
  release();
  let releaseLater;
  const result = await f.settle(waiting, { before(frame) {
    if (frame === 5) {
      fonts.status = 'loading';
      fonts.ready = new Promise(resolve => { releaseLater = resolve; });
    }
    if (frame === 12) fonts.status = 'loaded';
    if (frame === 14) releaseLater();
  } });
  assert.ifError(result.error);
  assert.ok(result.frame >= 18, 'current fonts.ready, not only its status, must finish before a new stable-frame streak');
  assert.deepEqual(f.scheduled, ['reader', 'chrome', 'reader', 'chrome']);
});

test('joint pending keeps an in-flight baseline reprobe from passing even when frame handles would be idle', async () => {
  const f = fixture({ chromePending: frame => frame < 12 });
  const result = await f.settle(f.wait());
  assert.ifError(result.error);
  assert.equal(result.value.sampledFrames, 15);
});

test('budget policy A: joint non-convergence rejects at 960 while local defaults still reject at 240', async () => {
  const combined = fixture({ readerPending: () => true });
  const result = await combined.settle(combined.wait());
  assert.match(result.error?.message || '', /Joint reader and viewer chrome layout did not reach stable dimensions/);
  assert.equal(result.frame, 960);
  for (const owner of ['reader', 'viewerChrome']) {
    const local = fixture({ readerPending: () => true, chromePending: () => true });
    const rejected = await local.settle(local.local(owner));
    assert.match(rejected.error?.message || '', /did not reach stable dimensions/);
    assert.equal(rejected.frame, 240, `${owner}: unchanged local default`);
  }
});

test('budget policy A accepts the original staged case that legacy also accepts', async t => {
  const options = { readerPending: frame => frame < 230, chromePending: frame => frame < 250 };
  const combined = fixture(options);
  const jointResult = await combined.settle(combined.wait());
  assert.ifError(jointResult.error);
  assert.equal(jointResult.frame, 253);

  const original = fixture(options);
  const legacy = original.local('reader')
    .then(() => original.local('viewerChrome'))
    .then(() => original.local('reader'))
    .then(() => original.local('viewerChrome'));
  const legacyResult = await original.settle(legacy);
  assert.ifError(legacyResult.error);
  assert.equal(legacyResult.frame, 261);
  t.diagnostic('Disclosed policy change: one joint budget is 960; each legacy local budget remains 240. This staged case passes both, but the policies are not equivalent.');
});

test('budget policy A newly accepts single-owner work at frame 250 that legacy rejects at 240', async t => {
  const options = { readerPending: frame => frame < 250 };
  const combined = fixture(options);
  const accepted = await combined.settle(combined.wait());
  assert.ifError(accepted.error);
  assert.equal(accepted.frame, 253);
  const original = fixture(options);
  const legacy = original.local('reader')
    .then(() => original.local('viewerChrome'))
    .then(() => original.local('reader'))
    .then(() => original.local('viewerChrome'));
  const rejected = await original.settle(legacy);
  assert.match(rejected.error?.message || '', /did not reach stable dimensions/);
  assert.equal(rejected.frame, 240);
  assert.deepEqual(original.scheduled, ['reader'], 'legacy stops on its first owner failure');
  t.diagnostic('New acceptance is intentional and explicit: joint accepts frame250 owner completion; original four-step policy rejects that first owner at frame240.');
});

test('late cross-owner feedback restarts the combined streak throughout the expanded budget', async () => {
  const f = fixture({
    readerPending: frame => frame < 230 || frame === 942 || frame === 943,
    chromePending: frame => frame >= 232 && frame < 940,
    readerSnapshot: frame => frame < 943 ? 'reader-before' : 'reader-after',
    chromeSnapshot: frame => frame < 942 ? 'chrome-before' : 'chrome-after',
  });
  const result = await f.settle(f.wait());
  assert.ifError(result.error);
  assert.equal(result.frame, 947, 'late feedback from either owner must reset all three comparisons');
  assert.deepEqual(JSON.parse(result.value.snapshot), [['reader', 'reader-after'], ['viewerChrome', 'chrome-after']]);
});

test('late owner work before the last comparison rejects at 960 instead of falsely passing', async () => {
  const f = fixture({ readerPending: frame => frame >= 959, chromePending: frame => frame < 956 });
  const result = await f.settle(f.wait());
  assert.match(result.error?.message || '', /did not reach stable dimensions/);
  assert.equal(result.frame, 960);
});

// Exercise the actual unchanged PipeCdp implementation and CLI inspection with
// a fake transport/clock. No Chrome process and no real 15-second sleep needed.
// Frame and wall-clock limits are independent: the CLI can time out before960.
test('forever-pending joint inspection still fails at the unchanged 15000ms CDP boundary without fallback', async () => {
  const visualSource = fs.readFileSync(path.join(root, 'archify/bin/visual-check.mjs'), 'utf8');
  const pipeSource = visualSource.slice(visualSource.indexOf('class PipeCdp {'), visualSource.indexOf('export function chromeVisualBrowserArgs'));
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const clockContext = vm.createContext({
    Buffer,
    process,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, deadline: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const PipeCdp = vm.runInContext(pipeSource + '\nPipeCdp', clockContext);
  const f = fixture({ readerPending: () => true });
  const localCalls = [];
  f.context.window = { Archify: f.context.Archify };
  f.context.document.documentElement = { setAttribute() {} };
  f.context.document.querySelector = () => null;
  f.context.Archify.readerLayout = { whenStable() { localCalls.push('reader'); return Promise.resolve(); } };
  f.context.Archify.viewerChromeLayout = { whenStable() { localCalls.push('chrome'); return Promise.resolve(); } };
  const sent = [];
  const read = new EventEmitter();
  read.setEncoding = () => {};
  const write = new EventEmitter();
  write.write = (raw, callback) => {
    const message = JSON.parse(raw.slice(0, -1));
    sent.push(message);
    queueMicrotask(() => {
      const respond = result => read.emit('data', JSON.stringify({ id: message.id, result }) + '\0');
      if (message.method === 'Runtime.evaluate') {
        Promise.resolve().then(() => vm.runInContext(message.params.expression, f.context))
          .then(value => respond({ result: { value } }), error => respond({ exceptionDetails: { exception: { description: error.message } } }));
      } else {
        respond({});
        if (message.method === 'Page.navigate') read.emit('data', JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'test-session', params: {} }) + '\0');
      }
      callback();
    });
  };
  const child = new EventEmitter();
  child.stdio = [null, null, null, write, read];
  const browser = Object.create(ChromeVisualBrowser.prototype);
  browser.sessionPromise = Promise.resolve('test-session');
  browser.cdp = new PipeCdp(child);
  let settled = false;
  const outcome = browser.inspect({ artifactPath: '/tmp/forever-pending.html', width: 1440, height: 900, theme: 'light' })
    .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  for (let i = 0; i < 50 && !sent.some(message => message.method === 'Runtime.evaluate'); i++) await Promise.resolve();
  assert.equal(sent.filter(message => message.method === 'Runtime.evaluate').length, 1);
  for (let frame = 0; frame < 899; frame++) await f.tick();
  now = 14999;
  assert.equal(settled, false);
  assert.equal(timers.size, 1);
  const [[timerId, { callback, deadline }]] = timers.entries();
  assert.equal(deadline, 15000, 'real PipeCdp.send default, not a larger budget-derived timeout');
  now = 15000;
  timers.delete(timerId);
  callback();
  const result = await outcome;
  assert.equal(result.error?.code, 'ERR_CHROME_CDP_TIMEOUT');
  assert.equal(result.error?.method, 'Runtime.evaluate');
  assert.match(result.error?.message || '', /timed out after 15000ms/);
  assert.equal(f.frame, 899, 'CLI can reject before the 960-frame sampler ceiling');
  assert.equal(browser.cdp.pending.size, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(localCalls, [], 'CDP failure cannot trigger a legacy recovery path');
  assert.equal(sent.filter(message => message.method === 'Runtime.evaluate').length, 1, 'no metrics evaluation after timeout');
});

function inspection({ capability = true, rejectJoint = false, localMethods = true } = {}) {
  const calls = [];
  const states = [];
  let current = {};
  let rafCount = 0;
  const Archify = {};
  if (localMethods) {
    Archify.readerLayout = { whenStable: async () => { calls.push('reader'); } };
    Archify.viewerChromeLayout = { whenStable: async () => { calls.push('chrome'); } };
  }
  if (capability) Archify.layoutStability = { whenStable: async () => {
    calls.push('joint');
    if (rejectJoint) throw new Error('joint rejection fixture');
  } };
  const page = vm.createContext({
    Archify, window: { Archify },
    document: { documentElement: { setAttribute() {} }, querySelector: () => null,
      fonts: { ready: Promise.resolve(), status: 'loaded' } },
    requestAnimationFrame(callback) { rafCount++; queueMicrotask(callback); },
  });
  const browser = Object.create(ChromeVisualBrowser.prototype);
  browser.sessionPromise = Promise.resolve('test-session');
  browser.close = async () => {};
  browser.cdp = {
    waitFor: async () => ({}),
    async send(method, params) {
      if (method === 'Emulation.setDeviceMetricsOverride') current = { width: params.width, height: params.height };
      if (method === 'Page.navigate') {
        current.theme = new URL(params.url).searchParams.get('theme');
        states.push({ ...current });
      }
      if (method === 'Runtime.evaluate' && params.awaitPromise) {
        try {
          await vm.runInContext(params.expression, page);
          return { result: { value: null } };
        } catch (error) {
          return { exceptionDetails: { exception: { description: error.message } } };
        }
      }
      if (method === 'Page.captureScreenshot') return { data: PNG_STUB };
      if (method === 'Runtime.evaluate') return { result: { value: {
        innerWidth: current.width, innerHeight: current.height, scrollWidth: current.width, scrollHeight: current.height,
        resolvedTheme: current.theme, minimumProjectedNodeTextPx: 12, hasNavigationDock: false,
        legendDockIntersectionArea: 0, dockStageIntersectionArea: 0, viewerChromeRequiredGap: 10,
      } } };
      return {};
    },
  };
  return { browser, calls, states, get rafCount() { return rafCount; } };
}

test('CLI inspection calls the new capability once and propagates its rejection without legacy recovery', async () => {
  const passing = inspection();
  await passing.browser.inspect({ artifactPath: '/tmp/joint-contract.html', width: 1440, height: 900, theme: 'light' });
  assert.deepEqual(passing.calls, ['joint']);
  const failing = inspection({ rejectJoint: true });
  await assert.rejects(failing.browser.inspect({ artifactPath: '/tmp/joint-contract.html', width: 1440, height: 900, theme: 'light' }), /joint rejection fixture/);
  assert.deepEqual(failing.calls, ['joint']);
});

test('old artifacts keep the exact four local waits and no-layout artifacts keep the two-rAF fallback', async () => {
  const legacy = inspection({ capability: false });
  await legacy.browser.inspect({ artifactPath: '/tmp/joint-contract.html', width: 1440, height: 900, theme: 'light' });
  assert.deepEqual(legacy.calls, ['reader', 'chrome', 'reader', 'chrome']);
  assert.equal(legacy.rafCount, 0);
  const absent = inspection({ capability: false, localMethods: false });
  await absent.browser.inspect({ artifactPath: '/tmp/joint-contract.html', width: 1440, height: 900, theme: 'light' });
  assert.equal(absent.rafCount, 2);
});

test('normal browser evidence retains all six inspections and receipt mappings with the joint capability', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-joint-contract-'));
  try {
    const artifactPath = path.join(directory, 'diagram.html');
    fs.writeFileSync(artifactPath, '<!doctype html><title>joint fixture</title>');
    const f = inspection();
    const result = await runVisualCheck({ artifactPath, chromePath: '/fake/chrome', browserFactory: () => f.browser });
    assert.equal(result.exitCode, 0);
    assert.equal(result.receipt.ok, true);
    assert.deepEqual(f.states, [
      { width: 1440, height: 900, theme: 'light' }, { width: 1600, height: 1000, theme: 'light' },
      { width: 1920, height: 1080, theme: 'light' }, { width: 2048, height: 1320, theme: 'light' },
      { width: 1440, height: 900, theme: 'dark' }, { width: 2048, height: 1320, theme: 'dark' },
    ]);
    assert.deepEqual(f.calls, Array(6).fill('joint'));
    assert.equal(result.receipt.containment.viewports.length, 4);
    assert.equal(result.receipt.readability.viewports.length, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
