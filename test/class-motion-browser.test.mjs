import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('class: hierarchy bus motion follows from-to while retaining aligned visual dashes', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run class motion browser checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-motion-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/payments.class.json'), 'utf8'));
  diagram.meta.animation = 'trace';
  const input = path.join(scratch, 'payments.class.json');
  const output = path.join(scratch, 'payments.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/class/render-class.mjs'), input, output]);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem('archify-motion'); } catch (_) {}` });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href });
  await loaded;
  await run('document.fonts.ready');
  await run('Archify.viewerChromeLayout.whenStable()');
  await run('Archify.motionGovernor.resume()');
  const result = await run(`(() => {
    const edge = document.querySelector('path[data-edge-id="card_implements"]');
    const visual = edge.getAttribute('d'), semantic = edge.getAttribute('data-motion-path');
    const endpoints = pathData => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', pathData);
      const first = path.getPointAtLength(0), last = path.getPointAtLength(path.getTotalLength());
      return [[first.x, first.y], [last.x, last.y]];
    };
    const token = Archify.flowTokens.create(edge, edge);
    Archify.focus.inspectRelationshipById('card_implements', { toggle: false });
    const pulse = document.querySelector('.relationship-flow-pulse').getAttribute('d');
    const animatedToken = document.querySelector('.relationship-flow-token animateMotion').getAttribute('path');
    Archify.focus.clear();
    Archify.intentTrace.show('card_gateway');
    const intent = document.querySelector('.intent-trace-flow').getAttribute('d');
    Archify.intentTrace.clear();
    Archify.semanticLens.select('class');
    const lens = [...document.querySelectorAll('.semantic-lens-flow')].some(path => path.getAttribute('d') === semantic);
    Archify.semanticLens.clear();
    Archify.routeProbe.begin(); Archify.routeProbe.choose('card_gateway'); Archify.routeProbe.choose('payment_gateway');
    const route = document.querySelector('.route-probe-flow').getAttribute('d');
    Archify.routeProbe.selectJourneyIndex(1);
    const journey = document.querySelector('.route-journey-flow').getAttribute('d');
    return { visual, semantic, visualEnds: endpoints(visual), semanticEnds: endpoints(semantic),
      token: token.querySelector('animateMotion').getAttribute('path'), pulse, animatedToken, intent, lens, route, journey,
      original: edge.getAttribute('d'), marker: edge.getAttribute('marker-start') };
  })()`);
  assert.notEqual(result.visual, result.semantic);
  assert.deepEqual(result.visualEnds, [...result.semanticEnds].reverse());
  for (const mode of ['token', 'animatedToken', 'pulse', 'intent', 'route', 'journey']) assert.equal(result[mode], result.semantic, mode);
  assert.equal(result.lens, true);
  assert.equal(result.original, result.visual);
  assert.equal(result.marker, 'url(#cl-triangle-start)');
  const recording = await run(`(async () => {
    Archify.routeProbe.clear();
    const original = SVGGeometryElement.prototype.getPointAtLength;
    const samples = [];
    SVGGeometryElement.prototype.getPointAtLength = function (distance) {
      const point = original.call(this, distance);
      if (this.getAttribute('data-edge-id') === 'card_implements') samples.push({ d: this.getAttribute('d'), x: point.x, y: point.y });
      return point;
    };
    try {
      const blob = await Archify.motion.recordWebm({ duration: 250, fps: 10 });
      return { type: blob.type, size: blob.size, samples };
    } finally { SVGGeometryElement.prototype.getPointAtLength = original; }
  })()`);
  assert.match(recording.type, /^video\/webm/);
  assert.ok(recording.size > 0);
  assert.ok(recording.samples.length > 1);
  assert.ok(recording.samples.every((sample) => sample.d === result.semantic));
  assert.deepEqual([recording.samples[0].x, recording.samples[0].y], result.semanticEnds[0]);
  assert.deepEqual([recording.samples.at(-1).x, recording.samples.at(-1).y], result.semanticEnds[1]);
});

test('class: mixed hierarchy fallback keeps dependency notation in focus and SVG export', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run class motion browser checks.',
  timeout: 60000,
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-bus-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'mixed.class.json');
  const output = path.join(scratch, 'mixed.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'class',
    meta: { title: 'Interface extension and use', animation: 'trace' },
    types: [
      { id: 'base', label: 'Base', kind: 'interface', row: 0, col: 1 },
      { id: 'left', label: 'Left', kind: 'interface', row: 1, col: 0 },
      { id: 'right', label: 'Right', kind: 'interface', row: 1, col: 2 },
      { id: 'client', label: 'Client', kind: 'class', row: 2, col: 1 },
    ],
    relationships: [
      { id: 'left_extends', from: 'left', to: 'base', kind: 'inheritance', via: [] },
      { id: 'right_extends', from: 'right', to: 'base', kind: 'inheritance', via: [] },
      { id: 'client_uses', from: 'client', to: 'base', kind: 'dependency' },
    ],
  }));
  execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'class', input, output, '--quality', 'showcase'], { timeout: 20000 });
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // 只截取下载边界，SVG 序列化和关系交互仍执行产品实现。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.classExports = [];
    const urls = new Map(), create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); urls.set(url, blob); return url; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.download) { classExports.push(urls.get(this.href)); return; }
      return click.call(this);
    };
  ` });
  for (const theme of ['light', 'dark']) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=' + theme });
    await loaded;
    await run('document.fonts.ready');
    await run('Archify.layoutStability.whenStable()');
    await run('Archify.motionGovernor.resume()');
    const result = await run(`(async () => {
      const svg = document.querySelector('.diagram-container svg');
      const paths = root => [...root.querySelectorAll('path[data-edge-id]')].map(path => ({
        id: path.dataset.edgeId, d: path.getAttribute('d'), kind: path.dataset.classRelationship,
        dashed: path.classList.contains('cl-dashed'),
        marker: (path.getAttribute('marker-end') || path.getAttribute('marker-start') || '').match(/#(cl-[\\w-]+)/)?.[1],
        end: path.getAttribute('data-composition-points').split(';').at(-1).split(',').map(Number),
      }));
      const live = paths(svg);
      const dependency = svg.querySelector('path[data-edge-id="client_uses"]');
      Archify.focus.inspectRelationshipById('client_uses', { toggle: false });
      const pulse = document.querySelector('.relationship-flow-pulse')?.getAttribute('d');
      Archify.focus.clear();
      Archify.exportMenu.run('svg');
      const deadline = performance.now() + 5000;
      while (!classExports.length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!classExports.length) throw new Error('Class SVG export did not complete');
      const exported = new DOMParser().parseFromString(await classExports[0].text(), 'image/svg+xml');
      return { live, exported: paths(exported), pulse, dependency: dependency.getAttribute('d') };
    })()`);
    assert.equal(result.live.length, 3);
    assert.deepEqual(result.exported, result.live, `${theme}: 独立 SVG 保留关系路径与符号`);
    const dependency = result.live.find(({ id }) => id === 'client_uses');
    assert.equal(dependency.marker, 'cl-open');
    assert.equal(dependency.dashed, true);
    assert.equal(result.pulse, result.dependency, `${theme}: 聚焦脉冲沿依赖方向运行`);
    for (const inherited of result.live.filter(({ kind }) => kind === 'inheritance')) {
      assert.equal(inherited.marker, 'cl-triangle');
      assert.equal(inherited.dashed, false);
      assert.ok(Math.hypot(inherited.end[0] - dependency.end[0], inherited.end[1] - dependency.end[1]) >= 16);
    }
  }
});

