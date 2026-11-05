import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, parseFragment } from 'parse5';
import { SEO_BLOCK_START, SEO_BLOCK_END, stripPublishedArtifactMetadata, artifactMetadata } from '../scripts/publish-seo.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';

const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const pages = ['index', 'start', 'guide', 'gallery', 'community'];

test('built deployment uses host-compatible generated assets and canonical metadata in both languages', () => {
  for (const lang of ['en', 'zh']) for (const page of pages) {
    const file = page === 'index' ? `${lang === 'zh' ? 'zh' : 'index'}.html` : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
    const dom = parse(fs.readFileSync(new URL(file, output), 'utf8'));
    const all = nodes(dom);
    const canonicalUrl = `https://archify.si/${page === 'index' ? (lang === 'zh' ? 'zh' : '') : `${lang === 'zh' ? 'zh/' : ''}${page}`}`;
    const bases = all.filter(node => node.tagName === 'base');
    assert.equal(bases.length, 1, file);
    assert.equal(attr(bases[0], 'href'), lang === 'zh' && page !== 'index' ? '../' : './', file);
    const documentUrl = cloudflare ? canonicalUrl : `https://tt-a1i.github.io/archify/${file}`;
    const baseUri = new URL(attr(bases[0], 'href'), documentUrl);
    const nav = all.find(node => node.tagName === 'nav' && attr(node, 'class') === 'site-nav');
    const navLinks = nodes(nav).filter(node => node.tagName === 'a' && (attr(node, 'class') || '').split(/\s+/).includes('nav-link'));
    assert.deepEqual(navLinks.map(node => new URL(attr(node, 'href'), baseUri).href), [
      ...['guide', 'gallery', 'start', 'community'].map(target => `${cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/'}${lang === 'zh' ? 'zh/' : ''}${target}${cloudflare ? '' : '.html'}`),
      'https://github.com/tt-a1i/archify',
    ], `${file}: routes resolved against the actual document base`);
    const canonical = all.filter(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical');
    assert.equal(canonical.length, 1, file);
    assert.equal(attr(canonical[0], 'href'), canonicalUrl, file);
    const alternates = all.filter(node => node.tagName === 'link' && attr(node, 'rel') === 'alternate');
    assert.deepEqual(alternates.map(node => [attr(node, 'hreflang'), attr(node, 'href')]), [
      ['en', `https://archify.si/${page === 'index' ? '' : page}`],
      ['zh-Hans', `https://archify.si/${page === 'index' ? 'zh' : `zh/${page}`}`],
      ['x-default', `https://archify.si/${page === 'index' ? '' : page}`],
    ], file);
    const generatedAssets = all.flatMap(node => ['src', 'href'].map(name => attr(node, name))).filter(value => value?.includes('/_astro/'));
    for (const asset of generatedAssets) {
      assert.ok(asset.startsWith(cloudflare ? '/_astro/' : '/archify/_astro/'), asset);
      const relative = asset.replace(cloudflare ? /^\// : /^\/archify\//, '').split(/[?#]/)[0];
      assert.ok(fs.statSync(new URL(relative, output)).isFile(), asset);
    }
    for (const property of ['og:url', 'og:image']) {
      const meta = all.filter(node => attr(node, 'property') === property);
      assert.equal(meta.length, 1, `${file}: ${property}`);
      assert.equal(attr(meta[0], 'content'), property === 'og:url' ? canonicalUrl : 'https://archify.si/assets/archify-social-preview.png');
    }
  }
});

test('deployment preserves standalone proof outside its exact metadata block and updater bytes; only Cloudflare gets a 404', () => {
  const file = 'gallery/artifacts/agent-tool-call.workflow.html';
  const published = fs.readFileSync(new URL(file, output), 'utf8');
  assert.equal(published.split(SEO_BLOCK_START).length, 2);
  assert.equal(published.split(SEO_BLOCK_END).length, 2);
  const start = published.indexOf(SEO_BLOCK_START), end = published.indexOf(SEO_BLOCK_END) + SEO_BLOCK_END.length;
  assert.ok(start > published.indexOf('<head>') && end < published.indexOf('</head>'));
  const entry = JSON.parse(fs.readFileSync(new URL('../../docs/gallery/manifest.json', import.meta.url), 'utf8')).entries.find(entry => entry.artifact === file);
  const presentation = CASES.find(item => item.id === entry.id);
  const block = published.slice(start, end) + '\n';
  assert.equal(block, artifactMetadata(entry, presentation));
  const metadataNodes = nodes(parseFragment(block)).filter(node => node.tagName);
  assert.deepEqual(metadataNodes.map(node => node.tagName), ['link', 'meta', 'meta', 'meta', 'meta', 'meta', 'script']);
  const structured = metadataNodes.at(-1);
  assert.equal(attr(structured, 'type'), 'application/ld+json');
  assert.equal(structured.attrs.length, 1);
  assert.equal(JSON.parse(structured.childNodes.map(node => node.value || '').join(''))['@type'], 'CreativeWork');
  assert.deepEqual(Buffer.from(stripPublishedArtifactMetadata(published)), fs.readFileSync(new URL(`../../docs/${file}`, import.meta.url)));
  for (const asset of ['skill-updates/archify/stable.json', 'assets/site-language.js']) {
    assert.deepEqual(fs.readFileSync(new URL(asset, output)), fs.readFileSync(new URL(`../../docs/${asset}`, import.meta.url)), asset);
  }
  assert.equal(fs.existsSync(new URL('404.html', output)), cloudflare);
  if (cloudflare) {
    const dom = parse(fs.readFileSync(new URL('404.html', output), 'utf8'));
    assert.ok(nodes(dom).some(node => node.tagName === 'a' && attr(node, 'href') === '/'));
  }
});
