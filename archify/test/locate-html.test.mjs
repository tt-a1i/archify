import assert from 'node:assert/strict';
import test from 'node:test';
import { LocateError } from '../locate/error.mjs';
import { renderLocateHtml, stampUncoveredCount, validateLocateHtml } from '../locate/locate-html.mjs';

const receipt = {
  schemaVersion: 1,
  ok: true,
  command: 'locate',
  locatorVersion: 2,
  mode: 'range',
  completeness: 'complete',
  repository: {
    root: '.',
    url: 'https://github.com/tt-a1i/archify',
    linkMode: 'web',
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
  },
  map: { path: 'map.architecture.json', diagramType: 'architecture', semanticSha256: 'c'.repeat(64) },
  ownership: { path: 'map.architecture.ownership.json', sha256: 'd'.repeat(64), presets: ['docs'] },
  review: { required: false, blocking: [], advisory: ['files_uncovered'] },
  summary: {
    files: { touched: 1, uncovered: 1, ambiguous: 0, excluded: 0, total: 2 },
    components: { touched: 1, untouched: 0, stale: 0, total: 1 },
  },
  files: [
    { path: 'bin/cli.mjs', changeType: 'M', state: 'touched', componentId: 'cli', matchedGlob: 'bin/**' },
    { path: 'README.md', changeType: 'M', state: 'uncovered' },
  ],
  components: [
    { id: 'cli', label: 'CLI', state: 'touched', touchedCount: 1, touchedFiles: ['bin/cli.mjs'] },
  ],
  facts: [],
  limitations: ['Path ownership only; no runtime impact, causality, risk, or mergeability is inferred.'],
};

test('standalone locate HTML is a receipt page with uncovered first', () => {
  const html = renderLocateHtml({ receipt });
  assert.deepEqual(validateLocateHtml(html, receipt), { ok: true, checksPassed: 6, checkCount: 6 });
  const uncoveredAt = html.indexOf('Paths outside the map');
  const componentsAt = html.indexOf('Components');
  assert.ok(uncoveredAt !== -1 && uncoveredAt < componentsAt);
  assert.match(html, /id="archify-locate-receipt"/);
  assert.match(html, /https:\/\/github.com\/tt-a1i\/archify\/blob\/b{40}\/bin\/cli.mjs/);
  assert.match(html, /<code>docs<\/code>/);
  assert.doesNotMatch(html, /data-locate-active/);
  assert.doesNotMatch(html, /\bSAFE\b|\bNO IMPACT\b/);
});

test('uncovered empty state renders None instead of hiding', () => {
  const empty = {
    ...receipt,
    summary: {
      files: { touched: 1, uncovered: 0, ambiguous: 0, excluded: 0, total: 1 },
      components: { touched: 1, untouched: 0, stale: 0, total: 1 },
    },
    files: [receipt.files[0]],
    review: { required: false, blocking: [], advisory: [] },
  };
  const html = renderLocateHtml({ receipt: empty });
  assert.match(html, /Paths outside the map \(0\)/);
  assert.match(html, /<p class="empty">None<\/p>/);
  assert.deepEqual(validateLocateHtml(html, empty), { ok: true, checksPassed: 6, checkCount: 6 });
});

test('validateLocateHtml rejects a second receipt and chrome forbidden claims', () => {
  const html = renderLocateHtml({ receipt });
  const duplicate = html.replace('</body>', '<script id="archify-locate-receipt" type="application/json">{}</script></body>');
  assert.throws(() => validateLocateHtml(duplicate, receipt), (error) => (
    error instanceof LocateError && error.code === 'locate/artifact-invalid'
  ));
  const unsafe = html.replace('Advisories', 'SAFE NO IMPACT');
  assert.throws(() => validateLocateHtml(unsafe, receipt), (error) => (
    error instanceof LocateError && /forbidden/.test(error.message)
  ));
});

test('stampUncoveredCount writes data-locate-uncovered-count on the SVG root', () => {
  const stamped = stampUncoveredCount('<svg viewBox="0 0 1 1"></svg>', 4);
  assert.match(stamped, /<svg data-locate-uncovered-count="4"/);
});

test('forbid-list does not scan receipt or path data', () => {
  const withSafePath = {
    ...receipt,
    files: [
      ...receipt.files,
      { path: 'tpl/safe/safe.go', changeType: 'M', state: 'uncovered' },
    ],
    summary: {
      files: { touched: 1, uncovered: 2, ambiguous: 0, excluded: 0, total: 3 },
      components: receipt.summary.components,
    },
  };
  const html = renderLocateHtml({ receipt: withSafePath });
  assert.deepEqual(validateLocateHtml(html, withSafePath), { ok: true, checksPassed: 6, checkCount: 6 });
  assert.match(html, /tpl\/safe\/safe\.go/);
});
