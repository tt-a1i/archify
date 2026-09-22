import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { packAtlasBundle, readAtlasBundle } from '../renderers/shared/atlas-bundle.mjs';
import { serializeScriptJson } from '../renderers/shared/utils.mjs';

// Execute the production shell at its DOM/history/member-message boundary.
// This deliberately does not prove painted frames; browser process evidence is
// covered separately. The clock controls readiness, feedback and startup expiry.
const source = fs.readFileSync(new URL('../renderers/shared/atlas-shell.mjs', import.meta.url), 'utf8');
const runtimeSource = source.slice(source.indexOf('function atlasRuntime('));
const plain = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function shell({ hash = 'diagram=root' } = {}) {
  const ids = ['root', 'child', 'grandchild', 'reference'];
  const bundle = {
    bundle_version: 1, diagramIds: ids,
    entry: 'root', meta: { title: 'Test atlas', locale: 'zh-CN', visual_preset: 'classic' },
    members: Object.fromEntries(ids.map((id) => [id, {
      title: id, html: '<html></html>', nodes: ['entry', 'exit', 'constructor'], relations: ['entry-exit'], views: ['overview'], parentContext: [],
      ...(id === 'root' ? { structureNodes: { entry: { code: ['entry-root', 'entry-symbol'] }, exit: { state: ['exit-field'] } },
        receipts: { internalStructure: { schemaVersion: 1, nodeCount: 2, itemCount: 3, relationCount: 0, sourceCount: 2, bytes: 3, sha256: '0'.repeat(64) } } } : {}),
    }])),
    details: [{ from: { diagram: 'root', node: 'entry' }, to: 'child' },
      { from: { diagram: 'child', node: 'entry' }, to: 'grandchild' }],
    references: ['child', 'reference'].map(diagram => ({ occurrence: { diagram, node: 'exit' }, target: { diagram: 'root', node: 'exit' } })),
  };
  let now = 0, timerId = 0, workbenchNavigation, changePreferences, changeWorkbenchLayout, currentIndex = 0;
  const timers = new Map(), events = new Map(), frames = [], changes = [];
  const entries = [{ href: `file:///tmp/atlas.html?theme=light#${hash}`, state: null }];
  const byId = new Map();
  const listeners = () => {
    const ownEvents = new Map();
    return {
      addEventListener(name, callback) {
        if (!ownEvents.has(name)) ownEvents.set(name, new Set());
        ownEvents.get(name).add(callback);
      },
      removeEventListener(name, callback) { ownEvents.get(name)?.delete(callback); },
      dispatchEvent(event) { ownEvents.get(event.type)?.forEach((callback) => callback(event)); return true; },
    };
  };
  function element(tag = 'div') {
    const attributes = new Map(), children = [];
    const node = {
      ...listeners(), tagName: tag.toUpperCase(), children, hidden: false, inert: false, textContent: '', dataset: {},
      style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } },
      classList: { add() {}, remove() {}, toggle() {} },
      get isConnected() { return node === document.body || Boolean(node.parentNode?.isConnected); },
      append(...items) { for (const child of items) { child.remove?.(); children.push(child); child.parentNode = node; } },
      appendChild(child) { node.append(child); return child; },
      prepend(child) { child.remove?.(); children.unshift(child); child.parentNode = node; },
      remove() {
        if (node.parentNode) {
          const siblings = node.parentNode.children;
          siblings.splice(siblings.indexOf(node), 1);
          node.parentNode = null;
        }
      },
      replaceChildren(...items) { for (const child of [...children]) child.remove(); node.textContent = ''; node.append(...items); },
      setAttribute(name, value) { attributes.set(name, String(value)); if (name === 'id') byId.set(String(value), node); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      hasAttribute(name) { return attributes.has(name); },
      contains(other) { return other === node || children.some((child) => child.contains?.(other)); },
      focus() { document.activeElement = node; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 1000, width: 1600, height: 1000 }; },
    };
    Object.defineProperty(node, 'id', { get() { return attributes.get('id') || ''; }, set(value) { node.setAttribute('id', value); } });
    return node;
  }
  const document = {
    ...listeners(), documentElement: element('html'), body: element('body'), head: element('head'), activeElement: null,
    getElementById(id) { return byId.get(id) || null; },
    querySelector(selector) { return selector === 'iframe' ? frames.find((frame) => frame.isConnected) : null; },
    querySelectorAll(selector) { return selector === 'iframe' ? frames.filter((frame) => frame.isConnected) : []; },
    createElement(tag) {
      const node = element(tag);
      if (tag !== 'iframe') return node;
      node.ready = false; node.prepared = false; node.revocations = 0; node.activations = 0;
      node.messages = []; node.preparations = []; node.focusCalls = []; node.motion = 'live';
      node.navigationReading = { tab: 'details' };
      node.navigationRestorations = [];
      node.reading = { camera: { centerX: 500, centerY: 300, scale: 1 }, scrollX: 0, scrollY: 0 };
      node.contentDocument = { documentElement: element('html'), activeElement: null, body: element('body'),
        querySelector: () => null, querySelectorAll: () => [] };
      const address = {
        active: false, location: { get href() { return node.address; } },
        snapshot() { return address.active ? plain(node.reading) : null; },
        revoke() { address.active = false; node.revocations++; },
        canActivate(options) {
          return Boolean(node.init && node.prepared && !node.revocations && !address.active &&
            (!options?.href || options.href === node.address));
        },
        activate(options) {
          if (!address.canActivate(options)) return false;
          address.active = true; node.activations++; return true;
        },
        navigate(href) { if (!address.active) return false; node.address = String(href); return true; },
        prepare(options) {
          node.address = options.href;
          node.prepared = false;
          if (options.motion) node.motion = options.motion;
          const preparation = { options: plain(options) };
          node.preparations.push(preparation);
          if (!node.deferPreparation) return Promise.resolve().then(() => { node.prepared = true; return true; });
          return new Promise((resolve, reject) => {
            preparation.resolve = (ready = true) => { node.prepared = ready !== false; resolve(ready); };
            preparation.reject = reject;
          });
        },
        setPreparing(value) { node.preparing = value; },
      };
      node.contentWindow = {
        ...listeners(), ArchifyAddress: address, Archify: { motionGovernor: { readerMode: () => node.motion } },
        postMessage(message) {
          node.messages.push(plain(message));
          if (message.type === 'init') {
            node.init = plain(message); node.address = message.href;
            if (message.motion) node.motion = message.motion;
            address.active = message.active !== false;
          }
          if (message.type === 'activate') address.activate();
          if (message.type === 'revoke') address.revoke();
        },
      };
      frames.push(node);
      return node;
    },
  };
  const viewer = element('main'); viewer.id = 'atlas-viewer'; document.body.append(viewer);
  const error = element('section'); error.id = 'atlas-error'; error.hidden = true; viewer.append(error);
  const data = element('script'); data.id = 'archify-atlas-data'; data.textContent = serializeScriptJson(packAtlasBundle(bundle), 2);
  const location = {
    get href() { return entries[currentIndex].href; },
    get hash() { return new URL(this.href).hash; }, get origin() { return new URL(this.href).origin; },
    get pathname() { return new URL(this.href).pathname; },
  };
  function emit(type, details = {}) { events.get(type)?.forEach((callback) => callback({ type, ...details })); }
  const history = {
    get state() { return entries[currentIndex].state; },
    get length() { return entries.length; },
    pushState(state, _, url) {
      entries.splice(currentIndex + 1); entries.push({ state: plain(state), href: String(url) }); currentIndex++;
      changes.push({ type: 'push', href: location.href, state: plain(state) });
    },
    replaceState(state, _, url) {
      entries[currentIndex] = { state: plain(state), href: String(url) };
      changes.push({ type: 'replace', href: location.href, state: plain(state) });
    },
    back() { if (currentIndex > 0) { currentIndex--; emit('popstate', { state: this.state }); } },
    forward() { if (currentIndex + 1 < entries.length) { currentIndex++; emit('popstate', { state: this.state }); } },
  };
  function installNavigation({ frame }) {
    return {
      snapshot: () => plain(frame.navigationReading),
      restore(snapshot) { if (snapshot) { frame.navigationReading = plain(snapshot); frame.navigationRestorations.push(plain(snapshot)); } }, dispose() {},
      focus() { frame.focusCalls.push({ target: 'title' }); document.activeElement = frame; },
      restoreFocus(value) { frame.focusCalls.push({ target: 'saved', value: plain(value) }); document.activeElement = frame; },
    };
  }
  const workbenchStatus = element('p'); workbenchStatus.id = 'atlas-status';
  function installWorkbench(options) {
    workbenchNavigation = options.navigate;
    changeWorkbenchLayout = options.onLayoutChange;
    return {
      attach() {}, commit() {}, detach() {}, openDirectory() {}, sync() {},
      canRestoreFocus(frame) {
        return !document.activeElement || [document.body, document.documentElement, frame].includes(document.activeElement);
      },
      setStatus(text) { workbenchStatus.textContent = text; },
    };
  }
  function installToolbar(options) {
    changePreferences = options.onPreferenceChange;
    return { attach() {}, commit() {}, detach() {}, setPreparing() {}, sync() {} };
  }
  const context = {
    document, location, history, URL, URLSearchParams, Promise, Event, console,
    Date: class extends Date { static now() { return now; } }, Math,
    setTimeout(callback, delay = 0) { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { return context.setTimeout(() => callback(now), 16); },
    cancelAnimationFrame(id) { timers.delete(id); },
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    installNavigation, installWorkbench, installToolbar, readAtlasBundle, innerWidth: 1600, innerHeight: 1000,
  };
  context.window = context;
  vm.runInNewContext(`${runtimeSource}\natlasRuntime(installNavigation, installWorkbench, installToolbar, readAtlasBundle);`, context);
  function message(frame, type, fields = {}) {
    const identity = frame.init || {};
    emit('message', { source: frame.contentWindow, data: {
      archifyAtlas: 1, type, diagram: frame.title,
      sessionId: identity.sessionId, entryId: identity.entryId, transaction: identity.transaction, ...fields,
    } });
  }
  function bridge(frame) { message(frame, 'bridge-ready'); return frame; }
  function ready(frame, fields = {}) { frame.ready = true; frame.prepared = true; message(frame, 'ready', fields); return frame; }
  const api = {
    frames, history, changes, location, error, timers, document,
    preferences(values) {
      for (const frame of api.active()) {
        const url = new URL(frame.address);
        for (const [key, value] of Object.entries(values)) {
          if (value == null || value === false) url.searchParams.delete(key);
          else url.searchParams.set(key, value === true ? '1' : value);
        }
        frame.address = url.href;
      }
      changePreferences(values);
    },
    changeWorkbenchLayout() { changeWorkbenchLayout(); },
    resize(width, height) { context.innerWidth = width; context.innerHeight = height; emit('resize'); },
    editHash(hash) {
      const oldURL = location.href, url = new URL(oldURL);
      url.hash = hash;
      // An external address owner may retain history.state when editing a hash.
      // Dispatch the browser event without invoking any shell-private loader.
      entries[currentIndex].href = url.href;
      emit('hashchange', { oldURL, newURL: url.href });
    },
    dispatchHashChange() { emit('hashchange'); },
    attached: () => frames.filter((frame) => frame.isConnected),
    active: () => frames.filter((frame) => frame.contentWindow.ArchifyAddress.active),
    navigate(...args) {
      assert.equal(typeof workbenchNavigation, 'function', 'Navigation must be installed'); workbenchNavigation(...args);
    },
    bridge, ready, message,
    finish(frame = frames.at(-1)) { bridge(frame); return ready(frame); },
    advance(milliseconds) {
      const until = now + milliseconds;
      while (true) {
        const pending = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        const [id, timer] = pending; now = timer.at; timers.delete(id); timer.callback();
      }
      now = until;
    },
    feedback: () => workbenchStatus.textContent,
  };
  api.finish(frames[0]);
  changes.length = 0;
  return api;
}

