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

function diagramFilename(title, heading) {
  const start = exportSource.indexOf('function diagramFilename()');
  assert.ok(start >= 0, 'diagramFilename() not found in viewer/export.js');
  const end = exportSource.indexOf('function currentBg()', start);
  assert.ok(end > start, 'diagramFilename() body boundary not found');
  const run = new Function('document', exportSource.slice(start, end) + '; return diagramFilename();');
  return run({
    title,
    querySelector: selector => selector === '.header h1' && heading !== undefined
      ? { textContent: heading }
      : null,
  });
}

test('export filenames keep non-Latin diagram titles (issue #1024)', () => {
  assert.equal(diagramFilename('订单平台'), '订单平台');
  assert.equal(diagramFilename('Checkout 다이어그램'), 'checkout-다이어그램');
  assert.equal(diagramFilename('Сервис оплаты'), 'сервис-оплаты');
  assert.equal(diagramFilename('Zahlungsübersicht Diagram'), 'zahlungsübersicht-diagram');
  assert.equal(diagramFilename('Pagos · Diagrama'), 'pagos-diagrama');
});

test('export filenames prefer the authored heading over the localized page title', () => {
  // Generated pages decorate document.title per locale; the heading is the
  // authored title, so every locale produces the same kind of name.
  assert.equal(diagramFilename('Checkout Platform Diagram', 'Checkout Platform'), 'checkout-platform');
  assert.equal(diagramFilename('Pagos · Diagrama', 'Pagos'), 'pagos');
  assert.equal(diagramFilename('결제 다이어그램', '결제'), '결제');
  assert.equal(diagramFilename('النظام — مخطّط', 'النظام'), 'النظام');
  assert.equal(diagramFilename('订单平台', '订单平台'), '订单平台');
  // An authored heading that ends in a suffix-like word keeps it.
  assert.equal(diagramFilename('Checkout Diagram Diagram', 'Checkout Diagram'), 'checkout-diagram');
  assert.equal(diagramFilename('Payments Architecture', 'Payments Architecture'), 'payments-architecture');
});

test('export filenames fall back to the complete document title', () => {
  // No heading, or a blank one: the title is used without stripping
  // words that merely look like decorations.
  assert.equal(diagramFilename('Checkout Diagram'), 'checkout-diagram');
  assert.equal(diagramFilename('Checkout Diagram', '   '), 'checkout-diagram');
  assert.equal(diagramFilename('Café Diagram'), 'café-diagram');
  assert.equal(diagramFilename('Payments Architecture Diagram'), 'payments-architecture-diagram');
  assert.equal(diagramFilename('', ''), 'diagram');
  assert.equal(diagramFilename(undefined), 'diagram');
});

test('export filenames drop detached Unicode marks', () => {
  // ❤️ is U+2764 + U+FE0F: the heart itself is replaced, and its variation
  // selector is a mark with no retained base. Nothing of it may survive,
  // or the export downloads as an invisible filename instead of diagram.png.
  assert.equal(diagramFilename('❤️'), 'diagram');
  assert.equal(diagramFilename('My ❤️ Diagram'), 'my-diagram');
  assert.equal(diagramFilename('My ❤️ Board'), 'my-board');
  // A mark attached to a letter base is kept: e + combining acute U+0301.
  assert.equal(diagramFilename('Cafe\u0301'), 'cafe\u0301');
});

test('export filenames keep existing Latin behavior', () => {
  assert.equal(diagramFilename('Checkout Platform'), 'checkout-platform');
  assert.equal(diagramFilename('_'), '_');
  assert.equal(diagramFilename('___'), '___');
  assert.equal(diagramFilename('  My Title!!  '), 'my-title');
  assert.equal(diagramFilename('<script>alert(1)</script>'), 'script-alert-1-script');
  assert.equal(diagramFilename(''), 'diagram');
  assert.equal(diagramFilename('!!!'), 'diagram');
});
