import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function payloadSequence() {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Checkout payload review', output: 'payload.html' },
    participants: [
      { id: 'web', label: 'Web', type: 'frontend' },
      { id: 'api', label: 'Checkout API', type: 'backend' },
      { id: 'pay', label: 'Payments', type: 'security' },
    ],
    messages: [
      {
        id: 'm-create', from: 'web', to: 'api', y: 180, label: 'POST /checkout', change: 'modified',
        payload: {
          summary: 'Adds idempotency key and drops legacy coupon field',
          contentType: 'application/json',
          before: { cart: 'c-1', coupon: 'SAVE10', total: 4200, currency: 'USD' },
          after: { cart: 'c-1', idempotencyKey: 'ik-9', total: 4300, currency: 'USD' },
        },
      },
      { id: 'm-charge', from: 'api', to: 'pay', y: 250, label: 'charge()', payload: { sample: { amount: 4300, method: 'card' } } },
      {
        id: 'm-ok', from: 'pay', to: 'api', y: 320, label: '201 Created', variant: 'return',
        payload: { summary: 'Response now carries receipt id', after: { status: 'ok', receiptId: 'r-1' } },
      },
      { id: 'm-done', from: 'api', to: 'web', y: 390, label: '200 OK', variant: 'return' },
    ],
  };
}

async function openViewer(t, output, query) {
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.pageErrors=[];addEventListener('error',e=>pageErrors.push(e.message));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href + query });
  await loaded;
  await checkPointer();
  await run('document.fonts.ready');
  await run('Archify.viewerChromeLayout.whenStable()');
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const key = async (name, code, virtualKey) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey });
    await settle();
  };
  const clickSelector = async (selector) => {
    const point = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert.ok(point.x > 0 && point.y > 0, JSON.stringify(point));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await settle();
  };
  const payloadState = () => run(`(() => {
    const section = document.getElementById('focus-payload');
    const chip = document.getElementById('focus-chip');
    const rows = [...section.querySelectorAll('.semantic-passport-payload-field')].map((row) => ({
      diff: row.getAttribute('data-diff'),
      path: row.querySelector('.semantic-passport-payload-path').textContent,
      value: row.querySelector('.semantic-passport-payload-value').textContent,
      folded: !!row.closest('details'),
      color: getComputedStyle(row.querySelector('.semantic-passport-payload-sign')).color,
    }));
    const chipRect = chip.getBoundingClientRect();
    const svgRect = document.querySelector('.diagram-container > svg').getBoundingClientRect();
    return {
      hidden: section.hidden,
      mode: section.getAttribute('data-payload-mode'),
      role: document.getElementById('focus-payload-role').textContent,
      type: document.getElementById('focus-payload-type').textContent,
      summary: document.getElementById('focus-payload-summary').textContent,
      status: document.getElementById('focus-payload-status').textContent,
      rows,
      foldOpen: section.querySelector('details') ? section.querySelector('details').open : null,
      chipHidden: chip.hidden,
      chipWithinViewport: chipRect.left >= 0 && chipRect.right <= innerWidth && chipRect.top >= 0 && chipRect.bottom <= innerHeight,
      canvasVisible: svgRect.width > chipRect.width * 1.5,
      pinned: Archify.focus.relationship ? Archify.focus.relationship() : null,
      focused: document.activeElement && (document.activeElement.id || document.activeElement.getAttribute('data-relationship-key')),
      svgText: document.querySelector('.diagram-container > svg').outerHTML,
      errors: pageErrors,
    };
  })()`);
  return { send, run, settle, key, clickSelector, payloadState };
}

