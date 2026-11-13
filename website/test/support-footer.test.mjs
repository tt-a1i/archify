import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => (node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join(''));
const pages = ['index', 'gallery', 'guide', 'start', 'community'];

function readPage(lang, page) {
  const file = page === 'index' ? (lang === 'zh' ? 'zh.html' : 'index.html') : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
  const html = fs.readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  const dom = parse(html);
  const bases = nodes(dom).filter(node => node.tagName === 'base');
  assert.equal(bases.length, 1, file);
  const baseUri = new URL(attr(bases[0], 'href'), `https://tt-a1i.github.io/archify/${file}`);
  return { file, dom, baseUri };
}

function href(node, baseUri) {
  return new URL(attr(node, 'href'), baseUri).href;
}

test('the homepage support section stays below the fold and reuses the README payment QR codes', () => {
  for (const lang of ['en', 'zh']) {
    const { file, dom } = readPage(lang, 'index');
    const support = nodes(dom).find(node => node.tagName === 'section' && attr(node, 'id') === 'support');
    assert.ok(support, `${file}: missing #support`);
    const images = nodes(support).filter(node => node.tagName === 'img');
    assert.deepEqual(images.map(node => attr(node, 'src')), [
      'assets/support/wechat-pay.png',
      'assets/support/alipay.png',
    ], file);
    assert.ok(fs.existsSync(new URL('../dist/assets/support/wechat-pay.png', import.meta.url)), 'wechat QR was not staged');
    assert.ok(fs.existsSync(new URL('../dist/assets/support/alipay.png', import.meta.url)), 'alipay QR was not staged');
    const heading = text(nodes(support).find(node => node.tagName === 'h2')).trim();
    assert.equal(heading, lang === 'zh' ? '支持 Archify' : 'Support Archify', file);
  }
});

test('every built page header links to the homepage support section with a visible tag', () => {
  for (const lang of ['en', 'zh']) {
    const supportUrl = lang === 'zh'
      ? 'https://tt-a1i.github.io/archify/zh.html#support'
      : 'https://tt-a1i.github.io/archify/#support';
    for (const page of pages) {
      const { file, dom, baseUri } = readPage(lang, page);
      const nav = nodes(dom).find(node => node.tagName === 'nav');
      assert.ok(nav, `${file}: missing nav`);
      const link = nodes(nav).find(node => node.tagName === 'a' && href(node, baseUri) === supportUrl);
      assert.ok(link, `${file}: nav must link to ${supportUrl}, got ${nodes(nav).filter(n => n.tagName === 'a').map(n => href(n, baseUri)).join(', ')}`);
      assert.equal(text(link).trim(), lang === 'zh' ? '☕ 支持' : '☕ Support', file);
      assert.equal((attr(link, 'class') || '').split(/\s+/).includes('nav-support'), true, `${file}: support tag should use nav-support`);
    }
  }
});

test('every built page footer links to the homepage support section', () => {
  for (const lang of ['en', 'zh']) {
    const supportUrl = lang === 'zh'
      ? 'https://tt-a1i.github.io/archify/zh.html#support'
      : 'https://tt-a1i.github.io/archify/#support';
    for (const page of pages) {
      const { file, dom, baseUri } = readPage(lang, page);
      const footer = nodes(dom).find(node => node.tagName === 'footer');
      assert.ok(footer, `${file}: missing footer`);
      const link = nodes(footer).find(node => node.tagName === 'a' && href(node, baseUri) === supportUrl);
      assert.ok(link, `${file}: footer must link to ${supportUrl}, got ${nodes(footer).filter(n => n.tagName === 'a').map(n => href(n, baseUri)).join(', ')}`);
      assert.equal(text(link).trim(), lang === 'zh' ? '支持项目' : 'Support', file);
    }
  }
});
