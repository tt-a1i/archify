import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCloudflareOutput } from '../scripts/check-cloudflare-output.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cloudflare-output-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const names = ['index', 'gallery', 'guide', 'start', 'community', 'zh', 'zh/gallery', 'zh/guide', 'zh/start', 'zh/community'];
  const urls = names.map(name => `https://archify.si/${name === 'index' ? '' : name}`);
  for (const [index, name] of names.entries()) {
    fs.mkdirSync(path.dirname(path.join(root, `${name}.html`)), { recursive: true });
    fs.writeFileSync(path.join(root, `${name}.html`), `<!doctype html><title>Archify</title><link rel="canonical" href="${urls[index]}">`);
  }
  fs.writeFileSync(path.join(root, '404.html'), '<!doctype html><title>Not found</title>');
  fs.writeFileSync(path.join(root, 'sitemap.xml'), `<urlset>${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`);
  fs.writeFileSync(path.join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://archify.si/sitemap.xml\n');
  fs.writeFileSync(path.join(root, '_headers'), '/*.json\n  X-Robots-Tag: noindex\n');
  fs.writeFileSync(path.join(root, 'site.css'), 'body { color: black; }');
  fs.appendFileSync(path.join(root, 'index.html'), '<link href="site.css" rel="stylesheet"><a href="/guide?lang=zh#install">Guide</a>');
  const manifest = path.join(root, 'skill-updates/archify/stable.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.copyFileSync(new URL('../../docs/skill-updates/archify/stable.json', import.meta.url), manifest);
  return root;
}

test('Cloudflare output accepts static files and extensionless canonical routes', t => {
  assert.equal(checkCloudflareOutput(fixture(t)), 11);
});

test('Cloudflare output rejects a missing 404 before implicit SPA fallback can ship', t => {
  const root = fixture(t);
  fs.rmSync(path.join(root, '404.html'));
  assert.throws(() => checkCloudflareOutput(root), /ENOENT.*404\.html/);
});

test('Cloudflare output rejects a referenced asset missing from the deployment', t => {
  const root = fixture(t);
  fs.rmSync(path.join(root, 'site.css'));
  assert.throws(() => checkCloudflareOutput(root), /index\.html: missing local target site\.css/);
});

test('Cloudflare output rejects a Worker accidentally bundled into the static site', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '_worker.js'), 'export default {};');
  assert.throws(() => checkCloudflareOutput(root), /Static deployment must not contain _worker\.js/);
});

test('Cloudflare output rejects an asset exceeding the Pages upload limit', t => {
  const root = fixture(t);
  const asset = path.join(root, 'oversize.bin');
  fs.writeFileSync(asset, '');
  fs.truncateSync(asset, 25 * 1024 * 1024 + 1);
  assert.throws(() => checkCloudflareOutput(root), /asset exceeds 25 MiB/);
});


test('Cloudflare output resolves nested-page assets against the HTML base', t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, 'zh/guide.html'), '<base href="../"><link href="site.css" rel="stylesheet">');
  assert.equal(checkCloudflareOutput(root), 11);
  fs.rmSync(path.join(root, 'site.css'));
  assert.throws(() => checkCloudflareOutput(root), /missing local target site\.css/);
});
