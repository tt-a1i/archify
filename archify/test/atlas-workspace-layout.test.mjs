import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const readerSource = fs.readFileSync(new URL('../../viewer/reader-layout.js', import.meta.url), 'utf8');

// A controlled DOM-metric contract, not a browser render. Only the existing
// container CSS (max-width and rail margin) is modeled; the real reader owns
// every sizing, docking, content-placement, and overflow decision under test.
// Vertical flow is supplied, so these tests cannot certify rendered SVG fit.
function readerFixture({ width = 1920, height = 1080, viewBox = [1260, 600],
  atlas = true, guidedHeight = 0, cardsHeight = 0, mode = '', print = false,
  paddingLeft = 32, paddingRight = 32 } = {}) {
  const attributes = new Map(mode ? [['data-' + mode, 'true']] : []);
  const variables = new Map();
  const frames = new Map();
  let frameId = 0;
  let bottom = height - 32;
  const html = {
    style: { setProperty: (key, value) => variables.set(key, value), removeProperty: key => variables.delete(key) },
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key), scrollHeight: height, scrollWidth: width,
  };
  function element(name, blockHeight = 0, css = {}) {
    return {
      name, hidden: false, parentNode: null, nextSibling: null, blockHeight,
      css: { display: 'block', marginTop: '0', marginBottom: '0', ...css },
      appendChild(child) { child.parentNode = this; },
      insertBefore(child) { child.parentNode = this; },
      getBoundingClientRect() { return { height: this.blockHeight, width: 0, left: 0, bottom: this.blockHeight }; },
      setAttribute() {},
    };
  }
  const shell = element('shell');
  const body = element('body', height, {
    paddingLeft: String(paddingLeft), paddingRight: String(paddingRight), paddingTop: '32', paddingBottom: '32',
  });
  body.scrollHeight = height;
  body.scrollWidth = width;
  const diagram = element('diagram', 0, { paddingLeft: '15', paddingRight: '15', paddingTop: '40', paddingBottom: '41' });
  const header = element('header', 80);
  const guided = guidedHeight ? element('guided', guidedHeight) : null;
  const cards = cardsHeight ? element('cards', cardsHeight) : null;
  const structure = element('structure', 1200);
  structure.hidden = true;
  if (cards) shell.appendChild(cards);
  const svg = {
    viewBox: { baseVal: { width: viewBox[0], height: viewBox[1] } },
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
  diagram.querySelector = () => svg;
  const elements = { '.container': shell, '.diagram-container': diagram, '.header': header, '.guided-views': guided, '.cards': cards };
  if (atlas) {
    for (const name of ['rail', 'directory-section', 'inspector', 'compact-navigation', 'inspection-slot', 'parent-context', 'overview']) {
      elements['.atlas-' + name] = element(name);
    }
  }
  shell.querySelector = selector => elements[selector];
  shell.getBoundingClientRect = () => {
    const contentWidth = width - paddingLeft - paddingRight;
    const readerWidth = Math.min(contentWidth, parseFloat(variables.get('--archify-reader-width')) || 1440);
    const left = attributes.get('data-atlas-layout') === 'rail'
      ? paddingLeft + parseFloat(variables.get('--atlas-reader-offset'))
      : paddingLeft + (contentWidth - readerWidth) / 2;
    return { width: readerWidth, height: bottom - 32, left, bottom };
  };
  const document = {
    documentElement: html,
    body,
    querySelector: selector => elements[selector],
    getElementById: id => id === 'node-internal-structure' ? structure : null,
    activeElement: null,
  };
  const context = {
    Archify: {}, document,
    window: { innerWidth: width, innerHeight: height, scrollY: 0, getComputedStyle: node => node.css,
      matchMedia: () => ({ matches: print }), addEventListener() {} },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  vm.runInNewContext(readerSource, context, { filename: 'viewer/reader-layout.js' });
  function flush() {
    for (let attempts = 0; frames.size; attempts += 1) {
      assert.ok(attempts < 10, 'reader should settle without an animation-frame loop');
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback());
    }
  }
  flush();
  return {
    width, paddingRight, attributes, variables, shell, cards, structure, elements, document, svg,
    reader: context.Archify.readerLayout, flush,
    measure() { const measured = context.Archify.readerLayout.measure(); flush(); return measured; },
    setOverflow(pixels) { bottom = height - 32 + pixels; },
  };
}

