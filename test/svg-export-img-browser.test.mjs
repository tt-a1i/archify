import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { buildPrPack } from '../archify/pr/build.mjs';
import { exportSvgArtifacts } from '../archify/renderers/shared/svg-export.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { git } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function changeSequence() {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Checkout change pack', output: 'change.html' },
    participants: [
      { id: 'web', label: 'Web', type: 'frontend' },
      { id: 'api', label: 'Checkout API', type: 'backend', change: 'modified' },
      { id: 'ledger', label: 'Ledger', type: 'database', change: 'added' },
      { id: 'legacy', label: 'Legacy Pay', type: 'security', change: 'removed' },
    ],
    messages: [
      { id: 'm-create', from: 'web', to: 'api', y: 180, label: 'POST /checkout', change: 'modified' },
      { id: 'm-ledger', from: 'api', to: 'ledger', y: 250, label: 'append()', change: 'added' },
      { id: 'm-legacy', from: 'api', to: 'legacy', y: 320, label: 'charge()', change: 'removed' },
      { id: 'm-done', from: 'api', to: 'web', y: 390, label: '200 OK', variant: 'return' },
    ],
  };
}

// GitHub renders PR images through Camo inside a plain <img>: no scripts, no
// external fetches, no stylesheet from the page. This host page mimics that
// surface with file:// and data: sources and a prefers-color-scheme <picture>.
function hostPage(light, dark) {
  const dataUrl = (file) => `data:image/svg+xml;base64,${fs.readFileSync(file).toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#777}img{display:block}</style></head><body>
<img id="light-file" src="${pathToFileURL(light).href}" alt="light">
<img id="dark-file" src="${pathToFileURL(dark).href}" alt="dark">
<img id="light-data" src="${dataUrl(light)}" alt="light data">
<img id="dark-data" src="${dataUrl(dark)}" alt="dark data">
<a id="picture-link" href="${pathToFileURL(light).href}"><picture><source media="(prefers-color-scheme: dark)" srcset="${pathToFileURL(dark).href}"><img id="picture" alt="Checkout change pack" src="${pathToFileURL(light).href}"></picture></a>
</body></html>`;
}

async function openHost(t, hostFile, colorScheme) {
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.pageErrors=[];addEventListener('error',e=>pageErrors.push(e.message));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(hostFile).href });
  await loaded;
  await run(`Promise.all([...(document.images || [])].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })))`);
  return { run, send };
}

// Opens the baked SVG as the document itself so its geometry can be measured;
// the file carries no scripts, so only the test's own CDP evaluation runs.
async function measureSvg(t, svgFile, colorScheme) {
  const { run } = await openHost(t, svgFile, colorScheme);
  return run(`(() => {
    const root = document.documentElement;
    const rootBox = root.getBoundingClientRect();
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const inside = (r) => r.left >= rootBox.left - 0.5 && r.top >= rootBox.top - 0.5 && r.right <= rootBox.right + 0.5 && r.bottom <= rootBox.bottom + 0.5;
    const visible = (el) => {
      for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
        if (getComputedStyle(cur).display === 'none') return false;
      }
      return true;
    };
    const texts = [...document.querySelectorAll('text')].filter((el) => el.textContent.trim() && !el.closest('defs') && visible(el))
      .map((el) => ({ text: el.textContent.trim(), ...box(el), inside: inside(el.getBoundingClientRect()), decoration: getComputedStyle(el).textDecorationLine }));
    const badges = [...document.querySelectorAll('[data-change-badge]')].map((el) => {
      const mask = el.querySelector('rect.c-mask');
      const rect = el.querySelector('rect:not(.c-mask)') || el.querySelector('rect');
      const glyph = el.querySelector('text');
      const r = box(rect), g = box(glyph);
      return { change: el.getAttribute('data-change-badge'), hasMask: Boolean(mask), rect: r, glyph: g, inside: inside(rect.getBoundingClientRect()),
        glyphInside: g.left >= r.left - 0.5 && g.right <= r.right + 0.5 && g.top >= r.top - 0.5 && g.bottom <= r.bottom + 0.5 };
    });
    const edgePrefixes = [...document.querySelectorAll('tspan[class*="t-change-badge-"]')].map((el) => {
      const r = box(el);
      return { text: el.textContent.trim(), ...r, inside: inside(el.getBoundingClientRect()) };
    });
    const nodeLabels = [...document.querySelectorAll('text[data-node-label]')].map((el) => ({
      text: el.textContent.trim(), ...box(el),
    }));
    const removed = [...document.querySelectorAll('[data-change="removed"]')].map((el) => {
      const shapes = [...el.querySelectorAll('rect, path, circle, polygon')].concat(el.matches('rect, path') ? [el] : []);
      return { dashed: shapes.some((shape) => getComputedStyle(shape).strokeDasharray !== 'none'),
        struck: [...el.querySelectorAll('text')].some((text) => getComputedStyle(text).textDecorationLine.includes('line-through')),
        opacity: Number(getComputedStyle(el).opacity) };
    });
    return { root: { width: rootBox.width, height: rootBox.height }, texts, badges, edgePrefixes, nodeLabels, removed, errors: pageErrors };
  })()`);
}

