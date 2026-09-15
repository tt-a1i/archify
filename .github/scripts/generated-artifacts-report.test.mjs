import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_LISTED_PATHS,
  compareTrees,
  fileStatus,
  parseSkipped,
  renderReport,
} from './generated-artifacts-report.mjs';

test('compareTrees pairs paths from both sides, sorted, with null for missing files', () => {
  const entries = compareTrees(
    { 'gallery.html': 'aaa', 'gallery/manifest.json': 'bbb', 'gallery/artifacts/old.html': 'ccc' },
    { 'gallery.html': 'aaa', 'gallery/manifest.json': 'bbb2', 'gallery/artifacts/new.html': 'ddd' },
  );
  assert.deepEqual(entries, [
    { path: 'gallery.html', committed: 'aaa', rebuilt: 'aaa' },
    { path: 'gallery/artifacts/new.html', committed: null, rebuilt: 'ddd' },
    { path: 'gallery/artifacts/old.html', committed: 'ccc', rebuilt: null },
    { path: 'gallery/manifest.json', committed: 'bbb', rebuilt: 'bbb2' },
  ]);
  assert.deepEqual(entries.map(fileStatus), ['identical', 'only in rebuild', 'only in checkout', 'differs']);
});

test('parseSkipped reads tab-separated builder/reason lines and tolerates blanks', () => {
  assert.deepEqual(parseSkipped('build-readme-showcase.mjs\tneeds Chrome\n\nbuild-x.mjs\n'), [
    { builder: 'build-readme-showcase.mjs', reason: 'needs Chrome' },
    { builder: 'build-x.mjs', reason: 'no reason recorded' },
  ]);
  assert.deepEqual(parseSkipped(''), []);
  assert.deepEqual(parseSkipped(undefined), []);
});

test('renderReport states the non-blocking contract, counts, zip status, skips, and closing line', () => {
  const report = renderReport({
    zip: 'differs',
    files: compareTrees(
      { 'gallery.html': 'a', 'guide.html': 'g', 'gallery/artifacts/old.html': 'o' },
      { 'gallery.html': 'a2', 'guide.html': 'g', 'gallery/artifacts/new.html': 'n' },
    ),
    skipped: [{ builder: 'build-readme-showcase.mjs', reason: 'needs Chrome and ffmpeg' }],
  });
  const lines = report.split('\n');
  assert.equal(lines[0], '## Generated artifacts (Phase 1: informational)');
  assert.match(report, /never blocks a pull request/);
  assert.ok(report.includes('- archify.zip: differs from rebuild (zip-freshness is the blocking check)'));
  assert.ok(report.includes('- Generated site: 1 files identical, 1 differ, 1 only in rebuild, 1 only in checkout'));
  assert.ok(report.includes('- differs: `gallery.html`'));
  assert.ok(report.includes('- only in rebuild: `gallery/artifacts/new.html`'));
  assert.ok(report.includes('- only in checkout: `gallery/artifacts/old.html`'));
  assert.ok(!report.includes('`guide.html`'), 'identical files are not listed');
  assert.ok(report.includes('Skipped: build-readme-showcase.mjs (needs Chrome and ffmpeg)'));
  assert.ok(report.endsWith('Contributors may stop committing rebuilt Gallery once Phase 2 in docs/maintenance-roadmap.md is complete; until then CONTRIBUTING.md#packages-and-generated-artifacts applies.\n'));
});

test('renderReport handles the all-identical case and an unknown zip status', () => {
  const report = renderReport({
    zip: 'unavailable',
    files: compareTrees({ 'gallery.html': 'a' }, { 'gallery.html': 'a' }),
    skipped: [],
  });
  assert.ok(report.includes('- archify.zip: rebuild unavailable (see the build step log)'));
  assert.ok(report.includes('- Generated site: 1 files identical, 0 differ, 0 only in rebuild, 0 only in checkout'));
  assert.ok(report.includes('\nSkipped: none\n'));
  assert.ok(renderReport({ zip: 'identical', files: [], skipped: [] }).includes('- archify.zip: identical to rebuild'));
  assert.ok(renderReport({ zip: 'bogus', files: [] }).includes('rebuild unavailable'));
});

test('renderReport caps the listed paths and reports the remainder', () => {
  const committed = {};
  const rebuilt = {};
  for (let i = 0; i < MAX_LISTED_PATHS + 5; i += 1) {
    committed[`gallery/artifacts/${String(i).padStart(3, '0')}.html`] = 'x';
    rebuilt[`gallery/artifacts/${String(i).padStart(3, '0')}.html`] = 'y';
  }
  const report = renderReport({ zip: 'identical', files: compareTrees(committed, rebuilt), skipped: [] });
  const listed = report.split('\n').filter((line) => line.startsWith('- differs: '));
  assert.equal(listed.length, MAX_LISTED_PATHS);
  assert.ok(report.includes('- … and 5 more'));
});
