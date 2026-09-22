import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../viewer/viewer-address.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function bridge() {
  const messages = [];
  const events = new Map();
  const frames = new Map();
  let nextFrame = 0;
  const calls = [];
  let camera = { centerX: 605, centerY: 332.5, scale: 1, scrollLeft: 0, scrollTop: 0 };
  const parent = { postMessage: (message) => messages.push(plain(message)) };
  const context = {
    URL, URLSearchParams, Promise, Event, parent,
    document: {
      getElementById: () => ({ textContent: '{"diagram":"runtime"}' }),
      documentElement: { setAttribute() {} }, fonts: { ready: Promise.resolve() },
    },
    location: new URL('about:srcdoc'), scrollX: 0, scrollY: 0,
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    },
    removeEventListener(name, callback) {
      events.set(name, (events.get(name) || []).filter((item) => item !== callback));
    },
    dispatchEvent(event) { events.get(event.type)?.forEach((callback) => callback(event)); },
    scrollTo(x, y) { context.scrollX = x; context.scrollY = y; },
    Archify: {
      readerLayout: { whenStable: () => Promise.resolve() },
      viewerChromeLayout: { whenStable: () => Promise.resolve() },
      motionGovernor: { pause: () => calls.push('pause') },
      view: {
        sync(options) { calls.push(['sync', plain(options)]); return false; },
        snapshot() { return { ...camera }; },
        restore(value) { camera = { ...value }; calls.push('restore'); },
      },
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const address = context.ArchifyAddress;
  address.connect();
  return {
    address, calls, messages, context,
    get pendingFrames() { return frames.size; },
    listenerCount(name) { return events.get(name)?.length || 0; },
    setCamera(value) { camera = value; },
    async flush() {
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        for (const [id, callback] of frames) { frames.delete(id); callback(); }
      }
    },
    async initialize(snapshot, options = {}) {
      context.dispatchEvent({ type: 'message', source: parent, data: {
        archifyAtlas: 1, type: 'init', sessionId: 'session', entryId: 'entry', transaction: 'transaction',
        href: 'https://example.test/maka.html#diagram=runtime', ...(snapshot ? { snapshot } : {}), ...options,
      } });
      await this.flush();
    },
  };
}

test('cold Atlas visits publish the initial camera even when semantic synchronization is a no-op', async () => {
  const runtime = bridge();
  assert.equal(runtime.address.snapshot(), null, 'Uninitialized members cannot persist reading state');
  await runtime.initialize();
  assert.equal(runtime.address.restoring, false);
  assert.deepEqual(runtime.calls, ['pause', ['sync', { initial: true, instant: true }]]);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'ready', 'snapshot']);
  assert.deepEqual(runtime.messages.at(-1).snapshot, plain(runtime.address.snapshot()));
  assert.equal(runtime.messages.at(-1).snapshot.camera.scale, 1);
});

test('returning Atlas visits restore their camera before publishing a snapshot without reframing focus', async () => {
  const runtime = bridge();
  const reading = {
    camera: { centerX: 830, centerY: 412, scale: 1.75, scrollLeft: 0, scrollTop: 0 },
    scrollX: 0, scrollY: 123,
  };
  await runtime.initialize(reading);
  assert.deepEqual(runtime.calls, ['restore', 'pause']);
  assert.deepEqual(runtime.messages.at(-1).snapshot, reading);
});

test('same-task focus and camera changes are available synchronously before parent message delivery', async () => {
  const runtime = bridge();
  await runtime.initialize();
  runtime.address.replaceState(null, '', '/maka.html#focus=tools');
  runtime.setCamera({ centerX: 700, centerY: 333, scale: 1.25, scrollLeft: 0, scrollTop: 0 });
  assert.equal(runtime.address.location.hash, '#focus=tools&diagram=runtime');
  assert.equal(runtime.address.snapshot().camera.scale, 1.25);
  assert.equal(runtime.messages.at(-1).type, 'state', 'No animation or snapshot event is required to capture departure');
});