function viewBoxOf(svgFile) {
  const [, viewBox] = fs.readFileSync(svgFile, 'utf8').match(/<svg\b[^>]*\sviewBox="([^"]+)"/);
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  return { width, height };
}

const PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];

for (const preset of PRESETS) test(`baked ${preset} SVGs render inside a sandboxed <img> with their authored size in both themes`, {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser SVG export checks.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), `archify-svg-export-img-${preset}-`));
  const input = path.join(scratch, 'change.sequence.json');
  fs.writeFileSync(input, JSON.stringify(changeSequence()));
  const receipt = await exportSvgArtifacts({ type: 'sequence', input, output: path.join(scratch, `change-${preset}`), preset });
  assert.equal(receipt.preset, preset);
  const light = receipt.outputs.find((entry) => entry.theme === 'light').path;
  const dark = receipt.outputs.find((entry) => entry.theme === 'dark').path;
  for (const file of [light, dark]) {
    const svg = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(svg, /color-mix\(/, `${preset} ${path.basename(file)} expands color-mix statically`);
    assert.doesNotMatch(svg, /var\(--/, `${preset} ${path.basename(file)} resolves every custom property`);
  }
  const hostFile = path.join(scratch, 'host.html');
  fs.writeFileSync(hostFile, hostPage(light, dark));
  const expected = viewBoxOf(light);
  assert.deepEqual(viewBoxOf(dark), expected);

  for (const scheme of ['dark', 'light']) {
    const { run } = await openHost(t, hostFile, scheme);
    const state = await run(`(() => {
      const sizes = Object.fromEntries([...document.images].map((img) => [img.id, { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: img.getBoundingClientRect().width }]));
      const picture = document.getElementById('picture');
      const sample = (id) => {
        const img = document.getElementById(id);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const corner = [data[0], data[1], data[2], data[3]];
        const colours = new Set();
        let differing = 0;
        for (let index = 0; index < data.length; index += 16) {
          const key = (data[index] >> 4) + ',' + (data[index + 1] >> 4) + ',' + (data[index + 2] >> 4);
          colours.add(key);
          if (Math.abs(data[index] - corner[0]) + Math.abs(data[index + 1] - corner[1]) + Math.abs(data[index + 2] - corner[2]) > 48) differing += 1;
        }
        return { corner, distinctColours: colours.size, differingShare: differing / (data.length / 16) };
      };
      return { sizes, currentSrc: picture.currentSrc, lightPixels: sample('light-data'), darkPixels: sample('dark-data'), errors: pageErrors };
    })()`);
    assert.deepEqual(state.errors, []);
    for (const [id, size] of Object.entries(state.sizes)) {
      assert.equal(size.complete, true, `${id} loaded`);
      assert.equal(size.naturalWidth, expected.width, `${id} natural width equals the viewBox width`);
      assert.equal(size.naturalHeight, expected.height, `${id} natural height equals the viewBox height`);
      assert.ok(size.width > 0, `${id} is laid out`);
    }
    assert.ok(state.currentSrc.endsWith(scheme === 'dark' ? path.basename(dark) : path.basename(light)), `picture picks the ${scheme} source (${state.currentSrc})`);
    const [lr, lg, lb, la] = state.lightPixels.corner;
    const [dr, dg, db, da] = state.darkPixels.corner;
    assert.equal(la, 255, 'light export paints an opaque background');
    assert.equal(da, 255, 'dark export paints an opaque background');
    assert.ok(lr + lg + lb > 600, `light background is light (${state.lightPixels.corner})`);
    assert.ok(dr + dg + db < 150, `dark background is dark (${state.darkPixels.corner})`);
    for (const [theme, pixels] of [['light', state.lightPixels], ['dark', state.darkPixels]]) {
      assert.ok(pixels.distinctColours >= 12, `${theme} export draws nodes, arrows, change marks and legend (${pixels.distinctColours} colour buckets)`);
      assert.ok(pixels.differingShare > 0.02 && pixels.differingShare < 0.9, `${theme} export has visible content over the background (${pixels.differingShare})`);
    }

    const geometry = await measureSvg(t, scheme === 'dark' ? dark : light, scheme);
    const where = `${preset}/${scheme}`;
    assert.deepEqual(geometry.errors, [], `${where}: no page errors`);
    assert.deepEqual({ width: geometry.root.width, height: geometry.root.height }, expected, `${where}: document renders at the authored size`);
    assert.ok(geometry.texts.length >= 8, `${where}: labels, messages and legend text present`);
    for (const text of geometry.texts) {
      assert.ok(text.width > 0 && text.height > 0, `${where}: "${text.text}" is laid out`);
      assert.ok(text.inside, `${where}: "${text.text}" stays inside the viewBox`);
    }
    assert.equal(geometry.badges.map((badge) => badge.change).sort().join(','), 'added,modified,removed', `${where}: one badge per marked participant`);
    for (const [index, badge] of geometry.badges.entries()) {
      assert.equal(badge.hasMask, true, `${where}: ${badge.change} badge includes opaque .c-mask`);
      assert.ok(badge.inside, `${where}: ${badge.change} badge stays inside the viewBox`);
      assert.ok(badge.glyphInside, `${where}: ${badge.change} badge glyph sits inside its pill ${JSON.stringify(badge)}`);
      for (const other of geometry.badges.slice(index + 1)) {
        const separated = badge.rect.right <= other.rect.left || other.rect.right <= badge.rect.left || badge.rect.bottom <= other.rect.top || other.rect.bottom <= badge.rect.top;
        assert.ok(separated, `${where}: badges overlap ${JSON.stringify([badge.rect, other.rect])}`);
      }
      for (const label of geometry.nodeLabels) {
        const clearOfLabel = badge.rect.right <= label.left || label.right <= badge.rect.left || badge.rect.bottom <= label.top || label.bottom <= badge.rect.top;
        assert.ok(clearOfLabel, `${where}: ${badge.change} badge overlaps node label "${label.text}"`);
      }
    }
    assert.equal(geometry.edgePrefixes.map((prefix) => prefix.text).sort().join(','), '+,~,\u2212', `${where}: marked messages carry inline change prefixes`);
    for (const prefix of geometry.edgePrefixes) {
      assert.ok(prefix.width > 0 && prefix.height > 0 && prefix.inside, `${where}: inline prefix "${prefix.text}" laid out inside viewBox`);
    }
    assert.equal(geometry.removed.length, 2, `${where}: removed participant and message keep their ghosts`);
    for (const ghost of geometry.removed) {
      assert.ok(ghost.dashed, `${where}: removed ghost is drawn dashed ${JSON.stringify(ghost)}`);
      assert.ok(ghost.struck, `${where}: removed label is struck through ${JSON.stringify(ghost)}`);
      assert.ok(ghost.opacity < 1 && ghost.opacity > 0.3, `${where}: removed ghost stays legible (${ghost.opacity})`);
    }
  }
});

