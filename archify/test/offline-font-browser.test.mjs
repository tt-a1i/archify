import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { assertFontCss, inspectDocuments } from './helpers/offline-fonts.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const options = { skip: chrome ? false : 'Set ARCHIFY_CHROME for offline font and export browser acceptance.' };

async function evaluate(browser, expression) {
  const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, await browser.sessionPromise, 30000);
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
  return result.result?.value;
}

async function prepare(browser, blocked) {
  const session = await browser.sessionPromise;
  await browser.cdp.send('Network.enable', {}, session);
  await browser.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, session);
  await browser.cdp.send('Network.setBlockedURLs', { urls: blocked ? ['http://*', 'https://*'] : [] }, session);
  await browser.cdp.send('DOM.enable', {}, session);
  await browser.cdp.send('CSS.enable', {}, session);
  await browser.cdp.send('CSS.setLocalFontsEnabled', { enabled: false }, session);
  const requests = [];
  let buffer = '';
  browser.cdp.readPipe.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) requests.push(message.params.request.url);
    }
  });
  return requests;
}

async function actualFonts(browser, selector) {
  const session = await browser.sessionPromise;
  const { root } = await browser.cdp.send('DOM.getDocument', {}, session);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector }, session);
  assert.ok(nodeId, selector);
  return (await browser.cdp.send('CSS.getPlatformFontsForNode', { nodeId }, session)).fonts;
}

function render(input, output, quality = 'standard') {
  execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'architecture', input, output, '--quality', quality], { stdio: 'pipe' });
}

const exportCapture = `(() => {
  const create = URL.createObjectURL.bind(URL);
  const blobs = new Map();
  URL.createObjectURL = function(blob) {
    const url = create(blob); blobs.set(url, blob);
    if (blob.type.includes('svg')) window.__svgBlob = blob;
    return url;
  };
  HTMLAnchorElement.prototype.click = function() {
    if (this.download) window.__download = blobs.get(this.href);
  };
})()`;

async function exported(browser, format) {
  return evaluate(browser, `(async () => {
    window.__download = null; window.__svgBlob = null;
    document.querySelector('[data-format="${format}"]').click();
    for (let i = 0; i < 1000 && !window.__download; i++) await new Promise(r => setTimeout(r, 10));
    if (!window.__download) throw new Error('Export did not finish: ' + document.documentElement.dataset.lastExportError);
    const blob = window.__download;
    return { type: blob.type, bytes: blob.size, svg: window.__svgBlob ? await window.__svgBlob.text() : null,
      canonical: document.documentElement.dataset.lastExportCanonical,
      width: document.documentElement.dataset.lastExportWidth, height: document.documentElement.dataset.lastExportHeight };
  })()`);
}

