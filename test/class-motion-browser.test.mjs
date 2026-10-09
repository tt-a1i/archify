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
