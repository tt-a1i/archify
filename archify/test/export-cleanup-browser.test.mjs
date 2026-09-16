import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const cases = {
  architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

test('Export cleanup preserves canonical artifacts and live interaction state', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser export checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-cleanup-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_EXPORT_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    const file = path.join(scratch, `${mode}.html`);
    if (process.env.ARCHIFY_EXPORT_BASELINE_DIR) {
      fs.copyFileSync(path.join(process.env.ARCHIFY_EXPORT_BASELINE_DIR, `${mode}.html`), file);
    } else {
      execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
        path.join(skillRoot, 'examples', example), file]);
    }
    files[mode] = file;
  }
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.exportTestErrors = [];
    addEventListener('error', e => exportTestErrors.push(e.message));
    addEventListener('unhandledrejection', e => exportTestErrors.push(String(e.reason)));` });
  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  async function load(file, theme = 'dark', reduced = false) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const result = await send('Page.navigate', { url: pathToFileURL(file).href + `?theme=${theme}` });
    assert.equal(result.errorText, undefined);
    await loaded;
    await evaluate('(async () => { await document.fonts.ready; await Archify.readerLayout.whenStable(); await Archify.viewerChromeLayout.whenStable(); })()', true);
    assert.deepEqual(await evaluate('exportTestErrors'), []);
  }
  async function exported(label, action = '') {
    // Capture the SVG synchronously at the public export call. Timers and
    // animation frames cannot explain away a live-DOM mutation by cleanup.
    const value = await evaluate(`(async () => {
      ${action}
      const svg = document.querySelector('.diagram-container > svg');
      const before = svg.outerHTML;
      const original = URL.createObjectURL;
      let blob;
      URL.createObjectURL = function (value) {
        if (value.type.startsWith('image/svg+xml')) blob = value;
        return original.call(URL, value);
      };
      let after;
      try {
        const pending = Archify.exportMenu.run('svg');
        after = svg.outerHTML;
        await pending;
      } finally { URL.createObjectURL = original; }
      if (!blob) throw new Error('Export did not produce SVG');
      const text = await blob.text();
      const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      const transient = root.querySelectorAll('[data-focus-selected], [data-reach-match], [data-lens-selected], [data-intent-trace-overlay], [data-route-probe-overlay], [data-route-journey-overlay], [data-story-overlay], [data-chapter-preview-role], [data-source-evidence-beacon], [data-relationship-hit-overlay]');
      return { text, liveUnchanged: before === after, transientCount: transient.length,
        geometry: root.getAttribute('viewBox'), liveGeometry: svg.getAttribute('viewBox'),
        rootClean: !['data-view-scale', 'data-focus-active', 'data-reach-active', 'data-route-active', 'data-lens-active', 'data-story-active', 'data-share-route', 'data-share-reach'].some(a => root.hasAttribute(a)),
        resources: performance.getEntriesByType('resource').map(e => e.name).filter(n => /^https?:/.test(n)), errors: exportTestErrors };
    })()`, true);
    assert.equal(value.liveUnchanged, true, `${label}: live SVG changed`);
    assert.equal(value.transientCount, 0, label);
    assert.equal(value.rootClean, true, label);
    assert.equal(value.geometry, value.liveGeometry, label);
    assert.deepEqual(value.resources, [], label);
    assert.deepEqual(value.errors, [], label);
    if (evidence) fs.writeFileSync(path.join(evidence, `${label}.svg`), value.text);
    const { text, ...observation } = value;
    records.push({ label, ...observation });
    return text;
  }

  await t.test('five modes export standalone SVG in both themes and reduced motion', async () => {
    for (const [mode, file] of Object.entries(files)) {
      for (const theme of ['dark', 'light']) {
        await load(file, theme, theme === 'light');
        await exported(`${mode}-${theme}`);
      }
    }
  });

  await t.test('real zoom, focus, preview, lens, story and route actions leave exports clean', async () => {
    await load(files.architecture);
    const pristine = await exported('interaction-pristine');
    const actions = {
      zoom: `Archify.view.zoomIn();`,
      focus: `if (!Archify.focus.set('api', { toggle: false, updateUrl: false })) throw new Error('focus failed');`,
      preview: `if (!Archify.intentTrace.show('api')) throw new Error('preview failed');`,
      lens: `Archify.semanticLens.select('backend'); if (!Archify.semanticLens.active()) throw new Error('lens failed');`,
      story: `Archify.guidedViews.activate('request-path', { updateUrl: false }); Archify.guidedViews.playCurrent(); if (!Archify.guidedViews.isPlaying()) throw new Error('story failed');`,
      route: `Archify.routeProbe.begin({ source: 'users', focusNode: false }); if (!Archify.routeProbe.choose('db', { updateUrl: false })) throw new Error('route failed');`,
      upstream: `Archify.focus.set('api', { toggle: false, updateUrl: false }); if (!Archify.focus.reach('upstream', { toggle: false, updateUrl: false, reveal: false })) throw new Error('reach failed');`,
      downstream: `Archify.focus.set('api', { toggle: false, updateUrl: false }); if (!Archify.focus.reach('downstream', { toggle: false, updateUrl: false, reveal: false })) throw new Error('reach failed');`,
    };
    for (const [name, action] of Object.entries(actions)) {
      await load(files.architecture);
      const text = await exported(`active-${name}`, action);
      // Existing style.removeProperty calls can leave empty style attributes.
      // Apart from that inert serialization detail, compare the entire SVG.
      assert.equal(text.replace(/ style=""/g, ''), pristine.replace(/ style=""/g, ''), name);
    }
  });

  await t.test('raster and share-card exports preserve dimensions and current theme', async () => {
    for (const theme of ['dark', 'light']) {
      await load(files.architecture, theme, theme === 'light');
      for (const format of ['png', 'jpeg', 'webp', 'share-card']) {
        const result = await evaluate(`(async () => {
          Archify.focus.set('api', { toggle: false, updateUrl: false });
          const format = ${JSON.stringify(format)};
          const original = URL.createObjectURL;
          let blob;
          URL.createObjectURL = function (value) {
            if (value.type.startsWith('image/') && value.type !== 'image/svg+xml') blob = value;
            return original.call(URL, value);
          };
          try {
            if (format === 'share-card') blob = await Archify.exportMenu.shareCard();
            else await Archify.exportMenu.run(format);
          } finally { URL.createObjectURL = original; }
          if (!blob) throw new Error('Missing raster export');
          const bitmap = await createImageBitmap(blob);
          const dimensions = [bitmap.width, bitmap.height];
          bitmap.close();
          const svg = document.querySelector('.diagram-container > svg');
          const expected = format === 'share-card' ? [1200, 630] : [svg.viewBox.baseVal.width * 4, svg.viewBox.baseVal.height * 4];
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return { data, dimensions, expected, type: blob.type, errors: exportTestErrors };
        })()`, true);
        assert.deepEqual(result.dimensions, result.expected);
        assert.equal(result.type, format === 'share-card' ? 'image/png' : `image/${format}`);
        assert.deepEqual(result.errors, []);
        const label = `${theme}-${format}`;
        if (evidence) fs.writeFileSync(path.join(evidence, `${label}.${format === 'share-card' ? 'png' : format}`), Buffer.from(result.data, 'base64'));
        const { data, ...observation } = result;
        records.push({ label, ...observation });
      }
    }
  });

  // Private checks supplement the real public exports. The hook exists only in
  // this disposable test artifact; production receives no testing interface.
  const html = fs.readFileSync(files.architecture, 'utf8');
  let cleanup = html.match(/function cleanExportClone\(clone\) \{[\s\S]*?\n      \}/)?.[0];
  if (!cleanup && process.env.ARCHIFY_EXPORT_BASELINE_DIR) {
    const start = html.indexOf('        // View transforms and neighborhood focus');
    const end = html.indexOf('        var vb = svg.viewBox.baseVal;', start);
    assert.ok(start >= 0 && end > start);
    cleanup = `function cleanExportClone(clone) {\n${html.slice(start, end)}return canonicalStateClean;\n}`;
  }
  assert.ok(cleanup, 'the extracted cleanup implementation is present');
  const cleanupReference = html.includes('function cleanExportClone(clone)') ? 'cleanExportClone' : cleanup;
  const hooked = html.replace('      function download(blob, filename) {',
    `      window.exportCleanupTest = { serialize: serializeSvg, clean: ${cleanupReference} };\n      function download(blob, filename) {`);
  assert.notEqual(hooked, html);
  const privateFile = path.join(scratch, 'private.html');
  fs.writeFileSync(privateFile, hooked);

  await t.test('clone restoration, preservation and repeated cleanup are independent of live DOM', async () => {
    await load(privateFile);
    const result = await evaluate(`(() => {
      const svg = document.querySelector('.diagram-container > svg');
      const before = svg.outerHTML;
      const clone = svg.cloneNode(true);
      // A small authored fragment is the independent preservation oracle.
      const group = document.createElementNS(svg.namespaceURI, 'g');
      group.setAttribute('id', 'authored-preservation');
      group.setAttribute('data-node-id', 'authored');
      group.setAttribute('data-animate', 'node');
      group.innerHTML = '<path d="M 0 0 L 10 20" transform="translate(3 4)"/><text>Keep 中文 &amp; text</text>';
      clone.appendChild(group);
      const authored = group.outerHTML;
      const labels = ['original', '', null].map((value, i) => {
        const node = document.createElementNS(svg.namespaceURI, 'g');
        node.setAttribute('id', 'restore-' + i);
        node.setAttribute('aria-label', 'runtime label');
        node.setAttribute('data-source-evidence-count', '2');
        if (value !== null) node.setAttribute('data-source-evidence-original-label', value);
        clone.appendChild(node);
        return node;
      });
      clone.setAttribute('data-share-route', 'true');
      clone.setAttribute('data-share-reach', 'upstream');
      group.setAttribute('data-share-route-match', '');
      group.setAttribute('data-share-reach-match', '');
      const clean = exportCleanupTest.clean(clone);
      const once = clone.outerHTML;
      const twiceClean = exportCleanupTest.clean(clone);
      const empty = document.createElementNS(svg.namespaceURI, 'svg');
      empty.setAttribute('viewBox', '0 0 100 50');
      const emptyBefore = empty.outerHTML;
      const emptyClean = exportCleanupTest.clean(empty);
      const orphan = document.createElementNS(svg.namespaceURI, 'g');
      orphan.setAttribute('data-story-carrier-token', 'true');
      const residual = empty.cloneNode(true);
      residual.appendChild(orphan);
      const residualClean = exportCleanupTest.clean(residual);
      return { clean, twiceClean, unchanged: before === svg.outerHTML, idempotent: once === clone.outerHTML,
        authored: group.outerHTML === authored, labels: labels.map(n => n.getAttribute('aria-label')),
        restorationRecords: clone.querySelectorAll('[data-source-evidence-count], [data-source-evidence-original-label]').length,
        shares: clone.hasAttribute('data-share-route') || clone.hasAttribute('data-share-reach'),
        residualClean, emptyClean, emptyUnchanged: emptyBefore === empty.outerHTML };
    })()`);
    assert.deepEqual(result, { clean: true, twiceClean: true, unchanged: true, idempotent: true,
      authored: true, labels: ['original', null, null], restorationRecords: 0, shares: false,
      residualClean: false, emptyClean: true, emptyUnchanged: true });
    records.push({ label: 'restoration', ...result });
  });

  await t.test('share decoration follows cleanup and preserves snapshot rejection behavior', async () => {
    for (const variant of ['route', 'upstream', 'downstream']) {
      await load(privateFile);
      const result = await evaluate(`(() => {
        const variant = ${JSON.stringify(variant)};
        let snapshot;
        if (variant === 'route') {
          Archify.routeProbe.begin({ source: 'users', focusNode: false });
          Archify.routeProbe.choose('db', { updateUrl: false });
          snapshot = Archify.routeProbe.exportSnapshot();
        } else {
          Archify.focus.set('api', { toggle: false, updateUrl: false });
          Archify.focus.reach(variant, { toggle: false, updateUrl: false, reveal: false });
          snapshot = Archify.focus.reachabilitySnapshot();
        }
        if (!snapshot) throw new Error('missing ' + variant + ' snapshot');
        const key = variant === 'route' ? 'routeSnapshot' : 'reachSnapshot';
        const field = variant === 'route' ? 'routeStateClean' : 'reachStateClean';
        const svg = document.querySelector('.diagram-container > svg');
        const before = svg.outerHTML;
        const data = exportCleanupTest.serialize(1, { [key]: snapshot });
        const rejected = exportCleanupTest.serialize(1, { [key]: { ...snapshot, nodeIds: [] } });
        const viewBox = svg.getAttribute('viewBox');
        svg.setAttribute('viewBox', '0 0 0 0');
        const invalidDimensions = exportCleanupTest.serialize(1, { [key]: snapshot });
        svg.setAttribute('viewBox', viewBox);
        const root = new DOMParser().parseFromString(data.svgString, 'image/svg+xml').documentElement;
        return { text: data.svgString, canonical: data.canonicalStateClean, accepted: data[field],
          rejected: rejected[field], invalidDimensions: invalidDimensions[field], unchanged: before === svg.outerHTML,
          route: root.hasAttribute('data-share-route'), reach: root.getAttribute('data-share-reach'),
          ids: [...root.querySelectorAll('[data-share-route-match][data-node-id], [data-share-reach-match][data-node-id]')].map(n => n.getAttribute('data-node-id')).sort(),
          expectedIds: snapshot.nodeIds.slice().sort() };
      })()`);
      assert.equal(result.canonical, true);
      assert.equal(result.accepted, true);
      assert.equal(result.rejected, false);
      assert.equal(result.invalidDimensions, false);
      assert.equal(result.unchanged, true);
      assert.equal(result.route, variant === 'route');
      assert.equal(result.reach, variant === 'route' ? null : variant);
      assert.deepEqual(result.ids, result.expectedIds);
      if (evidence) fs.writeFileSync(path.join(evidence, `share-${variant}.svg`), result.text);
      const { text, ...observation } = result;
      records.push({ label: `share-${variant}`, ...observation });
    }
  });
});
