import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const pages = ['index', 'gallery', 'guide', 'start', 'community'];

test('all five built pages expose one shared top navigation and the correct current page', () => {
  for (const page of pages) {
    const dom = parse(fs.readFileSync(new URL(`../dist/${page}.html`, import.meta.url), 'utf8'));
    const nav = nodes(dom).find(node => node.tagName === 'nav' && hasClass(node, 'site-nav'));
    assert.ok(nav, page);
    const links = nodes(nav).filter(node => node.tagName === 'a' && hasClass(node, 'nav-link'));
    assert.deepEqual(links.map(node => attr(node, 'href')), [
      'guide.html', 'gallery.html', 'start.html', 'community.html', 'https://github.com/tt-a1i/archify',
    ], page);
    assert.deepEqual(links.filter(node => attr(node, 'aria-current') === 'page').map(node => attr(node, 'href')),
      page === 'index' ? [] : [`${page}.html`], page);
    const community = links.find(node => attr(node, 'href') === 'community.html');
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
  assert.ok(nodes(footer).some(node => node.tagName === 'a' && attr(node, 'href') === 'community.html'));
});
