import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { stagePublic } from '../scripts/stage-public.mjs';

const repo = new URL('../../', import.meta.url);
const fonts = new URL('../public/fonts/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('sources.json', fonts), 'utf8'));
const css = fs.readFileSync(new URL('fonts.css', fonts), 'utf8');
const pages = ['index', 'guide', 'start', 'gallery', 'community'];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;

test('local font declarations preserve the original families, weights and swap behavior', () => {
  assert.doesNotMatch(css, /https?:|@import/);
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, face]) => ({
    family: /font-family:\s*'([^']+)'/.exec(face)[1],
    style: /font-style:\s*([^;]+)/.exec(face)[1],
    weight: Number(/font-weight:\s*(\d+)/.exec(face)[1]),
    file: /src:\s*url\(\.\/([^)]+)\)/.exec(face)[1],
    body: face,
  }));
  assert.equal(faces.length, 14);
  assert.deepEqual(faces.map(({ family, style, weight }) => [family, style, weight]), [
    ['Fraunces', 'italic', 400], ...[300, 400, 500].map(weight => ['Fraunces', 'normal', weight]),
    ...[400, 450, 500, 600].map(weight => ['Inter', 'normal', weight]),
    ...[400, 500, 600].map(weight => ['JetBrains Mono', 'normal', weight]),
    ...[400, 500, 600].map(weight => ['Space Grotesk', 'normal', weight]),
  ]);
  for (const face of faces) {
    assert.match(face.body, /font-display:\s*swap;/);
    assert.match(face.body, /unicode-range:\s*U\+0000-00FF/);
    assert.ok(manifest.fonts.some(font => font.file === face.file));
  }
  for (const page of pages) {
    const head = fs.readFileSync(new URL(`../src/data/${page}-head.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(head, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.equal((head.match(/href="fonts\/fonts.css"/g) || []).length, 1);
  }
});

test('tracked public staging ships authentic WOFF2 bytes, licenses and the CSS references', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-local-fonts-'));
  try {
    stagePublic(fileURLToPath(repo), output);
    assert.equal(manifest.fonts.length, 5);
    assert.equal(manifest.licenses.length, 4);
    assert.deepEqual(fs.readFileSync(path.join(output, 'fonts/fonts.css')), fs.readFileSync(new URL('fonts.css', fonts)));
    for (const item of [...manifest.fonts, ...manifest.licenses]) {
      const data = fs.readFileSync(path.join(output, 'fonts', item.file));
      assert.equal(data.length, item.bytes, item.file);
      assert.equal(sha256(data), item.sha256, item.file);
      if (item.file.endsWith('.woff2')) {
        assert.equal(data.subarray(0, 4).toString('ascii'), 'wOF2', item.file);
        assert.equal(data.readUInt32BE(8), data.length, item.file);
        assert.match(item.source, /^https:\/\/fonts\.gstatic\.com\/s\//);
      } else {
        assert.match(data.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
        assert.ok(item.source.startsWith(`https://raw.githubusercontent.com/google/fonts/${manifest.licenseCommit}/ofl/`));
      }
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

// Integration evidence is selected explicitly after the corresponding build.
if (process.env.ARCHIFY_FONT_BUILD_CHECK === '1') test('built font links resolve to deployed bytes for both languages and the selected host', () => {
  const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
  const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
  const root = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
  for (const lang of ['en', 'zh']) for (const page of pages) {
    const file = page === 'index' ? `${lang === 'zh' ? 'zh' : 'index'}.html` : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
    const html = fs.readFileSync(new URL(file, output), 'utf8');
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    const all = nodes(parse(html));
    const documentUrl = cloudflare ? new URL(file.replace(/index\.html$/, '').replace(/\.html$/, ''), root) : new URL(file, root);
    const base = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), documentUrl);
    const links = all.filter(node => node.tagName === 'link' && attr(node, 'href') === 'fonts/fonts.css');
    assert.equal(links.length, 1, file);
    assert.equal(new URL(attr(links[0], 'href'), base).href, `${root}fonts/fonts.css`, file);
  }
  const publishedCss = fs.readFileSync(new URL('fonts/fonts.css', output), 'utf8');
  for (const [, file] of publishedCss.matchAll(/url\(\.\/([^)]+)\)/g)) {
    assert.deepEqual(fs.readFileSync(new URL(`fonts/${file}`, output)), fs.readFileSync(new URL(file, fonts)), file);
  }
});