function assertWorkspaceCentered(fixture) {
  assert.equal(fixture.attributes.get('data-atlas-layout'), 'rail');
  const railWidth = parseFloat(fixture.variables.get('--atlas-rail-width'));
  assert.ok(railWidth >= 280 && railWidth <= 304, `rail width ${railWidth} must stay within its desktop budget`);
  const rect = fixture.shell.getBoundingClientRect();
  const leftSpace = rect.left - (16 + railWidth + 20);
  const rightSpace = fixture.width - fixture.paddingRight - rect.left - rect.width;
  assert.ok(leftSpace >= -1 && rightSpace >= -1, `reader must fit the work area: left ${leftSpace}, right ${rightSpace}`);
  assert.ok(Math.abs(leftSpace - rightSpace) <= 1, `work area gutters differ: left ${leftSpace}, right ${rightSpace}`);
  assert.ok(rect.width >= 960, 'docked reader must preserve its minimum readable width');
}

test('overview and child diagrams center in the remaining desktop workspace', () => {
  for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 951], [2048, 1320]]) {
    for (const member of [{ viewBox: [1260, 600] }, { viewBox: [1380, 840], guidedHeight: 57, cardsHeight: 180 }]) {
      const fixture = readerFixture({ width, height, ...member });
      assertWorkspaceCentered(fixture);
      assert.deepEqual(fixture.svg.viewBox.baseVal, { width: member.viewBox[0], height: member.viewBox[1] },
        'workspace adaptation must preserve authored SVG geometry');
    }
  }
});

test('desktop rail eligibility depends on workspace capacity, not member content', () => {
  for (const width of [1307, 1308, 1440, 1920]) {
    for (const guidedHeight of [0, 57, 140]) {
      for (const cardsHeight of [0, 180, 480]) {
        const fixture = readerFixture({ width, guidedHeight, cardsHeight });
        if (width >= 1308) assertWorkspaceCentered(fixture);
        else assert.equal(fixture.attributes.get('data-atlas-layout'), 'stacked');
      }
    }
  }
});

test('selection and relocated overview cards do not change the canonical reading area', () => {
  const fixture = readerFixture({ viewBox: [1380, 840], guidedHeight: 57, cardsHeight: 180 });
  assertWorkspaceCentered(fixture);
  const before = fixture.shell.getBoundingClientRect();
  assert.equal(fixture.cards.parentNode, fixture.elements['.atlas-overview']);
  fixture.elements['.atlas-inspector'].blockHeight = 650;
  fixture.cards.blockHeight = 450;
  fixture.elements['.atlas-compact-navigation'].blockHeight = 90;
  fixture.document.activeElement = { isConnected: true, focus() {} };
  fixture.measure();
  assertWorkspaceCentered(fixture);
  assert.deepEqual(fixture.shell.getBoundingClientRect(), before);
  assert.equal(fixture.cards.parentNode, fixture.elements['.atlas-overview']);
});