test('revoked Atlas members cannot publish or expose a departure snapshot', async () => {
  const runtime = bridge();
  await runtime.initialize();
  runtime.address.revoke();
  const count = runtime.messages.length;
  runtime.address.settled();
  runtime.address.replaceState(null, '', '/maka.html#focus=tools');
  assert.equal(runtime.address.snapshot(), null);
  assert.equal(runtime.messages.length, count);
});

test('staging initializes and reports readiness without activity or address and snapshot writes', async () => {
  const runtime = bridge();
  await runtime.initialize(undefined, { active: false });
  assert.equal(runtime.address.active, false);
  assert.equal(runtime.address.exportAllowed, false);
  assert.equal(runtime.address.snapshot(), null);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'ready']);
  const initial = runtime.address.location.href;
  runtime.address.replaceState(null, '', '/maka.html#focus=tools');
  runtime.address.preference('theme', 'light');
  runtime.address.send('navigate', { diagram: 'other' });
  runtime.address.send('snapshot', { snapshot: {} });
  runtime.address.settled();
  assert.equal(runtime.address.location.href, initial);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'ready']);
  assert.ok(!runtime.calls.includes('pause'), 'Staging must not persist the Motion Governor pause preference');
});

test('activation grants one prepared candidate its activity and export rights synchronously', async () => {
  const runtime = bridge();
  assert.equal(runtime.address.activate(), false, 'An uninitialized viewer cannot activate');
  await runtime.initialize(undefined, { active: false });
  const events = [];
  runtime.context.addEventListener('archify:atlas-activate', () => events.push('activate'));
  assert.equal(runtime.address.activate(), true);
  assert.equal(runtime.address.active, true);
  assert.equal(runtime.address.exportAllowed, true);
  assert.equal(runtime.address.snapshot().camera.scale, 1);
  assert.deepEqual(events, ['activate']);
  assert.equal(runtime.address.activate(), false, 'A committed candidate cannot be activated twice');
  runtime.address.setPreparing(true);
  assert.equal(runtime.address.active, true, 'Preparing a replacement must preserve current reading rights');
  assert.equal(runtime.address.exportAllowed, false);
  assert.ok(runtime.address.snapshot());
  runtime.address.setPreparing(false);
  assert.equal(runtime.address.exportAllowed, true);
});

test('re-preparation waits for current preferences and layout before activation and does not emit ready again', async () => {
  const runtime = bridge();
  await runtime.initialize(undefined, { active: false });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  runtime.context.Archify.readerLayout.whenStable = () => blocked;
  const preferences = [];
  runtime.context.Archify.theme = { apply: (value) => preferences.push(['theme', value]) };
  runtime.context.Archify.preset = { apply: (value) => preferences.push(['preset', value]) };
  const reading = { camera: { centerX: 910, centerY: 412, scale: 1.6 }, scrollX: 0, scrollY: 80 };
  const href = 'https://example.test/maka.html?theme=light&preset=blueprint#diagram=runtime';
  const preparation = runtime.address.prepare({ href, snapshot: reading });
  assert.equal(runtime.address.activate(), false);
  assert.equal(runtime.address.snapshot(), null);
  assert.equal(runtime.address.location.href, href);
  assert.deepEqual(preferences, [['theme', 'light'], ['preset', 'blueprint']]);
  release();
  await runtime.flush();
  assert.equal(await preparation, true);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'ready']);
  assert.equal(runtime.address.activate({ href }), true);
  assert.deepEqual(plain(runtime.address.snapshot()), reading);
});

test('revocation during preparation permanently suppresses late readiness and activation', async () => {
  const runtime = bridge();
  let release;
  runtime.context.document.fonts.ready = new Promise((resolve) => { release = resolve; });
  await runtime.initialize(undefined, { active: false });
  runtime.address.revoke();
  release();
  await runtime.flush();
  assert.equal(runtime.address.activate(), false);
  assert.equal(await runtime.address.prepare({}), false);
  assert.equal(runtime.address.active, false);
  assert.equal(runtime.address.exportAllowed, false);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready']);
});

