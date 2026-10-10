import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyTemplate } from '../archify/renderers/shared/utils.mjs';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('an occurrence-only diagram does not report unavailable relationship queries as zero', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for the native reader regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-query-availability-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const template = fs.readFileSync(path.join(root, 'archify/assets/template.html'), 'utf8');
  const files = {};
  for (const availability of ['omitted', 'complete', 'unavailable', 'unknown']) {
    const declaration = availability === 'omitted' ? '' : `data-relationship-queries="${availability}"`;
    const svg = `<svg viewBox="0 0 600 360" role="img" aria-label="Declared graph" ${declaration}>
      <g data-node-id="source" data-node-label="Source" data-node-kind="component" role="button" tabindex="0" aria-pressed="false"><rect x="80" y="60" width="180" height="64" class="c-backend"/><text x="100" y="90" class="t-primary">Source</text></g>
      <g data-node-id="target" data-node-label="Target" data-node-kind="component" role="button" tabindex="0" aria-pressed="false"><rect x="80" y="200" width="180" height="64" class="c-backend"/><text x="100" y="230" class="t-primary">Target</text></g>
      <path d="M 170 124 L 170 200" data-edge-from="source" data-edge-to="target" data-edge-label="Connects" data-edge-key="connects" class="a-default"/>
    </svg>`;
    files[availability] = path.join(scratch, availability + '.html');
    fs.writeFileSync(files[availability], applyTemplate(template, {
      title: 'Declared graph', subtitle: 'Occurrence reading', svg, cards: '', locale: 'en',
    }));
  }
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.queryErrors=[];
    addEventListener('error',event=>queryErrors.push(event.message));
    addEventListener('unhandledrejection',event=>queryErrors.push(String(event.reason)));
  ` });
  const run = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  for (const availability of ['unavailable', 'omitted', 'complete', 'unknown']) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[availability]).href });
    await loaded;
    await checkPointer();
    await run('document.fonts.ready');
    await run('Archify.viewerChromeLayout.whenStable()');
    await run(`Archify.focus.set('source',{toggle:false})`);
    const incomplete = !['omitted', 'complete'].includes(availability);
    const summary = await run(`document.getElementById('focus-summary').textContent`);
    if (incomplete) assert.match(summary, /unavailable/i);
    else assert.match(summary, /1 outgoing.*0 incoming/);
    assert.equal(await run(`Archify.focus.reach('downstream',{reveal:false})`), !incomplete);
    assert.equal(await run('Archify.focus.reachabilitySnapshot() === null'), incomplete);
    await run('Archify.focus.clear({preserveView:true})');
    assert.equal(await run(`Archify.routeProbe.begin({source:'source',focusNode:false})`), !incomplete);
    if (!incomplete) {
      assert.equal(await run(`Archify.routeProbe.choose('target')`), true);
      assert.deepEqual(await run('Archify.routeProbe.result().nodes'), ['source', 'target']);
    }
    await run('Archify.routeProbe.clear({restoreFocus:false})');
    assert.equal(await run('Archify.routeProbe.exportSnapshot()'), null);
    await run('Archify.semanticLens.open()');
    await run(`Archify.semanticLens.select('component')`);
    const lens = await run(`document.getElementById('semantic-lens-status').textContent`);
    if (incomplete) assert.match(lens, /unavailable/i);
    else assert.match(lens, /2 Component nodes.*1 touching relationship/);
    await run('Archify.semanticLens.clear({closePanel:true})');
    await run('Archify.finder.open()');
    const finder = await run(`document.querySelector('#node-finder-results button').getAttribute('aria-label')`);
    if (incomplete) assert.doesNotMatch(finder, /\d+ related connection/);
    else assert.match(finder, /1 related connection/);
    await run('Archify.finder.close({restoreFocus:false})');
    assert.deepEqual(await run('Archify.guide.facts()'), { nodes: 2, relationships: incomplete ? null : 1 });
    await run('Archify.guide.open()');
    const guide = await run(`document.getElementById('diagram-guide-stats').textContent`);
    if (incomplete) assert.match(guide, /unavailable/i);
    else assert.match(guide, /1 relationship/);
    assert.equal(await run(`document.querySelector('[data-guide-action="route"]').hidden`), incomplete);
    assert.equal(await run(`getComputedStyle(document.querySelector('[data-guide-action="route"]')).display === 'none'`), incomplete);
    assert.equal(await run(`getComputedStyle(document.getElementById('btn-route-probe')).display === 'none'`), incomplete);
    assert.deepEqual(await run('queryErrors'), []);
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const links = new Set(Array.from(readme.matchAll(/\]\((examples\/[^)\s]+\.html)\)/g), match => match[1]));
  const examples = fs.readdirSync(path.join(root, 'examples'))
    .filter(name => name.endsWith('.architecture.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8')).meta.output)
    .filter(output => links.has(output));
  assert.ok(examples.length, 'README links architecture examples with authoritative inputs');
  for (const example of examples) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(path.join(root, example)).href });
    await loaded;
    await run('Archify.viewerChromeLayout.whenStable()');
    const complete = await run('Archify.guide.facts()');
    assert.ok(complete.nodes > 0 && complete.relationships > 0, `${example} has authored graph facts`);
    const id = await run(`document.querySelector('svg [data-edge-from]')?.getAttribute('data-edge-from')`);
    assert.ok(id, `${example} provides an authored relationship`);
    await run(`Archify.focus.set(${JSON.stringify(id)}, {toggle:false,updateUrl:false})`);
    assert.equal(await run(`Archify.focus.reach('downstream',{reveal:false,updateUrl:false})`), true);
    await run('Archify.focus.clear({preserveView:true,updateUrl:false})');
    await run(`document.querySelector('svg').setAttribute('data-relationship-queries', 'unavailable')`);
    await run(`Archify.focus.set(${JSON.stringify(id)}, {toggle:false,updateUrl:false})`);
    assert.match(await run(`document.getElementById('focus-summary').textContent`), /unavailable/i,
      `${example} explains its declared query boundary`);
    assert.equal(await run(`Archify.focus.reach('downstream',{reveal:false,updateUrl:false})`), false);
    assert.equal(await run('Archify.focus.reachabilitySnapshot()'), null);
    assert.deepEqual(await run('Archify.guide.facts()'), { nodes: complete.nodes, relationships: null });
    assert.deepEqual(await run('queryErrors'), []);
  }
});