test('explicit navigation keeps the ready member until its candidate is ready and pushes only on commit', () => {
  const app = shell(), root = app.frames[0], href = app.location.href;
  app.navigate('child');
  const child = app.frames.at(-1);
  assert.ok(root.isConnected, 'The previous ready canvas must stay attached during preparation');
  assert.equal(root.contentWindow.ArchifyAddress.active, true, 'The previous canvas stays readable');
  assert.equal(app.location.href, href, 'Preparation must not expose the candidate address');
  assert.equal(app.history.length, 1);
  app.bridge(child);
  assert.equal(child.contentWindow.ArchifyAddress.active, false, 'Initialization is not activity authority');
  assert.equal(child.getAttribute('aria-hidden'), 'true', 'The candidate stays outside the accessible tree');
  assert.equal(child.inert, true, 'The candidate cannot receive input');
  root.reading.camera.scale = 1.75;
  app.ready(child);
  assert.equal(app.history.length, 2);
  assert.equal(app.changes.filter((change) => change.type === 'push').length, 1);
  assert.match(app.location.hash, /diagram=child/);
  assert.deepEqual(app.attached(), [child]);
  assert.deepEqual(app.active(), [child]);
  app.history.back();
  const returned = app.bridge(app.frames.at(-1));
  assert.equal(returned.init.snapshot.camera.scale, 1.75, 'Commit captures the latest old-member reading state');
});

