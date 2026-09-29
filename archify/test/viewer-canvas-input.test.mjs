import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Executes the real camera event handlers with deterministic geometry and time.
// This covers input ownership and camera arithmetic, not browser layout or native input.
function cameraFixture({ svgWidth = 1000, svgHeight = 600, width = 1000, height = 600,
  viewWidth = svgWidth, viewHeight = svgHeight, fixed = false, embed = false, wide = false, radar = false, padding = 0, border = 0 } = {}) {
  let now = 0, next = 1;
  const frames = new Map(), timers = new Map();
  const doc = { activeElement: null, hidden: false, title: 'Test diagram' };
  class Element {
    constructor() {
      this.attrs = new Map(); this.listeners = new Map(); this.children = new Map();
      this.hidden = false; this.textContent = ''; this.scrollLeft = 0; this.childNodes = [];
      this.clientHeight = this.offsetHeight = 160; this.offsetWidth = 240;
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n),
        toggle: (n, on) => { if (on ?? !classes.has(n)) classes.add(n); else classes.delete(n); } };
      this.style = { setProperty(n, v) { this[n] = v; }, getPropertyValue(n) { return this[n] || ''; },
        removeProperty(n) { delete this[n]; if (n === 'clip-path') delete this.clipPath; } };
    }
    addEventListener(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); }
    emit(name, data = {}) {
      const e = { target: this, defaultPrevented: false, pointerId: 1, pointerType: 'mouse', button: 0,
        clientX: 100, clientY: 100, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
        stopImmediatePropagation() { this.stopped = true; }, ...data };
      for (const fn of this.listeners.get(name) || []) { fn(e); if (e.stopped) break; }
      return e;
    }
    setAttribute(n, v) { this.attrs.set(n, String(v)); }
    getAttribute(n) { return this.attrs.get(n) ?? null; }
    hasAttribute(n) { return this.attrs.has(n); }
    removeAttribute(n) { this.attrs.delete(n); }
    toggleAttribute(n, on) { if (on) this.setAttribute(n, ''); else this.removeAttribute(n); }
    querySelector(s) { return this.children.get(s) || null; }
    querySelectorAll() { return []; }
    closest(s) { return this.match && s.includes(this.match) ? this : null; }
    insertBefore() {}
    appendChild(child) { this.childNodes.push(child); }
    getScreenCTM() { return { inverse: () => ({}) }; }
    createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; }
    focus() { const previous = doc.activeElement; doc.activeElement = this; if (previous !== this) previous?.emit('blur'); }
    setPointerCapture() {} releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: width, bottom: this.clientHeight, width, height: this.clientHeight }; }
  }
  const container = new Element(), svg = new Element(), root = new Element(), win = new Element();
  const buttons = Object.fromEntries(['in', 'out', 'reset', 'fit-all'].map(n => [n, new Element()]));
  const percent = new Element();
  buttons.reset.children.set('[data-view-percent]', percent);
  for (const [n, el] of Object.entries(buttons)) container.children.set(`[data-view="${n}"]`, el);
  container.children.set('svg', svg); container.children.set(':scope > svg', svg);
  container.clientWidth = width; container.clientHeight = svgHeight;
  container.clientLeft = container.clientTop = border;
  svg.clientWidth = svgWidth; svg.clientHeight = svgHeight;
  // SVGSVGElement has no HTMLElement offsetLeft/offsetTop; model its actual screen box.
  const cameraTransform = () => {
    const m = /translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/.exec(svg.style.transform || '');
    return m ? { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) } : { x: 0, y: 0, scale: 1 };
  };
  svg.getBoundingClientRect = () => {
    const { x, y, scale } = cameraTransform();
    const left = border + padding + x, top = border + padding + y;
    return { left, top, right: left + svgWidth * scale, bottom: top + svgHeight * scale,
      width: svgWidth * scale, height: svgHeight * scale };
  };
  svg.viewBox = { baseVal: { x: 0, y: 0, width: viewWidth, height: viewHeight } };
  if (fixed) root.setAttribute('data-fixed-canvas', '');
  if (embed) root.setAttribute('data-embed', 'true');
  if (wide) container.setAttribute('data-wide-diagram', 'true');
  win.innerWidth = width; win.innerHeight = height;
  win.matchMedia = () => ({ matches: false });
  Object.assign(doc, { documentElement: root, createElement: () => new Element(),
    querySelector: s => s === '.diagram-container' ? container : null });
  const Archify = {};
  const style = el => {
    if (el === svg) {
      const m = /translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/.exec(svg.style.transform || '');
      return { transform: m ? `matrix(${m[3]}, 0, 0, ${m[3]}, ${m[1]}, ${m[2]})` : 'none' };
    }
    return { paddingLeft: String(padding), paddingRight: String(padding), paddingTop: String(padding), paddingBottom: String(padding),
      borderLeftWidth: '0', borderTopWidth: '0', getPropertyValue: n => el.style.getPropertyValue(n) };
  };
  const runtime = {
    Archify, document: doc, window: win, Number, Math, Promise,
    Date: { now: () => now }, getComputedStyle: style, viewerText: key => key,
    requestAnimationFrame: fn => { const id = next++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  win.setTimeout = runtime.setTimeout; win.clearTimeout = runtime.clearTimeout;
  vm.runInNewContext(fs.readFileSync(new URL('../../viewer/viewer-camera.js', import.meta.url), 'utf8'), runtime);
  function frame(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(now));
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  }
  const ids = {};
  if (radar) {
    for (const id of ['overview-map', 'overview-map-surface', 'overview-map-status', 'btn-overview-map',
      'overview-map-close', 'overview-map-expand', 'overview-map-feedback', 'focus-chip']) ids[id] = new Element();
    ids['overview-map'].hidden = ids['focus-chip'].hidden = true;
    ids['overview-map'].children.set('.overview-map-head', new Element());
    doc.getElementById = id => ids[id] || null;
    doc.createElementNS = () => new Element();
    doc.listeners = new Map(); doc.addEventListener = Element.prototype.addEventListener;
    vm.runInNewContext(fs.readFileSync(new URL('../../viewer/semantic-radar.js', import.meta.url), 'utf8'), runtime);
  }
  frame(3);
  return { ids, view: Archify.view, Archify, container, svg, buttons, percent, root, win, doc, frame,
    element: () => new Element(), state: () => JSON.parse(JSON.stringify(Archify.view.state())),
    sizeSvg: (w, h) => { svgWidth = w; svgHeight = h; svg.clientWidth = w; svg.clientHeight = h; },
    resize: (w, h) => { width = w; height = h; container.clientWidth = w; container.clientHeight = h;
      win.innerWidth = w; win.innerHeight = h; win.emit('resize'); frame(5); } };
}

