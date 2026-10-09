import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonicalOrigin, canonicalUrl, sitePages } from '../src/data/site-urls.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';

export const key = '0e4ac4a253b420619eb3de08ba664736';
export const keyLocation = `${canonicalOrigin}/${key}.txt`;
export const sitemapLocation = `${canonicalOrigin}/sitemap.xml`;
export const endpoint = 'https://api.indexnow.org/indexnow';
const allowedUrls = new Set([
  ...sitePages.flatMap(page => ['en', 'zh'].map(lang => canonicalUrl(page, lang))),
  ...CASES.map(entry => `${canonicalOrigin}/gallery/artifacts/${entry.output.replace(/\.html$/, '')}`),
]);
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };

// Parse the deliberately small XML vocabulary emitted by publish-seo. Fail
// closed on sitemap indexes, DTDs, unexpected elements or malformed entities.
export function parseSitemap(xml) {
  requireValue(Buffer.byteLength(xml) <= 1024 * 1024, 'Sitemap exceeds 1 MiB');
  const root = xml.trim().replace(/^<\?xml\s+[^?]*\?>\s*/, '').match(/^<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"\s*>([\s\S]*)<\/urlset>$/);
  requireValue(root, 'Expected a standard sitemap urlset XML document');
  const entries = [];
  let body = root[1];
  while (body.trim()) {
    const item = body.match(/^\s*<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/);
    requireValue(item, 'Malformed sitemap URL entry');
    const value = item[1].replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]);
    requireValue(!/&(?:#\w+|\w+);/.test(value), 'Unsupported XML entity');
    const url = new URL(value);
    requireValue(url.protocol === 'https:' && url.host === 'archify.si' && !url.username && !url.password && !url.search && !url.hash, `Noncanonical host or URL: ${value}`);
    requireValue(url.href === value && allowedUrls.has(value), `URL outside the published page/artifact inventory: ${value}`);
    requireValue(!entries.includes(value), `Duplicate sitemap URL: ${value}`);
    entries.push(value);
    body = body.slice(item[0].length);
  }
  requireValue(entries.length === allowedUrls.size, 'Sitemap must contain all ten main pages and selected gallery artifacts');
  return entries;
}

async function readPublic(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  requireValue(response.status === 200, `Public preflight failed: ${url} HTTP ${response.status}`);
  const text = await response.text();
  requireValue(Buffer.byteLength(text) <= 1024 * 1024, `Public response exceeds 1 MiB: ${url}`);
  return text;
}

export async function notifyIndexNow({ submit = false, fetchImpl = fetch } = {}) {
  const localKey = fs.readFileSync(new URL(`../public/${key}.txt`, import.meta.url), 'utf8');
  requireValue(localKey.trim() === key, 'Public key file does not match the configured key');
  const urlList = parseSitemap(await readPublic(sitemapLocation, fetchImpl));
  const payload = { host: 'archify.si', key, keyLocation, urlList };
  if (!submit) return { status: 'dry-run', endpoint, payload };
  const hostedKey = await readPublic(keyLocation, fetchImpl);
  requireValue(hostedKey.trim() === key, 'Deployed IndexNow key file does not match');
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  requireValue(response.status === 200 || response.status === 202, `IndexNow notification failed: HTTP ${response.status}`);
  return { status: response.status === 200 ? 'accepted' : 'queued-key-validation', httpStatus: response.status, urlCount: urlList.length, indexed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--submit', '--help'].includes(arg))) {
    console.error('Usage: node website/scripts/indexnow.mjs [--submit]');
    process.exitCode = 1;
  } else if (args.includes('--help')) {
    console.log('Default: fetch the deployed sitemap and print the payload without POST.\nAfter deployment: node website/scripts/indexnow.mjs --submit\n200 means received; 202 means received with key validation pending. Neither confirms indexing.\nProtocol: https://www.indexnow.org/documentation');
  } else {
    try { console.log(JSON.stringify(await notifyIndexNow({ submit: args.includes('--submit') }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