test('preparation feedback starts at 300ms and clears after commit', () => {
  const app = shell();
  app.navigate('child');
  app.advance(299);
  assert.equal(app.feedback(), '');
  app.advance(1);
  assert.match(app.feedback(), /child/);
  app.finish();
  assert.equal(app.feedback(), '');
});

test('latest request wins, a duplicate pending target coalesces, and late candidate messages are inert', () => {
  const app = shell(), root = app.frames[0];
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  app.advance(200);
  app.navigate('grandchild'); const grandchild = app.bridge(app.frames.at(-1));
  assert.equal(child.isConnected, false);
  assert.equal(root.isConnected, true);
  app.advance(200);
  const count = app.frames.length;
  app.navigate('grandchild');
  assert.equal(app.frames.length, count, 'A duplicate target must not rebuild its candidate');
  app.advance(100);
  assert.match(app.feedback(), /grandchild/, 'A duplicate must not restart the delay');
  app.navigate('reference'); const reference = app.bridge(app.frames.at(-1));
  const beforeLateMessages = plain(app.changes);
  app.ready(child); app.ready(grandchild);
  app.message(grandchild, 'error', { message: 'late error' });
  app.message(child, 'snapshot', { href: child.address, snapshot: { camera: { scale: 99 } } });
  assert.deepEqual(app.changes, beforeLateMessages);
  assert.equal(root.isConnected, true);
  assert.equal(app.error.hidden, true);
  app.ready(reference);
  assert.deepEqual(app.attached(), [reference]);
  assert.equal(app.history.length, 2, 'Uncommitted intermediate targets must never enter history');
});

test('the current directory item is a no-op and cancels an explicit pending switch', () => {
  const app = shell(), root = app.frames[0];
  app.navigate('root');
  assert.deepEqual(app.attached(), [root]);
  assert.equal(app.frames.length, 1);
  assert.equal(app.history.length, 1);
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  app.advance(300);
  app.navigate('root');
  assert.deepEqual(app.attached(), [root]);
  assert.equal(app.feedback(), '');
  const changes = plain(app.changes);
  app.ready(child);
  assert.deepEqual(app.changes, changes);
  assert.deepEqual(app.active(), [root]);
});

test('same-member focus and relationship navigation update the reading address without rebuilding or pushing', () => {
  const app = shell(), root = app.frames[0], entry = app.history.state.entryId;
  app.navigate('root', 'entry');
  assert.equal(app.frames.length, 1);
  assert.equal(app.attached()[0], root);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('focus'), 'entry');
  app.navigate('root', undefined, 'entry-exit');
  assert.equal(app.frames.length, 1);
  assert.equal(app.history.state.entryId, entry);
  assert.equal(app.history.length, 1);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('relation'), 'entry-exit');
  assert.deepEqual(app.active(), [root]);
});

test('same-member structure navigation prepares a replacement and pushes only after it is ready', () => {
  const app = shell(), root = app.frames[0], href = app.location.href;
  app.message(root, 'navigate', { focus: 'entry', inspect: 'structure', section: 'code' });
  const structure = app.frames.at(-1);
  assert.notEqual(structure, root, 'A new structure surface must not use the graph-only replace shortcut');
  assert.equal(app.location.href, href);
  assert.equal(app.history.length, 1);
  assert.deepEqual(app.active(), [root]);
  app.bridge(structure);
  const params = new URL(structure.init.href).hash;
  assert.match(params, /diagram=root&focus=entry&inspect=structure&section=code/);
  assert.equal(structure.contentWindow.ArchifyAddress.active, false);
  app.ready(structure);
  assert.deepEqual(app.active(), [structure]);
  assert.equal(app.history.length, 2);
  assert.equal(app.changes.filter(change => change.type === 'push').length, 1);
});