test('right pan owns context menus before movement, during a long drag, and after release', () => {
  const f = cameraFixture();
  const menu = () => f.container.emit('contextmenu', { button: 2 }).defaultPrevented;
  assert.equal(menu(), false, 'an unowned context menu remains native');
  f.container.emit('pointerdown', { button: 2 });
  assert.equal(menu(), true, 'press-time context menus must not interrupt right pan');
  f.frame(60);
  assert.equal(menu(), true, 'holding the button must not expire ownership');
  f.container.emit('pointermove', { clientX: 160 }); f.frame();
  f.container.emit('pointerup', { button: 2 });
  assert.equal(menu(), true, 'release-time context menus must also be suppressed');
  f.frame(30);
  assert.equal(menu(), false, 'suppression must not survive the completed gesture');
  assert.equal(f.state().x, 60);
});

test('unclaimed right input and cancelled holds retain native menus', () => {
  for (const options of [{ embed: true }, { width: 640, wide: true }]) {
    const f = cameraFixture(options);
    f.container.emit('pointerdown', { button: 2 });
    assert.equal(f.container.emit('contextmenu', { button: 2 }).defaultPrevented, false);
  }
  for (const match of ['.diagram-nav', '.fixed-legend', 'input', 'button']) {
    const f = cameraFixture(), target = f.element(); target.match = match;
    f.container.emit('pointerdown', { button: 2, target });
    assert.equal(f.container.emit('contextmenu', { button: 2, target }).defaultPrevented, false);
  }
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    const f = cameraFixture();
    f.container.emit('pointerdown', { button: 2 });
    f.container.emit(end, { button: 2 });
    assert.equal(f.container.emit('contextmenu', { button: 2 }).defaultPrevented, false);
  }
});