test('same-member navigation hydrates the existing logical address without creating another session', async () => {
  const runtime = bridge();
  await runtime.initialize();
  const observed = [];
  runtime.context.addEventListener('hashchange', () => observed.push(runtime.address.location.hash));
  assert.equal(runtime.address.navigate('https://example.test/maka.html#diagram=runtime&focus=tools'), true);
  assert.deepEqual(observed, ['#diagram=runtime&focus=tools']);
  assert.equal(runtime.messages.at(-2).type, 'state');
  assert.equal(runtime.address.navigate('https://example.test/maka.html#diagram=other'), false);
  assert.equal(runtime.address.location.hash, '#diagram=runtime&focus=tools');
});

test('a superseded preparation cannot restore its old snapshot after the latest preparation completes', async () => {
  const runtime = bridge();
  await runtime.initialize(undefined, { active: false });
  let release;
  runtime.context.Archify.readerLayout.whenStable = () => new Promise((resolve) => { release = resolve; });
  const old = runtime.address.prepare({ snapshot: { camera: { scale: 2 }, scrollY: 10 } });
  await new Promise((resolve) => setImmediate(resolve));
  runtime.context.Archify.readerLayout.whenStable = () => Promise.resolve();
  const latest = { camera: { scale: 1.4 }, scrollX: 0, scrollY: 55 };
  const current = runtime.address.prepare({ snapshot: latest });
  await runtime.flush();
  assert.equal(await current, true);
  release();
  await runtime.flush();
  assert.equal(await old, false);
  assert.equal(runtime.address.activate(), true);
  assert.deepEqual(plain(runtime.address.snapshot()), latest);
});

test('revoke removes bridge listeners and its pending paint callbacks without late scheduling', async () => {
  const runtime = bridge();
  await runtime.initialize(undefined, { active: false });
  runtime.address.connect();
  assert.equal(runtime.listenerCount('message'), 1, 'Repeated connect does not duplicate listeners');
  const preparation = runtime.address.prepare({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingFrames, 1);
  runtime.address.revoke();
  assert.equal(runtime.listenerCount('message'), 0);
  assert.equal(runtime.listenerCount('scroll'), 0);
  assert.equal(runtime.pendingFrames, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingFrames, 0, 'Resolving a canceled paint must not enqueue another frame');
  assert.equal(await preparation, false);
});

test('a staging bootstrap failure reports its identity without granting activity or readiness', async () => {
  const runtime = bridge();
  runtime.address.run(() => { throw new Error('fixture initialization failed'); });
  await runtime.initialize(undefined, { active: false });
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'error']);
  assert.equal(runtime.messages.at(-1).entryId, 'entry');
  assert.equal(runtime.messages.at(-1).message, 'fixture initialization failed');
  assert.equal(runtime.address.activate(), false);
  assert.equal(runtime.address.active, false);
});

test('initial and revised staging preparation apply shared motion and presentation through existing capabilities', async () => {
  const runtime = bridge();
  const inherited = [];
  let present = false;
  runtime.context.Archify.motionGovernor.setMode = (mode, options) => inherited.push([mode, plain(options)]);
  runtime.context.Archify.presentation = {
    active: () => present, enter: () => { present = true; }, exit: () => { present = false; },
  };
  await runtime.initialize(undefined, { active: false, motion: 'still' });
  assert.deepEqual(inherited, [['still', { persist: false }]]);
  const prepared = runtime.address.prepare({
    href: 'https://example.test/maka.html?present=1#diagram=runtime', motion: 'live',
  });
  assert.equal(present, true);
  await runtime.flush();
  assert.equal(await prepared, true);
  assert.deepEqual(inherited.at(-1), ['live', { persist: false }]);
  assert.equal(runtime.address.active, false);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['bridge-ready', 'ready']);
});

