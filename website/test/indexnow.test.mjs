import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalUrl, sitePages, canonicalOrigin } from '../src/data/site-urls.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { notifyIndexNow, parseSitemap, endpoint, key, keyLocation, sitemapLocation } from '../scripts/indexnow.mjs';

const urls = [...sitePages.flatMap(page => ['en', 'zh'].map(lang => canonicalUrl(page, lang))), ...CASES.map(entry => `${canonicalOrigin}/gallery/artifacts/${entry.output.replace(/\.html$/, '')}`)];
const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
function mock({ sitemap = xml, hostedKey = key, getStatus = 200, postStatus = 200 } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return { status: options.method === 'POST' ? postStatus : getStatus, text: async () => url === sitemapLocation ? sitemap : hostedKey };
  } };
}

test('public key is a root verification file and default mode only reads the deployed sitemap', async () => {
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(fs.readFileSync(new URL(`../public/${key}.txt`, import.meta.url), 'utf8'), key);
  const service = mock();
  const result = await notifyIndexNow(service);
  assert.equal(result.status, 'dry-run');
  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0].url, sitemapLocation);
  assert.deepEqual(result.payload, { host: 'archify.si', key, keyLocation, urlList: urls });
});

for (const status of [200, 202]) test(`HTTP ${status} confirms receipt without claiming indexing`, async () => {
  const service = mock({ postStatus: status });
  const result = await notifyIndexNow({ ...service, submit: true });
  assert.equal(result.indexed, false);
  assert.equal(result.status, status === 200 ? 'accepted' : 'queued-key-validation');
  assert.equal(service.calls.length, 3);
  assert.equal(service.calls[1].url, keyLocation);
  assert.equal(service.calls[2].url, endpoint);
  assert.deepEqual(JSON.parse(service.calls[2].options.body).urlList, urls);
});

for (const status of [400, 403, 422, 429, 500]) test(`HTTP ${status} fails once without retry`, async () => {
  const service = mock({ postStatus: status });
  await assert.rejects(notifyIndexNow({ ...service, submit: true }), new RegExp(`HTTP ${status}`));
  assert.equal(service.calls.length, 3);
});

test('public preflight requires HTTP 200 and matching deployed key before POST', async () => {
  for (const options of [{ getStatus: 404 }, { hostedKey: 'different key' }]) {
    const service = mock(options);
    await assert.rejects(notifyIndexNow({ ...service, submit: true }), /preflight failed|does not match/);
    assert.ok(service.calls.every(call => call.options.method !== 'POST'));
  }
});

test('sitemap XML parser rejects foreign, query, source, duplicate, incomplete and malformed inventories', () => {
  assert.deepEqual(parseSitemap(xml), urls);
  for (const sitemap of [xml.replace('https://archify.si/', 'http://archify.si/'), xml.replace('https://archify.si/', 'https://other.example/'), xml.replace(urls[0], `${urls[0]}?preview=1`), xml.replace(urls[0], `${canonicalOrigin}/gallery/manifest.json`), xml.replace(urls[0], urls[1]), xml.replace(/<url>[\s\S]*?<\/url>/, ''), xml.replace('<loc>', '<wrong>'), '<!DOCTYPE foo>' + xml]) {
    assert.throws(() => parseSitemap(sitemap));
  }
});