test('middle and Space-left pan in all directions and release input ownership', () => {
  for (const button of [1, 2, 0]) {
    for (const [dx, dy] of [[80, 0], [-80, 0], [0, 60], [0, -60]]) {
      const f = cameraFixture(); f.container.focus();
      if (button === 0) f.win.emit('keydown', { key: ' ', target: f.container });
      const down = f.container.emit('pointerdown', { button });
      f.container.emit('pointermove', { clientX: 100 + dx, clientY: 100 + dy }); f.frame();
      f.container.emit('pointerup', { button }); f.frame(2);
      assert.equal(down.defaultPrevented, true, `button ${button}`);
      assert.equal(f.view.state().x, dx); assert.equal(f.view.state().y, dy);
      assert.equal(f.container.classList.contains('is-panning'), false);
      if (button === 0) f.win.emit('keyup', { key: ' ' });
      assert.equal(f.container.classList.contains('is-pan-ready'), false);
    }
  }
});

test('pan key respects editors and controls; cancellation releases the active pointer', () => {
  for (const end of ['pointercancel', 'lostpointercapture', 'blur', 'space-up']) {
    const f = cameraFixture();
    const input = f.element(); input.match = 'input'; input.focus();
    assert.equal(f.win.emit('keydown', { key: ' ', target: input }).defaultPrevented, false);
    f.container.focus(); f.win.emit('keydown', { key: ' ', target: f.container });
    const button = f.element(); button.match = 'button';
    assert.equal(f.container.emit('pointerdown', { button: 0, target: button }).defaultPrevented, false);
    f.container.emit('pointerdown');
    f.container.emit('pointermove', { pointerId: 2, clientX: 900 }); f.frame();
    assert.equal(f.view.state().x, 0, 'other pointers must not move the active drag');
    f.container.emit('pointermove', { clientX: 150 }); f.frame();
    if (end === 'space-up') f.win.emit('keyup', { key: ' ' });
    else f.container.emit(end);
    const stopped = f.state();
    f.container.emit('pointermove', { clientX: 900 }); f.frame(4);
    assert.deepEqual(f.state(), stopped);
    assert.equal(f.container.classList.contains('is-panning'), false);
    const click = f.container.emit('click');
    assert.equal(click.defaultPrevented, true, 'drag completion must not select a node');
    f.win.emit('keyup', { key: ' ' });
    assert.equal(f.container.classList.contains('is-pan-ready'), false);
  }
});

test('fitAll contains a long diagram below 25% and preserves legacy reset', () => {
  const f = cameraFixture({ svgHeight: 6000 });
  assert.equal(typeof f.view.fitAll, 'function');
  f.view.panBy(-200, -400);
  assert.equal(f.view.fitAll(), true);
  const fit = f.state();
  assert.ok(Math.abs(fit.scale - 568 / 6000) < 1e-10);
  assert.ok(Math.abs(fit.x - (1000 - 1000 * fit.scale) / 2) < 1e-8);
  assert.ok(Math.abs(fit.y - 16) < 1e-8);
  assert.equal(fit.mode, 'fit');
  f.view.fitAll(); assert.deepEqual(f.state(), fit);
  f.view.zoomIn();
  assert.ok(f.view.state().scale > fit.scale && f.view.state().scale < 0.25);
  f.view.fit();
  assert.deepEqual(f.state(), { scale: 1, x: 0, y: 0, mode: 'overview' });
});

test('fit responds to resize until manual navigation, including extreme wide and sub-percent views', () => {
  const f = cameraFixture({ svgWidth: 1000000, svgHeight: 600 });
  assert.equal(f.view.fitAll(), true);
  assert.ok(Math.abs(f.view.state().scale - 0.000968) < 1e-12);
  assert.equal(f.percent.textContent, '<1%');
  f.win.innerWidth = 800; f.win.emit('resize'); f.frame(4);
  assert.ok(Math.abs(f.view.state().scale - 0.000768) < 1e-12);
  const before = f.state();
  const world = { x: (300 - before.x) / before.scale, y: (200 - before.y) / before.scale };
  f.view.zoomAt(before.scale * 1.1, 300, 200);
  assert.ok(Math.abs((300 - f.view.state().x) / f.view.state().scale - world.x) < 1e-6);
  assert.ok(Math.abs((200 - f.view.state().y) / f.view.state().scale - world.y) < 1e-6);
  const manual = f.state();
  f.win.innerWidth = 1440; f.win.emit('resize'); f.frame(4);
  assert.deepEqual(f.state(), manual, 'resize must not pull a manually chosen view back to fit');
});