test('internal structure height never feeds back into the preserved graph reading width', () => {
  const fixture = readerFixture({ width: 1920, height: 1080, viewBox: [1380, 840], guidedHeight: 57, cardsHeight: 180 });
  const before = fixture.reader.receipt();
  const readerRect = fixture.shell.getBoundingClientRect();
  fixture.attributes.set('data-reader-surface', 'structure');
  fixture.elements['.diagram-container'].hidden = true;
  fixture.elements['.guided-views'].hidden = true;
  fixture.cards.hidden = true;
  fixture.structure.hidden = false;
  const structureMeasure = fixture.measure();
  assert.equal(structureMeasure.surface, 'structure');
  assert.deepEqual(fixture.reader.receipt(), before);
  assert.deepEqual(fixture.shell.getBoundingClientRect(), readerRect);
  assert.equal(fixture.attributes.has('data-reader-overflow'), false);
  fixture.structure.blockHeight = 4000;
  fixture.setOverflow(3000);
  fixture.measure();
  assert.deepEqual(fixture.reader.receipt(), before, 'structure document height must not shrink the hidden graph');
  assert.deepEqual(fixture.svg.viewBox.baseVal, { width: 1380, height: 840 });
  fixture.attributes.set('data-reader-surface', 'graph');
  fixture.elements['.diagram-container'].hidden = false;
  fixture.elements['.guided-views'].hidden = false;
  fixture.cards.hidden = false;
  fixture.setOverflow(0);
  fixture.structure.hidden = true;
  fixture.measure();
  assert.deepEqual(fixture.reader.receipt(), before);
  assert.deepEqual(fixture.shell.getBoundingClientRect(), readerRect);
});

test('overflow reduction keeps the reader centered in its reserved workspace', () => {
  const fixture = readerFixture({ width: 2048, height: 1320 });
  assertWorkspaceCentered(fixture);
  const widthBefore = fixture.shell.getBoundingClientRect().width;
  fixture.setOverflow(70);
  fixture.measure();
  assert.equal(fixture.attributes.get('data-reader-overflow'), 'reduced');
  assert.ok(fixture.shell.getBoundingClientRect().width < widthBefore);
  assertWorkspaceCentered(fixture);
  assert.deepEqual(fixture.svg.viewBox.baseVal, { width: 1260, height: 600 });
});

test('workspace centering respects unequal body padding', () => {
  assertWorkspaceCentered(readerFixture({ paddingLeft: 48, paddingRight: 72 }));
});

test('Atlas square and portrait members retain their existing document-flow layout', () => {
  for (const viewBox of [[840, 840], [840, 1380]]) {
    const fixture = readerFixture({ viewBox, cardsHeight: 180 });
    assert.equal(fixture.reader.active(), false);
    assert.equal(fixture.variables.has('--archify-reader-width'), false);
    assert.equal(fixture.attributes.get('data-atlas-layout'), 'stacked');
    assert.equal(fixture.cards.parentNode, fixture.shell);
    assert.deepEqual(fixture.svg.viewBox.baseVal, { width: viewBox[0], height: viewBox[1] });
  }
});

test('compact, embed, presentation and print retain document-flow behavior', () => {
  for (const options of [{ width: 720 }, { width: 1023 }, { mode: 'embed' }, { mode: 'present' }, { print: true }]) {
    const fixture = readerFixture({ cardsHeight: 180, ...options });
    assert.equal(fixture.reader.active(), false);
    assert.equal(fixture.variables.has('--archify-reader-width'), false);
    assert.equal(fixture.attributes.get('data-atlas-layout'), 'stacked');
    assert.equal(fixture.cards.parentNode, fixture.shell);
  }
});

test('standalone diagrams keep adaptive viewport centering without an Atlas reservation', () => {
  const fixture = readerFixture({ atlas: false });
  assert.equal(fixture.reader.active(), true);
  assert.equal(fixture.attributes.has('data-atlas-layout'), false);
  const rect = fixture.shell.getBoundingClientRect();
  assert.equal(rect.left + rect.width / 2, fixture.width / 2);
  assert.ok(rect.width > 1440, 'standalone wide diagrams retain the available height budget');
  assert.equal(fixture.variables.has('--atlas-reader-offset'), false);
  assert.equal(readerFixture({ atlas: false, viewBox: [840, 1380] }).reader.active(), false);
});