test('fresh viewers use bundled fonts with local fonts disabled and identical offline layout', options, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-font-layout-'));
  const fixtures = [
    ['production', 'production-deployment.architecture.json', 'showcase'],
    ['web', 'web-app.architecture.json', 'standard'],
  ];
  try {
    for (const [name, source, quality] of fixtures) render(path.join(skillRoot, 'examples', source), path.join(tmp, `${name}.html`), quality);
    const mixed = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json')));
    mixed.meta.title = 'Fonts A Ā Ѡ Ж Ω ắ 中文';
    fs.writeFileSync(path.join(tmp, 'mixed.json'), JSON.stringify(mixed));
    render(path.join(tmp, 'mixed.json'), path.join(tmp, 'mixed.html'));
    const compare = path.join(tmp, 'compare.html');
    execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'compare', 'architecture', path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'), path.join(skillRoot, 'examples/checkout-platform.head.architecture.json'), compare], { stdio: 'pipe' });
    const online = new Map();
    for (const blocked of [false, true]) {
      const browser = new ChromeVisualBrowser(chrome);
      try {
        const requests = await prepare(browser, blocked);
        for (const name of ['production', 'web', 'mixed']) for (const theme of ['light', 'dark']) {
          const metrics = await browser.inspect({ artifactPath: path.join(tmp, `${name}.html`), width: 1440, height: 900, theme });
          const snapshot = { readerWidth: metrics.readerWidth, diagramWidth: metrics.diagramWidth, scrollHeight: metrics.scrollHeight };
          const key = `${name}/${theme}`;
          assert.ok(snapshot.readerWidth > 0 && snapshot.diagramWidth > 0, key);
          if (blocked) assert.deepEqual(snapshot, online.get(key), key);
          else online.set(key, snapshot);
          const fonts = await actualFonts(browser, '.diagram-container svg text[data-node-label]');
          assert.ok(fonts.some(f => f.isCustomFont && /JetBrains Mono/.test(f.familyName)), JSON.stringify(fonts));
          const loaded = await evaluate(browser, `(async () => {
            await Promise.all([400,500,600,700].map(w => document.fonts.load(w + ' 16px "JetBrains Mono"', 'A Ā Ѡ Ж Ω ắ')));
            return Array.from(document.fonts).filter(f => /JetBrains Mono/.test(f.family)).map(f => f.status);
          })()`);
          assert.deepEqual(loaded, Array(6).fill('loaded'));
        }
        await browser.inspect({ artifactPath: compare, width: 1440, height: 900, theme: 'light' });
        const frames = await evaluate(browser, `(async () => Promise.all(Array.from(document.querySelectorAll('iframe[srcdoc]')).map(async frame => {
          await frame.contentDocument.fonts.load('400 16px "JetBrains Mono"', 'A Ā Ѡ Ж Ω ắ');
          return Array.from(frame.contentDocument.fonts).filter(f => /JetBrains Mono/.test(f.family)).map(f => f.status);
        })))()`);
        assert.deepEqual(frames, [Array(6).fill('loaded'), Array(6).fill('loaded')]);
        assert.deepEqual(requests, [], 'viewers must not attempt an HTTP(S) request');
      } finally { await browser.close(); }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('SVG and raster exports preserve the viewer font with local fonts and network disabled', options, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-font-export-'));
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const requests = await prepare(browser, true);
    const artifact = path.join(tmp, 'web.html');
    render(path.join(skillRoot, 'examples/web-app.architecture.json'), artifact);
    await browser.inspect({ artifactPath: artifact, width: 1440, height: 900, theme: 'light' });
    await evaluate(browser, exportCapture);
    const svg = await exported(browser, 'svg');
    assert.equal(svg.canonical, 'true');
    assertFontCss(inspectDocuments(svg.svg)[0].styles.join('\n'), 'exported SVG');
    fs.writeFileSync(path.join(tmp, 'export.svg'), svg.svg);
    for (const format of ['png', 'jpeg', 'webp', 'share-card']) {
      const result = await exported(browser, format);
      assert.ok(result.bytes > 1000, format);
      assert.equal(result.type, `image/${format === 'share-card' ? 'png' : format}`);
      assertFontCss(inspectDocuments(result.svg)[0].styles.join('\n'), format);
      if (format === 'share-card') assert.deepEqual([result.width, result.height], ['1200', '630']);
    }
    // A negative control proves the font bytes affect actual Image/Canvas
    // rendering, rather than merely surviving serialization as inert text.
    const pixelsDiffer = await evaluate(browser, `(async () => {
      const source = await window.__svgBlob.text();
      async function pixels(svg) {
        const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
        try {
          const image = new Image(); image.src = url; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
          canvas.getContext('2d').drawImage(image,0,0); return canvas.toDataURL();
        } finally { URL.revokeObjectURL(url); }
      }
      return await pixels(source) !== await pixels(source.replace(/@font-face\\s*\\{[^}]+\\}/g,''));
    })()`);
    assert.equal(pixelsDiffer, true, 'embedded font must affect rasterized glyphs');
    const session = await browser.sessionPromise;
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(path.join(tmp, 'export.svg')).href }, session);
    await loaded;
    await evaluate(browser, 'document.fonts.ready');
    const fonts = await actualFonts(browser, 'text[data-node-label]');
    assert.ok(fonts.some(f => f.isCustomFont && /JetBrains Mono/.test(f.familyName)), JSON.stringify(fonts));
    assert.deepEqual(requests, []);
  } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

for (const format of ['png', 'share-card']) test(`${format} requested at DOMContentLoaded matches a font-settled repeat`, options, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-font-early-export-'));
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const requests = await prepare(browser, true);
    const artifact = path.join(tmp, 'early.html');
    render(path.join(skillRoot, 'examples/web-app.architecture.json'), artifact);
    const session = await browser.sessionPromise;
    await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: exportCapture + `
      window.__fontDraws = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        window.__fontDraws.push(document.fonts.check(this.font, text));
        return fillText.call(this, text, ...args);
      };
      document.addEventListener('DOMContentLoaded', () => {
        window.__fontStatusAtClick = document.fonts.status;
        document.querySelector('[data-format="${format}"]').click();
      }, { once: true });
    ` }, session);
    await browser.inspect({ artifactPath: artifact, width: 1440, height: 900, theme: 'light' });
    const early = await evaluate(browser, `(async () => {
      for(let i=0;i<500&&!window.__download;i++) await new Promise(r=>setTimeout(r,10));
      if (!window.__download) throw new Error('early export did not finish');
      window.__firstCardBytes = Array.from(new Uint8Array(await window.__download.arrayBuffer()));
      return { statusAtClick: window.__fontStatusAtClick, readyAtDraw: window.__fontDraws };
    })()`);
    if (format === 'share-card') assert.ok(early.readyAtDraw.length > 0);
    assert.ok(early.readyAtDraw.every(Boolean), JSON.stringify(early));
    await exported(browser, format);
    assert.equal(await evaluate(browser, `(async () => {
      const current = new Uint8Array(await window.__download.arrayBuffer());
      return current.length === window.__firstCardBytes.length && current.every((byte,i) => byte === window.__firstCardBytes[i]);
    })()`), true);
    t.diagnostic(`${format}: fonts at initial click: ${early.statusAtClick}; fonts ready for every Canvas text draw`);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
