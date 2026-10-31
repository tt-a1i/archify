import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = findChrome();

function stableManifest() {
  return {
    schemaVersion: 1, skillId: 'archify', channel: 'stable', version: '3.2.2', publishedAt: '2026-10-23T00:00:00Z',
    source: { repository: 'https://github.com/tt-a1i/archify', ref: 'v3.2.2', treeSha: 'a'.repeat(40) },
    artifact: { sha256: 'b'.repeat(64) }, summary: 'Reader update notice is available.',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v3.2.2', severity: 'normal',
  };
}

async function installNetworkProbe(send, manifest = stableManifest()) {
  const source = `(() => {
    const calls = [];
    Object.defineProperty(window, '__archifyNetworkCalls', { value: calls });
    const record = (kind, value) => calls.push({ kind, url: String(value) });
    window.__archifyManifest = ${JSON.stringify(manifest)};
    window.fetch = (input) => {
      record('fetch', input);
      return Promise.resolve(new Response(JSON.stringify(window.__archifyManifest), {
        status: 200, headers: { 'content-type': 'application/json' }
      }));
    };
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_method, url, ...rest) {
      record('xhr', url);
      return xhrOpen.call(this, _method, url, ...rest);
    };
    for (const key of ['WebSocket', 'EventSource']) {
      const Native = window[key];
      if (!Native) continue;
      const Wrapped = function (...args) { record(key.toLowerCase(), args[0]); return new Native(...args); };
      Wrapped.prototype = Native.prototype;
      window[key] = Wrapped;
    }
  })();`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source });
}

async function renderExplainerArtifact(directory, version = '3.2.1') {
  const { renderExplainer } = await import('../archify/explainer/render.mjs');
  const artifact = path.join(directory, 'explainer.html');
  const html = renderExplainer({
    schema_version: 1, diagram_type: 'explainer', meta: { id: 'offline-explainer', title: 'Offline explainer', locale: 'en' },
    answer: { summary: 'Read locally.' }, panels: [{ id: 'main', title: 'Main', blocks: [{ id: 'text', type: 'prose', text: 'No network request is needed.' }] }], sources: [],
  }, { sourceText: '{}' });
  fs.writeFileSync(artifact, html.replace(/"generatorVersion":"[^"]+"/, `"generatorVersion":"${version}"`));
  return artifact;
}

async function openArtifact(browser, artifact, manifest = stableManifest()) {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await installNetworkProbe(send, manifest);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href });
  await loaded;
  await send('Runtime.evaluate', { expression: `window.__archifyManifest = ${JSON.stringify(manifest)}` });
  return send;
}

test('reader update is local on load and exposes a strict, accessible notice only after an explicit check', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'diagram.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'workflow', path.join(root, 'archify/examples/agent-tool-call.workflow.json'), artifact]);
  // This fixture models an already-released generator. Development builds must
  // never claim a stable result, which is covered by the ordinary fixture.
  fs.writeFileSync(artifact, fs.readFileSync(artifact, 'utf8').replace(/"generatorVersion":"[^"]+"/, '"generatorVersion":"3.2.1"'));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await installNetworkProbe(send);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href });
  await loaded;
  const before = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => ({
    dialogOpen: document.getElementById('reader-update').open,
    trigger: document.getElementById('btn-reader-update').textContent,
    feedback: document.querySelector('[data-reader-feedback]'),
    requests: window.__archifyNetworkCalls
  }))()` });
  assert.equal(before.result.value.dialogOpen, false);
  assert.match(before.result.value.trigger, /Version 3\.2\.1/);
  assert.equal(before.result.value.feedback, null);
  assert.deepEqual(before.result.value.requests, [], 'loading the artifact makes no fetch, XHR, WebSocket, or EventSource request');

  const intercepted = await send('Runtime.evaluate', { expression: `document.getElementById('btn-reader-update').focus(); document.getElementById('btn-reader-update').click(); document.getElementById('reader-update-check').click();` });
  assert.equal(intercepted.exceptionDetails, undefined, intercepted.exceptionDetails?.exception?.description);
  await new Promise(resolve => setTimeout(resolve, 50));
  const after = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const dialog = document.getElementById('reader-update');
    return {
      open: dialog.open,
      focusIsModal: document.activeElement === dialog || dialog.contains(document.activeElement),
      trigger: document.getElementById('btn-reader-update').textContent,
      current: document.getElementById('reader-update-current').textContent,
      available: document.getElementById('reader-update-available').textContent,
      summaries: [...document.querySelectorAll('#reader-update-summaries li')].map(node => node.textContent),
      releaseNotes: document.getElementById('reader-update-release-notes').href,
      requests: window.__archifyNetworkCalls,
    };
  })()` });
  assert.equal(after.result.value.open, true);
  assert.equal(after.result.value.focusIsModal, true, 'focus remains inside the opened dialog');
  assert.equal(after.result.value.trigger, 'New version 3.2.2');
  assert.match(after.result.value.current, /3\.2\.1/);
  assert.match(after.result.value.available, /3\.2\.2/);
  assert.deepEqual(after.result.value.summaries, ['Reader update notice is available.']);
  assert.equal(after.result.value.releaseNotes, 'https://github.com/tt-a1i/archify/releases/tag/v3.2.2');
  assert.deepEqual(after.result.value.requests, [{ kind: 'fetch', url: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json' }]);
});

test('explainer initial load calls none of the four instrumented JavaScript network APIs', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-explainer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = await renderExplainerArtifact(directory);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const send = await openArtifact(browser, artifact);
  const result = await send('Runtime.evaluate', { returnByValue: true, expression: 'window.__archifyNetworkCalls' });
  assert.deepEqual(result.result.value, [], 'loading an explainer calls none of fetch, XHR, WebSocket, or EventSource');
});