test('structure initialization failure and superseded readiness leave the committed surface and history intact', () => {
  for (const outcome of ['error', 'timeout']) {
    const app = shell(), root = app.frames[0], href = app.location.href;
    app.navigate({ diagram: 'root', focus: 'entry', inspect: 'structure' });
    const structure = app.bridge(app.frames.at(-1));
    if (outcome === 'error') app.message(structure, 'error', { message: 'injected structure rendering failure' });
    else app.advance(15000);
    assert.equal(app.location.href, href);
    assert.deepEqual(app.active(), [root]);
    assert.equal(app.history.length, 1);
  }
  const app = shell();
  app.navigate({ diagram: 'root', focus: 'entry', inspect: 'structure' });
  const structure = app.bridge(app.frames.at(-1));
  app.navigate('child'); const child = app.finish();
  app.ready(structure);
  assert.deepEqual(app.active(), [child]);
  assert.match(app.location.hash, /diagram=child/);
  assert.equal(app.history.length, 2);
});

test('a reported ready surface must match the pending structure address before it can commit', () => {
  const app = shell(), root = app.frames[0], href = app.location.href;
  app.navigate({ diagram: 'root', focus: 'entry', inspect: 'structure' });
  const structure = app.bridge(app.frames.at(-1));
  app.ready(structure, { surface: 'graph' });
  assert.deepEqual(app.active(), [root]);
  assert.equal(app.location.href, href);
  assert.equal(app.history.length, 1);
  assert.equal(app.error.hidden, false);
});

test('reopening the current structure is a no-op and chapter changes replace its reading address', () => {
  const app = shell();
  app.navigate({ diagram: 'root', focus: 'entry', inspect: 'structure' });
  const structure = app.finish(), count = app.frames.length, entry = app.history.state.entryId;
  for (let index = 0; index < 5; index++) app.message(structure, 'navigate', { focus: 'entry', inspect: 'structure' });
  assert.equal(app.frames.length, count);
  assert.equal(app.history.length, 2);
  app.message(structure, 'navigate', { focus: 'entry', inspect: 'structure', section: 'code' });
  assert.equal(app.frames.length, count);
  assert.equal(app.history.state.entryId, entry);
  assert.equal(app.history.length, 2);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('section'), 'code');
  app.message(structure, 'navigate', { focus: 'entry', inspect: 'structure' });
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('section'), 'code', 'A repeated open does not reset the last section');
});

test('structure addresses reject malformed surfaces, sections, and nodes without authored structure content', () => {
  for (const hash of [
    'diagram=root&inspect=structure',
    'diagram=root&focus=missing&inspect=structure',
    'diagram=root&focus=entry&inspect=unknown',
    'diagram=root&focus=entry&inspect=structure&section=',
    'diagram=root&focus=entry&inspect=structure&section=unknown',
    'diagram=root&focus=entry&inspect=structure&section=constraints',
    'diagram=root&focus=entry&section=flow',
  ]) {
    const app = shell({ hash });
    assert.equal(app.error.hidden, false, hash);
    assert.deepEqual(app.active(), [], hash);
    assert.equal(app.location.hash, `#${hash}`, 'A bad cold address is preserved for recovery');
  }
  const app = shell({ hash: 'diagram=grandchild&focus=entry&inspect=structure' });
  assert.equal(app.error.hidden, false, 'The Atlas rejects a missing-structure deep link before member startup');
  assert.deepEqual(app.active(), []);
  const inheritedName = shell({ hash: 'diagram=root&focus=constructor&inspect=structure&section=flow' });
  assert.equal(inheritedName.error.hidden, false, 'Node IDs must not accidentally read Object.prototype as structure metadata');
});