test('invalid or unavailable fitting is a no-op; fit and reset cancel old drags', () => {
  for (const options of [{ viewWidth: 0 }, { viewHeight: Infinity }, { width: 20 }, { embed: true }, { width: 600, wide: true }]) {
    const f = cameraFixture(options), before = f.state();
    assert.equal(f.view.fitAll(), false);
    assert.deepEqual(f.state(), before);
  }
  for (const command of ['fitAll', 'reset']) {
    const f = cameraFixture({ svgHeight: 6000 }); f.container.focus();
    f.container.emit('pointerdown', { button: 1 });
    f.container.emit('pointermove', { clientX: 400 });
    f.view[command](); const takenOver = f.state();
    f.container.emit('pointermove', { clientX: 900 }); f.frame(20);
    assert.deepEqual(f.state(), takenOver);
    assert.equal(f.container.classList.contains('is-panning'), false);
  }
});

test('wheel frames expose live viewport and percentage feedback without full auxiliary sync', () => {
  const f = cameraFixture();
  let full = 0; const live = [];
  f.Archify.radar = { sync: () => full++, syncViewport: () => live.push(f.view.logicalViewport()) };
  f.container.emit('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0 });
  const startingSyncs = full;
  f.frame(2);
  assert.ok(live.length >= 1, 'the active wheel gesture must publish its changing viewport');
  assert.equal(full, startingSyncs, 'steady input frames must not schedule full panel work');
  assert.equal(live.at(-1).scale, f.view.state().scale);
  f.frame(80);
  f.container.emit('wheel', { deltaY: -200, ctrlKey: true, deltaMode: 0 });
  f.frame(2);
  assert.equal(f.percent.textContent, Math.round(f.view.state().scale * 100) + '%');
  const settledSyncs = full;
  f.frame(80); assert.ok(full > settledSyncs);
});

test('real Radar surface handlers preserve scale and a new camera command cancels map dragging', () => {
  for (const scale of [0.5, 1, 2, 0.1]) {
    const f = cameraFixture({ radar: true, svgHeight: 6000 });
    f.view.zoomAt(scale, 0, 0);
    f.Archify.radar.open(); f.frame(3);
    const surface = f.ids['overview-map-surface'];
    surface.emit('pointerdown', { clientX: 400, clientY: 500 });
    surface.emit('pointermove', { clientX: 600, clientY: 800 }); f.frame(2);
    surface.emit('pointerup'); f.frame(3);
    assert.equal(f.view.state().scale, scale);
    surface.emit('keydown', { key: 'ArrowDown' }); f.frame(3);
    assert.equal(f.view.state().scale, scale);
    surface.emit('pointerdown', { clientX: 200, clientY: 100 });
    f.view.reset(); const reset = f.state();
    surface.emit('pointermove', { clientX: 700, clientY: 700 }); f.frame(3);
    assert.deepEqual(f.state(), reset);
    assert.equal(f.ids['overview-map'].hasAttribute('data-dragging'), false);
  }
});

test('open Radar tracks each steady pan frame without measuring its panel; hidden Radar stops writing', () => {
  const f = cameraFixture({ radar: true }); f.Archify.radar.open(); f.frame(3);
  const map = f.ids['overview-map-surface'].childNodes[0], marker = map.childNodes[1];
  f.container.emit('pointerdown', { button: 1 }); f.frame(2);
  const panel = f.ids['overview-map'];
  let reads = 0, writes = 0, statusWrites = 0;
  const status = f.ids['overview-map-status']; let statusText = status.textContent;
  Object.defineProperty(status, 'textContent', { get: () => statusText,
    set: value => { statusWrites++; statusText = value; } });
  const measure = panel.getBoundingClientRect.bind(panel);
  panel.getBoundingClientRect = () => { reads++; return measure(); };
  const set = panel.setAttribute.bind(panel);
  panel.setAttribute = (...args) => { writes++; return set(...args); };
  for (let i = 1; i <= 120; i++) {
    f.container.emit('pointermove', { clientX: 100 - i, clientY: 100 }); f.frame();
    assert.equal(Number(marker.getAttribute('x')), i);
  }
  assert.equal(reads, 0); assert.equal(writes, 0, 'no placement writes during steady frames');
  assert.equal(statusWrites, 0, 'unchanged live-region text must not be rewritten');
  f.container.emit('pointerup'); f.frame(3);
  assert.ok(writes > 0, 'placement sync resumes after the gesture');
  f.Archify.radar.close(); f.frame(3);
  const hiddenMarker = [...marker.attrs];
  f.container.emit('pointerdown', { button: 1 });
  f.container.emit('pointermove', { clientX: 50 }); f.frame(10);
  assert.deepEqual([...marker.attrs], hiddenMarker);
});


test('closing Radar settles its pending drag and removes drag UI state', () => {
  const f = cameraFixture({ radar: true });
  f.view.zoomAt(2, 200, 200); f.Archify.radar.open(); f.frame(3);
  const surface = f.ids['overview-map-surface'];
  surface.emit('pointerdown', { clientX: 300, clientY: 300 });
  surface.emit('pointermove', { clientX: 400, clientY: 400 });
  f.Archify.radar.close(); f.frame(3);
  assert.equal(f.ids['overview-map'].hasAttribute('data-dragging'), false);
  assert.ok(f.svg.style.clipPath?.startsWith('inset('));
  assert.equal(f.container.classList.contains('is-panning'), false);
});

test('releasing Space before the mouse still suppresses the completed drag click', () => {
  const f = cameraFixture(); f.container.focus();
  f.win.emit('keydown', { key: ' ', target: f.container });
  f.container.emit('pointerdown'); f.container.emit('pointermove', { clientX: 200 }); f.frame();
  f.win.emit('keyup', { key: ' ' }); f.frame(20);
  f.container.emit('pointerup');
  assert.equal(f.container.emit('click', { detail: 1 }).defaultPrevented, true);
  f.container.emit('pointerdown'); f.container.emit('pointerup');
  assert.equal(f.container.emit('click', { detail: 1 }).defaultPrevented, false, 'a fresh click remains available');
});

test('fit and pointer zoom use the SVG screen origin with padded, bordered containers', () => {
  const f = cameraFixture({ svgWidth: 934, svgHeight: 600, padding: 32, border: 1 });
  f.view.panBy(-800, 400);
  f.view.fitAll();
  const fit = f.state(), rect = f.svg.getBoundingClientRect();
  const safe = { left: 49, top: 49, right: 952, bottom: 552 };
  assert.ok(rect.left >= safe.left - 0.01 && rect.top >= safe.top - 0.01 &&
    rect.right <= safe.right + 0.01 && rect.bottom <= safe.bottom + 0.01,
    JSON.stringify({ fit, rect, safe }));
  assert.ok(Math.abs((rect.left + rect.right) / 2 - (safe.left + safe.right) / 2) < 0.01);
  assert.ok(Math.abs((rect.top + rect.bottom) / 2 - (safe.top + safe.bottom) / 2) < 0.01);
  const before = f.state();
  const point = { x: (300 - 33 - before.x) / before.scale, y: (200 - 33 - before.y) / before.scale };
  f.view.zoomAt(before.scale * 1.1, 300, 200);
  const after = f.state();
  assert.ok(Math.abs(33 + after.x + point.x * after.scale - 300) < 0.01);
  assert.ok(Math.abs(33 + after.y + point.y * after.scale - 200) < 0.01);
});


test('fixed canvas clips the visible stage during drag and preserves complete fit', () => {
  const f = cameraFixture({ fixed: true, svgHeight: 1300, height: 600 });
  f.view.reset();
  assert.equal(f.svg.style.clipPath, 'inset(0px 0px 700px 0px)');
  f.container.emit('pointerdown', { button: 1 });
  f.container.emit('pointermove', { clientY: -100 }); f.frame();
  assert.equal(f.svg.style.clipPath, 'inset(200px 0px 500px 0px)');
  f.container.emit('pointerup', { button: 1 }); f.frame();
  f.view.fitAll(); f.frame();
  assert.equal(f.svg.style.clipPath, 'inset(0px 0px 0px 0px)');
  const state = f.state();
  assert.ok(state.y >= 0 && state.y + 1300 * state.scale <= 600);
});

// New framing contract: real camera execution, deterministic viewport geometry.
// Actual SVG/CSS sizing and first paint are checked separately in the browser gate.
test('fixed canvas initially fits the complete long diagram without a manual command', () => {
  const f = cameraFixture({ fixed: true, svgHeight: 1300, height: 600 });
  assert.equal(f.state().mode, 'fit');
  assert.ok(Math.abs(f.state().scale - 568 / 1300) < 1e-10);
  const r = f.svg.getBoundingClientRect();
  assert.ok(r.top >= 16 - 1e-6 && r.bottom <= 584 + 1e-6);
});

test('fixed fit does not enlarge a small authored diagram to fill the screen', () => {
  const f = cameraFixture({ fixed: true, svgWidth: 400, svgHeight: 200, width: 1400, height: 900 });
  f.container.clientHeight = 900;
  f.view.fitAll();
  assert.equal(f.state().scale, 1);
  assert.equal(f.state().x, 500); assert.equal(f.state().y, 350);
});

test('fixed manual resize preserves actual scale and the world point at viewport center', () => {
  const f = cameraFixture({ fixed: true, svgWidth: 1200, svgHeight: 800, width: 1440, height: 900 });
  f.view.reset(); f.view.zoomAt(2, 300, 250); f.view.panBy(90, -70);
  const before = f.view.worldViewport(), scale = f.state().scale;
  f.resize(1080, 700);
  const after = f.view.worldViewport();
  assert.equal(f.state().scale, scale);
  assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) < 1e-6,
    JSON.stringify({before, after}));
  assert.ok(Math.abs(before.y + before.height / 2 - after.y - after.height / 2) < 1e-6);
});

