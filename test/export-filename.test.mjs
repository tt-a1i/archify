import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test for https://github.com/tt-a1i/archify/issues/1024:
// every export from a diagram with a non-Latin title downloaded as
// "diagram.png" because diagramFilename() stripped every non-ASCII letter.
// The function is exercised exactly as shipped: extracted verbatim from
// viewer/export.js and evaluated with a stub document.
const here = path.dirname(fileURLToPath(import.meta.url));
const exportSource = fs.readFileSync(path.resolve(here, '..', 'viewer', 'export.js'), 'utf8');

function diagramFilename(title) {
  const start = exportSource.indexOf('function diagramFilename()');
  assert.ok(start >= 0, 'diagramFilename() not found in viewer/export.js');
  const end = exportSource.indexOf('function currentBg()', start);
  assert.ok(end > start, 'diagramFilename() body boundary not found');
  const run = new Function('document', exportSource.slice(start, end) + '; return diagramFilename();');
  return run({ title });
}

test('export filenames keep non-Latin diagram titles (issue #1024)', () => {
  assert.equal(diagramFilename('订单平台'), '订单平台');
  assert.equal(diagramFilename('Checkout 다이어그램'), 'checkout-다이어그램');
  assert.equal(diagramFilename('Сервис оплаты'), 'сервис-оплаты');
  assert.equal(diagramFilename('Zahlungsübersicht Diagram'), 'zahlungsübersicht');
  assert.equal(diagramFilename('Pagos · Diagrama'), 'pagos-diagrama');
});

test('export filenames drop detached Unicode marks', () => {
  // ❤️ is U+2764 + U+FE0F: the heart itself is replaced, and its variation
  // selector is a mark with no retained base. Nothing of it may survive,
  // or the export downloads as an invisible filename instead of diagram.png.
  assert.equal(diagramFilename('❤️'), 'diagram');
  assert.equal(diagramFilename('My ❤️ Diagram'), 'my');
  assert.equal(diagramFilename('My ❤️ Board'), 'my-board');
  // A mark attached to a letter base is kept: e + combining acute U+0301.
  assert.equal(diagramFilename('Cafe\u0301'), 'cafe\u0301');
});

test('export filenames keep existing Latin behavior', () => {
  assert.equal(diagramFilename('Checkout Platform Diagram'), 'checkout-platform');
  assert.equal(diagramFilename('  My Title!!  '), 'my-title');
  assert.equal(diagramFilename('<script>alert(1)</script>'), 'script-alert-1-script');
  assert.equal(diagramFilename(''), 'diagram');
  assert.equal(diagramFilename('!!!'), 'diagram');
});