test('a cold structure link through a reference resolves to the canonical owner', () => {
  const app = shell({ hash: 'diagram=reference&focus=exit&inspect=structure&section=state&item=exit-field' });
  const structure = app.finish();
  assert.equal(structure.title, 'root');
  assert.match(structure.init.href, /#diagram=root&focus=exit&inspect=structure&section=state&item=exit-field$/);
  assert.match(app.location.hash, /#diagram=root&focus=exit&inspect=structure&section=state&item=exit-field$/);
  assert.equal(app.history.length, 1, 'Canonicalizing a cold link replaces the current entry');
});

test('a canonical structure returns to each occurrence with its original local reading state', () => {
  for (const occurrence of ['child', 'reference']) {
    const app = shell();
    app.navigate(occurrence, 'exit'); const source = app.finish(), sourceEntry = app.history.state.entryId;
    source.reading.camera.scale = 2.25;
    source.reading.structure = { surface: 'graph', nodeId: 'exit', focus: { id: 'atlas-open-internal-structure' } };
    source.navigationReading = { tab: 'relationships', scroll: { relationships: 91 }, focus: { id: 'atlas-open-internal-structure' } };
    app.document.activeElement = source;
    app.message(source, 'navigate', { focus: 'exit', inspect: 'structure', section: 'state' });
    const structure = app.bridge(app.frames.at(-1));
    assert.equal(structure.title, 'root');
    assert.match(structure.init.href, /#diagram=root&focus=exit&inspect=structure&section=state$/);
    app.ready(structure);
    structure.reading.structure = { surface: 'structure', nodeId: 'exit', section: 'state', scrollTop: 180, focus: { section: 'state' } };
    app.message(structure, 'structure-return');
    const returned = app.bridge(app.frames.at(-1));
    assert.equal(returned.title, occurrence);
    assert.equal(returned.init.entryId, sourceEntry);
    assert.equal(returned.init.snapshot.camera.scale, 2.25);
    assert.equal(returned.init.snapshot.navigation.tab, 'relationships');
    assert.equal(returned.init.snapshot.navigation.scroll.relationships, 91);
    returned.contentWindow.Archify.internalStructure = {
      focus(value) { returned.focusCalls.push({ target: 'structure', value: plain(value) }); },
    };
    app.ready(returned);
    assert.deepEqual(returned.focusCalls.at(-1), { target: 'saved', value: { id: 'atlas-open-internal-structure' } });
    app.history.forward();
    const forwarded = app.bridge(app.frames.at(-1));
    assert.equal(forwarded.title, 'root');
    assert.equal(forwarded.init.snapshot.structure.scrollTop, 180);
    assert.match(forwarded.init.href, /inspect=structure&section=state/);
    forwarded.contentWindow.Archify.internalStructure = {
      focus(value) { forwarded.focusCalls.push({ target: 'structure', value: plain(value) }); app.document.activeElement = forwarded; },
    };
    const pushes = app.changes.filter(change => change.type === 'push').length;
    assert.deepEqual(forwarded.focusCalls, [], 'A hidden structure must not receive focus during preparation');
    app.ready(forwarded);
    assert.deepEqual(forwarded.focusCalls, [{ target: 'structure', value: { section: 'state' } }]);
    assert.equal(app.changes.filter(change => change.type === 'push').length, pushes, 'Focus restoration must not add a history entry');
  }
});

test('restoring structure focus after Forward preserves focus moved to the persistent toolbar', () => {
  const app = shell(), root = app.frames[0];
  root.focus();
  app.message(root, 'navigate', { focus: 'entry', inspect: 'structure', section: 'code' });
  const structure = app.finish();
  structure.reading.structure = { surface: 'structure', nodeId: 'entry', section: 'code', focus: { section: 'code' } };
  app.history.back(); app.finish();
  app.history.forward(); const forwarded = app.bridge(app.frames.at(-1));
  forwarded.contentWindow.Archify.internalStructure = {
    focus(value) { forwarded.focusCalls.push({ target: 'structure', value: plain(value) }); app.document.activeElement = forwarded; },
  };
  const toolbarControl = app.document.createElement('button');
  app.document.body.append(toolbarControl); toolbarControl.focus();
  app.ready(forwarded);
  assert.equal(app.document.activeElement, toolbarControl);
  assert.deepEqual(forwarded.focusCalls, []);
  assert.deepEqual(app.active(), [forwarded]);
});

test('returning from a cold structure replaces the surface without navigating outside the atlas', () => {
  const app = shell({ hash: 'diagram=root&focus=entry&inspect=structure&section=code' });
  const structure = app.frames[0], entry = app.history.state.entryId, href = app.location.href;
  app.message(structure, 'structure-return');
  const graph = app.frames.at(-1);
  assert.notEqual(graph, structure);
  assert.equal(app.location.href, href, 'The existing structure remains committed while its graph prepares');
  app.finish(graph);
  assert.equal(app.history.state.entryId, entry);
  assert.equal(app.history.length, 1);
  assert.equal(app.location.hash, '#diagram=root&focus=entry');
  const reordered = shell({ hash: 'focus=entry&inspect=structure&diagram=root' });
  reordered.message(reordered.frames[0], 'structure-return'); reordered.finish();
  assert.equal(new URLSearchParams(reordered.location.hash.slice(1)).get('focus'), 'entry', 'Returning respects the focus regardless of fragment key order');
});

test('duplicate pending graph replacements merge and a graph selection cancels a queued structure', () => {
  const app = shell({ hash: 'diagram=root&focus=entry&inspect=structure' }), structure = app.frames[0];
  app.navigate('root'); const graph = app.frames.at(-1), count = app.frames.length;
  app.advance(200); app.navigate('root');
  assert.equal(app.frames.length, count);
  app.advance(100);
  assert.match(app.feedback(), /root/, 'A duplicate surface target must not reset feedback timing');
  app.finish(graph);
  assert.equal(structure.contentWindow.ArchifyAddress.active, false);
  graph.contentDocument.documentElement.setAttribute('data-atlas-export-busy', '');
  app.message(graph, 'navigate', { focus: 'entry', inspect: 'structure' });
  assert.equal(app.frames.length, count, 'Export-busy structure opening must wait without a candidate');
  app.navigate('root', 'exit');
  graph.contentDocument.documentElement.removeAttribute('data-atlas-export-busy'); app.message(graph, 'export-idle');
  assert.equal(app.frames.length, count);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('focus'), 'exit');
});

test('directory selection leaves a structure for the graph surface and failure retains the structure', () => {
  const app = shell({ hash: 'diagram=root&focus=entry&inspect=structure' });
  const structure = app.frames[0], href = app.location.href;
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  app.message(child, 'error', { message: 'injected graph failure' });
  assert.deepEqual(app.active(), [structure]);
  assert.equal(app.location.href, href);
  app.navigate('root'); const graph = app.frames.at(-1);
  assert.notEqual(graph, structure, 'The same directory diagram must still exit a structure');
  app.finish(graph);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).has('inspect'), false);
  assert.equal(app.history.length, 1, 'A same-diagram graph selection retains its existing replace semantics');
});

