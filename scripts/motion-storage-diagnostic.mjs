import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

// Diagnostic only: observations are printed even when storage is lost. This is
// not a replacement for the failing product assertion or a CI acceptance gate.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-minimal-'));
const plain = path.join(scratch, 'plain.html');
const viewer = path.join(scratch, 'viewer.html');
fs.writeFileSync(plain, '<!doctype html><html><head><title>Storage control</title></head><body>Storage control</body></html>');
const input = JSON.parse(fs.readFileSync('archify/examples/web-app.architecture.json'));
input.meta.animation = 'trace';
const inputFile = path.join(scratch, 'viewer.json');
fs.writeFileSync(inputFile, JSON.stringify(input));
execFileSync(process.execPath, ['archify/renderers/architecture/render-architecture.mjs', inputFile, viewer]);
const padded = path.join(scratch, 'padded.html');
fs.writeFileSync(padded, '<!doctype html><html><head><title>Padded control</title></head><body>' + 'x'.repeat(fs.statSync(viewer).size) + '</body></html>');
const results = [];
try {
  for (const documentKind of ['padded', 'viewer']) for (const earlyRead of [false, true]) for (const prelude of [0, 6]) {
    const product = documentKind === 'viewer';
    const browser = new ChromeVisualBrowser(findChrome());
    try {
      const session = await browser.sessionPromise;
      const send = (method, params = {}) => browser.cdp.send(method, params, session);
      const run = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const result = { documentKind, product, earlyRead, prelude, browser: await browser.cdp.send('Browser.getVersion'), reads: [], events: [] };
      let buffer = '';
      const trace = chunk => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\0')) >= 0) {
          const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
          if (!raw) continue;
          const event = JSON.parse(raw);
          if (event.method?.startsWith('DOMStorage.')) result.events.push({ method: event.method, ...event.params });
        }
      };
      browser.cdp.readPipe.on('data', trace);
      await send('DOMStorage.enable');
      let startup;
      let generation = 0;
      const url = pathToFileURL(product ? viewer : padded).href;
      async function load({ reload = false, clear = false, query = '' } = {}) {
        const expected = ++generation;
        if (startup) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: startup });
        ({ identifier: startup } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
          window.diagnosticGeneration = ${expected};
          ${earlyRead ? "window.diagnosticInitial = localStorage.getItem('archify-motion');" : ''}
          ${clear ? "localStorage.removeItem('archify-motion');" : ''}
        ` }));
        const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
        await send(reload ? 'Page.reload' : 'Page.navigate', reload ? {} : { url: url + query });
        await loaded;
        const read = await run(`({ generation:diagnosticGeneration, initial:window.diagnosticInitial,
          current:localStorage.getItem('archify-motion'),mode:window.Archify?.motionGovernor?.mode(),
          url:location.href,type:performance.getEntriesByType('navigation')[0].type })`);
        if (read.generation !== expected) throw new Error('Unexpected document generation');
        return read;
      }
      for (let i = 0; i < prelude; i++) {
        await load({ clear: true, query: '?prelude=' + i });
        await run("localStorage.setItem('archify-motion','still');localStorage.removeItem('archify-motion')");
      }
      await load({ clear: true });
      await run(product ? 'Archify.motionGovernor.pause()' : "localStorage.setItem('archify-motion','still')");
      result.afterWrite = await run("localStorage.getItem('archify-motion')");
      for (let i = 0; i < 20; i++) result.reads.push(await load({ reload: true }));
      const { frameTree } = await send('Page.getFrameTree');
      const { storageKey } = await send('Storage.getStorageKeyForFrame', { frameId: frameTree.frame.id });
      result.backend = { storageKey, ...await send('DOMStorage.getDOMStorageItems', { storageId: { storageKey, isLocalStorage: true } }) };
      result.lostAt = result.reads.findIndex(read => read.current !== 'still');
      browser.cdp.readPipe.off('data', trace);
      results.push(result);
      console.log(JSON.stringify(result));
    } finally { await browser.close(); }
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
fs.writeFileSync('motion-storage-observations.json', JSON.stringify(results, null, 2) + '\n');
