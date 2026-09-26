import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome, runVisualCheck } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = configured ? findChrome() : null;
if (configured && !chrome) throw new Error(`ARCHIFY_CHROME is not executable: ${process.env.ARCHIFY_CHROME}`);

// This observer deliberately has no access to either owner's receipt(),
// measure(), stageRect(), or scheduler. In particular, a stale receipt cannot
// repair the geometry before the first observation at joint resolution.
const pageHelpers = `(() => {
  const rounded = value => Math.round(value * 100) / 100;
  const rect = element => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return ['left', 'top', 'right', 'bottom', 'width', 'height'].map(key => rounded(box[key]));
  };
  window.__jointRaw = () => {
    const html = document.documentElement;
    const panel = document.querySelector('.diagram-container');
    const svg = panel.querySelector(':scope > svg');
    const nav = panel.querySelector('.diagram-nav');
    const stage = svg.getBoundingClientRect();
    const dock = nav.getBoundingClientRect();
    return {
      boxes: ['.container', '.header', '.guided-views', '.cards', '.diagram-container',
        '.diagram-container > svg', '.diagram-nav', '[data-legend]']
        .map(selector => [selector, rect(document.querySelector(selector))]),
      reserve: parseFloat(getComputedStyle(panel).getPropertyValue('--archify-nav-reserve')) || 0,
      rail: panel.getAttribute('data-nav-stage-rail'), rootRail: html.getAttribute('data-nav-stage-rail'),
      readerWidth: html.style.getPropertyValue('--archify-reader-width'),
      reader: html.getAttribute('data-reader-layout'), overflow: html.getAttribute('data-reader-overflow'),
      readerFit: svg.getAttribute('data-reader-fit'), theme: html.getAttribute('data-theme'), preset: html.getAttribute('data-preset'),
      dimensions: [innerWidth, innerHeight, html.scrollWidth, html.scrollHeight, document.body.scrollWidth, document.body.scrollHeight],
      viewBox: svg.getAttribute('viewBox'),
      gap: rounded(dock.top - stage.bottom),
      overlap: rounded(Math.max(0, Math.min(stage.right, dock.right) - Math.max(stage.left, dock.left)) *
        Math.max(0, Math.min(stage.bottom, dock.bottom) - Math.max(stage.top, dock.top))),
      fonts: document.fonts ? document.fonts.status : null,
      payloads: Array.from(document.querySelectorAll('script[type="application/json"]'))
        .map(element => [element.id, element.textContent]),
      // Preserve complete live geometry for every within-state convergence
      // comparison, including runtime legend hit areas and count badges.
      semantic: Array.from(svg.querySelectorAll('[data-node-id], [data-edge-id], [data-legend]')).map(element => [
        element.getAttribute('data-node-id') || element.getAttribute('data-edge-id') || 'legend',
        [element, ...element.querySelectorAll('rect, path, line, circle, ellipse, polygon, polyline, text')].map(node =>
          ['transform', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'font-size']
            .map(attribute => node.getAttribute(attribute)))
      ]),
      // Cross-state preservation follows canonical export cleanup's exact
      // runtime-legend boundary. Authored legend geometry remains included.
      authoredSemantic: Array.from(svg.querySelectorAll('[data-node-id], [data-edge-id], [data-legend]')).map(element => [
        element.getAttribute('data-node-id') || element.getAttribute('data-edge-id') || 'legend',
        [element, ...element.querySelectorAll('rect, path, line, circle, ellipse, polygon, polyline, text')]
          .filter(node => !node.closest('[data-legend-bridge-runtime]')).map(node =>
            ['transform', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'font-size']
              .map(attribute => node.getAttribute(attribute)))
      ])
    };
  };
  window.__jointFrames = count => new Promise(resolve => {
    const step = () => { if (--count <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  window.__jointOracle = immediate => new Promise((resolve, reject) => {
    const expected = JSON.stringify(immediate);
    let previous = '', equal = 0, sampled = 0, firstDeviation = null;
    const sample = () => {
      const raw = __jointRaw();
      const current = JSON.stringify(raw);
      sampled++;
      if (current !== expected && !firstDeviation) firstDeviation = { sampledFrame: sampled, raw };
      equal = current === previous ? equal + 1 : 0;
      previous = current;
      if (equal >= 8) return resolve({ raw, firstDeviation });
      if (sampled >= 240) return reject(new Error('Independent eight-frame geometry oracle did not converge'));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  window.__jointCompare = async immediate => {
    // The read-only oracle runs BEFORE any extra readiness API. Otherwise
    // legacy scheduling could repair a missed observer before it is noticed.
    const observation = await __jointOracle(immediate);
    await Archify.readerLayout.whenStable();
    await Archify.viewerChromeLayout.whenStable();
    await Archify.readerLayout.whenStable();
    await Archify.viewerChromeLayout.whenStable();
    const legacy = __jointRaw();
    await Archify.layoutStability.whenStable();
    const second = __jointRaw();
    return { immediate, later: observation.raw, firstDeviation: observation.firstDeviation,
      legacy, second, errors: window.__jointErrors || [] };
  };
})()`;

