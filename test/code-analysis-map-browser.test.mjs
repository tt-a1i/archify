import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { analyzeRepository } from '../archify/modules/code-analysis/overlay/page.mjs';
import { createMapBrowser } from './helpers/map-browser.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('Map workspace links captured files, Atlas, and both PR sides with native downloads', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for Map workspace browser acceptance.',
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-map-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const put = (side, file, text) => {
    const dest = path.join(directory, side, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  };
  for (const side of ['base', 'head']) {
    put(side, 'src/shared/index.mjs', 'export const kind = "shared";\n');
    put(side, 'src/ui/index.mjs', "import { kind } from '../shared/index.mjs';\nexport const surface = kind;\n");
    put(side, 'src/parent.mjs', 'export const parent = true;\n');
  }
  put('base', 'old.mjs', 'export const OLD_MARKER = "before rename";\n');
  put('base', 'removed.mjs', 'export const REMOVED_MARKER = "base only";\n');
  put('head', 'new.mjs', 'export const NEW_MARKER = "after rename";\n');
  put('head', 'added.mjs', 'export const ADDED_MARKER = "head only";\n');
  put('head', 'notes.txt', 'not measured by the TypeScript adapter\n');
  put('head', 'src/shared/index.mjs', "import '../ui/index.mjs';\nexport const kind = 'head';\n");
  const root = path.join(directory, 'head');
  const plain = analyzeRepository({ root, out: path.join(directory, 'plain'), language: 'ts' });
  const baseSHA = 'a'.repeat(40), headSHA = 'b'.repeat(40);
  const gitTree = { sourceKind: 'git-tree', root: '.', baseRevision: baseSHA, revision: baseSHA };
  const base = path.join(directory, 'pr', 'base');
  analyzeRepository({ root: path.join(directory, 'base'), out: base, language: 'ts', source: gitTree });
  const pr = analyzeRepository({ root, out: path.join(directory, 'pr'), language: 'ts',
    source: { ...gitTree, revision: headSHA }, previous: path.join(base, 'findings.json'),
    pullRequest: {
      pr: { number: 42, repository: 'example/map', title: 'Reorganization', mergeBaseSHA: baseSHA, headSHA, baseSHA },
      scope: '.', sourceRoot: root, manifests: { base: { skipped: [] }, head: { skipped: [] } },
      changedFiles: [
        { path: 'added.mjs', status: 'added' }, { path: 'new.mjs', previousPath: 'old.mjs', status: 'renamed' },
        { path: 'notes.txt', status: 'modified' }, { path: 'removed.mjs', status: 'removed' },
        { path: 'src/shared/index.mjs', status: 'modified' },
      ],
    },
  });
  const browser = new ChromeVisualBrowser(chrome, { shutdownTimeoutMs: 8_000 });
  t.after(() => browser.close());
  const { run, open, click, search, download, waitFor } = await createMapBrowser(browser, path.join(directory, 'downloads'));
  await open(pathToFileURL(plain.overlay.html).href);
  await click('.reader-map');
  assert.equal(await run('document.querySelectorAll("[data-map-mode]").length'), 0);
  await click('.map-folder[data-map-folder="src"]');
  await search('index.mjs');
  assert.equal(await run('document.querySelectorAll(".map-file").length'), 2, 'Duplicate basenames retain distinct paths');
  await click('[data-map-file="src/ui/index.mjs"]');
  assert.equal(await run('document.documentElement.dataset.bauifyAtlasFile'), 'src/ui/index.mjs');
  await click('.map-evidence .map-source-link');
  assert.match(await run('document.getElementById("bauify-code").textContent'), /import .*shared/);
  assert.match(await run('document.getElementById("bauify-code").textContent'), /Source · line 1/);
  await click('.source-back');
  const file = await download('MAP-repository-file-src-ui-index.mjs.md');
  assert.match(file.text, /Captured working-tree snapshot: \x60 [a-f0-9]{64}/);
  assert.match(file.text, /src\/ui\/index\.mjs:1/);
  await click('#bauify-atlas .atlas-clear');
  await waitFor('!document.querySelector(".map-file[aria-current=true]")', 'Atlas clear did not clear the file selection');
  await click('#bauify-atlas [data-module]');
  const module = await run('document.querySelector(".map-controls select").value');
  assert.ok(module, 'Atlas module selection filters the file list');
  const slug = module.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 72).replace(/^[-.]+|[-.]+$/g, '') || 'selection';
  const scoped = await download('MAP-repository-module-' + slug + '.md');
  assert.match(scoped.text, /Focus \(module\)/);
  assert.doesNotMatch(scoped.text, /export const surface/);

  await open(pathToFileURL(pr.overlay.html).href, 940, 800);
  await click('.reader-map');
  assert.equal(await run('document.querySelector("[data-map-mode=changes]").getAttribute("aria-pressed")'), 'true');
  await search('old.mjs');
  await click('[data-map-file="new.mjs"]');
  assert.match(await run('document.querySelector(".map-selection").textContent'), /Renamed.*old\.mjs.*new\.mjs/);
  await click('.map-selection > .map-actions > button:first-child');
  assert.match(await run('document.getElementById("bauify-code").textContent'), /Showing merge-base source.*OLD_MARKER/s);
  await click('[data-pr-side=head]');
  assert.match(await run('document.getElementById("bauify-code").textContent'), /Showing PR head source.*NEW_MARKER/s);
  assert.doesNotMatch(await run('document.getElementById("bauify-code").textContent'), /OLD_MARKER/);
  await click('.source-back');
  const rename = await download('MAP-changes-file-new.mjs.md');
  assert.match(rename.text, /example\/map#42/);
  assert.match(rename.text, /Renamed.*old\.mjs.*new\.mjs/);
  assert.match(rename.text, /base old\.mjs/);
  assert.match(rename.text, /head new\.mjs/);
  assert.doesNotMatch(rename.text, /NEW_MARKER|OLD_MARKER/);
  await search('removed');
  await click('[data-map-file="removed.mjs"]');
  await click('.map-selection > .map-actions > button');
  assert.equal(await run('document.querySelector("[data-pr-side=head]").disabled'), true);
  assert.match(await run('document.getElementById("bauify-code").textContent'), /REMOVED_MARKER/);
  await click('.source-back');
  await search('added');
  await click('[data-map-file="added.mjs"]');
  await click('.map-selection > .map-actions > button');
  assert.equal(await run('document.querySelector("[data-pr-side=base]").disabled'), true);
  await click('.source-back');
  await search('notes.txt');
  await click('[data-map-file="notes.txt"]');
  assert.match(await run('document.querySelector(".map-selection").textContent'), /Not analyzed in the captured scope/);
  assert.equal(await run('[...document.querySelectorAll(".map-selection > .map-actions button")].every(button=>button.disabled)'), true);
  await search('src/shared');
  await click('[data-map-file="src/shared/index.mjs"]');
  assert.match(await run('document.querySelector(".map-evidence").textContent'), /Detected in head only.*File cycle/s);
  await click('.map-observation .map-source-link');
  assert.match(await run('document.getElementById("bauify-code").textContent'), /Showing PR head source/);
  await click('.source-back');
  await click('[data-map-mode=repository]');
  assert.equal(await run('!!document.querySelector(".pr-summary")'), false, 'Repository view has no PR glyph legend');
});
