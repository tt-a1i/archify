import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installAtlasWorkbench } from '../renderers/shared/atlas-workbench.mjs';

// This exercises real host control ownership, focus, and member bindings. The
// synthetic rectangles are not evidence about browser layout or paint timing.
function fixture() {
  let observers = 0;
  class Element {
    constructor(tag, owner) {
      this.tagName = tag; this.ownerDocument = owner; this.children = []; this.dataset = {};
      this.attributes = new Map(); this.events = new Map(); this.value = ''; this.scrollTop = 0; this.scrollHeight = 700;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.rect = { left: 16, top: 100, width: 280, height: 36 };
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
    removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
    fire(name, details = {}) { for (const callback of this.events.get(name) || []) callback({ target: this, ...details }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { this.ownerDocument.activeElement = this; }
    getBoundingClientRect() { return this.rect; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  }
  function document() {
    const doc = { createElement: tag => new Element(tag, doc) };
    doc.head = doc.createElement('head'); doc.body = doc.createElement('body'); doc.documentElement = doc.createElement('html'); doc.activeElement = doc.body;
    return doc;
  }
  const doc = document();
  const window = new Element('window', doc); window.innerHeight = 900;
  let nextFrame = 0;
  const frames = new Map();
  const navigations = [];
  let invalidations = 0;
  const bundle = { entry: 'system', meta: { locale: 'en' },
    members: { system: { title: 'System' }, child: { title: 'Child' }, leaf: { title: 'Leaf' } },
    details: [{ from: { diagram: 'system' }, to: 'child' }, { from: { diagram: 'child' }, to: 'leaf' }] };
  const host = vm.runInNewContext(`(${installAtlasWorkbench.toString()})`, {
    document: doc, window,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }
  })({ bundle, navigate: id => navigations.push(id), onLayoutChange: () => { invalidations++; } });
  function find(predicate, parent = doc.body) { if (predicate(parent)) return parent; for (const child of parent.children) { const match = find(predicate, child); if (match) return match; } }
  function flush() { const scheduled = Array.from(frames.values()); frames.clear(); for (const callback of scheduled) callback(); }
  function member(diagram, { mode = 'rail', left = 16, top = 100 } = {}) {
    const memberDoc = document(); memberDoc.documentElement.setAttribute('data-atlas-layout', mode);
    const slot = memberDoc.createElement('section'); slot.rect = { left, top, width: 280, height: 36 };
    const brand = memberDoc.createElement('div'); brand.rect = { left: 16, top: 24, width: 280, height: 48 };
    memberDoc.querySelector = selector => selector === '.atlas-directory-section' ? slot : brand;
    class Observer { constructor(callback) { this.callback = callback; this.live = true; observers++; } observe() {} disconnect() { if (this.live) { this.live = false; observers--; } } }
    const win = new Element('window', memberDoc); win.innerWidth = 1440; win.MutationObserver = Observer; win.ResizeObserver = Observer;
    win.getComputedStyle = () => ({ getPropertyValue: () => '' });
    win.Archify = { readerLayout: { schedule() {} } };
    const frame = doc.createElement('iframe'); frame.rect = { left: 0, top: 0 };
    frame.contentDocument = memberDoc; frame.contentWindow = win;
    const opens = [];
    const state = { frame, diagram, navigation: { setDirectoryOpen(value) { opens.push(value); } } };
    return { state, slot, opens, win, memberDoc };
  }
  return { host, doc, find, member, flush, navigations, observers: () => observers, invalidations: () => invalidations };
}

test('persistent directory keeps identity, query, selection, scroll and focus through preparation and commits', () => {
  const f = fixture();
  const root = f.find(node => node.id === 'atlas-workbench');
  const search = f.find(node => node.id === 'atlas-directory-search');
  const directory = f.find(node => node.id === 'atlas-directory');
  const brand = f.find(node => node.className === 'atlas-host-brand');
  const a = f.member('system'); f.host.attach(a.state); f.host.commit(a.state); f.host.openDirectory(true);
  search.value = 'Child'; search.selectionStart = 1; search.selectionEnd = 4; search.focus(); search.fire('input'); directory.scrollTop = 130;
  const b = f.member('child', { top: 180 }); f.host.attach(b.state); f.flush();
  assert.equal(f.find(node => node.dataset.atlasDiagram === 'system').getAttribute('aria-current'), 'page');
  assert.equal(f.find(node => node.className === 'atlas-host-directory-section').style.top, '100px', 'candidate geometry must not change the committed controls');
  f.host.commit(b.state); f.host.detach(a.state);
  assert.equal(f.find(node => node.id === 'atlas-workbench'), root);
  assert.equal(f.find(node => node.id === 'atlas-directory-search'), search);
  assert.equal(f.find(node => node.className === 'atlas-host-brand'), brand);
  assert.equal(search.value, 'Child'); assert.equal(search.selectionStart, 1); assert.equal(search.selectionEnd, 4);
  assert.equal(directory.scrollTop, 130); assert.equal(f.doc.activeElement, search);
  assert.equal(b.opens.at(-1), true);
  assert.equal(f.find(node => node.dataset.atlasDiagram === 'child').getAttribute('aria-current'), 'page');
  f.host.dispose(); assert.equal(f.observers(), 0);
});

test('same-diagram clicks reach the shell without resetting shared directory state', () => {
  const f = fixture(); const a = f.member('system'); f.host.attach(a.state); f.host.commit(a.state);
  f.host.openDirectory(true);
  const search = f.find(node => node.id === 'atlas-directory-search'); search.value = 'System';
  f.find(node => node.dataset.atlasDiagram === 'system').fire('click');
  assert.deepEqual(f.navigations, ['system']);
  assert.equal(f.find(node => node.id === 'atlas-directory').hidden, false);
  assert.equal(search.value, 'System');
});

test('only commit changes current item; clearing an invalid current keeps directory navigation available', () => {
  const f = fixture(); const a = f.member('system'); const b = f.member('child');
  f.host.attach(a.state); f.host.commit(a.state); f.host.attach(b.state);
  const rootLink = f.find(node => node.dataset.atlasDiagram === 'system'); const childLink = f.find(node => node.dataset.atlasDiagram === 'child');
  assert.equal(rootLink.getAttribute('aria-current'), 'page'); assert.equal(childLink.getAttribute('aria-current'), null);
  f.host.setStatus('Opening Child'); assert.equal(f.find(node => node.className === 'atlas-host-status').textContent, 'Opening Child');
  f.host.commit(null); f.host.setStatus('');
  assert.equal(rootLink.getAttribute('aria-current'), null); assert.equal(childLink.getAttribute('aria-current'), null);
  assert.equal(f.find(node => node.className === 'atlas-host-status').textContent, '');
  childLink.fire('click'); assert.deepEqual(f.navigations, ['child']);
});

test('compact directory reserves its expanded height and native workbench focus wins over visit focus', () => {
  const f = fixture(); const a = f.member('system', { mode: 'stacked' });
  f.host.attach(a.state); f.host.commit(a.state);
  assert.equal(a.slot.style.height, '36px');
  f.host.openDirectory(true); assert.equal(a.slot.style.height, '336px');
  f.host.openDirectory(false); assert.equal(a.slot.style.height, '36px');
  const toolbar = f.doc.createElement('button'); f.doc.body.append(toolbar); toolbar.focus();
  assert.equal(f.host.canRestoreFocus(a.state.frame), false);
  f.doc.activeElement = a.state.frame; assert.equal(f.host.canRestoreFocus(a.state.frame), true);
  f.find(node => node.id === 'atlas-directory-search').focus(); assert.equal(f.host.hasFocus(), true);
  assert.equal(f.host.canRestoreFocus(a.state.frame), false);
});

test('a compact candidate cannot use the committed directory allocation as feedback for its own height', () => {
  const f = fixture(); const a = f.member('system'); const b = f.member('child', { mode: 'stacked' });
  f.host.attach(a.state); f.host.commit(a.state); f.host.openDirectory(true);
  const directory = f.find(node => node.id === 'atlas-directory');
  // Browser scrollHeight includes the currently allocated client area. In the
  // reported process, a 39px toggle was budgeted as 36px, creating a -3px loop.
  Object.defineProperty(directory, 'scrollHeight', { configurable: true, get() {
    return Math.max(220, Number.parseFloat(b.slot.style.height || '801') - 39);
  } });
  f.host.attach(b.state);
  const prepared = b.slot.style.height;
  f.host.commit(b.state);
  for (let index = 0; index < 6; index++) { f.host.sync(); b.win.fire('scroll'); f.flush(); }
  assert.equal(b.slot.style.height, prepared, 'ready dimensions must remain fixed when the same directory is committed and observed');
  assert.equal(prepared, '336px');
});

test('member binding observers and listeners return to baseline after repeated visits', () => {
  const f = fixture(); let active = f.member('system'); f.host.attach(active.state); f.host.commit(active.state);
  const baseline = f.observers();
  for (let index = 0; index < 20; index++) {
    const next = f.member(index % 2 ? 'system' : 'child'); f.host.attach(next.state); f.host.commit(next.state);
    f.host.detach(active.state);
    assert.equal(active.win.events.get('scroll').size, 0); assert.equal(active.win.events.get('resize').size, 0);
    assert.equal(f.observers(), baseline); active = next;
  }
  f.host.dispose(); assert.equal(f.observers(), 0);
});

test('shared directory geometry invalidates pending readiness only when its candidate slot changes', () => {
  const f = fixture(); const a = f.member('system'); const b = f.member('child', { mode: 'stacked' });
  f.host.attach(a.state); f.host.commit(a.state); f.host.attach(b.state);
  assert.equal(f.invalidations(), 0, 'initial attach establishes the slot without restarting readiness');
  f.host.openDirectory(true); assert.equal(f.invalidations(), 1);
  f.host.openDirectory(true); assert.equal(f.invalidations(), 1, 'unchanged shared state is not an invalidation');
  const directory = f.find(node => node.id === 'atlas-directory'); directory.scrollHeight = 160;
  f.find(node => node.id === 'atlas-directory-search').fire('input');
  assert.equal(f.invalidations(), 1, 'filtering changes content inside the fixed viewport without changing candidate layout');
  f.host.sync(); f.flush(); assert.equal(f.invalidations(), 1, 'observer reconciliation cannot create a restart loop');
  f.host.commit(b.state); f.host.detach(a.state); f.host.openDirectory(false);
  assert.equal(f.invalidations(), 1, 'changing only the committed slot does not invalidate a nonexistent candidate');
});