const helperSetupAssertion = `
  if (!['__jointRaw', '__jointFrames', '__jointOracle', '__jointCompare']
      .every(name => typeof window[name] === 'function')) {
    throw new Error('Joint layout test helper setup failed');
  }
`;

// Wrap native observers only to count actual notifications. All original
// callbacks, entries, observation options and native scheduling pass through.
const observerCounters = `(() => {
  window.__jointErrors = [];
  addEventListener('error', event => __jointErrors.push(event.message));
  addEventListener('unhandledrejection', event => __jointErrors.push(String(event.reason)));
  window.__jointObservers = { resizeReader: 0, resizeChrome: 0, mutationReader: 0, mutationChrome: 0 };
  const reader = element => element.matches && element.matches('.header, .guided-views, .cards');
  const chrome = element => element.matches && element.matches('.diagram-nav, .diagram-container > svg, [data-legend]');
  const Resize = window.ResizeObserver;
  if (Resize) window.ResizeObserver = class extends Resize {
    constructor(callback) { super((entries, observer) => {
      if (entries.some(entry => reader(entry.target))) __jointObservers.resizeReader++;
      if (entries.some(entry => chrome(entry.target))) __jointObservers.resizeChrome++;
      callback(entries, observer);
    }); }
  };
  const Mutation = window.MutationObserver;
  if (Mutation) window.MutationObserver = class extends Mutation {
    constructor(callback) { super((entries, observer) => {
      if (entries.some(entry => reader(entry.target))) __jointObservers.mutationReader++;
      if (entries.some(entry => chrome(entry.target) || entry.target === document.documentElement)) __jointObservers.mutationChrome++;
      callback(entries, observer);
    }); }
  };
})()`;