test('fixed reading returns after a document-layout round trip without stale gesture work', () => {
  const f = cameraFixture({ fixed:true, svgWidth:1200, svgHeight:800, width:1440, height:900 });
  f.view.reset();f.view.zoomAt(2,300,250);f.view.panBy(-90,70);
  const before=f.view.worldViewport();
  f.root.removeAttribute('data-fixed-canvas');f.resize(1023,599);
  f.root.setAttribute('data-fixed-canvas','');f.resize(1440,900);
  const after=f.view.worldViewport();
  assert.equal(after.scale,before.scale);
  for(const [axis,size] of [['x','width'],['y','height']]) {
    assert.ok(Math.abs(before[axis]+before[size]/2-after[axis]-after[size]/2)<1e-6);
  }
  f.container.emit('pointerdown',{button:1});f.container.emit('pointermove',{clientX:180});f.frame();
  f.resize(1100,700);const settled=f.state();
  f.container.emit('pointermove',{clientX:500});f.frame(10);
  assert.deepEqual(f.state(),settled);
  assert.equal(f.container.classList.contains('is-panning'),false);
});

test('a user reset outside fixed mode invalidates its previous reading snapshot', () => {
  const f = cameraFixture({ fixed:true, svgWidth:1200, svgHeight:800, width:1440, height:900 });
  f.view.zoomAt(2,300,250);f.view.panBy(-90,70);
  f.root.removeAttribute('data-fixed-canvas');f.resize(1023,599);f.view.reset();
  f.root.setAttribute('data-fixed-canvas','');f.resize(1440,900);
  assert.equal(f.state().scale,1);
  assert.equal(f.state().mode,'overview');
});