test('Semantic Passport shows a before/after field diff for a pinned payload message', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser passport payload checks.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-passport-payload-'));
  const input = path.join(scratch, 'payload.json');
  const output = path.join(scratch, 'payload.html');
  fs.writeFileSync(input, JSON.stringify(payloadSequence()));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, output]);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /<script id="archify-payloads-data" type="application\/json">/);

  const viewer = await openViewer(t, output, '?theme=dark&keep=yes');
  const { run, key, clickSelector, payloadState } = viewer;

  const idle = await payloadState();
  assert.equal(idle.hidden, true, 'no payload section before a relationship is pinned');
  assert.doesNotMatch(idle.svgText, /SAVE10|idempotencyKey|receiptId/, 'payload values never enter the SVG');

  await clickSelector('[data-relationship-hit-key][data-relationship-id="m-create"]');
  const diff = await payloadState();
  assert.equal(diff.chipHidden, false);
  assert.equal(diff.hidden, false, 'clicking a payload-bearing message opens the payload section');
  assert.equal(diff.mode, 'diff');
  assert.equal(diff.role, 'Request');
  assert.equal(diff.type, 'application/json');
  assert.equal(diff.summary, 'Adds idempotency key and drops legacy coupon field');
  assert.equal(diff.status, '1 added · 1 removed · 1 changed · 2 unchanged');
  const visible = diff.rows.filter((row) => !row.folded);
  assert.deepEqual(visible.map((row) => [row.diff, row.path, row.value]), [
    ['removed', 'coupon', '"SAVE10"'],
    ['modified', 'total', '4200 → 4300'],
    ['added', 'idempotencyKey', '"ik-9"'],
  ]);
  assert.deepEqual(diff.rows.filter((row) => row.folded).map((row) => row.path), ['cart', 'currency']);
  assert.equal(diff.foldOpen, false, 'unchanged fields are folded by default');
  const colours = new Set(visible.map((row) => row.color));
  assert.equal(colours.size, 3, 'added, removed, and modified use three distinct sign colours: ' + [...colours].join(' | '));
  assert.equal(diff.chipWithinViewport, true, 'the passport stays within the viewport');
  assert.equal(diff.canvasVisible, true, 'the passport does not cover the canvas');
  assert.equal(diff.pinned && diff.pinned.id, 'm-create');

  if (process.env.ARCHIFY_TEST_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.ARCHIFY_TEST_EVIDENCE_DIR, { recursive: true });
    const capture = await viewer.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(process.env.ARCHIFY_TEST_EVIDENCE_DIR, 'passport-payload-diff-dark.png'), Buffer.from(capture.data, 'base64'));
  }

  await run(`document.getElementById('focus-payload-body').focus()`);
  assert.equal((await payloadState()).focused, 'focus-payload-body', 'the payload body is keyboard focusable');

  assert.equal(await run(`Archify.focus.inspectRelationshipById('m-ok')`), true);
  const afterOnly = await payloadState();
  assert.equal(afterOnly.mode, 'after');
  assert.equal(afterOnly.role, 'Response', 'return messages are labelled as responses');
  assert.deepEqual(afterOnly.rows.map((row) => [row.diff, row.path, row.value]), [
    ['unchanged', 'receiptId', '"r-1"'],
    ['unchanged', 'status', '"ok"'],
  ]);

  assert.equal(await run(`Archify.focus.inspectRelationshipById('m-charge')`), true);
  const sample = await payloadState();
  assert.equal(sample.mode, 'sample');
  assert.equal(sample.rows.length, 2);

  assert.equal(await run(`Archify.focus.inspectRelationshipById('m-done')`), true);
  const bare = await payloadState();
  assert.equal(bare.hidden, true, 'messages without a payload hide the section');
  assert.equal(bare.chipHidden, false);

  await run(`Archify.focus.set('api')`);
  assert.equal((await payloadState()).hidden, true, 'node focus never shows a payload');

  await run(`Archify.motionGovernor.pause()`);
  assert.equal(await run(`Archify.focus.inspectRelationshipById('m-create')`), true);
  const still = await payloadState();
  assert.equal(still.mode, 'diff', 'Still mode keeps the payload diff available');
  await key('Escape', 'Escape', 27);
  const escaped = await payloadState();
  assert.equal(escaped.hidden, true, 'Escape clears the pin and the payload section');
  assert.deepEqual(escaped.errors, []);
});

test('payload diff keeps the same structure and distinct colours across themes and presets', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser passport payload checks.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-passport-payload-themes-'));
  const diagram = payloadSequence();
  const input = path.join(scratch, 'payload.json');
  const output = path.join(scratch, 'payload.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, output]);
  const viewer = await openViewer(t, output, '?theme=light&keep=yes');
  const { run, payloadState } = viewer;
  const seen = [];
  for (const theme of ['light', 'dark']) {
    for (const preset of ['classic', 'signal-flow', 'blueprint', 'editorial']) {
      await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); document.documentElement.setAttribute('data-preset', ${JSON.stringify(preset)});`);
      await run(`Archify.focus.clear(); Archify.focus.inspectRelationshipById('m-create')`);
      const state = await payloadState();
      assert.equal(state.mode, 'diff', `${theme}/${preset}`);
      const visible = state.rows.filter((row) => !row.folded);
      assert.deepEqual(visible.map((row) => row.diff), ['removed', 'modified', 'added'], `${theme}/${preset}`);
      assert.equal(new Set(visible.map((row) => row.color)).size, 3, `${theme}/${preset} keeps three distinct sign colours`);
      assert.equal(state.chipWithinViewport, true, `${theme}/${preset}`);
      seen.push(`${theme}/${preset}`);
    }
  }
  assert.equal(seen.length, 8);
  assert.deepEqual((await payloadState()).errors, []);
});
