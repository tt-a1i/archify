import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';

// Check the deployable files, not only the build configuration. Pages needs a
// top-level 404 to disable its implicit single-page-app fallback.
export function checkCloudflareOutput(root) {
  const pages = ['index.html', 'gallery.html', 'guide.html', 'start.html', 'community.html', 'zh.html', 'zh/gallery.html', 'zh/guide.html', 'zh/start.html', 'zh/community.html', '404.html'];
  let fileCount = 0;
  const checkAssets = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Static output must not contain a symlink: ${file}`);
      if (entry.isDirectory()) checkAssets(file);
      else {
        fileCount += 1;
        assert.ok(fs.statSync(file).size <= 25 * 1024 * 1024, `Cloudflare Pages asset exceeds 25 MiB: ${file}`);
      }
    }
  };
  checkAssets(root);
  assert.ok(fileCount <= 20000, `Cloudflare Pages Free file limit exceeded: ${fileCount}`);
  for (const forbidden of ['_worker.js', '_worker.js/index.js', 'functions']) {
    assert.ok(!fs.existsSync(path.join(root, forbidden)), `Static deployment must not contain ${forbidden}`);
  }
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const document = parse(source);
    const findBase = node => node.tagName === 'base'
      ? node.attrs?.find(attribute => attribute.name === 'href')?.value
      : (node.childNodes ?? []).map(findBase).find(Boolean);
    const documentUrl = `https://archify.si/${page}`;
    const baseUrl = new URL(findBase(document) || documentUrl, documentUrl);
    const visit = node => {
      for (const { name, value } of node.attrs ?? []) {
        if (!['src', 'href'].includes(name) || !value || value.startsWith('#')) continue;
        const url = new URL(value, baseUrl);
        if (url.origin !== 'https://archify.si') continue;
        const pathname = decodeURIComponent(url.pathname);
        assert.ok(!/^\/archify(?:\/|$)/.test(pathname), `${page}: legacy base URL ${value}`);
        const relative = pathname.replace(/^\//, '') || 'index.html';
        const target = path.resolve(root, relative);
        assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`), `${page}: URL escapes output ${value}`);
        // Pages serves file-format HTML at extensionless canonical URLs.
        const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
        assert.ok(candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()), `${page}: missing local target ${value}`);
      }
      for (const child of node.childNodes ?? []) visit(child);
    };
    visit(document);
  }
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.ok(locations.length >= 10, 'Sitemap must include both languages');
  assert.equal(new Set(locations).size, locations.length, 'Duplicate sitemap URL');
  for (const location of locations) {
    const url = new URL(location);
    assert.equal(url.origin, 'https://archify.si');
    assert.ok(!url.search && !url.hash && !/\.html$/.test(url.pathname), `Noncanonical sitemap URL: ${location}`);
    const relative = url.pathname.slice(1);
    const file = !relative || relative.endsWith('/') ? `${relative}index.html` : `${relative}.html`;
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes(`rel="canonical" href="${location}"`), `Missing matching canonical: ${location}`);
    assert.ok(!/<meta[^>]+(?:name="robots"[^>]+content="[^"]*noindex|content="[^"]*noindex[^>]+name="robots")/i.test(html), `Noindex sitemap page: ${location}`);
  }
  assert.equal(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8').includes('Sitemap: https://archify.si/sitemap.xml'), true);
  assert.match(fs.readFileSync(path.join(root, '_headers'), 'utf8'), /\/\*\.json\n  X-Robots-Tag: noindex/);
  const builtManifest = fs.readFileSync(path.join(root, 'skill-updates/archify/stable.json'));
  const canonicalManifest = fs.readFileSync(new URL('../../docs/skill-updates/archify/stable.json', import.meta.url));
  assert.ok(builtManifest.equals(canonicalManifest), 'The static site must retain the exact stable update manifest');
  return pages.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../dist-cloudflare/', import.meta.url));
  const count = checkCloudflareOutput(root);
  console.log(`Verified ${count} Cloudflare pages, local assets, static-only output, and stable update manifest.`);
}
