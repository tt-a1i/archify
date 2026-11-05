import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { canonicalPath, canonicalUrl, sitePages } from '../src/data/site-urls.mjs';
import { publishSeo, selectedArtifacts, stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-search-'));
  fs.cpSync(path.join(docs, 'gallery'), path.join(root, 'gallery'), { recursive: true });
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const route = canonicalPath(page, lang).slice(1);
    const file = !route || route.endsWith('/') ? `${route}index.html` : `${route}.html`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `<html><head><link rel="canonical" href="${canonicalUrl(page, lang)}"></head></html>`);
  }
  return root;
}

for (const name of ['cloudflare', 'github']) test(`${name}: published discovery metadata retains proof bytes and advertises only real canonical HTML`, () => {
  const root = fixture();
  try {
    const urls = publishSeo(root, { name });
    assert.equal(urls.length, 10 + CASES.length);
    assert.equal(new Set(urls).size, urls.length);
    for (const page of sitePages) for (const lang of ['en', 'zh']) assert.ok(urls.includes(canonicalUrl(page, lang)));
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /lastmod|priority|changefreq|\.json|\.html|tt-a1i\.github/);
    assert.equal((sitemap.match(/<loc>/g) || []).length, urls.length);
    for (const { entry, presentation } of selectedArtifacts(root)) {
      const original = fs.readFileSync(path.join(docs, entry.artifact), 'utf8');
      const published = fs.readFileSync(path.join(root, entry.artifact), 'utf8');
      assert.equal(stripPublishedArtifactMetadata(published), original, `${entry.id}: all renderer bytes preserved`);
      const url = `https://archify.si/${entry.artifact.replace(/\.html$/, '')}`;
      assert.ok(published.includes(`rel="canonical" href="${url}"`));
      const structured = JSON.parse(published.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
      assert.equal(structured.description, presentation.descriptionEn);
      assert.equal(structured.isBasedOn, `https://archify.si/${entry.input}`);
      assert.deepEqual(fs.readFileSync(path.join(root, entry.input)), fs.readFileSync(path.join(docs, entry.input)));
    }
    const once = fs.readFileSync(path.join(root, `gallery/artifacts/${CASES[0].output}`), 'utf8');
    publishSeo(root, { name });
    assert.equal(fs.readFileSync(path.join(root, `gallery/artifacts/${CASES[0].output}`), 'utf8'), once, 'repeat build is idempotent');
    assert.equal(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n\nSitemap: https://archify.si/sitemap.xml\n');
    assert.equal(fs.existsSync(path.join(root, '_headers')), name === 'cloudflare');
    if (name === 'cloudflare') assert.equal(fs.readFileSync(path.join(root, '_headers'), 'utf8'), '/*.json\n  X-Robots-Tag: noindex\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publication fails closed for missing localized pages or changed proof artifacts/sources', () => {
  const root = fixture();
  try {
    fs.rmSync(path.join(root, 'zh/guide.html'));
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Missing indexable page/);
    fs.writeFileSync(path.join(root, 'zh/guide.html'), '<html></html>');
    const first = CASES[0];
    fs.appendFileSync(path.join(root, `gallery/artifacts/${first.output}`), 'changed');
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Artifact proof hash mismatch/);
    fs.copyFileSync(path.join(docs, `gallery/artifacts/${first.output}`), path.join(root, `gallery/artifacts/${first.output}`));
    fs.appendFileSync(path.join(root, `gallery/sources/${first.input}`), 'changed');
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Source proof hash mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
