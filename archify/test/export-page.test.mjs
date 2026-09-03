import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function renderArtifact(tmp, name, json) {
  const input = path.join(tmp, `${name}.json`);
  fs.writeFileSync(input, JSON.stringify(json));
  const artifact = path.join(tmp, `${name}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render', 'architecture', input, artifact, '--quality', 'showcase',
  ], { cwd: skillRoot, encoding: 'utf8' });
  return artifact;
}

// Minimal PNG header reader: returns { width, height } from the IHDR chunk.
function pngDimensions(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), 'expected a PNG signature');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function baseArchitectureJson(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Export Page Test',
      quality_profile: 'showcase',
      ...(overrides.meta || {}),
    },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 60], size: [120, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [240, 60], size: [120, 60] },
      { id: 'db', type: 'database', label: 'Database', pos: [440, 60], size: [120, 60] },
    ],
    connections: [
      { id: 'c-to-api', from: 'client', to: 'api' },
      { id: 'api-to-db', from: 'api', to: 'db' },
    ],
    ...(overrides.cards !== undefined ? { cards: overrides.cards } : {
      cards: [
        { dot: 'cyan', title: 'Edge', items: ['Client request'] },
        { dot: 'emerald', title: 'Backend', items: ['API serves data'] },
      ],
    }),
  };
}

async function exportPageViaMenu(browser, sessionId, downloadDir) {
  await browser.cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true,
  }).catch(() => {});
  const clicked = await browser.cdp.send('Runtime.evaluate', {
    expression: `(function () {
      var toggle = Array.prototype.find.call(document.querySelectorAll('.toolbar button'), function (b) {
        return /export/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '') + ' ' + (b.id || ''));
      });
      if (!toggle) return 'toggle-missing';
      toggle.click();
      var item = document.querySelector('.export-menu button[data-format="page"]');
      if (!item) return 'menu-item-missing';
      item.click();
      return 'clicked';
    })()`,
    returnByValue: true,
  }, sessionId, 30000);
  assert.equal(clicked.result?.value, 'clicked', 'export menu page action should be clickable');

  const deadline = Date.now() + 15000;
  let files = [];
  while (Date.now() < deadline) {
    files = fs.readdirSync(downloadDir).filter((f) => f.endsWith('.png'));
    if (files.length) return path.join(downloadDir, files[0]);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`export download timed out; files in dir: ${fs.readdirSync(downloadDir).join(', ') || '(empty)'}`);
}

function readReceipt(browser, sessionId) {
  const raw = browser.cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      format: document.documentElement.getAttribute('data-last-export-format'),
      width: document.documentElement.getAttribute('data-last-export-width'),
      height: document.documentElement.getAttribute('data-last-export-height'),
      bytes: document.documentElement.getAttribute('data-last-export-bytes'),
      error: document.documentElement.getAttribute('data-last-export-error'),
    })`,
    returnByValue: true,
  }, sessionId);
  return raw.then((r) => JSON.parse(r.result.value));
}