test('activation eligibility checks preparation, revocation and exact address without side effects', async () => {
  const runtime = bridge();
  assert.equal(runtime.address.canActivate(), false);
  let release;
  runtime.context.document.fonts.ready = new Promise((resolve) => { release = resolve; });
  await runtime.initialize(undefined, { active: false });
  assert.equal(runtime.address.canActivate(), false, 'Initialization alone cannot qualify a candidate');
  release();
  await runtime.flush();
  const href = runtime.address.location.href;
  const messages = runtime.messages.length;
  const calls = runtime.calls.length;
  assert.equal(runtime.address.canActivate(), true);
  assert.equal(runtime.address.canActivate({ href }), true);
  assert.equal(runtime.address.canActivate({ href: `${href}&focus=other` }), false);
  assert.equal(runtime.address.canActivate({ href: 'https://[' }), false);
  assert.equal(runtime.address.active, false);
  assert.equal(runtime.address.snapshot(), null);
  assert.equal(runtime.address.location.href, href);
  assert.equal(runtime.messages.length, messages);
  assert.equal(runtime.calls.length, calls);
  runtime.address.revoke();
  assert.equal(runtime.address.canActivate({ href }), false);
  assert.equal(runtime.address.activate({ href }), false);
});

test('a restored camera does not qualify activation before its final layout settles', async () => {
  const runtime = bridge();
  let visits = 0;
  let release;
  runtime.context.Archify.readerLayout.whenStable = () => {
    visits++;
    return visits === 3 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  };
  await runtime.initialize(undefined, { active: false });
  assert.equal(runtime.address.restoring, false, 'The initial camera has already synchronized');
  assert.equal(runtime.address.canActivate(), false, 'Final layout is still unsettled');
  assert.equal(runtime.address.activate(), false);
  release();
  await runtime.flush();
  assert.equal(runtime.address.canActivate(), true);
});