test('a fresh member-origin navigation focuses the destination title only after commit', () => {
  const app = shell(), root = app.frames[0];
  root.focus();
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  assert.equal(app.document.activeElement, root);
  assert.deepEqual(child.focusCalls, []);
  app.ready(child);
  assert.deepEqual(child.focusCalls, [{ target: 'title' }]);
  assert.equal(app.document.activeElement, child);
});

test('moving focus to the persistent toolbar during preparation prevents destination focus theft', () => {
  const app = shell(), root = app.frames[0];
  root.focus();
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  const toolbarControl = app.document.createElement('button');
  app.document.body.append(toolbarControl); toolbarControl.focus();
  app.ready(child);
  assert.equal(app.document.activeElement, toolbarControl);
  assert.deepEqual(child.focusCalls, []);
  assert.deepEqual(app.active(), [child]);
});

test('explicit initialization failure and timeout preserve the prior address and readable canvas', () => {
  for (const outcome of ['error', 'timeout']) {
    const app = shell(), root = app.frames[0], href = app.location.href;
    app.navigate('child'); const child = app.bridge(app.frames.at(-1));
    if (outcome === 'error') app.message(child, 'error', { message: 'injected startup failure' });
    else app.advance(15000);
    assert.equal(app.location.href, href, outcome);
    assert.equal(app.history.length, 1, outcome);
    assert.deepEqual(app.attached(), [root], outcome);
    assert.deepEqual(app.active(), [root], outcome);
    assert.equal(child.isConnected, false);
    app.navigate('reference'); app.finish();
    assert.match(app.location.hash, /diagram=reference/, 'The directory remains usable after failure');
  }
});

test('candidate state cannot write history and readiness requires the candidate session identity', () => {
  const app = shell(), root = app.frames[0];
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  const href = app.location.href, changes = plain(app.changes);
  app.message(child, 'state', { href: child.address });
  app.message(child, 'snapshot', { href: child.address, snapshot: { camera: { scale: 99 } } });
  for (const identity of ['sessionId', 'entryId', 'transaction']) {
    app.message(child, 'ready', { [identity]: 'unrelated-visit' });
  }
  assert.equal(app.location.href, href);
  assert.deepEqual(app.changes, changes);
  assert.equal(root.isConnected, true);
  assert.equal(child.contentWindow.ArchifyAddress.active, false);
  app.ready(child);
  assert.match(app.location.hash, /diagram=child/);
});

test('a candidate that loses activation eligibility fails without revoking the old visit or pushing history', () => {
  const app = shell(), root = app.frames[0], href = app.location.href;
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  assert.equal(child.contentWindow.ArchifyAddress.canActivate({ href: child.address }), false, 'Initialization alone is insufficient');
  child.contentWindow.ArchifyAddress.revoke();
  app.ready(child); // A ready message already queued before the member lost eligibility.
  assert.deepEqual(app.active(), [root]);
  assert.deepEqual(app.attached(), [root]);
  assert.equal(root.revocations, 0);
  assert.equal(child.activations, 0);
  assert.equal(app.location.href, href);
  assert.equal(app.history.length, 1);
  assert.equal(app.changes.some((change) => change.type === 'push'), false);
  assert.equal(app.error.hidden, false);
  app.navigate('child'); const retried = app.finish();
  assert.deepEqual(app.active(), [retried]);
  assert.equal(app.history.length, 2);
});

test('workbench slot changes invalidate candidate readiness until its new layout has settled', async () => {
  const app = shell(), root = app.frames[0];
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  child.deferPreparation = true;
  app.changeWorkbenchLayout(); // For example, the compact directory changes the reserved slot.
  app.ready(child);
  assert.equal(child.preparations.length, 1);
  assert.equal(child.contentWindow.ArchifyAddress.canActivate({ href: child.address }), false);
  assert.equal(root.isConnected, true);
  assert.equal(app.history.length, 1);
  app.changeWorkbenchLayout();
  child.preparations[0].resolve(); await Promise.resolve();
  assert.equal(child.preparations.length, 2);
  assert.equal(root.isConnected, true);
  child.preparations[1].resolve(); await Promise.resolve();
  assert.deepEqual(app.attached(), [child]);
  assert.equal(app.history.length, 2);
});

test('commit samples the old member appearance and motion even before its preference message arrives', async () => {
  const app = shell(), root = app.frames[0];
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  child.deferPreparation = true;
  const changed = new URL(root.address);
  changed.searchParams.set('theme', 'dark'); changed.searchParams.set('preset', 'blueprint');
  root.address = changed.href; root.motion = 'still';
  app.ready(child);
  assert.equal(child.preparations.length, 1);
  const preparation = child.preparations[0];
  assert.equal(new URL(preparation.options.href).searchParams.get('theme'), 'dark');
  assert.equal(new URL(preparation.options.href).searchParams.get('preset'), 'blueprint');
  assert.equal(preparation.options.motion, 'still');
  assert.equal(root.isConnected, true);
  assert.equal(app.history.length, 1);
  preparation.resolve(); await Promise.resolve();
  assert.deepEqual(app.active(), [child]);
  assert.equal(child.motion, 'still');
  assert.equal(new URL(app.location.href).searchParams.get('theme'), 'dark');
  assert.equal(new URL(app.location.href).searchParams.get('preset'), 'blueprint');
});