function v2BrowserFixtures() {
  const erd = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'orders.erd.json'), 'utf8'));
  erd.entities[0].change = 'modified';
  erd.entities[0].attributes[1].change = 'modified';
  erd.entities[0].attributes[1].previousType = 'int';
  erd.entities[0].attributes[1].type = 'bigint';
  erd.entities[0].attributes.push({ name: 'legacy_token', type: 'varchar(64)', change: 'removed' });
  delete erd.entities[0].width;

  const cls = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payments.class.json'), 'utf8'));
  cls.types[0].change = 'modified';
  cls.types[0].attributes.push(
    { name: 'amount', type: 'bigint', previousType: 'int', visibility: 'private', change: 'modified' },
    { name: 'legacyKey', type: 'string', visibility: 'private', change: 'removed' },
  );
  cls.types[3].change = 'added';
  cls.types[4].change = 'removed';
  cls.relationships[0].change = 'added';

  const tree = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payment-platform.tree.json'), 'utf8'));
  tree.nodes[1].change = 'added';
  tree.nodes[2].change = 'modified';
  tree.nodes.at(-1).change = 'removed';

  const timeline = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payment-incident.timeline.json'), 'utf8'));
  timeline.lanes[0].change = 'modified';
  timeline.events[0].change = 'added';
  timeline.events[1].change = 'modified';
  timeline.events[3].change = 'removed';

  const waterfall = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'checkout-request.waterfall.json'), 'utf8'));
  waterfall.spans[1].change = 'added';
  waterfall.spans[2].change = 'modified';
  waterfall.spans[3].change = 'removed';

  const arch = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  const api = arch.components.find((component) => component.id === 'api');
  const cache = arch.components.find((component) => component.id === 'cache');
  const worker = arch.components.find((component) => component.id === 'worker');
  const db = arch.components.find((component) => component.id === 'db');
  db.brand = 'postgresql';
  db.change = 'modified';
  api.change = 'modified';
  cache.change = 'added';
  worker.change = 'removed';
  arch.boundaries[0].change = 'modified';
  arch.connections[0].change = 'added';

  return { architecture: arch, erd, class: cls, tree, timeline, waterfall };
}

