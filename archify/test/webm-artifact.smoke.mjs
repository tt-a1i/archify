import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-webm-artifact-'));
function executable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      return execFileSync('sh', ['-c', `command -v "$1"`, 'archify-which', candidate], { encoding: 'utf8' }).trim();
    } catch (_) {
      // Try the next platform-specific name.
    }
  }
  return '';
}

const chrome = executable([
  process.env.ARCHIFY_CHROME,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]);
const ffmpeg = executable([process.env.ARCHIFY_FFMPEG, 'ffmpeg']);

assert.ok(chrome, 'Chrome/Chromium is required for the WebM artifact smoke test (or set ARCHIFY_CHROME)');
assert.ok(ffmpeg, 'ffmpeg is required for the WebM artifact smoke test (or set ARCHIFY_FFMPEG)');

const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
source.meta.animation = 'trace';
source.meta.visual_preset = 'signal-flow';

const input = path.join(tmp, 'motion.architecture.json');
const output = path.join(tmp, 'motion.html');
fs.writeFileSync(input, JSON.stringify(source));
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
  input,
  output,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sequenceOutput = path.join(tmp, 'sequence.html');
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'),
  path.join(skillRoot, 'examples/cache-miss-request.sequence.json'),
  sequenceOutput,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const routeOutputs = {
  architecture: output,
  sequence: sequenceOutput,
};
for (const [mode, example] of Object.entries({
  workflow: 'agent-tool-call.workflow.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
})) {
  const rendered = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    rendered,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  routeOutputs[mode] = rendered;
}

function renderLegendFixture(mode, name, document) {
  const inputPath = path.join(tmp, `${name}.${mode}.json`);
  const outputPath = path.join(tmp, `${name}.${mode}.html`);
  fs.writeFileSync(inputPath, JSON.stringify(document));
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    inputPath,
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return outputPath;
}

const legendOutputs = {
  dataflow: renderLegendFixture('dataflow', 'issue-52-default-flow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Default Flow With Store' },
    stages: [{ label: 'Input' }, { label: 'Output' }],
    nodes: [
      { id: 'input', type: 'backend', label: 'Input', stage: 0, row: 0 },
      { id: 'output', type: 'database', label: 'Output Store', stage: 1, row: 0 },
    ],
    flows: [{ from: 'input', to: 'output', label: 'request', route: 'straight' }],
  }),
  lifecycle: renderLegendFixture('lifecycle', 'issue-52-no-waiting', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'No Waiting or Failure', viewBox: [720, 566] },
    lanes: [{ id: 'main', label: 'Lifecycle' }],
    states: [
      { id: 'started', type: 'start', label: 'Started', lane: 'main', col: 0 },
      { id: 'running', type: 'active', label: 'Running', lane: 'main', col: 1 },
      { id: 'completed', type: 'success', label: 'Completed', lane: 'main', col: 2 },
    ],
    transitions: [{ from: 'started', to: 'running' }, { from: 'running', to: 'completed' }],
  }),
  custom: renderLegendFixture('architecture', 'issue-52-custom-label', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Custom Legend Label',
      viewBox: [720, 420],
      legend: {
        entries: {
          frontend: { label: 'Reader <UI> & ops' },
          external: { label: 'Future integration', visible: true },
        },
      },
      views: [{ id: 'main', label: 'Main', focus: ['ui', 'store'] }],
    },
    components: [
      { id: 'ui', type: 'frontend', label: 'UI', pos: [60, 90] },
      { id: 'store', type: 'database', label: 'Store', pos: [300, 90] },
    ],
    connections: [],
  }),
  hidden: renderLegendFixture('dataflow', 'issue-52-hidden', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Hidden Legend', legend: { mode: 'hidden', entries: { database: { visible: true } } } },
    stages: [{ label: 'Input' }, { label: 'Output' }],
    nodes: [
      { id: 'input', type: 'backend', label: 'Input', stage: 0, row: 0 },
      { id: 'output', type: 'backend', label: 'Output', stage: 1, row: 0 },
    ],
    flows: [{ from: 'input', to: 'output', label: 'request', route: 'straight' }],
  }),
};

assert.equal(typeof WebSocket, 'function', 'Node.js 22+ is required for the Chrome DevTools smoke harness');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    once(child, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function removeTempTree(directory) {
  const transientCodes = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (!transientCodes.has(error?.code)) throw error;
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  console.warn(`warning: temporary Chrome profile cleanup deferred (${lastError?.code || 'unknown'}): ${directory}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function devtoolsEndpoint(port, chromeProcess, diagnostics) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch (_) {
      // Chrome may need a moment to bind the debugging port.
    }
    if (chromeProcess.exitCode !== null) break;
    await delay(50);
  }
  const stderr = diagnostics().trim();
  const exit = chromeProcess.exitCode === null ? 'still running' : `exited with code ${chromeProcess.exitCode}`;
  throw new Error(`Chrome did not expose a DevTools endpoint (${exit})${stderr ? `:\n${stderr}` : ''}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Chrome DevTools connection closed'));
    pending.clear();
  });
  return {
    socket,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'browser evaluation failed');
  }
  return response.result?.value;
}

const port = await freePort();
let chromeStderr = '';
const chromeProcess = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required',
  '--log-level=3',
  `--user-data-dir=${path.join(tmp, 'chrome-profile')}`,
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chromeProcess.stderr.setEncoding('utf8');
chromeProcess.stderr.on('data', (chunk) => {
  chromeStderr = `${chromeStderr}${chunk}`.slice(-64 * 1024);
});

let cdp;
let targetId;

