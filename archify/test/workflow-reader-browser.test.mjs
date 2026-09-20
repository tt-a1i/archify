import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function fixture() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Reader clock regression',
      locale: 'en',
      quality_profile: 'showcase',
      rules: [{
        id: 'clock', kind: 'accumulate',
        seeds: { l1: { start: 'a', base: '09:00' } },
        add: { node: 'stay', edge: 'ride' },
        render: { edge: '{value} ' },
      }],
      reader: {
        slots: [{ id: 'here', kind: 'point', label: 'Here' }, { id: 'at', kind: 'time', label: 'At' }],
        clock: { rule: 'clock', anchor: 'here', at: 'at' },
      },
    },
    lanes: [{ id: 'l1', label: 'First lane' }, { id: 'l2', label: 'Other lane' }],
    nodes: [
      { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'Start', width: 120, facts: { stay: 15 } },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'Middle', width: 120, facts: { stay: 20 } },
      { id: 'c', lane: 'l1', col: 2, type: 'database', label: 'End', width: 120, facts: { stay: 10 } },
      { id: 'd', lane: 'l2', col: 3, type: 'cloud', label: 'Other', width: 120, facts: { stay: 5 } },
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: 'one', facts: { ride: 30 } },
      { id: 'bc', from: 'b', to: 'c', label: 'two', facts: { ride: 30 } },
    ],
    cards: [],
  };
}

test('workflow clocks preserve the compiled contract in the real reader', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser workflow reader checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-reader-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.readerErrors=[];
      addEventListener('error',event=>readerErrors.push(event.message));
      addEventListener('unhandledrejection',event=>readerErrors.push(String(event.reason)));`,
  });
  t.afterEach(async () => assert.deepEqual(await run('readerErrors'), []));

  let sequence = 0;
  async function load(document) {
    const input = path.join(scratch, `${++sequence}.json`);
    const output = path.join(scratch, `${sequence}.html`);
    // Reader persistence uses the title, so each case needs its own document
    // identity even when its fields otherwise match another case.
    document.meta.title += ` ${sequence}`;
    fs.writeFileSync(input, JSON.stringify(document));
    execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'workflow', input, output]);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(output).href });
    await loaded;
    await run('document.fonts.ready');
    await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function labels() {
    return run(`Object.fromEntries([...document.querySelectorAll('svg g[data-edge-from][data-edge-to]')]
      .map(group => [group.dataset.edgeId, [...group.querySelectorAll('text')].map(text => text.textContent)]))`);
  }
  async function arriveAt(time) {
    await run(`Archify.focus.set('b', {toggle:false})`);
    assert.equal(await run(`new Promise(resolve => {
      const deadline=Date.now()+3000;
      function ready() {
        const button=[...document.querySelectorAll('[data-reader-block] button')].find(el=>el.textContent==='Here');
        if(button) { button.click(); resolve(true); }
        else if(Date.now()>deadline) resolve(false);
        else setTimeout(ready,20);
      }
      ready();
    })`), true, 'the reader must offer its declared anchor control');
    await run(`(() => {
      const input=document.querySelector('[data-reader-block] input[type="time"]');
      input.value=${JSON.stringify(time)};
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  }

  await t.test('clock-only declaration applies and resets an arrival time', async () => {
    await load(fixture());
    await arriveAt('12:00');
    const changed = await labels();
    assert.equal(changed.ab[0], '09:45 one', 'the upstream leg retains its plan');
    assert.equal(changed.bc[0], '12:50 two', '12:00 + 20 stay + 30 ride');
    await run(`[...document.querySelectorAll('[data-reader-block] button')].find(el=>el.textContent==='Back to plan').click()`);
    assert.equal((await labels()).bc[0], '10:35 two');
  });

  for (const scope of ['lane', 'chain']) {
    await t.test(`${scope} scope retains the same cross-lane boundary on load and edit`, async () => {
      const document = fixture();
      // Keep this independent of the clock-only regression.
      document.meta.reader.view = { solo: true };
      if (scope === 'chain') document.meta.rules[0].scope = scope;
      document.edges.push({ id: 'cd', from: 'c', to: 'd', label: 'cross', facts: { ride: 30 } });
      await load(document);
      assert.equal((await labels()).cd[0], scope === 'chain' ? '11:15 cross' : 'cross');
      await arriveAt('12:00');
      assert.equal((await labels()).cd[0], scope === 'chain' ? '13:30 cross' : 'cross');
    });
  }

  for (const [locale, override, expected] of [
    ['en', null, '30 min'],
    ['zh-CN', null, '30 分'],
    ['en', 'Travel {value} minutes', 'Travel 30 minutes'],
  ]) {
    await t.test(`default caption follows ${locale}${override ? ' label override' : ''} after replay`, async () => {
      const document = fixture();
      document.meta.locale = locale;
      document.meta.reader.view = { solo: true };
      if (override) document.meta.labels = { 'workflow.leg.cost': override };
      await load(document);
      assert.equal((await labels()).bc[1], expected);
      await arriveAt('12:00');
      assert.equal((await labels()).bc[1], expected);
    });
  }

  await t.test('authored value, band and minute templates survive edits and midnight wrapping', async () => {
    const document = fixture();
    document.meta.reader.view = { solo: true };
    document.meta.rules[0].render.caption = '{band} {minutes}m {value}';
    document.meta.rules[0].wrap = { at: 1440, label: 'next ' };
    document.meta.bands = [
      { label: 'AM', from: '00:00', to: '11:59' },
      { label: 'PM', from: '12:00', to: '22:59' },
      { label: 'Late', from: '23:00', to: '02:00' },
    ];
    await load(document);
    assert.equal((await labels()).bc[1], 'AM 30m 10:35');
    await arriveAt('12:00');
    assert.equal((await labels()).bc[1], 'PM 30m 12:50');
    await arriveAt('23:30');
    assert.equal((await labels()).bc[0], 'next 00:20 two');
    assert.equal((await labels()).bc[1], 'Late 30m next 00:20');
  });
});