for (const [type, document] of Object.entries(v2BrowserFixtures())) {
  test(`V2 baked ${type} change marks keep non-overlapping Chrome geometry in light and dark themes`, {
    skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser SVG export checks.',
  }, async (t) => {
    const scratch = createScratchDirectory(path.join(os.tmpdir(), `archify-v2-${type}-`));
    const input = path.join(scratch, `${type}.json`);
    fs.writeFileSync(input, JSON.stringify(document));
    const receipt = await exportSvgArtifacts({ type, input, output: path.join(scratch, type), preset: 'classic' });
    for (const output of receipt.outputs) {
      const svg = fs.readFileSync(output.path, 'utf8');
      assert.doesNotMatch(svg, /color-mix\(/, `${type}/${output.theme} expands color-mix statically`);
      assert.doesNotMatch(svg, /var\(--/, `${type}/${output.theme} resolves every CSS variable`);
      const geometry = await measureSvg(t, output.path, output.theme);
      const where = `${type}/${output.theme}`;
      assert.deepEqual(geometry.errors, [], `${where}: zero page errors`);
      assert.ok(geometry.badges.length >= 2, `${where}: renders change badges`);
      for (const text of geometry.texts) {
        assert.ok(text.width > 0 && text.height > 0 && text.inside, `${where}: text "${text.text}" fits inside viewBox`);
      }
      if (type === 'erd' || type === 'class') {
        assert.ok(geometry.texts.some((text) => text.text.includes('int → bigint')), `${where}: renders type migration`);
      }
      for (const [index, badge] of geometry.badges.entries()) {
        assert.equal(badge.hasMask, true, `${where}: ${badge.change} badge uses .c-mask`);
        assert.ok(badge.inside && badge.glyphInside, `${where}: badge geometry valid ${JSON.stringify(badge)}`);
        for (const other of geometry.badges.slice(index + 1)) {
          const separated = badge.rect.right <= other.rect.left || other.rect.right <= badge.rect.left || badge.rect.bottom <= other.rect.top || other.rect.bottom <= badge.rect.top;
          assert.ok(separated, `${where}: badges must not overlap ${JSON.stringify([badge.rect, other.rect])}`);
        }
        for (const label of geometry.nodeLabels) {
          const clearOfLabel = badge.rect.right <= label.left || label.right <= badge.rect.left || badge.rect.bottom <= label.top || label.bottom <= badge.rect.top;
          assert.ok(clearOfLabel, `${where}: badge overlaps node label "${label.text}"`);
        }
      }
    }
  });
}

test('pr build story walkthrough SVGs animate infinitely in Chrome and keep captions clear of the viewport', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser SVG export checks.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-story-browser-'));
  const repoDir = path.join(scratch, 'repo');
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'src', 'handler.mjs'), [
    'export function handleCheckout(req) {',
    '  if (!req.idempotencyKey) return { status: 400 };',
    '  return { status: 202, queued: true };',
    '}',
  ].join('\n'));
  git(repoDir, 'init', '-b', 'main');
  git(repoDir, 'config', 'user.name', 'Archify Tests');
  git(repoDir, 'config', 'user.email', 'archify@example.test');
  git(repoDir, 'remote', 'add', 'origin', 'https://github.com/acme/checkout.git');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'base');
  const baseSha = git(repoDir, 'rev-parse', 'HEAD');
  git(repoDir, 'checkout', '-q', '-b', 'feat/story');
  fs.writeFileSync(path.join(repoDir, 'src', 'handler.mjs'), [
    'export function handleCheckout(req) {',
    '  if (!req.idempotencyKey) return { status: 400 };',
    '  enqueueCheckout(req);',
    '  return { status: 202, queued: true };',
    '}',
  ].join('\n'));
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-q', '-m', 'async queue');
  const headSha = git(repoDir, 'rev-parse', 'HEAD');

  const packDir = path.join(scratch, 'pack');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'before.json'), JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Before', output: 'before.html' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 140], size: [130, 60] },
      { id: 'api', type: 'backend', label: 'Checkout API', pos: [280, 140], size: [150, 60] },
    ],
    connections: [{ id: 'c1', from: 'client', to: 'api', label: 'POST /checkout' }],
  }));
  fs.writeFileSync(path.join(packDir, 'after.json'), JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'After', output: 'after.html', repository: { url: 'https://github.com/acme/checkout', revision: headSha } },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 140], size: [130, 60], change: 'unchanged' },
      { id: 'api', type: 'backend', label: 'Checkout API', pos: [280, 140], size: [150, 60], change: 'modified', sources: [{ path: 'src/handler.mjs', line: 1, end_line: 5 }] },
      { id: 'queue', type: 'messagebus', label: 'Checkout Queue', pos: [540, 140], size: [160, 60], change: 'added' },
    ],
    connections: [
      { id: 'c1', from: 'client', to: 'api', label: 'POST /checkout', change: 'modified' },
      { id: 'c2', from: 'api', to: 'queue', label: 'enqueue', change: 'added' },
    ],
  }));
  const manifestFile = path.join(packDir, 'pr-pack.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    schema_version: 1,
    kind: 'pr-pack',
    title: 'Queue checkout walkthrough',
    repository: 'acme/checkout',
    baseSha,
    headSha,
    platform: 'github',
    theme: 'both',
    preset: 'classic',
    views: [
      { id: 'before', title: 'Before', type: 'architecture', input: 'before.json', storyOnly: true },
      { id: 'after', title: 'After', type: 'architecture', input: 'after.json', collapsed: true },
    ],
    story: {
      id: 'walkthrough',
      duration: 18,
      loop: true,
      stages: [
        { view: 'before', end: 4.5 },
        { view: 'after', start: 3.5, end: 18 },
      ],
      pair: { before: 'before', after: 'after', at: 3.5, shared: [{ id: 'client' }, { id: 'api' }] },
      enter: [{ view: 'after', nodes: ['queue'], at: 4.5 }],
      connect: [{ view: 'after', edges: ['c2'], at: 5.2 }],
      traces: [{ view: 'after', edges: ['c2'], times: [6.8], end: 10.2, travel: 2.0 }],
      metrics: [{ view: 'after', node: 'api', label: 'latency', before: '420ms', after: '18ms', at: 12.2 }],
      detail: {
        view: 'after',
        nodes: ['api'],
        start: 11.5,
        end: 18,
        title: 'src/handler.mjs · handleCheckout()',
        path: 'src/handler.mjs',
        lines: [1, 2, 3, 4],
        highlight: [3],
      },
      steps: [
        { at: 0, title: 'Synchronous baseline request', body: 'CallsCheckout synchronously before queue rollout.' },
        { at: 4, title: 'Queue decouples Checkout API', body: 'Enqueues work asynchronously on request.' },
        { at: 6.6, title: 'Trace queued handoff', body: 'Packet moves smoothly along the added queue edge.' },
        { at: 11.6, title: 'Inspect handler implementation', body: 'Shows enqueueCheckout line with measured metric readout.' },
      ],
    },
  }));

  const build = await buildPrPack(manifestFile, { outDir: path.join(scratch, 'out'), repoRoot: repoDir });
  const light = build.story.svgs.light;
  const dark = build.story.svgs.dark;
  const hostFile = path.join(scratch, 'host.html');
  fs.writeFileSync(hostFile, hostPage(light, dark));

  for (const scheme of ['light', 'dark']) {
    const { run } = await openHost(t, hostFile, scheme);
    const imgChecks = await run(`(['light-file','dark-file','light-data','dark-data','picture']).map(id => {
      const img = document.getElementById(id);
      return { id, complete: img.complete, w: img.naturalWidth, h: img.naturalHeight };
    })`);
    for (const item of imgChecks) {
      assert.equal(item.complete, true, `${scheme} ${item.id} completed`);
      assert.equal(item.w, 960, `${scheme} ${item.id} width`);
      assert.equal(item.h, 560, `${scheme} ${item.id} height`);
    }
  }

  for (const [scheme, file] of [['light', light], ['dark', dark]]) {
    const { run } = await openHost(t, file, scheme);
    const samples = await run(`(() => {
      const anims = document.getAnimations();
      for (const a of anims) a.pause();
      const sampleAt = (ms) => {
        for (const a of anims) a.currentTime = ms;
        const caps = [...document.querySelectorAll('.story-caption')]
          .map((c) => ({ op: Number(getComputedStyle(c).opacity), bottom: c.getBoundingClientRect().bottom }))
          .filter((c) => c.op > 0.1);
        const tok = document.getElementById('story-token-0-0');
        const tokRect = tok.getBoundingClientRect();
        const detail = document.getElementById('story-source-detail');
        const metricAfter = document.querySelector('[id$="-after"]');
        return {
          maxCaptionBottom: caps.length ? Math.max(...caps.map((c) => c.bottom)) : 0,
          tokenX: tokRect.left + tokRect.width / 2,
          tokenOpacity: Number(getComputedStyle(tok).opacity),
          detailOpacity: Number(getComputedStyle(detail).opacity),
          detailRight: detail.getBoundingClientRect().right,
          metricAfterOpacity: metricAfter ? Number(getComputedStyle(metricAfter).opacity) : 0,
        };
      };
      return {
        errors: pageErrors,
        animCount: anims.length,
        t1: sampleAt(1000),
        traceStart: sampleAt(6900),
        traceMid: sampleAt(7800),
        traceMidCycle2: sampleAt(18000 + 7800),
        detailMid: sampleAt(14500),
      };
    })()`);
    assert.deepEqual(samples.errors, [], `${scheme}: zero page errors`);
    assert.ok(samples.animCount > 0, `${scheme}: has active CSS animations`);
    for (const s of [samples.t1, samples.traceStart, samples.traceMid, samples.detailMid]) {
      assert.ok(s.maxCaptionBottom <= 112, `${scheme}: caption clears viewport (${s.maxCaptionBottom})`);
    }
    assert.ok(samples.traceMid.tokenOpacity > 0.9, `${scheme}: trace token visible mid-flight`);
    assert.ok(samples.traceMid.tokenX > samples.traceStart.tokenX + 20, `${scheme}: trace token advances along edge (${samples.traceStart.tokenX} -> ${samples.traceMid.tokenX})`);
    assert.ok(samples.traceMidCycle2.tokenOpacity > 0.9 && Math.abs(samples.traceMidCycle2.tokenX - samples.traceMid.tokenX) < 3, `${scheme}: infinite loop replays identically in Cycle 2 (${samples.traceMid.tokenX} vs ${samples.traceMidCycle2.tokenX})`);
    assert.ok(samples.detailMid.detailOpacity > 0.9 && samples.detailMid.detailRight <= 960, `${scheme}: source excerpt fits inside canvas`);
    assert.ok(samples.detailMid.metricAfterOpacity > 0.9, `${scheme}: metric readout transitions cleanly`);
  }
});