test('one joint wait preserves real Reader/Chrome convergence at the CLI boundary', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the real joint-layout browser regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-joint-layout-'));
  const records = [];
  const evidence = process.env.ARCHIFY_JOINT_LAYOUT_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  let browser;
  try {
    function render(name, input, repoRoot) {
      const file = path.join(scratch, `${name}.html`);
      execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'),
        'render', 'architecture', path.resolve(skillRoot, input), file,
        ...(repoRoot ? ['--repo-root', repoRoot] : [])], { stdio: 'pipe' });
      return file;
    }
    // Use the existing evidence-browser fixture pattern so preservation covers
    // a verified, nonempty source payload, not just an absent script element.
    const repo = path.join(scratch, 'source-repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'source.js'), 'export function source() {\n  return true;\n}\n');
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init');
    git('add', 'source.js');
    git('-c', 'user.name=Archify Tests', '-c', 'user.email=archify@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'source fixture');
    git('remote', 'add', 'origin', 'https://github.com/example/evidence-repo');
    const wideSource = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
    wideSource.meta.repository = { url: 'https://github.com/example/evidence-repo', revision: git('rev-parse', 'HEAD') };
    wideSource.components[0].sources = [{ path: 'source.js', line: 1, end_line: 3 }];
    const wideInput = path.join(repo, 'wide.json');
    fs.writeFileSync(wideInput, JSON.stringify(wideSource));
    const wide = render('wide', wideInput, repo);
    const intrinsic = render('intrinsic', 'test/fixtures/architecture-viewport/route-expanded-worldscope.architecture.json');
    const pristine = new Map([wide, intrinsic].map(file => [file, fs.readFileSync(file, 'utf8')]));
    function variant(name, base, { before = '', after = '' } = {}) {
      let html = pristine.get(base);
      const anchor = '  <script>\n    var Archify = {};';
      assert.ok(html.includes(anchor), 'Viewer fixture anchor');
      if (before) html = html.replace(anchor, () => `  <script>${before}</script>\n${anchor}`);
      if (after) html = html.replace('</body>', () => `<script>${after}</script>\n</body>`);
      const file = path.join(scratch, `${name}.html`);
      fs.writeFileSync(file, html);
      return file;
    }
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
      return result.result?.value;
    };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `${observerCounters};\n${pageHelpers}` });
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    async function viewport(width = 1440, height = 900) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    }
    async function load(file = wide, { width = 1440, height = 900, theme = 'light' } = {}) {
      await viewport(width, height);
      await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      const navigation = await send('Page.navigate', { url: pathToFileURL(file).href + `?theme=${theme}` });
      assert.equal(navigation.errorText, undefined);
      await loaded;
      await evaluate(helperSetupAssertion);
      await evaluate(`document.documentElement.setAttribute('data-motion', 'still');
        document.querySelector('.diagram-container').setAttribute('data-detail-level', 'read');`);
    }
    function compare(result, label) {
      assert.deepEqual(result.errors, [], `${label}: Viewer errors`);
      assert.equal(result.firstDeviation, null, `${label}: geometry changed after resolution: ${JSON.stringify(result.firstDeviation)}`);
      for (const key of ['later', 'legacy', 'second']) {
        assert.deepEqual(result.immediate, result[key], `${label}: joint resolution differs from ${key}`);
      }
      records.push({ label, ...result });
      return result.immediate;
    }
    async function joint(label, setup = '') {
      return compare(await evaluate(`(async () => {
        ${setup}
        await Archify.layoutStability.whenStable();
        const immediate = __jointRaw();
        return __jointCompare(immediate);
      })()`, true), label);
    }
    function clearStage(raw, label) {
      assert.ok(raw.reserve > 0, `${label}: reserve`);
      assert.ok(raw.gap >= 9, `${label}: stage gap ${raw.gap}`);
      assert.equal(raw.overlap, 0, `${label}: dock/stage overlap`);
      assert.equal(raw.rail, 'true', label);
      assert.equal(raw.rootRail, 'true', label);
      assert.ok(raw.dimensions[2] <= raw.dimensions[0], `${label}: horizontal containment`);
    }
    function unchanged(before, after, label) {
      for (const key of ['viewBox', 'authoredSemantic', 'payloads']) assert.deepEqual(after[key], before[key], `${label}: ${key}`);
    }
    function preservedState(raw) {
      // Baseline resize also recomputes runtime legend decorations. Exclude
      // only those live values from CROSS-state return equality; compare()
      // above still checks every original raw field within each state.
      const preserved = { ...raw };
      delete preserved.semantic;
      preserved.boxes = raw.boxes.filter(([selector]) => selector !== '[data-legend]');
      return preserved;
    }
    function assertRuntimeLegendReturn(actual, expected, label) {
      if (Array.isArray(expected)) {
        assert.ok(Array.isArray(actual), `${label}: array shape`);
        assert.equal(actual.length, expected.length, `${label}: array length`);
        expected.forEach((value, index) => assertRuntimeLegendReturn(actual[index], value, `${label}[${index}]`));
        return;
      }
      const numeric = value => typeof value === 'number'
        || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value));
      if (numeric(actual) && numeric(expected)) {
        assert.ok(Math.abs(Number(actual) - Number(expected)) <= 0.5,
          `${label}: runtime legend geometry changed by more than 0.5px (${expected} -> ${actual})`);
      } else assert.deepEqual(actual, expected, label);
    }
    async function canonicalExport() {
      return evaluate(`(async () => {
        const create = URL.createObjectURL;
        const click = HTMLAnchorElement.prototype.click;
        let svg;
        URL.createObjectURL = function(blob) {
          if (blob.type.startsWith('image/svg+xml')) svg = blob;
          return create.call(URL, blob);
        };
        HTMLAnchorElement.prototype.click = function() {};
        try {
          await Archify.exportMenu.run('svg');
          if (!svg) throw new Error('Canonical SVG export was not captured');
          return { text: await svg.text(), canonical: document.documentElement.getAttribute('data-last-export-canonical') };
        } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
      })()`, true);
    }

    await t.test('CLI visits all six fresh states and captures immediate geometry before collecting metrics', async () => {
      const instrumented = variant('cli', intrinsic, { after: `
        ${helperSetupAssertion}
        window.__jointCalls = { joint: 0, chrome: 0 };
        const joint = Archify.layoutStability.whenStable;
        const chrome = Archify.viewerChromeLayout.whenStable;
        Archify.layoutStability.whenStable = function() {
          __jointCalls.joint++;
          return joint().then(result => { window.__jointAtResolution = __jointRaw(); return result; });
        };
        Archify.viewerChromeLayout.whenStable = function() { __jointCalls.chrome++; return chrome(); };
      ` });
      const states = [];
      const result = await runVisualCheck({ artifactPath: instrumented, chromePath: chrome,
        browserFactory: async () => ({
          inspect: async options => {
            const metrics = await browser.inspect(options);
            assert.deepEqual(await evaluate('__jointCalls'), { joint: 1, chrome: 0 }, 'one CLI joint call; no legacy Chrome call');
            const raw = compare(await evaluate('__jointCompare(__jointAtResolution)', true), `cli-${options.width}-${options.height}-${options.theme}`);
            clearStage(raw, 'CLI');
            assert.deepEqual(raw.dimensions.slice(0, 2), [options.width, options.height], 'actual raw viewport');
            assert.deepEqual([metrics.innerWidth, metrics.innerHeight], [options.width, options.height], 'actual CLI metrics viewport');
            assert.equal(raw.theme, options.theme);
            assert.equal(raw.viewBox, '0 0 980 678');
            assert.equal(raw.readerFit, 'intrinsic-height');
            states.push([options.width, options.height, options.theme]);
            return metrics;
          },
          // The suite owns one browser; the CLI wrapper owns no process.
          close: async () => {},
        }),
      });
      assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
      assert.deepEqual(states, [[1440, 900, 'light'], [1600, 1000, 'light'], [1920, 1080, 'light'],
        [2048, 1320, 'light'], [1440, 900, 'dark'], [2048, 1320, 'dark']]);
      assert.deepEqual(result.receipt.containment.viewports.map(value => [value.width, value.height]), states.slice(0, 4).map(value => value.slice(0, 2)));
      assert.deepEqual(result.receipt.readability.viewports.map(value => [value.width, value.height]), states.slice(0, 4).map(value => value.slice(0, 2)));
    });

    await t.test('native observer feedback converges through reserve and adaptive overflow without changing canonical SVG', async () => {
      await load();
      const before = await joint('feedback-before');
      clearStage(before, 'feedback-before');
      assert.equal(before.reader, 'adaptive');
      const sourcePayload = before.payloads.find(([id]) => id === 'archify-source-evidence-data');
      assert.ok(sourcePayload, 'fixture has embedded verified source evidence');
      assert.equal(JSON.parse(sourcePayload[1]).verified, true);
      const exportedBefore = await canonicalExport();
      assert.equal(exportedBefore.canonical, 'true');
      const after = await joint('feedback-after', `
        Object.keys(__jointObservers).forEach(key => { __jointObservers[key] = 0; });
        document.querySelector('.diagram-nav').style.height = '110px';
        document.querySelector('.header').style.minHeight = '240px';
        document.querySelector('.cards').insertAdjacentHTML('beforeend', '<div class="card" style="height:1200px">Late supporting content</div>');
        document.documentElement.setAttribute('data-preset', 'blueprint');
      `);
      clearStage(after, 'feedback-after');
      assert.equal(after.overflow, 'authored');
      assert.ok(after.dimensions[3] > after.dimensions[1]);
      assert.ok(after.reserve > before.reserve, 'nav resize adds reserve and schedules Reader');
      assert.ok(parseFloat(after.readerWidth) <= parseFloat(before.readerWidth));
      const counts = await evaluate('__jointObservers');
      for (const [name, count] of Object.entries(counts)) assert.ok(count > 0, `native ${name}: ${JSON.stringify(counts)}`);
      unchanged(before, after, 'observer feedback');
      // Restore the visual preset before comparing complete canonical exports.
      await joint('feedback-restored-preset', `document.documentElement.setAttribute('data-preset', ${JSON.stringify(before.preset)});`);
      // Export is intentionally after every immediate/raw geometry assertion.
      const exportedAfter = await canonicalExport();
      assert.equal(exportedAfter.canonical, 'true');
      assert.equal(exportedAfter.text, exportedBefore.text, 'Reader/Chrome changes preserve canonical SVG bytes');
    });

    await t.test('a deferred or rejected reader-only reprobe blocks joint resolution and coalesces', async () => {
      for (const reject of [false, true]) {
        await load();
        const before = await joint(`probe-before-${reject}`);
        const result = await evaluate(`(async () => {
          const original = Archify.readerLayout.whenStable;
          let release;
          const gate = new Promise((resolve, reject) => { release = ${reject} ? () => reject(new Error('held reader probe')) : resolve; });
          Archify.readerLayout.whenStable = () => gate;
          try {
            const first = Archify.viewerChromeLayout.reprobe();
            const second = Archify.viewerChromeLayout.reprobe();
            let resolved = false;
            const waiting = Archify.layoutStability.whenStable().then(() => { resolved = true; return __jointRaw(); });
            await __jointFrames(12);
            const pending = { resolved, same: first === second,
              reserve: document.querySelector('.diagram-container').style.getPropertyValue('--archify-nav-reserve') };
            Archify.readerLayout.whenStable = original;
            release();
            const immediate = await waiting;
            return { pending, probeResult: await first, comparisons: await __jointCompare(immediate) };
          } finally { Archify.readerLayout.whenStable = original; release(); }
        })()`, true);
        assert.deepEqual(result.pending, { resolved: false, same: true, reserve: '' });
        assert.equal(result.probeResult, true);
        const after = compare(result.comparisons, `probe-after-${reject}`);
        clearStage(after, 'probe return');
        unchanged(before, after, 'probe');
      }
    });

    await t.test('initial font readiness blocks the gate through changed nav and reader content', async () => {
      const delayed = variant('initial-font-gate', wide, { before: `
        window.__jointNativeFonts = document.fonts;
        window.__jointFontGate = { status: 'loading', ready: new Promise(resolve => { window.__jointReleaseInitialFont = resolve; }) };
        Object.defineProperty(document, 'fonts', { configurable: true, value: __jointFontGate });
      ` });
      await load(delayed);
      const result = await evaluate(`(async () => {
        let resolved = false;
        const waiting = Archify.layoutStability.whenStable().then(() => { resolved = true; return __jointRaw(); });
        document.querySelector('.diagram-nav').style.height = '100px';
        document.querySelector('.cards').style.minHeight = '450px';
        await __jointFrames(12);
        const beforeReady = resolved;
        __jointFontGate.status = 'loaded';
        __jointReleaseInitialFont();
        const immediate = await waiting;
        const comparisons = await __jointCompare(immediate);
        Object.defineProperty(document, 'fonts', { configurable: true, value: __jointNativeFonts });
        return { beforeReady, comparisons };
      })()`, true);
      assert.equal(result.beforeReady, false);
      clearStage(compare(result.comparisons, 'initial-font-ready'), 'initial-font-ready');
    });

    await t.test('a new native font cycle active during sampling cannot resolve before font/layout readiness', async () => {
      await load();
      const before = await joint('late-font-before');
      // The final bundled face is the Latin subset, including the title text.
      const encoded = [...pristine.get(wide).matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)].at(-1)?.[1];
      assert.ok(encoded, 'use the artifact own bundled WOFF2 bytes');
      await send('Fetch.enable', { patterns: [{ urlPattern: 'https://archify-joint-font.test/*', resourceType: 'Font', requestStage: 'Request' }] });
      const requested = browser.cdp.waitFor('Fetch.requestPaused', session);
      // Observe both outcomes immediately so a request timeout cannot become an
      // unhandled rejection if a preceding page assertion fails.
      const requestOutcome = requested.then(value => ({ value }), error => ({ error }));
      try {
        const held = await evaluate(`(async () => {
          const run = window.__jointFontRun = { resolved: false };
          run.ready = Archify.layoutStability.whenStable().then(() => {
            run.resolved = true;
            run.immediate = __jointRaw();
            run.faceAtResolution = run.face.status;
            return run.immediate;
          });
          await __jointFrames(1);
          run.resolvedAtStart = run.resolved;
          run.face = new FontFace('JointLateFont', 'url("https://archify-joint-font.test/native.woff2")');
          document.fonts.add(run.face);
          document.querySelector('.header h1').style.fontFamily = 'JointLateFont, monospace';
          run.loaded = run.face.load().then(() => {
            document.querySelector('.diagram-nav').style.height = '115px';
            document.querySelector('.cards').style.minHeight = '390px';
          });
          // Register a handler immediately; the awaited copy below still fails.
          run.loaded.catch(() => {});
          await __jointFrames(12);
          return { resolvedAtStart: run.resolvedAtStart, resolvedWhileLoading: run.resolved,
            fonts: document.fonts.status, face: run.face.status };
        })()`, true);
        const outcome = await requestOutcome;
        if (outcome.error) throw outcome.error;
        assert.deepEqual(held, { resolvedAtStart: false, resolvedWhileLoading: false, fonts: 'loading', face: 'loading' });
        await send('Fetch.fulfillRequest', { requestId: outcome.value.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'font/woff2' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: encoded });
        const result = await evaluate(`(async () => {
          const run = __jointFontRun;
          await run.loaded;
          const immediate = await run.ready;
          return { faceAtResolution: run.faceAtResolution, comparisons: await __jointCompare(immediate) };
        })()`, true);
        assert.equal(result.faceAtResolution, 'loaded');
        const after = compare(result.comparisons, 'native-late-font');
        assert.equal(after.fonts, 'loaded');
        clearStage(after, 'native-late-font');
        unchanged(before, after, 'native font');
      } finally { await send('Fetch.disable'); }
    });

    await t.test('intrinsic-height overflow, resize bursts, and mode returns converge at baseline camera', async () => {
      await load(intrinsic);
      const before = await joint('intrinsic-before');
      assert.equal(before.readerFit, 'intrinsic-height');
      const exportedBefore = await canonicalExport();
      assert.equal(exportedBefore.canonical, 'true');
      const overflow = await joint('intrinsic-overflow', `document.querySelector('.cards').style.minHeight = '1200px';`);
      assert.equal(overflow.overflow, 'authored');
      clearStage(overflow, 'intrinsic overflow');
      unchanged(before, overflow, 'intrinsic overflow');
      await joint('intrinsic-content-restored', `document.querySelector('.cards').style.minHeight = '';`);
      for (const mode of ['embed', 'present', 'print']) {
        if (mode === 'print') {
          await send('Emulation.setEmulatedMedia', { media: 'print' });
          await evaluate(`dispatchEvent(new Event('beforeprint'))`);
        } else await evaluate(mode === 'present' ? 'Archify.presentation.enter()'
          : `document.documentElement.setAttribute('data-embed', 'true')`);
        const entered = await joint(`${mode}-entered`);
        assert.equal(entered.reader, null);
        if (mode !== 'present') assert.equal(entered.reserve, 0);
        if (mode === 'print') {
          await send('Emulation.setEmulatedMedia', { media: '' });
          await evaluate(`dispatchEvent(new Event('afterprint'))`);
        } else await evaluate(mode === 'present' ? 'Archify.presentation.exit()'
          : `document.documentElement.removeAttribute('data-embed')`);
        const returned = await joint(`${mode}-returned`);
        clearStage(returned, `${mode} return`);
        unchanged(before, returned, `${mode} return`);
      }
      await viewport(1600, 1000);
      const resized = await joint('resize-theme-burst', `
        for (let i = 0; i < 20; i++) dispatchEvent(new Event('resize'));
        document.documentElement.setAttribute('data-theme', 'dark');
      `);
      clearStage(resized, 'resize/theme burst');
      assert.equal(resized.theme, 'dark');
      unchanged(before, resized, 'resize/theme');
      await viewport();
      const restored = await joint('resize-theme-return', `document.documentElement.setAttribute('data-theme', 'light');`);
      assert.deepEqual(preservedState(restored), preservedState(before), 'return to original authored and Viewer frame geometry');
      const exportedAfter = await canonicalExport();
      assert.equal(exportedAfter.canonical, 'true');
      assert.equal(exportedAfter.text, exportedBefore.text, 'resize and mode returns preserve canonical SVG bytes');
    });

    await t.test('optional-observer fallback retains joint scheduling on viewport changes', async () => {
      const fallback = variant('no-observers', wide, { before: 'window.ResizeObserver = undefined; window.MutationObserver = undefined;' });
      await load(fallback);
      const before = await joint('fallback-before');
      await viewport(720, 900);
      const mobile = await joint('fallback-mobile');
      assert.equal(mobile.reader, null);
      assert.equal(mobile.reserve, 0);
      await viewport();
      const after = await joint('fallback-return');
      clearStage(after, 'fallback return');
      // Linux Chrome remeasures the runtime legend text after a mobile return:
      // CI 35750261802 retained the exact 1068px reader, authored SVG, payloads,
      // stage gap and viewport, but legend bounds changed by at most 0.27px.
      // Keep all authored/frame state exact and limit tolerance to that legend.
      // joint() still requires exact eight-frame convergence within each state.
      assert.deepEqual(preservedState(after), preservedState(before));
      assertRuntimeLegendReturn(after.boxes.find(([selector]) => selector === '[data-legend]'),
        before.boxes.find(([selector]) => selector === '[data-legend]'), 'fallback legend bounds');
      assert.equal(after.semantic.length, before.semantic.length);
      before.semantic.forEach((entry, index) => {
        if (entry[0] === 'legend') assertRuntimeLegendReturn(after.semantic[index], entry, 'fallback runtime legend');
        else assert.deepEqual(after.semantic[index], entry, 'fallback authored geometry');
      });
    });
    for (const [file, original] of pristine) assert.equal(fs.readFileSync(file, 'utf8'), original, 'canonical artifact bytes remain untouched');
  } finally {
    if (evidence) fs.writeFileSync(path.join(evidence, 'joint-layout-observations.json'), `${JSON.stringify(records, null, 2)}\n`);
    if (browser) await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