test('a committed structure publishes its reading snapshot together with the retained graph camera', async () => {
  const runtime = bridge();
  const structure = { surface: 'structure', nodeId: 'tools', section: 'code', scrollTop: 164 };
  runtime.context.Archify.internalStructure = {
    syncAddress: () => Promise.resolve(), surface: () => 'structure', snapshot: () => structure,
  };
  await runtime.initialize(undefined, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure&section=interfaces' });
  assert.equal(runtime.address.activate(), true);
  assert.deepEqual(plain(runtime.address.snapshot().structure), structure);
  assert.equal(runtime.address.snapshot().camera.scale, 1);
  assert.equal(runtime.messages.find(message => message.type === 'ready').surface, 'structure');
  assert.deepEqual(runtime.messages.at(-1).snapshot.structure, structure);
  assert.ok(!runtime.calls.some(call => Array.isArray(call) && call[0] === 'sync'), 'Structure activation must not reframe its hidden graph');
});

test('candidate readiness waits for both structure rendering and structure scroll restoration', async () => {
  const runtime = bridge(), stages = [];
  let releaseRender, releaseRestore, surface = 'graph';
  const render = new Promise(resolve => { releaseRender = () => { surface = 'structure'; resolve(); }; });
  const restored = new Promise(resolve => { releaseRestore = resolve; });
  const reading = { camera: { centerX: 830, centerY: 412, scale: 1.75 }, scrollX: 0, scrollY: 123,
    structure: { surface: 'structure', nodeId: 'tools', section: 'code', scrollTop: 211 } };
  runtime.context.Archify.internalStructure = {
    syncAddress(options) { stages.push(['sync', plain(options)]); return render; },
    restore(value, options) { stages.push(['restore', plain(value), plain(options)]); return restored; },
    surface: () => surface, snapshot: () => reading.structure,
  };
  await runtime.initialize(reading, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure&section=interfaces' });
  assert.equal(stages[0][0], 'sync');
  assert.equal(stages[0][1].history, false);
  assert.equal(runtime.address.canActivate(), false);
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready']);
  releaseRender(); await runtime.flush();
  assert.deepEqual(stages.at(-1).slice(0, 2), ['restore', reading.structure]);
  assert.equal(stages.at(-1)[2].focus, false);
  assert.equal(runtime.address.canActivate(), false, 'The first rendered structure is not ready before restoring reading position');
  releaseRestore(); await runtime.flush();
  assert.equal(runtime.address.canActivate(), true);
  assert.equal(runtime.address.activate(), true);
  assert.deepEqual(plain(runtime.address.snapshot()), reading);
});

test('structure rendering failures report initialization errors without activity or a ready message', async () => {
  const runtime = bridge();
  runtime.context.Archify.internalStructure = {
    syncAddress: () => Promise.reject(new Error('fixture structure failed')), surface: () => 'graph',
  };
  await runtime.initialize(undefined, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure' });
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready', 'error']);
  assert.match(runtime.messages.at(-1).message, /fixture structure failed/);
  assert.equal(runtime.address.canActivate(), false);
  assert.equal(runtime.address.active, false);
});

test('a missing structure reader cannot qualify a graph as a requested structure', async () => {
  const runtime = bridge();
  await runtime.initialize(undefined, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure' });
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready', 'error']);
  assert.equal(runtime.address.canActivate(), false);
});

test('the new Viewer may resolve a valid structure address to its missing-content reading surface', async () => {
  const runtime = bridge();
  runtime.context.Archify.internalStructure = {
    available: () => false, syncAddress: () => Promise.resolve(), surface: () => 'structure',
    snapshot: () => ({ surface: 'structure', nodeId: 'tools', section: null, scrollTop: 0 }),
  };
  await runtime.initialize(undefined, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure' });
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready', 'ready']);
  assert.equal(runtime.address.canActivate(), true);
  assert.equal(runtime.address.activate(), true);
  assert.equal(runtime.address.snapshot().structure.nodeId, 'tools');
});

test('a resolved reader promise cannot report ready for the wrong visible surface', async () => {
  const runtime = bridge();
  runtime.context.Archify.internalStructure = { syncAddress: () => Promise.resolve(), surface: () => 'graph' };
  await runtime.initialize(undefined, { active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure' });
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready', 'error']);
  assert.equal(runtime.address.canActivate(), false);
});

test('graph re-preparation synchronizes the surface and ignores an obsolete structure result', async () => {
  const runtime = bridge();
  let surface = 'graph', releaseStructure;
  const restored = [];
  runtime.context.Archify.internalStructure = {
    syncAddress() {
      const params = new URLSearchParams(runtime.address.location.hash.slice(1));
      if (params.get('inspect') === 'structure') return new Promise(resolve => { releaseStructure = resolve; });
      surface = 'graph'; return Promise.resolve();
    },
    restore(value) { restored.push(plain(value)); }, surface: () => surface, snapshot: () => ({ surface }),
  };
  await runtime.initialize(undefined, { active: false });
  const old = runtime.address.prepare({ href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure',
    snapshot: { structure: { surface: 'structure', section: 'code', scrollTop: 400 } } });
  await new Promise(resolve => setImmediate(resolve));
  const graph = runtime.address.prepare({ href: 'https://example.test/maka.html#diagram=runtime&focus=tools',
    snapshot: { camera: { centerX: 700, centerY: 300, scale: 1.3 }, scrollX: 0, scrollY: 30, structure: { surface: 'graph' } } });
  await runtime.flush();
  assert.equal(await graph, true);
  releaseStructure(); await runtime.flush();
  assert.equal(await old, false);
  assert.deepEqual(restored, [{ surface: 'graph' }], 'The old result cannot restore its structure state into the latest graph');
  assert.equal(runtime.address.canActivate(), true);
});

test('revocation while a structure renders prevents late restoration and readiness', async () => {
  const runtime = bridge();
  let release;
  const restored = [];
  runtime.context.Archify.internalStructure = {
    syncAddress: () => new Promise(resolve => { release = resolve; }),
    restore: value => restored.push(value), surface: () => 'structure',
  };
  await runtime.initialize({ structure: { surface: 'structure', section: 'code' } }, {
    active: false, href: 'https://example.test/maka.html#diagram=runtime&focus=tools&inspect=structure',
  });
  runtime.address.revoke(); release(); await runtime.flush();
  assert.deepEqual(restored, []);
  assert.deepEqual(runtime.messages.map(message => message.type), ['bridge-ready']);
  assert.equal(runtime.address.canActivate(), false);
});