try {
  cdp = await connectCdp(await devtoolsEndpoint(port, chromeProcess, () => chromeStderr));
  ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
  await cdp.send('Target.activateTarget', { targetId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  async function navigateReady(file, condition, label) {
    const url = file instanceof URL ? file.href : pathToFileURL(file).href;
    await cdp.send('Page.navigate', { url }, sessionId);
    await cdp.send('Page.bringToFront', {}, sessionId);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
      ready = await evaluate(cdp, sessionId, `document.readyState === "complete" && (${condition})`);
      if (!ready) await delay(50);
    }
    assert.equal(ready, true, `${label} did not expose its browser export surface`);
  }

  async function verifyResolvedLegendContract(outputs) {
    async function inspectKinds(file, expectedKinds, theme) {
      const url = new URL(pathToFileURL(file).href);
      url.searchParams.set('theme', theme);
      await navigateReady(url, '!!(window.Archify && Archify.semanticLens)', `legend ${theme}`);
      const result = await evaluate(cdp, sessionId, `(() => {
        var svg = document.querySelector('.diagram-container > svg');
        var entries = Array.from(svg.querySelectorAll('[data-legend-semantic-kind]'));
        var vb = svg.viewBox.baseVal;
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          kinds: entries.map(function (entry) { return entry.getAttribute('data-legend-semantic-kind'); }),
          bridge: !!svg.querySelector('[data-legend-bridge]'),
          roles: entries.map(function (entry) { return entry.getAttribute('role'); }),
          aria: entries.map(function (entry) { return entry.getAttribute('aria-label'); }),
          counts: entries.map(function (entry) { return entry.getAttribute('data-legend-count'); }),
          tabStops: entries.filter(function (entry) { return entry.getAttribute('tabindex') === '0'; }).length,
          inside: entries.every(function (entry) {
            var box = entry.getBBox();
            return box.x >= vb.x && box.y >= vb.y && box.x + box.width <= vb.x + vb.width && box.y + box.height <= vb.y + vb.height;
          })
        };
      })()`);
      assert.equal(result.theme, theme);
      assert.deepEqual(result.kinds, expectedKinds);
      assert.equal(result.inside, true);
      return result;
    }

    for (const theme of ['dark', 'light']) {
      const dataflow = await inspectKinds(outputs.dataflow, ['database', 'default'], theme);
      assert.equal(dataflow.bridge, true);
      assert.deepEqual(dataflow.roles, ['button', null]);
      assert.deepEqual(dataflow.aria, ['Inspect data store, 1 node', null]);
      assert.deepEqual(dataflow.counts, ['1', null]);
      assert.equal(dataflow.tabStops, 1);
      const lifecycle = await inspectKinds(outputs.lifecycle, ['start', 'active', 'success'], theme);
      assert.equal(lifecycle.bridge, true);
    }

    await navigateReady(outputs.dataflow, '!!(window.Archify && Archify.semanticLens && Archify.exportMenu)', 'Dataflow database legend runtime');
    const databaseRuntime = await evaluate(cdp, sessionId, String.raw`(async function () {
      var entry = document.querySelector('[data-legend-kind="database"]');
      entry.focus();
      entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      var originalCreateObjectURL = URL.createObjectURL;
      var originalAnchorClick = HTMLAnchorElement.prototype.click;
      var captured;
      URL.createObjectURL = function (blob) {
        captured = blob.text();
        return 'blob:archify-dataflow-legend-smoke';
      };
      HTMLAnchorElement.prototype.click = function () {};
      try {
        await Archify.exportMenu.run('svg');
        var exportedText = await captured;
        var exported = new DOMParser().parseFromString(exportedText, 'image/svg+xml').documentElement;
        return {
          selected: Archify.semanticLens.active(),
          lensOpen: Archify.semanticLens.isOpen(),
          exportedKinds: Array.from(exported.querySelectorAll('[data-legend-semantic-kind]')).map(function (item) { return item.getAttribute('data-legend-semantic-kind'); }),
          exportedBridgeResidue: exported.querySelectorAll('[data-legend-bridge], [data-legend-kind], [data-legend-label], [data-legend-count], [data-legend-bridge-runtime]').length
        };
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
    })()`, true);
    assert.deepEqual(databaseRuntime.selected, ['database']);
    assert.equal(databaseRuntime.lensOpen, true);
    assert.deepEqual(databaseRuntime.exportedKinds, ['database', 'default']);
    assert.equal(databaseRuntime.exportedBridgeResidue, 0);

    await navigateReady(outputs.custom, '!!(window.Archify && Archify.semanticLens && Archify.exportMenu)', 'custom legend runtime');
    const runtime = await evaluate(cdp, sessionId, String.raw`(async function () {
      var svg = document.querySelector('.diagram-container > svg');
      var entries = Array.from(svg.querySelectorAll('[data-legend-semantic-kind]'));
      var interactive = entries.filter(function (entry) { return entry.hasAttribute('data-legend-kind'); });
      var first = interactive[0];
      var second = interactive[1];
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      var arrowMoved = document.activeElement === second;
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      var selected = Archify.semanticLens.active();
      var guidedActivated = Archify.guidedViews.activate('main', { updateUrl: false });
      var guidedActive = Archify.guidedViews.active();
      var visualMatrix = [];
      for (var preset of ['classic', 'signal-flow', 'blueprint', 'editorial']) {
        if (!Archify.preset.apply(preset)) throw new Error('could not apply preset ' + preset);
        for (var theme of ['dark', 'light']) {
          document.documentElement.setAttribute('data-theme', theme);
          visualMatrix.push({
            preset: preset,
            theme: theme,
            kinds: entries.map(function (entry) { return entry.getAttribute('data-legend-semantic-kind'); }),
            labels: entries.map(function (entry) { return entry.querySelector('text').textContent; })
          });
        }
      }

      var originalCreateObjectURL = URL.createObjectURL;
      var originalAnchorClick = HTMLAnchorElement.prototype.click;
      var captured;
      URL.createObjectURL = function (blob) {
        captured = blob.text();
        return 'blob:archify-legend-smoke';
      };
      HTMLAnchorElement.prototype.click = function () {};
      try {
        await Archify.exportMenu.run('svg');
        var exportedText = await captured;
        var exported = new DOMParser().parseFromString(exportedText, 'image/svg+xml').documentElement;
        return {
          labels: interactive.map(function (entry) { return entry.getAttribute('aria-label'); }),
          roles: entries.map(function (entry) { return entry.getAttribute('role'); }),
          counts: interactive.map(function (entry) { return entry.getAttribute('data-legend-count'); }),
          tabStops: interactive.filter(function (entry) { return entry.getAttribute('tabindex') === '0'; }).length,
          arrowMoved: arrowMoved,
          selected: selected,
          lensOpen: Archify.semanticLens.isOpen(),
          guidedActivated: guidedActivated,
          guidedActive: guidedActive,
          visualMatrix: visualMatrix,
          forcedUnusedInteractive: entries.at(-1).hasAttribute('data-legend-kind'),
          exportedKinds: Array.from(exported.querySelectorAll('[data-legend-semantic-kind]')).map(function (entry) { return entry.getAttribute('data-legend-semantic-kind'); }),
          exportedBridgeResidue: exported.querySelectorAll('[data-legend-bridge], [data-legend-kind], [data-legend-label], [data-legend-count], [data-legend-bridge-runtime]').length,
          exportedLabels: Array.from(exported.querySelectorAll('[data-legend-semantic-kind] text')).map(function (text) { return text.textContent; })
        };
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
    })()`, true);
    assert.deepEqual(runtime.labels, ['Inspect Reader <UI> & ops, 1 node', 'Inspect Database, 1 node']);
    assert.deepEqual(runtime.roles, ['button', 'button', null]);
    assert.deepEqual(runtime.counts, ['1', '1']);
    assert.equal(runtime.tabStops, 1);
    assert.equal(runtime.arrowMoved, true);
    assert.deepEqual(runtime.selected, ['database']);
    assert.equal(runtime.lensOpen, false);
    assert.equal(runtime.guidedActivated, true);
    assert.equal(runtime.guidedActive, 'main');
    assert.equal(runtime.visualMatrix.length, 8);
    for (const entry of runtime.visualMatrix) {
      assert.deepEqual(entry.kinds, ['frontend', 'database', 'external']);
      assert.deepEqual(entry.labels, ['Reader <UI> & ops', 'Database', 'Future integration']);
    }
    assert.equal(runtime.forcedUnusedInteractive, false);
    assert.deepEqual(runtime.exportedKinds, ['frontend', 'database', 'external']);
    assert.equal(runtime.exportedBridgeResidue, 0);
    assert.deepEqual(runtime.exportedLabels, ['Reader <UI> & ops', 'Database', 'Future integration']);

    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
    const printState = await evaluate(cdp, sessionId, `(() => ({
      legendDisplay: getComputedStyle(document.querySelector('[data-legend]')).display,
      runtimeBadgesHidden: Array.from(document.querySelectorAll('[data-legend-bridge-runtime]')).every(function (entry) { return getComputedStyle(entry).display === 'none'; })
    }))()`);
    assert.notEqual(printState.legendDisplay, 'none');
    assert.equal(printState.runtimeBadgesHidden, true);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' }, sessionId);

    const embedUrl = new URL(pathToFileURL(outputs.custom).href);
    embedUrl.searchParams.set('embed', '1');
    await navigateReady(embedUrl, '!!(window.Archify && Archify.semanticLens)', 'embedded legend');
    const embed = await evaluate(cdp, sessionId, `(() => ({
      roles: document.querySelectorAll('[data-legend-kind][role]').length,
      runtime: document.querySelectorAll('[data-legend-bridge-runtime]').length,
      kinds: Array.from(document.querySelectorAll('[data-legend-semantic-kind]')).map(function (entry) { return entry.getAttribute('data-legend-semantic-kind'); })
    }))()`);
    assert.deepEqual(embed, { roles: 0, runtime: 0, kinds: ['frontend', 'database', 'external'] });

    await navigateReady(outputs.hidden, '!!(window.Archify && Archify.semanticLens)', 'hidden legend');
    const hidden = await evaluate(cdp, sessionId, `(() => ({
      root: !!document.querySelector('[data-legend]'),
      bridge: !!document.querySelector('[data-legend-bridge]'),
      title: Array.from(document.querySelectorAll('.diagram-container svg text')).some(function (text) { return text.textContent.trim() === 'Legend'; })
    }))()`);
    assert.deepEqual(hidden, { root: false, bridge: false, title: false });
    console.log('ok legend runtime: labels, counts, keyboard, export, print, embed, hidden, and dual themes');
  }

  async function verifySemanticPassportDismissal(file) {
    await navigateReady(file, '!!(window.Archify && Archify.focus && document.querySelector("#btn-focus-clear"))', 'Semantic Passport dismissal');
    const result = await evaluate(cdp, sessionId, `(() => {
      var chip = document.querySelector('#focus-chip');
      var close = document.querySelector('#btn-focus-clear');
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var origin = svg.querySelector('[data-node-id="clients"]');
      var neighbor = svg.querySelector('[data-node-id]:not([data-node-id="clients"])');
      if (!origin || !neighbor) return { ok: false, error: 'missing smoke-test nodes' };
      function state() {
        return { hidden: chip.hidden, active: Archify.focus.active() };
      }

      Archify.focus.set('clients', { toggle: false, updateUrl: false });
      var cardRect = chip.getBoundingClientRect();
      var closeRect = close.getBoundingClientRect();
      var layout = {
        topGap: Math.round(closeRect.top - cardRect.top),
        rightGap: Math.round(cardRect.right - closeRect.right),
        label: close.getAttribute('aria-label'),
        title: close.getAttribute('title'),
        text: close.textContent.trim()
      };
      close.click();
      var afterClose = state();
      var restoredFocus = document.activeElement && document.activeElement.getAttribute('data-node-id');

      Archify.focus.set('clients', { toggle: false, updateUrl: false });
      chip.querySelector('.relationship-lens-head').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var afterInside = state();
      container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var afterOutside = state();

      Archify.focus.set('clients', { toggle: false, updateUrl: false });
      neighbor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var afterNode = state();
      return {
        ok: true,
        layout: layout,
        afterClose: afterClose,
        restoredFocus: restoredFocus,
        afterInside: afterInside,
        afterOutside: afterOutside,
        afterNode: afterNode,
        neighborId: neighbor.getAttribute('data-node-id')
      };
    })()`);
    assert.equal(result?.ok, true, result?.error || 'Semantic Passport smoke failed');
    assert.equal(result.layout.label, 'Close semantic passport');
    assert.equal(result.layout.title, 'Close');
    assert.equal(result.layout.text, '×');
    assert.ok(result.layout.topGap >= 0 && result.layout.topGap <= 16, `Semantic Passport close top gap ${result.layout.topGap}px`);
    assert.ok(result.layout.rightGap >= 0 && result.layout.rightGap <= 16, `Semantic Passport close right gap ${result.layout.rightGap}px`);
    assert.deepEqual(result.afterClose, { hidden: true, active: null });
    assert.equal(result.restoredFocus, 'clients');
    assert.deepEqual(result.afterInside, { hidden: false, active: 'clients' });
    assert.deepEqual(result.afterOutside, { hidden: true, active: null });
    assert.deepEqual(result.afterNode, { hidden: false, active: result.neighborId });
    console.log('ok Semantic Passport: close control, focus return, inside preservation, and outside dismissal');
  }

  async function verifyArchitectureDeltaNavigator(file) {
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);
    const readyCondition = '!!document.querySelector("#review-play") && !document.querySelector("#review-play").disabled';
    async function waitForSelected(changeKey, label) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey === ${JSON.stringify(changeKey)}`)) return;
        await delay(50);
      }
      const observed = await evaluate(cdp, sessionId, `({
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey || null,
        pressed: document.querySelector('#review-play')?.getAttribute('aria-pressed'),
        label: document.querySelector('#review-play')?.textContent,
        status: document.querySelector('#review-status')?.textContent,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        hidden: document.hidden
      })`);
      assert.fail(`${label} did not select ${changeKey} within the bounded wait: ${JSON.stringify(observed)}`);
    }
    async function waitForReviewFinished(label) {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const done = await evaluate(cdp, sessionId, `document.querySelector('#review-play').getAttribute('aria-pressed') === 'false' && document.querySelector('#review-play').textContent === 'Replay'`);
        if (done) return;
        await delay(50);
      }
      assert.fail(`${label} did not finish within the bounded wait`);
    }
    await navigateReady(file, readyCondition, 'architecture-delta navigator');
    const initial = await evaluate(cdp, sessionId, `({
      status: document.querySelector('#review-status').textContent,
      selected: document.querySelectorAll('.change-row[aria-current="step"]').length,
      current: document.querySelectorAll('[data-delta-review-current]').length,
      rows: document.querySelectorAll('.change-row').length
    })`);
    assert.deepEqual(initial, { status: 'Overview · 11 authored changes', selected: 0, current: 0, rows: 11 });

    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    await waitForSelected('relationship:fraud-check', 'architecture-delta initial playback');
    const advanced = await evaluate(cdp, sessionId, `({
      selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
      pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
    })`);
    assert.deepEqual(advanced, { selected: 'relationship:fraud-check', pressed: 'true' });

    await evaluate(cdp, sessionId, `document.querySelector('[role="tab"][data-target="base"]').click()`);
    const pausedKey = await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey`);
    await delay(1550);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey`), pausedKey);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelector('#review-play').getAttribute('aria-pressed')`), 'false');

    const overview = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('[role="tab"][data-target="delta"]').click();
      document.querySelector('#review-overview').click();
      return {
        active: document.querySelector('[data-view="delta"]').hasAttribute('data-delta-review-active'),
        current: document.querySelectorAll('[data-delta-review-current]').length,
        selected: document.querySelectorAll('.change-row[aria-current="step"]').length
      };
    })()`);
    assert.deepEqual(overview, { active: false, current: 0, selected: 0 });

    await navigateReady(file, readyCondition, 'architecture-delta manual lifecycle navigator');
    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    await waitForSelected('relationship:fraud-check', 'architecture-delta previous control');
    const previousPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#review-previous').click();
      return {
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(previousPause, { selected: 'component:fraud', pressed: 'false' });
    await delay(1450);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey`), 'component:fraud');

    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    const nextPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#review-next').click();
      return {
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(nextPause, { selected: 'relationship:fraud-check', pressed: 'false' });

    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    const rowPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('.change-row[data-change-key="component:queue"]').click();
      return {
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(rowPause, { selected: 'component:queue', pressed: 'false' });

    await navigateReady(file, readyCondition, 'architecture-delta focus lifecycle navigator');
    const focusedPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#review-play').click();
      document.querySelector('#review-next').focus();
      return {
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(focusedPause, { selected: 'component:fraud', pressed: 'false' });
    await delay(1450);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey`), 'component:fraud');

    await navigateReady(file, readyCondition, 'architecture-delta hidden lifecycle navigator');
    const hiddenPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#review-play').click();
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
      document.dispatchEvent(new Event('visibilitychange'));
      return {
        hidden: document.hidden,
        selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(hiddenPause, { hidden: true, selected: 'component:fraud', pressed: 'false' });
    await delay(1450);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey`), 'component:fraud');

    await navigateReady(file, readyCondition, 'architecture-delta print lifecycle navigator');
    const printPause = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('#review-play').click();
      window.dispatchEvent(new Event('beforeprint'));
      return {
        status: document.querySelector('#review-status').textContent,
        selected: document.querySelectorAll('.change-row[aria-current="step"]').length,
        pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
      };
    })()`);
    assert.deepEqual(printPause, { status: 'Overview · 11 authored changes', selected: 0, pressed: 'false' });
    await delay(1450);
    assert.equal(await evaluate(cdp, sessionId, `document.querySelectorAll('.change-row[aria-current="step"]').length`), 0);

    const keyboard = await evaluate(cdp, sessionId, `(() => {
      document.querySelector('details').open = true;
      var first = document.querySelector('.change-row');
      first.click();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      var focused = document.activeElement.dataset.changeKey;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { focused: focused, selected: document.querySelector('.change-row[aria-current="step"]').dataset.changeKey };
    })()`);
    assert.deepEqual(keyboard, { focused: 'relationship:fraud-check', selected: 'relationship:fraud-check' });

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await navigateReady(file, readyCondition, 'architecture-delta reduced-motion navigator');
    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    await delay(1550);
    const reduced = await evaluate(cdp, sessionId, `({
      selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
      pressed: document.querySelector('#review-play').getAttribute('aria-pressed'),
      nextDisabled: document.querySelector('#review-next').disabled
    })`);
    assert.deepEqual(reduced, { selected: 'component:fraud', pressed: 'false', nextDisabled: false });
    await evaluate(cdp, sessionId, `document.querySelector('#review-next').click()`);

    await evaluate(cdp, sessionId, `document.querySelector('.change-row').click()`);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
    await delay(200);
    const printState = await evaluate(cdp, sessionId, `({
      strip: getComputedStyle(document.querySelector('.review-strip')).display,
      base: getComputedStyle(document.querySelector('[data-view="base"]')).display,
      delta: getComputedStyle(document.querySelector('[data-view="delta"]')).display,
      head: getComputedStyle(document.querySelector('[data-view="head"]')).display,
      current: getComputedStyle(document.querySelector('[data-delta-review-current]')).opacity,
      same: getComputedStyle(document.querySelector('[data-view="delta"] [data-delta-state="same"]')).opacity
    })`);
    assert.deepEqual(printState, { strip: 'none', base: 'none', delta: 'block', head: 'none', current: '1', same: '1' });
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);

    await navigateReady(file, readyCondition, 'architecture-delta tamper navigator');
    const tampered = await evaluate(cdp, sessionId, `(() => {
      var companion = document.querySelector('[data-view="delta"] g[data-edge-id="fraud-check"]');
      companion.parentNode.insertBefore(companion.cloneNode(true), companion.nextSibling);
      document.querySelector('.change-row[data-change-key="relationship:fraud-check"]').click();
      return {
        status: document.querySelector('#review-status').textContent,
        disabled: Array.from(document.querySelectorAll('.review-step,.change-row')).every(function (button) { return button.disabled; }),
        canvases: document.querySelectorAll('[data-view]').length
      };
    })()`);
    assert.deepEqual(tampered, { status: 'Review unavailable · compare identity mismatch', disabled: true, canvases: 3 });

    await navigateReady(file, readyCondition, 'architecture-delta finite navigator');
    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    await waitForReviewFinished('architecture-delta finite playback');
    const finished = await evaluate(cdp, sessionId, `({
      selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
      label: document.querySelector('#review-play').textContent,
      pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
    })`);
    assert.deepEqual(finished, { selected: 'relationship:publish-order', label: 'Replay', pressed: 'false' });
    await evaluate(cdp, sessionId, `document.querySelector('#review-play').click()`);
    const replayStarted = await evaluate(cdp, sessionId, `({
      selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
      label: document.querySelector('#review-play').textContent,
      pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
    })`);
    assert.deepEqual(replayStarted, { selected: 'component:fraud', label: 'Pause', pressed: 'true' });
    await waitForReviewFinished('architecture-delta replay playback');
    const replayFinished = await evaluate(cdp, sessionId, `({
      selected: document.querySelector('.change-row[aria-current="step"]')?.dataset.changeKey,
      label: document.querySelector('#review-play').textContent,
      pressed: document.querySelector('#review-play').getAttribute('aria-pressed')
    })`);
    assert.deepEqual(replayFinished, { selected: 'relationship:publish-order', label: 'Replay', pressed: 'false' });

    const exportProof = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      var frames = Array.from(document.querySelectorAll('.snapshot-frame'));
      var explorers = frames.map(function (frame) {
        var child = frame.contentWindow;
        return Boolean(child && child.Archify && child.Archify.focus && child.Archify.routeProbe && child.document.querySelector('#btn-node-finder') && child.document.querySelector('#guided-view-play'));
      });
      var svgA = Archify.deltaExport.canonicalSvg();
      document.querySelector('#theme').click();
      document.querySelector('#preset').click();
      document.querySelector('.change-row').click();
      var svgB = Archify.deltaExport.canonicalSvg();
      var parsed = new DOMParser().parseFromString(svgB, 'image/svg+xml');
      var exportStyle = parsed.querySelector('style')?.textContent || '';
      var originalAnchorClick = HTMLAnchorElement.prototype.click;
      var downloadClicks = 0;
      var rejectedFormats;
      try {
        HTMLAnchorElement.prototype.click = function () { downloadClicks += 1; };
        Archify.exportMenu.run('svg');
        var successfulReceipt = document.documentElement.getAttribute('data-archify-delta-export');
        var beforeRetired = downloadClicks;
        var retiredError = null;
        try { Archify.exportMenu.run('share-card'); }
        catch (error) { retiredError = String(error && error.message || error); }
        var retiredReceipt = document.documentElement.getAttribute('data-archify-delta-export');
        var retiredDownloads = downloadClicks - beforeRetired;
        Archify.exportMenu.run('svg');
        var beforeUnknown = downloadClicks;
        var unknownError = null;
        try { Archify.exportMenu.run('not-a-format'); }
        catch (error) { unknownError = String(error && error.message || error); }
        rejectedFormats = {
          successfulReceipt: Boolean(successfulReceipt),
          retired: { rejected: Boolean(retiredError), downloads: retiredDownloads, receipt: retiredReceipt },
          unknown: {
            rejected: Boolean(unknownError),
            downloads: downloadClicks - beforeUnknown,
            receipt: document.documentElement.getAttribute('data-archify-delta-export')
          }
        };
      } finally {
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
      return {
        explorers: explorers,
        stable: svgA === svgB,
        reviewResidue: parsed.querySelectorAll('[data-delta-review-current]').length,
        boundaryStyle: exportStyle.includes('text[data-delta-boundary-state="added"]{fill:#34d399!important}'),
        markerStyle: exportStyle.includes('.delta-edge-marker[data-delta-state],.delta-boundary-marker[data-delta-state]{color:var(--delta)}'),
        frameStyle: exportStyle.includes('rect[data-graph-role="structural-frame"]'),
        boundaryMarkers: Array.from(parsed.querySelectorAll('.delta-boundary-marker')).map(function (marker) { return marker.textContent; }),
        rejectedFormats: rejectedFormats,
        retiredShareCard: !document.querySelector('#share-card') &&
          !('shareCard' in Archify.deltaExport) &&
          !('downloadShareCard' in Archify.deltaExport)
      };
    })()`, true), 15_000, 'Architecture Delta export');
    assert.deepEqual(exportProof.explorers, [true, true]);
    assert.equal(exportProof.stable, true);
    assert.equal(exportProof.reviewResidue, 0);
    assert.equal(exportProof.boundaryStyle, true);
    assert.equal(exportProof.markerStyle, true);
    assert.equal(exportProof.frameStyle, true);
    assert.deepEqual(exportProof.boundaryMarkers, ['~', '~']);
    assert.deepEqual(exportProof.rejectedFormats, {
      successfulReceipt: true,
      retired: { rejected: true, downloads: 0, receipt: null },
      unknown: { rejected: true, downloads: 0, receipt: null },
    });
    assert.equal(exportProof.retiredShareCard, true);
    console.log('ok Architecture Delta navigator + export: exact identity, complete explorers, static SVG, and no Share Card API');
  }

  async function captureCopiedDiagram(file, label, temporaryState) {
    await navigateReady(file, '!!(window.Archify && Archify.exportMenu && Archify.exportMenu.copyDiagram)', label);
    const copiedPayload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function (temporaryState) {
      var originalCreateObjectURL = URL.createObjectURL;
      var originalAnchorClick = HTMLAnchorElement.prototype.click;
      try {
        var downloadClicks = 0;
        HTMLAnchorElement.prototype.click = function () { downloadClicks += 1; };
        await Archify.exportMenu.run('svg');
        var successfulReceipt = document.documentElement.getAttribute('data-last-export-format');
        var beforeRetired = downloadClicks;
        var retiredError = null;
        try { await Archify.exportMenu.run('share-card'); }
        catch (error) { retiredError = String(error && error.message || error); }
        var retiredReceipt = document.documentElement.getAttribute('data-last-export-format');
        var retiredDownloads = downloadClicks - beforeRetired;
        await Archify.exportMenu.run('svg');
        var beforeUnknown = downloadClicks;
        var unknownError = null;
        try { await Archify.exportMenu.run('not-a-format'); }
        catch (error) { unknownError = String(error && error.message || error); }
        var unknownReceipt = document.documentElement.getAttribute('data-last-export-format');
        var unknownDownloads = downloadClicks - beforeUnknown;
        HTMLAnchorElement.prototype.click = originalAnchorClick;

        var liveSvg = document.querySelector('.diagram-container svg');
        var firstNode = liveSvg.querySelector('[data-node-id]');
        var firstEdge = liveSvg.querySelector('[data-edge-from][data-edge-to]');
        var firstView = document.querySelector('[data-guided-view-id]');
        var temporaryStateActive = false;
        if (temporaryState === 'focus' && firstNode) {
          temporaryStateActive = Archify.focus.set(firstNode.getAttribute('data-node-id'), { toggle: false, updateUrl: false }) === true &&
            liveSvg.hasAttribute('data-focus-active');
        } else if (temporaryState === 'reach' && firstEdge) {
          Archify.focus.set(firstEdge.getAttribute('data-edge-from'), { toggle: false, updateUrl: false });
          Archify.focus.reach('downstream', { toggle: false, updateUrl: false, reveal: false });
          temporaryStateActive = liveSvg.hasAttribute('data-reach-active');
        } else if (temporaryState === 'route' && firstEdge) {
          Archify.routeProbe.begin({ source: firstEdge.getAttribute('data-edge-from'), focusNode: false });
          Archify.routeProbe.choose(firstEdge.getAttribute('data-edge-to'), { updateUrl: false });
          temporaryStateActive = liveSvg.hasAttribute('data-route-active');
        } else if (temporaryState === 'story' && firstView) {
          Archify.guidedViews.activate(firstView.getAttribute('data-guided-view-id'), { updateUrl: false });
          temporaryStateActive = Archify.guidedViews.active() !== null;
        } else if (temporaryState === 'camera') {
          Archify.view.zoomIn();
          temporaryStateActive = Archify.view.state().scale > 1;
        }

        var capturedSvg = null;
        URL.createObjectURL = function (blob) {
          if (!capturedSvg && blob && /^image\/svg\+xml/.test(blob.type || '')) capturedSvg = blob.text();
          return originalCreateObjectURL.call(URL, blob);
        };
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            write: async function (items) {
              window.__archifyCopiedDiagram = await items[0].getType('image/png');
            }
          }
        });
        window.alert = function (message) { window.__archifyCopyAlert = message; };
        var exportButton = document.querySelector('#btn-export');
        var copyButton = document.querySelector('[aria-label="Share"] button[data-action="copy"]');
        var copyDisabled = !copyButton || copyButton.disabled;
        exportButton.click();
        copyButton.click();
        for (var attempt = 0; attempt < 200 && !window.__archifyCopiedDiagram && !window.__archifyCopyAlert; attempt += 1) {
          await new Promise(function (resolve) { setTimeout(resolve, 25); });
        }
        var blob = window.__archifyCopiedDiagram;
        if (!blob) throw new Error(window.__archifyCopyAlert || 'clipboard received no blob');
        var svgText = capturedSvg ? await capturedSvg : '';
        var parser = new DOMParser();
        var exportedSvg = parser.parseFromString(svgText, 'image/svg+xml').documentElement;
        function identities(root, selector, attribute) {
          return Array.from(new Set(Array.from(root.querySelectorAll(selector))
            .map(function (element) { return element.getAttribute(attribute); })
            .filter(Boolean))).sort();
        }
        var topology = {
          liveNodes: identities(liveSvg, '[data-node-id]', 'data-node-id'),
          exportedNodes: identities(exportedSvg, '[data-node-id]', 'data-node-id'),
          liveEdges: identities(liveSvg, '[data-edge-key]', 'data-edge-key'),
          exportedEdges: identities(exportedSvg, '[data-edge-key]', 'data-edge-key'),
          liveBoundaries: identities(liveSvg, '[data-boundary-id]', 'data-boundary-id'),
          exportedBoundaries: identities(exportedSvg, '[data-boundary-id]', 'data-boundary-id')
        };
        var temporaryRootAttributes = [
          'data-focus-active', 'data-reach-active', 'data-lens-active', 'data-route-picking',
          'data-route-active', 'data-route-journey', 'data-story-active', 'data-story-playing',
          'data-story-beat', 'data-story-next', 'data-story-follow', 'data-chapter-handoff',
          'data-chapter-anchor', 'data-chapter-preview'
        ];
        var temporaryResidueSelector = [
          '[data-focus-match]', '[data-focus-selected]', '[data-reach-match]', '[data-reach-origin]',
          '[data-reach-depth]', '[data-semantic-lens-overlay]', '[data-lens-match]', '[data-lens-selected]',
          '[data-lens-peer]', '[data-route-probe-overlay]', '[data-route-journey-overlay]', '[data-route-match]',
          '[data-route-start]', '[data-route-end]', '[data-route-step]', '[data-route-candidate]',
          '[data-route-journey-state]', '[data-route-journey-current]', '[data-story-overlay]',
          '[data-story-carrier-overlay]', '[data-story-carrier-token]', '[data-story-step]',
          '[data-story-beat-state]', '[data-story-beat-step]', '[data-chapter-handoff-overlay]',
          '[data-chapter-role]', '[data-chapter-preview-role]'
        ].join(',');
        var temporaryResidue = {
          rootAttributes: temporaryRootAttributes.filter(function (attribute) { return exportedSvg.hasAttribute(attribute); }),
          descendants: exportedSvg.querySelectorAll(temporaryResidueSelector).length,
          transformed: Boolean(exportedSvg.style.getPropertyValue('transform') || exportedSvg.style.getPropertyValue('clip-path'))
        };
        var bytes = new Uint8Array(await blob.arrayBuffer());
        var binary = '';
        for (var offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
        }
        var vb = document.querySelector('.diagram-container svg').viewBox.baseVal;
        var shareItems = document.querySelectorAll('[aria-label="Share"] button[role="menuitem"]');
        return {
          ok: true,
          type: blob.type,
          size: blob.size,
          base64: btoa(binary),
          viewBox: { width: vb.width, height: vb.height },
          topology: topology,
          temporaryState: { kind: temporaryState, active: temporaryStateActive, residue: temporaryResidue },
          copyDisabled: copyDisabled,
          soleShareAction: shareItems.length === 1 && shareItems[0].dataset.action === 'copy',
          retiredApi: !('shareCard' in Archify.exportMenu) &&
            !('copyShareCard' in Archify.exportMenu) &&
            !('downloadRouteShareCard' in Archify.exportMenu) &&
            !('downloadReachShareCard' in Archify.exportMenu) &&
            !('reachabilitySnapshot' in Archify.focus) &&
            !('exportSnapshot' in Archify.routeProbe),
          retiredFormat: {
            successfulReceipt: successfulReceipt,
            rejected: Boolean(retiredError),
            downloads: retiredDownloads,
            receipt: retiredReceipt
          },
          unknownFormat: {
            rejected: Boolean(unknownError),
            downloads: unknownDownloads,
            receipt: unknownReceipt
          }
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
    })(${JSON.stringify(temporaryState)})`, true), 10_000, `${label} Copy diagram`);

    assert.equal(copiedPayload?.ok, true, copiedPayload?.error || `${label} Copy diagram failed`);
    assert.equal(copiedPayload.type, 'image/png');
    assert.ok(copiedPayload.size > 20_000, `${label} copied diagram is unexpectedly small`);
    assert.equal(copiedPayload.copyDisabled, false, `${label} Copy diagram menu item is disabled`);
    assert.equal(copiedPayload.soleShareAction, true);
    assert.equal(copiedPayload.retiredApi, true);
    assert.deepEqual(copiedPayload.retiredFormat, { successfulReceipt: 'svg', rejected: true, downloads: 0, receipt: null });
    assert.deepEqual(copiedPayload.unknownFormat, { rejected: true, downloads: 0, receipt: null });
    assert.deepEqual(copiedPayload.temporaryState, {
      kind: temporaryState,
      active: true,
      residue: { rootAttributes: [], descendants: 0, transformed: false },
    });
    assert.deepEqual(copiedPayload.topology.exportedNodes, copiedPayload.topology.liveNodes, `${label} copied diagram changed nodes`);
    assert.deepEqual(copiedPayload.topology.exportedEdges, copiedPayload.topology.liveEdges, `${label} copied diagram changed edges`);
    assert.deepEqual(copiedPayload.topology.exportedBoundaries, copiedPayload.topology.liveBoundaries, `${label} copied diagram changed boundaries`);
    const png = Buffer.from(copiedPayload.base64, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} copied output is not a PNG`);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const scale = width / copiedPayload.viewBox.width;
    assert.ok(Number.isInteger(scale) && scale >= 1 && scale <= 4, `${label} unexpected raster scale ${scale}`);
    assert.equal(height, copiedPayload.viewBox.height * scale, `${label} copied diagram changed aspect ratio`);
    console.log(`ok ${label} Copy diagram: ${copiedPayload.size} bytes, ${width}x${height}, complete ${scale}x raster`);
  }

  async function verifyDynamicReducedMotionRoute(file, label, sourceId, targetId) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);
    await navigateReady(file, '!!(window.Archify && Archify.routeProbe && Archify.exportMenu && Archify.motionGovernor)', label);

    async function sourceFingerprint() {
      return evaluate(cdp, sessionId, `JSON.stringify((function () {
        var result = Archify.routeProbe.result();
        return result ? { source: result.source, target: result.target, nodes: result.nodes, hops: result.hops } : null;
      })())`);
    }

    const setup = await evaluate(cdp, sessionId, `(function () {
      Archify.routeProbe.begin({ source: ${JSON.stringify(sourceId)}, focusNode: false });
      if (!Archify.routeProbe.choose(${JSON.stringify(targetId)}, { updateUrl: false })) return { resolved: false };
      Archify.routeProbe.showOverview({ reveal: false });
      return {
        resolved: true,
        started: Archify.routeProbe.playJourney(),
        playing: Archify.routeProbe.isJourneyPlaying(),
        motion: document.documentElement.getAttribute('data-motion')
      };
    })()`);
    assert.deepEqual(setup, { resolved: true, started: true, playing: true, motion: 'live' });
    const before = await sourceFingerprint();

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    }, sessionId);
    let reduced = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      reduced = await evaluate(cdp, sessionId, `({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        motion: document.documentElement.getAttribute('data-motion'),
        playing: Archify.routeProbe.isJourneyPlaying()
      })`);
      if (reduced.matches && reduced.motion === 'still' && !reduced.playing) break;
      await delay(20);
    }
    assert.deepEqual(reduced, { matches: true, motion: 'still', playing: false });
    const after = await sourceFingerprint();
    assert.equal(after, before, `${label} source changed after dynamic reduced-motion paused Journey`);

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);
    console.log(`ok ${label}: dynamic reduced-motion paused Journey without changing the resolved route`);
  }

  await verifyResolvedLegendContract(legendOutputs);
  await verifySemanticPassportDismissal(path.resolve(skillRoot, '../docs/gallery/artifacts/production-deployment.architecture.html'));
  await verifyArchitectureDeltaNavigator(path.resolve(skillRoot, '../examples/checkout-platform-delta.html'));
  const temporaryStates = {
    architecture: 'focus',
    workflow: 'reach',
    sequence: 'route',
    dataflow: 'story',
    lifecycle: 'camera',
  };
  for (const [mode, file] of Object.entries(routeOutputs)) {
    await captureCopiedDiagram(file, `${mode}-complete`, temporaryStates[mode]);
  }
  await verifyDynamicReducedMotionRoute(routeOutputs.architecture, 'architecture-route reduced motion', 'users', 'api');
  await navigateReady(output, '!!(window.Archify && Archify.motion && Archify.motion.canRecord())', 'motion artifact');

  const payload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
    try {
      var blob = await Archify.motion.recordWebm({ duration: 1400, fps: 12 });
      var bytes = new Uint8Array(await blob.arrayBuffer());
      var binary = '';
      for (var offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
      }
      return { ok: true, type: blob.type, size: blob.size, base64: btoa(binary) };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  })()`, true), 20_000, 'WebM recording');
  assert.equal(payload?.ok, true, payload?.error || 'WebM recording failed');
  assert.match(payload.type, /^video\/webm/);
  assert.ok(payload.size > 10_000, `WebM is unexpectedly small (${payload.size} bytes)`);

  const webm = path.join(tmp, 'motion.webm');
  fs.writeFileSync(webm, Buffer.from(payload.base64, 'base64'));
  const frameMd5 = execFileSync(ffmpeg, [
    '-v', 'error',
    '-i', webm,
    '-vf', 'fps=6,scale=320:-2',
    '-f', 'framemd5',
    '-',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const hashes = frameMd5
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1).trim());
  const uniqueFrames = new Set(hashes);

  assert.ok(hashes.length >= 4, `decoded only ${hashes.length} WebM frames`);
  assert.ok(uniqueFrames.size >= 2, 'decoded WebM frames are static');
  console.log(`ok WebM artifact: ${payload.size} bytes, ${hashes.length} sampled frames, ${uniqueFrames.size} unique`);
} finally {
  if (cdp && targetId) await withTimeout(cdp.send('Target.closeTarget', { targetId }), 500, 'target close').catch(() => {});
  if (cdp) cdp.socket.close();
  chromeProcess.kill('SIGTERM');
  if (!(await waitForExit(chromeProcess, 1000))) {
    chromeProcess.kill('SIGKILL');
    await waitForExit(chromeProcess, 1000);
  }
  await removeTempTree(tmp);
}