test('readiness is confirmed again when appearance and viewport change while a candidate settles', async () => {
  const app = shell(), root = app.frames[0];
  app.navigate('child'); const child = app.bridge(app.frames.at(-1));
  child.deferPreparation = true;
  app.preferences({ theme: 'dark' });
  app.ready(child);
  assert.equal(child.preparations.length, 1);
  assert.equal(root.isConnected, true);
  assert.equal(app.history.length, 1);
  assert.equal(new URL(child.preparations[0].options.href).searchParams.get('theme'), 'dark');
  app.resize(1920, 1080);
  app.preferences({ preset: 'blueprint' });
  child.preparations[0].resolve();
  await Promise.resolve();
  assert.equal(child.preparations.length, 2, 'The obsolete settled layout cannot commit');
  assert.equal(root.isConnected, true);
  assert.equal(new URL(child.preparations[1].options.href).searchParams.get('preset'), 'blueprint');
  child.preparations[1].resolve();
  await Promise.resolve();
  assert.deepEqual(app.attached(), [child]);
  assert.equal(new URL(app.location.href).searchParams.get('theme'), 'dark');
  assert.equal(new URL(app.location.href).searchParams.get('preset'), 'blueprint');
  assert.equal(app.history.length, 2);
});

test('a replaced candidate cannot commit or display errors from a late preparation promise', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const app = shell();
    app.navigate('child'); const child = app.bridge(app.frames.at(-1));
    child.deferPreparation = true;
    app.resize(1920, 1080); app.ready(child);
    assert.equal(child.preparations.length, 1);
    app.navigate('reference'); const reference = app.finish();
    const href = app.location.href, changes = plain(app.changes);
    child.preparations[0][outcome](new Error('late preparation failure'));
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(app.attached(), [reference]);
    assert.equal(app.location.href, href);
    assert.deepEqual(app.changes, changes);
    assert.equal(app.error.hidden, true);
    assert.equal(app.feedback(), '');
  }
});

test('native history revokes the old visit immediately and does not rewrite the target after failure', () => {
  const app = shell();
  app.navigate('child'); const child = app.finish();
  app.history.back();
  const targetHref = app.location.href, targetEntry = app.history.state.entryId;
  assert.equal(child.contentWindow.ArchifyAddress.active, false);
  if (child.isConnected) assert.equal(child.inert, true, 'A retained historical preview must not receive user input');
  const root = app.bridge(app.frames.at(-1));
  const changes = plain(app.changes);
  app.message(child, 'snapshot', { href: child.address, snapshot: { camera: { scale: 99 } } });
  app.message(root, 'error', { message: 'history target failed' });
  assert.equal(app.location.href, targetHref);
  assert.equal(app.history.state.entryId, targetEntry);
  assert.deepEqual(app.changes, changes, 'Failure must not replace the target with the previously visible member');
  assert.deepEqual(app.active(), []);
  if (child.isConnected) assert.equal(child.inert, true, 'A failed historical target cannot revive the preview');
  assert.equal(app.error.hidden, false);
  assert.match(app.error.children.map((node) => node.textContent).join(' '), /root/);
  app.navigate('child');
  assert.equal(app.error.hidden, false, 'Recovery keeps the visible error until a replacement graph can commit');
  assert.deepEqual(app.active(), []);
  const recovered = app.finish();
  assert.deepEqual(app.active(), [recovered]);
  assert.equal(app.error.hidden, true, 'Successful recovery replaces the error in the same commit');
});

test('an externally edited hash takes precedence over the previous visit cache', () => {
  const app = shell(), root = app.frames[0];
  app.navigate('root', 'entry');
  app.editHash('diagram=grandchild&focus=exit');
  assert.equal(root.contentWindow.ArchifyAddress.active, false);
  assert.equal(app.frames.at(-1).title, 'grandchild');
  const grandchild = app.finish();
  const params = new URLSearchParams(app.location.hash.slice(1));
  assert.equal(params.get('diagram'), 'grandchild');
  assert.equal(params.get('focus'), 'exit');
  assert.deepEqual(app.active(), [grandchild]);
  assert.equal(app.history.length, 1, 'Handling an external hash edit must not append a visit');
});

test('an invalid externally edited target remains in the address and produces an actionable error', () => {
  const app = shell(), root = app.frames[0];
  app.editHash('diagram=missing&focus=entry');
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('diagram'), 'missing');
  assert.equal(root.contentWindow.ArchifyAddress.active, false);
  assert.deepEqual(app.active(), []);
  assert.equal(app.error.hidden, false);
  assert.match(app.error.children.map((node) => node.textContent).join(' '), /missing/);
  assert.ok(app.error.children.some((node) => node.tagName === 'BUTTON'), 'The target error must retain a recovery action');
  app.navigate('reference'); app.finish();
  assert.match(app.location.hash, /diagram=reference/);
});

test('Back to an invalid external hash cannot revive the member cached under its former entry identity', () => {
  const app = shell();
  app.editHash('diagram=missing&focus=entry');
  app.navigate('reference'); app.finish();
  const frameCount = app.frames.length;
  app.history.back();
  const params = new URLSearchParams(app.location.hash.slice(1));
  assert.equal(params.get('diagram'), 'missing');
  assert.equal(params.get('focus'), 'entry');
  assert.equal(app.error.hidden, false);
  assert.match(app.error.children.map((node) => node.textContent).join(' '), /missing/);
  assert.ok(app.error.children.some((node) => node.tagName === 'BUTTON'));
  assert.deepEqual(app.active(), []);
  assert.deepEqual(app.attached(), []);
  assert.equal(app.frames.slice(frameCount).some((frame) => frame.title === 'root'), false);
});

test('the hashchange paired with a failed popstate does not replace its visit identity or restart loading', () => {
  const app = shell();
  app.editHash('diagram=missing&focus=entry');
  app.navigate('reference'); app.finish();
  app.history.back();
  const entryId = app.history.state.entryId, href = app.location.href;
  const frameCount = app.frames.length, changes = plain(app.changes);
  app.dispatchHashChange();
  assert.equal(app.history.state.entryId, entryId);
  assert.equal(app.location.href, href);
  assert.equal(app.frames.length, frameCount);
  assert.deepEqual(app.changes, changes);
  assert.equal(app.error.hidden, false);
  assert.deepEqual(app.active(), []);
  assert.equal(app.timers.size, 0);
});

