import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const pages = ['index', 'gallery', 'guide', 'start', 'community'];

test('all five built pages expose one shared top navigation and the correct current page', () => {
  for (const lang of ['en', 'zh']) for (const page of pages) {
    const file = page === 'index' ? (lang === 'zh' ? 'zh.html' : 'index.html') : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
    const hrefFor = target => `https://tt-a1i.github.io/archify/${lang === 'zh' ? 'zh/' : ''}${target}.html`;
    const dom = parse(fs.readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8'));
    const bases = nodes(dom).filter(node => node.tagName === 'base');
    assert.equal(bases.length, 1, file);
    assert.equal(attr(bases[0], 'href'), lang === 'zh' && page !== 'index' ? '../' : './', file);
    const baseUri = new URL(attr(bases[0], 'href'), `https://tt-a1i.github.io/archify/${file}`);
    const resolvedHref = node => new URL(attr(node, 'href'), baseUri).href;
    const nav = nodes(dom).find(node => node.tagName === 'nav' && hasClass(node, 'site-nav'));
    assert.ok(nav, page);
    const links = nodes(nav).filter(node => node.tagName === 'a' && hasClass(node, 'nav-link'));
    assert.deepEqual(links.map(resolvedHref), [
      ...['guide', 'gallery', 'start', 'community'].map(hrefFor), 'https://github.com/tt-a1i/archify',
    ], page);
    assert.deepEqual(links.filter(node => attr(node, 'aria-current') === 'page').map(resolvedHref),
      page === 'index' ? [] : [hrefFor(page)], page);
    const community = links.find(node => resolvedHref(node) === hrefFor('community'));
    if (page === 'index' || page === 'guide') {
      assert.equal(attr(community, 'data-i18n'), page === 'index' ? 'nav-community' : 'navCommunity', page);
    } else {
      assert.equal(attr(community, 'data-en'), 'Community', page);
      assert.equal(attr(community, 'data-zh'), '社区包', page);
    }
    const row = nodes(nav).find(node => hasClass(node, 'nav-links'));
    assert.equal(nodes(row).filter(node => node.tagName === 'a').length, 5, page);
  }
});

test('the homepage retains its footer catalog link alongside the top entry', () => {
  const dom = parse(fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'));
  const footer = nodes(dom).find(node => node.tagName === 'footer');
  const base = nodes(dom).filter(node => node.tagName === 'base');
  assert.equal(base.length, 1);
  assert.equal(attr(base[0], 'href'), './');
  const baseUri = new URL(attr(base[0], 'href'), 'https://tt-a1i.github.io/archify/index.html');
  assert.ok(nodes(footer).some(node => node.tagName === 'a' && new URL(attr(node, 'href'), baseUri).href === 'https://tt-a1i.github.io/archify/community.html'));
});
