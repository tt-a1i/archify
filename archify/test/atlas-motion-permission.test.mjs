import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../viewer/motion-governor.js', import.meta.url), 'utf8');

function governor({ atlas = true, active = false } = {}) {
  const events = new Map();
  const writes = [];
  const messages = [];
  const element = (initial = {}) => {
    const attributes = new Map(Object.entries(initial));
    return {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      hasAttribute: (name) => attributes.has(name),
      addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [{}],
    };
  };
  const html = element();
  const svg = element({ 'data-animation': 'trace' });
  const address = {
    context: atlas ? { diagram: 'runtime' } : null, active: atlas ? active : true,
    send: (type, payload) => { if (address.active) messages.push({ type, ...payload }); },
  };
  const context = {
    Archify: {}, ArchifyAddress: address, viewerText: (key) => key,
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) },
    document: {
      documentElement: html, querySelector: () => svg, getElementById: () => element(), addEventListener() {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (type, callback) => {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(callback);
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    motion: context.Archify.motionGovernor, api: context.Archify, html, writes, messages,
    setActive(value) {
      address.active = value;
      events.get(value ? 'archify:atlas-activate' : 'archify:atlas-revoke')?.forEach((callback) => callback());
    },
  };
}

test('an initialized staging member stays still without changing the shared reader motion preference', () => {
  const runtime = governor();
  assert.equal(runtime.motion.isPaused(), true);
  assert.equal(runtime.html.getAttribute('data-motion'), 'still');
  assert.equal(runtime.html.getAttribute('data-ambient-motion'), 'settled');
  assert.equal(runtime.html.getAttribute('data-ambient-settle-reason'), 'suppressed');
  assert.deepEqual(runtime.writes, []);
  runtime.setActive(true);
  assert.equal(runtime.motion.isPaused(), false);
  assert.equal(runtime.html.getAttribute('data-motion'), 'live');
  assert.equal(runtime.html.getAttribute('data-ambient-motion'), 'settled', 'Commit must not replay a hidden entrance animation');
  assert.deepEqual(runtime.writes, []);
  runtime.setActive(false);
  assert.equal(runtime.motion.isPaused(), true);
  assert.deepEqual(runtime.writes, []);
});

test('standalone trace viewers retain their ambient animation and explicit reader preference', () => {
  const runtime = governor({ atlas: false });
  assert.equal(runtime.motion.isPaused(), false);
  assert.equal(runtime.html.getAttribute('data-ambient-motion'), 'running');
  runtime.motion.pause();
  assert.equal(runtime.motion.isPaused(), true);
  assert.deepEqual(runtime.writes, [['archify-motion', 'still']]);
});

test('a candidate receives the newest reader preference without persisting it or publishing appearance', () => {
  const runtime = governor();
  assert.equal(runtime.motion.readerMode(), 'live', 'Reader preference is distinct from the staging suspension');
  runtime.motion.setMode('still', { persist: false });
  assert.equal(runtime.motion.readerMode(), 'still');
  assert.deepEqual(runtime.writes, []);
  assert.deepEqual(runtime.messages, []);
  runtime.setActive(true);
  assert.equal(runtime.motion.isPaused(), true, 'Commit retains the inherited reader preference');
  runtime.motion.toggle();
  assert.equal(runtime.motion.readerMode(), 'live');
  assert.deepEqual(runtime.messages, [{ type: 'appearance', motion: 'live' }]);
  assert.deepEqual(runtime.writes, [['archify-motion']]);
});

test('revoking an active member stops story and route playback through the permission event alone', () => {
  const runtime = governor({ active: true });
  const stopped = [];
  runtime.api.guidedViews = { isPlaying: () => true, pause: () => stopped.push('story') };
  runtime.api.routeProbe = { isJourneyPlaying: () => true, pauseJourney: () => stopped.push('route') };
  runtime.setActive(false);
  assert.deepEqual(stopped, ['story', 'route']);
  assert.deepEqual(runtime.writes, [], 'Revocation does not mutate reader motion preferences');
});