test('class: method parameter delimiters retain visible spaces and tabs', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run class parameter browser checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-parameters-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const parameters = ['value: Literal["a,b"]', 'value: Literal["a, b"]',
    'value: Literal["a,  b"]', 'value: Literal["a,\tb"]', 'value: Literal["a,\t\tb"]', 'a: X,  b: Y'];
  const expected = parameters.map((value, index) => `parse${index}(${value})`);
  const input = path.join(scratch, 'parameters.class.json');
  const output = path.join(scratch, 'parameters.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'class', meta: { title: 'Literal fidelity' },
    types: [
      { id: 'parser', label: 'Parser', kind: 'class', width: 600, row: 0, col: 0,
        methods: parameters.map((value, index) => ({ name: `parse${index}`, parameters: value, returns: 'Result' })) },
      { id: 'narrow', label: 'Narrow', kind: 'class', width: 196, row: 1, col: 0,
        methods: [{ name: 'parse', parameters: 'value: Literal["a,  b"]', returns: 'Result' }] },
    ],
  }));
  execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'class', input, output]);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const theme of ['light', 'dark']) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=' + theme });
    await loaded;
    const result = await send('Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        await Archify.viewerChromeLayout.whenStable();
        const rows = root => [...root.querySelectorAll('text[data-class-member="methods"]')].map(el => ({
          text: el.textContent, characters: el.getNumberOfChars(),
          whitespace: [...el.textContent].flatMap((char, index) => /[ \\t]/.test(char)
            ? [el.getSubStringLength(index, 1)] : []),
        }));
        return { wide: rows(document.querySelector('#node-parser')), narrow: rows(document.querySelector('#node-narrow')) };
      })()`, awaitPromise: true, returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    const { wide, narrow } = result.result.value;
    assert.deepEqual(wide.map(row => row.text), expected);
    const spaceAdvance = wide[1].whitespace.at(-1);
    for (const tabAdvance of [...wide[3].whitespace.slice(-1), ...wide[4].whitespace.slice(-2)]) {
      assert.ok(Math.abs(tabAdvance - spaceAdvance) < 0.1, `${theme}: ${JSON.stringify({ tabAdvance, spaceAdvance })}`);
    }
    assert.equal(narrow.map(row => row.text).join(''), 'parse(value: Literal["a,  b"]): Result');
    for (const row of [...wide, ...narrow]) {
      assert.equal(row.characters, row.text.length, `${theme}: ${JSON.stringify(row)}`);
      assert.ok(row.whitespace.every(advance => advance > 0), `${theme}: ${JSON.stringify(row)}`);
    }
  }
});