test('external cross-member hash edits receive a fresh visit without inheriting the previous reading snapshot', () => {
  const app = shell(), root = app.frames[0], previousEntry = app.history.state.entryId;
  root.reading.camera.scale = 2.5;
  app.message(root, 'snapshot', { href: root.address });
  assert.equal(app.history.state.snapshot.camera.scale, 2.5);
  assert.equal(app.history.state.snapshot.navigation.tab, 'details');
  app.editHash('diagram=grandchild&focus=exit');
  const grandchild = app.bridge(app.frames.at(-1));
  assert.equal(grandchild.title, 'grandchild');
  assert.equal(grandchild.init.snapshot, undefined);
  assert.notEqual(grandchild.init.entryId, previousEntry);
  assert.notEqual(app.history.state.entryId, previousEntry);
  assert.equal(app.history.length, 1, 'The shell replaces the externally edited entry without pushing');
});

test('native Back captures undelivered reading changes so Forward restores the final logical address and camera', () => {
  const app = shell();
  app.navigate('child'); const child = app.finish();
  const finalAddress = new URL(child.address);
  finalAddress.hash = 'diagram=child&focus=exit';
  child.address = finalAddress.href;
  child.reading.camera.scale = 2.5;
  app.history.back(); app.finish();
  app.history.forward();
  const restoredChild = app.bridge(app.frames.at(-1));
  assert.equal(restoredChild.title, 'child');
  assert.equal(new URLSearchParams(new URL(restoredChild.init.href).hash.slice(1)).get('focus'), 'exit');
  assert.equal(restoredChild.init.snapshot.camera.scale, 2.5);
  assert.equal(app.history.length, 2);
});

test('cold deep links reject composite focus or beat values without silently falling back', () => {
  for (const field of ['focus', 'beat']) {
    const app = shell({ hash: `diagram=child&${field}=entry~exit` });
    assert.equal(new URLSearchParams(app.location.hash.slice(1)).get(field), 'entry~exit');
    assert.equal(app.error.hidden, false, `${field} identifies exactly one node`);
    assert.deepEqual(app.active(), []);
    assert.equal(app.history.length, 1);
  }
});

test('an explicitly empty cold diagram parameter is an error and preserves the requested address', () => {
  const app = shell({ hash: 'diagram=' });
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('diagram'), '');
  assert.equal(app.error.hidden, false);
  assert.deepEqual(app.active(), []);
  assert.equal(app.history.length, 1);
});

test('selecting the old diagram during native history preparation creates a new explicit visit', () => {
  const app = shell();
  app.navigate('child'); const previousChild = app.finish();
  app.history.back(); const pendingRoot = app.bridge(app.frames.at(-1));
  app.navigate('child');
  const nextChild = app.frames.at(-1);
  assert.notEqual(nextChild, previousChild);
  assert.notEqual(nextChild, pendingRoot);
  assert.equal(previousChild.contentWindow.ArchifyAddress.active, false);
  assert.equal(pendingRoot.isConnected, false);
  assert.match(app.location.hash, /diagram=root/, 'The browser history target remains until explicit commit');
  app.finish(nextChild);
  assert.match(app.location.hash, /diagram=child/);
  assert.deepEqual(app.active(), [nextChild]);
  const href = app.location.href;
  app.ready(pendingRoot);
  assert.equal(app.location.href, href);
});

test('export-busy navigation waits without booting candidates and keeps only the last intent', () => {
  const app = shell(), root = app.frames[0];
  root.contentDocument.documentElement.setAttribute('data-atlas-export-busy', '');
  app.navigate('child'); app.navigate('grandchild'); app.navigate('reference');
  assert.equal(app.frames.length, 1);
  assert.equal(app.history.length, 1);
  assert.match(app.feedback(), /导出/);
  root.contentDocument.documentElement.removeAttribute('data-atlas-export-busy');
  app.message(root, 'export-idle');
  assert.equal(app.frames.length, 2);
  assert.equal(app.frames.at(-1).title, 'reference');
  assert.equal(app.history.length, 1);
  app.finish();
  assert.match(app.location.hash, /diagram=reference/);
  assert.deepEqual(app.active(), [app.frames.at(-1)]);
});

test('selecting the current member cancels an export-waiting navigation intent', () => {
  const app = shell(), root = app.frames[0];
  root.contentDocument.documentElement.setAttribute('data-atlas-export-busy', '');
  app.navigate('child');
  app.navigate('root');
  assert.equal(app.feedback(), '');
  root.contentDocument.documentElement.removeAttribute('data-atlas-export-busy');
  app.message(root, 'export-idle');
  assert.equal(app.frames.length, 1);
  assert.deepEqual(app.active(), [root]);
  assert.equal(app.history.length, 1);
});

test('twenty commits retain one active member, at most two attached frames and no startup timers', () => {
  const app = shell();
  for (let index = 0; index < 20; index++) {
    app.navigate(index % 2 === 0 ? 'child' : 'root');
    assert.equal(app.attached().length, 2);
    assert.equal(app.active().length, 1);
    app.bridge(app.frames.at(-1));
    assert.equal(app.active().length, 1, 'The candidate may initialize without taking activity authority');
    app.ready(app.frames.at(-1));
    assert.equal(app.attached().length, 1);
    assert.equal(app.active().length, 1);
    assert.equal(app.timers.size, 0);
  }
});