test('fixed zoom buttons magnify around the visible canvas center even for an enormous SVG', () => {
  const f=cameraFixture({fixed:true,svgWidth:24000,svgHeight:800,width:1440,height:900});
  const before=f.view.worldViewport();f.view.zoomIn();f.frame(3);const after=f.view.worldViewport();
  assert.ok(after.scale>before.scale);
  for(const [axis,size] of [['x','width'],['y','height']]) {
    assert.ok(Math.abs(before[axis]+before[size]/2-after[axis]-after[size]/2)*after.scale<1e-6,
      JSON.stringify({before,after}));
  }
});

test('latest manual reading in document layout survives return to a different SVG base size', () => {
  const f=cameraFixture({fixed:true,svgWidth:1200,svgHeight:800,width:1440,height:900});
  f.view.zoomAt(2,300,250);f.view.panBy(-90,70);
  f.root.removeAttribute('data-fixed-canvas');f.sizeSvg(900,600);f.resize(1023,599);
  f.view.zoomAt(.8,400,300);f.view.panBy(110,-70);
  const before=f.view.worldViewport(),effective=before.scale*.75;
  f.root.setAttribute('data-fixed-canvas','');f.sizeSvg(1200,800);f.resize(1440,900);
  const after=f.view.worldViewport();
  assert.ok(Math.abs(after.scale-effective)<1e-6,JSON.stringify({before,after,effective}));
  for(const [axis,size] of [['x','width'],['y','height']]) {
    assert.ok(Math.abs(before[axis]+before[size]/2-after[axis]-after[size]/2)*after.scale<1e-6);
  }
});

