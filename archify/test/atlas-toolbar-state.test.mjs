import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import { installAtlasToolbar } from '../renderers/shared/atlas-toolbar.mjs';

// Execute the production adapter against the full authored toolbar. This checks
// command ownership, menus and persistent identities, not browser paint/layout.
const template = fs.readFileSync(new URL('../../viewer/template.source.html', import.meta.url), 'utf8');
const markup = template.slice(template.indexOf('<div class="toolbar"'), template.indexOf('<div class="container">'));

function harness() {
  const frames = [], preferences = [], observers = [], callbacks = new Map();
  let clock = 0;
  class Element {
    constructor(tag, owner) { this.tagName = tag.toUpperCase(); this.ownerDocument = owner; this.attributes = new Map(); this.children = []; this.events = new Map(); this.style = { setProperty(name, value) { this[name] = value; } }; this.content = ''; }
    get id() { return this.getAttribute('id') || ''; } set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; } set className(value) { this.setAttribute('class', value); }
    get textContent() { return this.content + this.children.map((child) => child.textContent).join(''); } set textContent(value) { this.content = value; this.children = []; }
    get hidden() { return this.hasAttribute('hidden'); } set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); } set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get title() { return this.getAttribute('title'); } set title(value) { this.setAttribute('title', value); }
    get classList() { const own = this; return { contains(name) { return own.className.split(' ').includes(name); }, add(name) { own.className = [...new Set([...own.className.split(' ').filter(Boolean), name])].join(' '); }, remove(name) { own.className = own.className.split(' ').filter((item) => item !== name).join(' '); } }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...items) { items.forEach((item) => { item.remove(); item.parentNode = this; const adopt = (node) => { node.ownerDocument = this.ownerDocument; node.children.forEach(adopt); }; adopt(item); this.children.push(item); }); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this); this.parentNode = null; }
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); }
    matches(selector) {
      return selector.split(',').some((part) => {
        const value = part.trim();
        if (value.startsWith('#')) return this.id === value.slice(1);
        if (value.startsWith('.')) return this.classList.contains(value.slice(1));
        const match = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (match) return match[2] == null ? this.hasAttribute(match[1]) : this.getAttribute(match[1]) === match[2];
        return this.tagName.toLowerCase() === value;
      });
    }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
    removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
    dispatch(name, extra = {}) { const event = { target: this, key: '', preventDefault() { this.defaultPrevented = true; }, ...extra }; for (let node = this; node; node = node.parentNode) node.events.get(name)?.forEach((callback) => callback(event)); return event; }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { this.ownerDocument.activeElement = this; }
    cloneNode() { const copy = new Element(this.tagName, this.ownerDocument); copy.attributes = new Map(this.attributes); copy.content = this.content; this.children.forEach((child) => copy.append(child.cloneNode(true))); return copy; }
    getBoundingClientRect() { return this.rect || { top: 16, left: 1150, width: 434, height: 44 }; }
  }
  function document() {
    const doc = new Element('document'); doc.ownerDocument = doc;
    doc.createElement = (tag) => new Element(tag, doc);
    doc.documentElement = doc.createElement('html'); doc.documentElement.lang = 'zh-CN';
    doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
    doc.documentElement.append(doc.head, doc.body); doc.append(doc.documentElement); doc.activeElement = doc.body;
    doc.styleSheets = [{ cssRules: [{ selectorText: '.toolbar button', cssText: '.toolbar button { color:var(--toolbar-text); }' }, { selectorText: '.diagram-container', cssText: '.diagram-container{display:grid}' }] }];
    return doc;
  }
  const outer = document();
  function member(id) {
    const doc = document();
    const convert = (node) => {
      const element = doc.createElement(node.tagName || 'text');
      for (const attribute of node.attrs || []) element.setAttribute(attribute.name, attribute.value);
      element.content = node.value || '';
      for (const child of node.childNodes || []) element.append(convert(child));
      return element;
    };
    const source = convert(parseFragment(markup).childNodes.find((node) => node.tagName === 'div'));
    doc.body.append(source);
    doc.documentElement.setAttribute('data-theme', 'light'); doc.documentElement.setAttribute('data-preset', 'classic');
    const events = new Map();
    class Observer { constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } }
    const win = {
      document: doc, ArchifyAddress: { active: true },
      MutationObserver: Observer, ResizeObserver: Observer,
      getComputedStyle: (element) => ({ display: 'flex', visibility: 'visible', fontFamily: 'system-ui', fontSize: '16px', getPropertyValue: () => doc.documentElement.getAttribute('data-theme') === 'light' ? '#334155' : '#e2e8f0' }),
      addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name, callback) { if (events.get(name) === callback) events.delete(name); },
      Archify: { preset: { cycle() { calls.push('cycle'); } }, exportMenu: { syncRouteShare() {}, syncReachShare() {} } },
    };
    const calls = [];
    source.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      calls.push(button.id || button.getAttribute('data-format') || button.getAttribute('data-action') || button.getAttribute('data-preset-value'));
      if (button.id === 'btn-theme') doc.documentElement.setAttribute('data-theme', doc.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
      if (button.getAttribute('data-preset-value')) doc.documentElement.setAttribute('data-preset', button.getAttribute('data-preset-value'));
    }));
    const state = { diagram: id, frame: { contentDocument: doc, contentWindow: win, getBoundingClientRect: () => ({ top: 0, left: 0 }) } };
    frames.push(state);
    return { state, source, win, calls, events };
  }
  const globals = { document: outer, window: outer, requestAnimationFrame(callback) { callbacks.set(++clock, callback); return clock; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const install = vm.runInNewContext('(' + installAtlasToolbar.toString() + ')', globals);
  const api = install({ onPreferenceChange: (value) => preferences.push(JSON.parse(JSON.stringify(value))) });
  return { api, outer, member, preferences, observers, callbacks, toolbar: () => outer.querySelector('#atlas-toolbar') };
}

test('the full toolbar and focused menu controls retain identity across commits; candidates cannot command it', () => {
  const env = harness(); const root = env.member('root'); const child = env.member('child');
  env.api.attach(root.state); env.api.commit(root.state);
  const toolbar = env.toolbar(); const preset = toolbar.querySelector('#btn-preset');
  preset.click(); const option = toolbar.querySelector('[data-preset-value="blueprint"]'); option.focus();
  env.api.attach(child.state); child.win.ArchifyAddress.active = false;
  assert.equal(child.win.ArchifyToolbarHost.open('export'), false);
  assert.equal(child.win.ArchifyToolbarHost.clipboardWindow(), null);
  assert.equal(root.win.ArchifyToolbarHost.clipboardWindow(), env.outer);
  assert.equal(env.toolbar(), toolbar);
  assert.equal(env.outer.activeElement, option);
  child.win.ArchifyAddress.active = true; root.win.ArchifyAddress.active = false;
  assert.equal(root.win.ArchifyToolbarHost.clipboardWindow(), null);
  env.api.commit(child.state); env.api.detach(root.state);
  assert.equal(child.win.ArchifyToolbarHost.clipboardWindow(), env.outer);
  assert.equal(env.toolbar(), toolbar);
  assert.equal(toolbar.querySelector('#btn-preset'), preset);
  assert.equal(env.outer.activeElement, option);
  option.click();
  assert.deepEqual(root.calls, []);
  assert.deepEqual(child.calls, ['blueprint']);
  assert.equal(env.observers.filter((observer) => observer.connected).length, 2);
  env.api.dispose();
  assert.equal(env.observers.filter((observer) => observer.connected).length, 0);
  assert.equal(env.callbacks.size, 0);
});

test('every authored export format and action dispatches to the committed member with capability state intact', () => {
  const env = harness(); const root = env.member('root'); const child = env.member('child');
  root.source.querySelectorAll('#export-menu')[0].querySelectorAll('button').forEach((button) => { button.hidden = false; button.disabled = false; });
  env.api.attach(root.state); env.api.commit(root.state); env.api.attach(child.state);
  const expected = root.source.querySelector('#export-menu').querySelectorAll('button').map((button) => button.getAttribute('data-format') || button.getAttribute('data-action'));
  env.toolbar().querySelector('#export-menu').querySelectorAll('button').forEach((button) => button.click());
  assert.deepEqual(root.calls, expected);
  assert.deepEqual(child.calls, []);
  assert.ok(expected.includes('webm') && expected.includes('route-share-card') && expected.includes('reach-share-card') && expected.includes('copy'));
  env.api.commit(child.state);
  assert.equal(env.toolbar().querySelector('[data-action="route-share-card"]').hidden, true);
  assert.equal(env.toolbar().querySelector('[data-action="route-share-card"]').disabled, true);
});

test('preparation disables all new exports while appearance controls update shared preferences', () => {
  const env = harness(); const root = env.member('root'); env.api.attach(root.state); env.api.commit(root.state);
  env.toolbar().querySelector('#btn-export').click();
  env.api.setPreparing(true);
  assert.equal(root.win.ArchifyToolbarHost.isOpen('export'), false);
  assert.equal(env.outer.activeElement, env.toolbar().querySelector('#btn-export'));
  assert.equal(env.toolbar().querySelector('#btn-export').disabled, true);
  assert.match(env.toolbar().querySelector('#btn-export').title, /切换完成后/);
  env.toolbar().querySelector('[data-format="png"]').click();
  assert.deepEqual(root.calls, []);
  env.toolbar().querySelector('#btn-theme').click();
  assert.deepEqual(env.preferences, [{ theme: 'dark', preset: 'classic', present: false }]);
  assert.equal(env.outer.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(env.toolbar().style['--toolbar-text'], '#e2e8f0');
  env.api.setPreparing(false);
  env.toolbar().querySelector('[data-format="png"]').click();
  assert.deepEqual(root.calls, ['btn-theme', 'png']);
});

test('menu keyboard navigation and member shortcuts keep focus in the persistent toolbar', () => {
  const env = harness(); const root = env.member('root'); env.api.attach(root.state); env.api.commit(root.state);
  assert.equal(root.win.ArchifyToolbarHost.open('export'), true);
  const available = env.toolbar().querySelector('#export-menu').querySelectorAll('button').filter((button) => !button.hidden && !button.disabled);
  assert.equal(env.outer.activeElement, available[0]);
  available[0].dispatch('keydown', { key: 'End' }); assert.equal(env.outer.activeElement, available.at(-1));
  available.at(-1).dispatch('keydown', { key: 'Escape' });
  assert.equal(env.outer.activeElement, env.toolbar().querySelector('#btn-export'));
  assert.equal(root.win.ArchifyToolbarHost.isOpen('export'), false);
  const input = env.outer.createElement('input'); env.outer.body.append(input);
  input.dispatch('keydown', { key: 't' }); assert.deepEqual(root.calls, []);
  env.toolbar().querySelector('#btn-theme').dispatch('keydown', { key: 't', isComposing: true }); assert.deepEqual(root.calls, []);
  env.toolbar().querySelector('#btn-theme').dispatch('keydown', { key: 't' }); assert.deepEqual(root.calls, ['btn-theme']);
  env.api.commit(null);
  assert.ok(env.toolbar().querySelectorAll('button').every((button) => button.disabled));
  assert.equal(root.win.ArchifyToolbarHost.open('export'), false);
});

test('Atlas export entry points refuse preparation and revoked sessions, then report idle only for started operations', async () => {
  const exportSource = fs.readFileSync(new URL('../../viewer/export.js', import.meta.url), 'utf8');
  const start = exportSource.indexOf('        var pendingExports = 0;');
  const end = exportSource.indexOf('        runExport = trackAtlasExport', start);
  const calls = [], writes = [];
  const context = { Promise, ArchifyAddress: { active: true, exportAllowed: false, send: (type) => calls.push(type) }, document: { documentElement: { setAttribute: (...args) => writes.push(args), removeAttribute: (...args) => writes.push(args) } } };
  const track = vm.runInNewContext(exportSource.slice(start, end) + '\ntrackAtlasExport;', context);
  const run = track(() => calls.push('run'));
  await run(); assert.deepEqual(calls, []); assert.deepEqual(writes, []);
  context.ArchifyAddress.exportAllowed = true; await run(); assert.deepEqual(calls, ['run', 'export-idle']);
  context.ArchifyAddress.active = false; await run(); assert.deepEqual(calls, ['run', 'export-idle']);
  context.ArchifyAddress.active = true; calls.length = 0; writes.length = 0;
  let finish;
  const nested = track(() => new Promise((resolve) => { finish = resolve; }));
  const outer = track(() => nested());
  const pending = outer();
  assert.equal(writes.filter((entry) => entry[1] === 'true').length, 2);
  assert.deepEqual(calls, []);
  finish(); await pending;
  assert.deepEqual(calls, ['export-idle'], 'Nested public export work reports idle only when the outer operation ends');
});

test('staging detects clipboard support without obtaining permission to write through the host', () => {
  const source = fs.readFileSync(new URL('../../viewer/export.js', import.meta.url), 'utf8');
  const start = source.indexOf('      function clipboardWindow()');
  const end = source.indexOf('      // ---- Raster format detection', start);
  let owner = null;
  const outer = { ClipboardItem: class {}, navigator: { clipboard: { write() {} } } };
  const member = { ClipboardItem: class {}, navigator: { clipboard: { write() {} } },
    ArchifyToolbarHost: { clipboardWindow: () => owner } };
  const api = vm.runInNewContext(source.slice(start, end) + '\n({supported:canCopyImage,owner:clipboardWindow})', { window: member });
  assert.equal(api.supported(), true, 'Supported copy actions stay enabled during candidate initialization');
  assert.equal(api.owner(), null, 'Initialization does not grant clipboard write permission');
  owner = outer;
  assert.equal(api.owner(), outer, 'The active member writes through the focused toolbar document');
  delete member.ArchifyToolbarHost;
  assert.equal(api.owner(), member, 'Standalone viewers retain their own clipboard context');
});

test('an admitted export can finish internal work after navigation queues while new public exports are refused', async () => {
  const source = fs.readFileSync(new URL('../../viewer/export.js', import.meta.url), 'utf8');
  const start = source.lastIndexOf("      if (typeof ArchifyAddress !== 'undefined' && ArchifyAddress.context) {", source.indexOf('        var pendingExports = 0;'));
  const end = source.indexOf('      // Auto-open on page load', start);
  for (const format of ['share-card', 'webm']) {
    const calls = [], writes = [];
    let finish;
    const context = {
      Promise, calls, afterStarted: new Promise((resolve) => { finish = resolve; }),
      Archify: {}, ArchifyAddress: { context: { diagram: 'root' }, active: true, exportAllowed: true, send: (type) => calls.push(type) },
      document: { documentElement: { setAttribute: (...args) => writes.push(['set', ...args]), removeAttribute: (...args) => writes.push(['remove', ...args]) } },
    };
    vm.runInNewContext(`
      function rasterizeShareCard() { calls.push('share-card'); return Promise.resolve('share-card-blob'); }
      function recordWebm() { calls.push('webm'); return Promise.resolve('webm-blob'); }
      function runExport(format) {
        return afterStarted.then(function () { return format === 'webm' ? recordWebm() : rasterizeShareCard(); });
      }
      function runRouteShareCard() {} function runReachShareCard() {} function runCopy() {} function runCopyShareCard() {}
      function canRecordMotion() {} function open() {} function close() {} function isOpen() {}
      function syncRouteShareItem() {} function syncReachShareItem() {}
      ${source.slice(start, end)}
    `, context);
    const running = context.Archify.exportMenu.run(format);
    assert.deepEqual(writes, [['set', 'data-atlas-export-busy', 'true']]);
    context.ArchifyAddress.exportAllowed = false;
    await context.Archify.exportMenu.shareCard();
    await context.Archify.motion.recordWebm();
    assert.deepEqual(calls, [], 'Queued navigation prevents new public Blob and recording work');
    finish();
    assert.equal(await running, format + '-blob', 'Previously admitted work keeps access to its internal operations');
    assert.deepEqual(calls, [format, 'export-idle']);
    assert.deepEqual(writes, [['set', 'data-atlas-export-busy', 'true'], ['remove', 'data-atlas-export-busy']]);
    context.ArchifyAddress.exportAllowed = true;
    calls.length = 0;
    const blob = format === 'webm' ? await context.Archify.motion.recordWebm() : await context.Archify.exportMenu.shareCard();
    assert.equal(blob, format + '-blob', 'The same public API is usable after preparation ends');
    assert.deepEqual(calls, [format, 'export-idle']);
  }
});