test('full diagram page export produces a chrome-free PNG with exact receipt dimensions', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-page-'));
  const downloadDir = path.join(tmp, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const artifact = renderArtifact(tmp, 'basic', baseArchitectureJson());

  const { ChromeVisualBrowser } = await import('../bin/visual-check.mjs');
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.inspect({ artifactPath: artifact, width: 1600, height: 900 });
    const downloaded = await exportPageViaMenu(browser, sessionId, downloadDir);

    const png = fs.readFileSync(downloaded);
    const { width, height } = pngDimensions(png);
    assert.equal(width, 3200, 'default export should be 2x (3200px wide)');
    assert.ok(height > 1000, 'export height should follow the diagram aspect');
    assert.ok(png.length > 50 * 1024, 'chrome-free content should be non-trivial in size');

    const receipt = await readReceipt(browser, sessionId);
    assert.equal(receipt.format, 'page');
    assert.equal(receipt.width, String(width), 'receipt width should match the actual PNG width');
    assert.equal(receipt.height, String(height), 'receipt height should match the actual PNG height');
    assert.ok(Number(receipt.bytes) > 0);
    assert.equal(receipt.error, null);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('full diagram page export falls back to 1x when 2x would exceed the canvas cap', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  // A tall viewBox makes the 2x canvas exceed MAX_CANVAS_PIXELS while 1x stays under it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-page-fallback-'));
  const downloadDir = path.join(tmp, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const artifact = renderArtifact(tmp, 'fallback', baseArchitectureJson({
    meta: { viewBox: [600, 3800] },
  }));

  const { ChromeVisualBrowser } = await import('../bin/visual-check.mjs');
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.inspect({ artifactPath: artifact, width: 1600, height: 900 });
    const downloaded = await exportPageViaMenu(browser, sessionId, downloadDir);

    const png = fs.readFileSync(downloaded);
    const { width, height } = pngDimensions(png);
    assert.equal(width, 1600, 'oversized 2x should fall back to 1x width');
    assert.ok(width * height <= MAX_CANVAS_PIXELS, 'actual pixels must respect MAX_CANVAS_PIXELS');
    const receipt = await readReceipt(browser, sessionId);
    assert.equal(receipt.width, String(width));
    assert.equal(receipt.height, String(height));
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('full diagram page export fails closed when even 1x exceeds the canvas cap', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-page-fail-'));
  const downloadDir = path.join(tmp, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  // A tall viewBox keeps 1x above MAX_CANVAS_PIXELS, so the export must
  // reject instead of downloading a file.
  const artifact = renderArtifact(tmp, 'fail', baseArchitectureJson({
    meta: { viewBox: [600, 4500] },
  }));

  const { ChromeVisualBrowser } = await import('../bin/visual-check.mjs');
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.inspect({ artifactPath: artifact, width: 1600, height: 900 });
    await browser.cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: downloadDir,
    }).catch(() => {});
    // The fail-closed path surfaces viewer.export.failed via alert(); accept
    // the dialog so the export promise chain can settle.
    const dialog = browser.cdp.waitFor('Page.javascriptDialogOpening', sessionId, 10000);
    const clicked = browser.cdp.send('Runtime.evaluate', {
      expression: `(function () {
        var toggle = Array.prototype.find.call(document.querySelectorAll('.toolbar button'), function (b) {
          return /export/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '') + ' ' + (b.id || ''));
        });
        toggle.click();
        document.querySelector('.export-menu button[data-format="page"]').click();
      })()`,
      returnByValue: true,
    }, sessionId, 30000);
    await dialog;
    await browser.cdp.send('Page.handleJavaScriptDialog', { accept: true }, sessionId);
    await clicked;

    // Give the (rejected) export promise chain time to settle.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(fs.readdirSync(downloadDir).length, 0, 'no file should be downloaded on fail-closed');
    const receipt = await readReceipt(browser, sessionId);
    assert.ok(receipt.error, 'fail-closed should set data-last-export-error');
    assert.match(receipt.error, /canvas safety limit|画布安全上限/);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('full diagram page export works without cards and in the light theme', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-page-nocards-'));
  const downloadDir = path.join(tmp, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const artifact = renderArtifact(tmp, 'nocards', baseArchitectureJson({ cards: [] }));

  const { ChromeVisualBrowser } = await import('../bin/visual-check.mjs');
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.inspect({ artifactPath: artifact, width: 1600, height: 900 });
    const downloaded = await exportPageViaMenu(browser, sessionId, downloadDir);
    const { width } = pngDimensions(fs.readFileSync(downloaded));
    assert.equal(width, 3200, 'card-less export should still render at 2x');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('long card items wrap onto multiple lines instead of being truncated', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  // A single schema-valid item longer than one line at the item font size.
  const longItem = 'Retry only idempotent requests after a transient upstream failure. '
    + 'Back off exponentially with jitter and surface a per-request retry budget so callers '
    + 'can decide whether a bounded retry is safe for their operation.';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-page-wrap-'));
  const downloadDir = path.join(tmp, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const cards = () => [
    { dot: 'cyan', title: 'Edge', items: [longItem] },
    { dot: 'emerald', title: 'Backend', items: ['API serves data'] },
  ];
  const artifact = renderArtifact(tmp, 'wrap', baseArchitectureJson({ cards: cards() }));
  // The same structure with a single-line item: the canvas must be shorter,
  // proving wrapped lines participated in the height budget.
  const baseline = renderArtifact(tmp, 'baseline', baseArchitectureJson({
    cards: [
      { dot: 'cyan', title: 'Edge', items: ['Short item'] },
      { dot: 'emerald', title: 'Backend', items: ['API serves data'] },
    ],
  }));

  const { ChromeVisualBrowser } = await import('../bin/visual-check.mjs');
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    const heights = {};
    for (const [label, file] of [['wrapped', artifact], ['baseline', baseline]]) {
      await browser.inspect({ artifactPath: file, width: 1600, height: 900 });
      const downloaded = await exportPageViaMenu(browser, sessionId, downloadDir);
      const png = fs.readFileSync(downloaded);
      const dims = pngDimensions(png);
      assert.equal(dims.width, 3200, `${label} export should render at 2x`);
      heights[label] = dims.height;
      fs.unlinkSync(downloaded); // keep the download dir clean for the next export
    }
    // Three wrapped lines add ~2 extra lines of card height over the baseline.
    assert.ok(
      heights.wrapped > heights.baseline,
      `wrapped content should grow the canvas (wrapped=${heights.wrapped}, baseline=${heights.baseline})`,
    );
    assert.ok(
      heights.wrapped - heights.baseline >= 4 * 26,
      `wrapped canvas should gain at least two 2x line heights (diff=${heights.wrapped - heights.baseline})`,
    );
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The packaged skill archive must carry the same export implementation as
// the working tree, otherwise installed copies silently miss the feature.
function readZipEntry(zipPath, entryName) {
  const bytes = fs.readFileSync(zipPath);
  const eocd = bytes.indexOf(Buffer.from('504b0506', 'hex'));
  assert.ok(eocd >= 0, 'expected an EOCD record in the zip');
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  let cursor = centralOffset;
  while (cursor < bytes.length) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLen = bytes.readUInt16LE(cursor + 28);
    const extraLen = bytes.readUInt16LE(cursor + 30);
    const commentLen = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      const local = localOffset;
      const localNameLen = bytes.readUInt16LE(local + 26);
      const localExtraLen = bytes.readUInt16LE(local + 28);
      const dataStart = local + 30 + localNameLen + localExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      return method === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

test('the packaged archify.zip template matches the working tree export implementation', () => {
  const zipPath = path.join(skillRoot, '..', 'archify.zip');
  assert.ok(fs.existsSync(zipPath), 'archify.zip should exist at the repo root');
  const entry = readZipEntry(zipPath, 'archify/assets/template.html');
  assert.ok(entry, 'archify.zip should contain archify/assets/template.html');
  assert.ok(entry.includes('renderPageExport'), 'packaged template should carry renderPageExport');
  assert.ok(entry.includes('data-format="page"'), 'packaged template should carry the page menu entry');
});