test('subpixel SVG measurement noise does not move an explicit reset camera', () => {
  const f = cameraFixture({ fixed: true, width: 1000, height: 700, svgWidth: 24000, svgHeight: 800 });
  f.view.reset();
  const box = f.svg.getBoundingClientRect;
  f.svg.getBoundingClientRect = () => {
    const rect = box();
    return { ...rect, left: rect.left + .0006, right: rect.right + .0006,
      top: rect.top - .0004, bottom: rect.bottom - .0004 };
  };
  f.win.emit('resize'); f.frame(5);
  assert.deepEqual(f.state(), { scale: 1, x: 0, y: 0, mode: 'overview' });
});

test('fixed semantic framing contains wide selections even below one percent', () => {
  for (const right of [1010, 240000]) {
    const f = cameraFixture({ fixed: true, svgWidth: right + 70, svgHeight: 600,
      width: 630, height: 700, padding: 16, border: 1 });
    f.win.innerWidth = 1024;
    f.doc.getElementById = () => null;
    const boxes = [{ id: 'left', x: 40, y: 300, width: 120, height: 60 },
      { id: 'right', x: right - 130, y: 300, width: 130, height: 60 }];
    f.svg.querySelectorAll = selector => selector === '[data-node-id]'
      ? boxes.map(box => ({ getAttribute: () => box.id, getBBox: () => box })) : [];
    f.view.reveal(['left', 'right'], { instant: true });
    const visible = f.view.worldViewport();
    assert.equal(f.state().mode, 'semantic');
    assert.ok(visible.scale > 0 && visible.scale < 1, JSON.stringify(visible));
    assert.ok(visible.x <= 40 && visible.x + visible.width >= right, JSON.stringify(visible));
    assert.ok(visible.y <= 300 && visible.y + visible.height >= 360, JSON.stringify(visible));
  }
});

test('document semantic framing keeps the legacy 100 percent minimum', () => {
  const f = cameraFixture({ svgWidth: 24000, svgHeight: 600, width: 1000, height: 700 });
  f.doc.getElementById = () => null;
  const boxes = [{ id: 'left', x: 0, y: 300, width: 120, height: 60 },
    { id: 'right', x: 23800, y: 300, width: 130, height: 60 }];
  f.svg.querySelectorAll = selector => selector === '[data-node-id]'
    ? boxes.map(box => ({ getAttribute: () => box.id, getBBox: () => box })) : [];
  f.view.reveal(['left', 'right'], { instant: true });
  assert.equal(f.state().mode, 'semantic');
  assert.equal(f.state().scale, 1);
});

test('fixed canvas grid stays sparse across zoom levels and pan writes only its origin', () => {
  const f = cameraFixture({ fixed: true, width: 1440, height: 900, svgWidth: 200000, svgHeight: 900, viewWidth: 200000, viewHeight: 900 });
  for (const scale of [.001, .01, .05, .1, .24999, .25, .25001, .5, 1, 2, 4]) {
    f.view.zoomAt(scale, 300, 200); f.frame(3);
    const spacing = parseFloat(f.container.style['--archify-grid-minor']);
    assert.ok(spacing >= 24 - .001 && spacing <= 48 + .001, `spacing ${spacing} at ${scale}`);
    const before = { ...f.container.style };
    const writes = [];
    const setProperty = f.container.style.setProperty;
    f.container.style.setProperty = function(name, value) { writes.push(name); setProperty.call(this, name, value); };
    f.view.panBy(-53, 71); f.frame(3);
    f.container.style.setProperty = setProperty;
    assert.ok(writes.filter(name => name.startsWith('--archify-grid-')).every(name => name === '--archify-grid-x' || name === '--archify-grid-y'));
    assert.equal(f.container.style['--archify-grid-minor'], before['--archify-grid-minor']);
    assert.equal(f.container.style['--archify-grid-weight'], before['--archify-grid-weight']);
    assert.ok(Math.abs(parseFloat(f.container.style['--archify-grid-x']) - parseFloat(before['--archify-grid-x']) + 53) < .01);
    assert.ok(Math.abs(parseFloat(f.container.style['--archify-grid-y']) - parseFloat(before['--archify-grid-y']) - 71) < .01);
  }
});