test('explainer reader update follows the native development and manifest failure contract', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-explainer-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await installNetworkProbe(send);
  async function inspectUpdate({ version = '3.2.1', manifest = stableManifest() }) {
    const artifact = await renderExplainerArtifact(directory, version);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(artifact).href });
    await loaded;
    await send('Runtime.evaluate', { expression: `window.__archifyManifest = ${JSON.stringify(manifest)}; window.__archifyNetworkCalls.length = 0;` });
    await send('Runtime.evaluate', { expression: "document.querySelector('[data-reader-update]').click(); document.querySelector('[data-reader-update-check]').click();" });
    await new Promise(resolve => setTimeout(resolve, 50));
    const result = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => ({
      trigger: document.querySelector('[data-reader-update]').textContent,
      status: document.querySelector('[data-reader-update-status]').textContent,
      notesHidden: document.querySelector('[data-reader-update-release-notes]').hidden,
      requests: window.__archifyNetworkCalls,
    }))()` });
    return result.result.value;
  }

  await t.test('development artifacts do not request a manifest', async () => {
    const result = await inspectUpdate({ version: '3.2.1-dev.1' });
    assert.match(result.status, /development artifact/i);
    assert.doesNotMatch(result.trigger, /New version/i);
    assert.equal(result.notesHidden, true);
    assert.deepEqual(result.requests, [], 'a development explainer must return before fetch');
  });

  await t.test('a malformed stable manifest fails closed', async () => {
    const result = await inspectUpdate({ manifest: {} });
    assert.equal(result.status, 'Update status unavailable. No update result was recorded.');
    assert.doesNotMatch(result.trigger, /New version/i);
    assert.equal(result.notesHidden, true);
    assert.deepEqual(result.requests, [{ kind: 'fetch', url: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json' }]);
  });

  await t.test('a calendar-invalid stable manifest fails closed', async () => {
    const result = await inspectUpdate({ manifest: { ...stableManifest(), publishedAt: '2025-02-30T00:00:00Z' } });
    assert.equal(result.status, 'Update status unavailable. No update result was recorded.');
    assert.doesNotMatch(result.trigger, /New version/i);
    assert.equal(result.notesHidden, true);
  });

  await t.test('a valid stable manifest is read once after explicit check', async () => {
    const result = await inspectUpdate({ manifest: stableManifest() });
    assert.equal(result.status, 'A newer stable version is available.');
    assert.equal(result.trigger, 'New version 3.2.2');
    assert.equal(result.notesHidden, false);
    assert.deepEqual(result.requests, [{ kind: 'fetch', url: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json' }]);
  });
});

test('development artifacts never claim a stable result', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-dev-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'diagram.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'workflow', path.join(root, 'archify/examples/agent-tool-call.workflow.json'), artifact]);
  fs.writeFileSync(artifact, fs.readFileSync(artifact, 'utf8').replace(/"generatorVersion":"[^"]+"/, '"generatorVersion":"3.2.1-dev.1"'));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await installNetworkProbe(send);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href });
  await loaded;
  await send('Runtime.evaluate', { expression: "document.getElementById('btn-reader-update').click(); document.getElementById('reader-update-check').click();" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await send('Runtime.evaluate', { returnByValue: true, expression: "document.getElementById('reader-update-status').textContent" });
    if (!/Checking the fixed stable manifest/.test(status.result.value)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const result = await send('Runtime.evaluate', { returnByValue: true, expression: `({
    trigger: document.getElementById('btn-reader-update').textContent,
    status: document.getElementById('reader-update-status').textContent,
    notesHidden: document.getElementById('reader-update-release-notes').hidden,
    requests: window.__archifyNetworkCalls,
  })` });
  assert.match(result.result.value.status, /development artifact/i);
  assert.doesNotMatch(result.result.value.trigger, /New version/i);
  assert.equal(result.result.value.notesHidden, true);
  assert.deepEqual(result.result.value.requests, [], 'a development artifact does not request a manifest that cannot produce a result');
});

test('a malformed stable manifest cannot promote an artifact to a new version', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'diagram.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'workflow', path.join(root, 'archify/examples/agent-tool-call.workflow.json'), artifact]);
  fs.writeFileSync(artifact, fs.readFileSync(artifact, 'utf8').replace(/"generatorVersion":"[^"]+"/, '"generatorVersion":"3.2.1"'));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href });
  await loaded;
  const invalid = { ...stableManifest(), publishedAt: '2025-02-30T00:00:00Z' };
  await send('Runtime.evaluate', { expression: `window.fetch = () => Promise.resolve(new Response(JSON.stringify(${JSON.stringify(invalid)}))); document.getElementById('btn-reader-update').click(); document.getElementById('reader-update-check').click();` });
  await new Promise(resolve => setTimeout(resolve, 50));
  const result = await send('Runtime.evaluate', { returnByValue: true, expression: `({
    trigger: document.getElementById('btn-reader-update').textContent,
    status: document.getElementById('reader-update-status').textContent,
    notesHidden: document.getElementById('reader-update-release-notes').hidden
  })` });
  assert.equal(result.result.value.status, 'Update status unavailable. No update result was recorded.');
  assert.doesNotMatch(result.result.value.trigger, /New version/i);
  assert.equal(result.result.value.notesHidden, true);
});

test('both readers reject oversized manifest bodies before they can show a version', {
  skip: chrome ? false : 'Chrome is unavailable.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-oversized-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const native = path.join(directory, 'native.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'workflow', path.join(root, 'archify/examples/agent-tool-call.workflow.json'), native]);
  fs.writeFileSync(native, fs.readFileSync(native, 'utf8').replace(/"generatorVersion":"[^"]+"/, '"generatorVersion":"3.2.1"'));
  const explainer = await renderExplainerArtifact(directory);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const validManifest = JSON.stringify(stableManifest());
  const oversizedManifest = `${validManifest}${' '.repeat(65537 - validManifest.length + 1)}`;
  const cases = [
    {
      name: 'streamed body',
      response: `{ ok: true, headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(${JSON.stringify(oversizedManifest)})); }, cancel() { window.__archifyManifestStreamCancelled = true; } }) }`,
      expectsCancellation: true,
    },
    {
      name: 'declared content length',
      response: `{ ok: true, headers: new Headers({ 'content-length': '65537' }), body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(${JSON.stringify(validManifest)})); controller.close(); } }) }`,
      expectsCancellation: false,
    },
  ];
  const readers = [
    { artifact: native, trigger: '#btn-reader-update', check: '#reader-update-check', status: '#reader-update-status', notes: '#reader-update-release-notes' },
    { artifact: explainer, trigger: '[data-reader-update]', check: '[data-reader-update-check]', status: '[data-reader-update-status]', notes: '[data-reader-update-release-notes]' },
  ];
  for (const reader of readers) for (const scenario of cases) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(reader.artifact).href });
    await loaded;
    const invoked = await send('Runtime.evaluate', { expression: `window.__archifyManifestStreamCancelled = false; window.fetch = () => Promise.resolve(${scenario.response}); document.querySelector(${JSON.stringify(reader.trigger)}).click(); document.querySelector(${JSON.stringify(reader.check)}).click();` });
    assert.equal(invoked.exceptionDetails, undefined, `${reader.trigger} ${scenario.name}: ${invoked.exceptionDetails?.text}`);
    let result;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      result = await send('Runtime.evaluate', { returnByValue: true, expression: `({ status: document.querySelector(${JSON.stringify(reader.status)}).textContent, trigger: document.querySelector(${JSON.stringify(reader.trigger)}).textContent, notesHidden: document.querySelector(${JSON.stringify(reader.notes)}).hidden, streamCancelled: window.__archifyManifestStreamCancelled })` });
      if (result.result.value.status === 'Update status unavailable. No update result was recorded.') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(result.result.value.status, 'Update status unavailable. No update result was recorded.', `${reader.trigger} ${scenario.name}`);
    assert.doesNotMatch(result.result.value.trigger, /New version/i);
    assert.equal(result.result.value.notesHidden, true);
    assert.equal(result.result.value.streamCancelled, scenario.expectsCancellation, `${reader.trigger} ${scenario.name}: stream cancellation`);
  }
});
