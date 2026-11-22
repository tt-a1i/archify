import { sitePages } from '../src/data/site-urls.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const pages = sitePages;
const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
const extension = cloudflare ? '' : '.html';

test('all built pages expose one shared top navigation and the correct current page', () => {
  for (const lang of ['en', 'zh']) for (const page of pages) {
    const file = page === 'index' ? (lang === 'zh' ? 'zh.html' : 'index.html') : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
    const hrefFor = target => `${origin}${lang === 'zh' ? 'zh/' : ''}${target}${extension}`;
    const dom = parse(fs.readFileSync(new URL(file, output), 'utf8'));
    const bases = nodes(dom).filter(node => node.tagName === 'base');
    assert.equal(bases.length, 1, file);
    assert.equal(attr(bases[0], 'href'), '../'.repeat(file.split('/').length - 1) || './', file);
    const baseUri = new URL(attr(bases[0], 'href'), new URL(cloudflare ? file.replace(/\.html$/, '').replace(/^index$/, '') : file, origin));
    const resolvedHref = node => new URL(attr(node, 'href'), baseUri).href;
    const nav = nodes(dom).find(node => node.tagName === 'nav' && hasClass(node, 'site-nav'));
    assert.ok(nav, page);
    const links = nodes(nav).filter(node => node.tagName === 'a' && hasClass(node, 'nav-link'));
    assert.deepEqual(links.map(resolvedHref), [
      ...['guide', 'gallery', 'start', 'community'].map(hrefFor), 'https://github.com/tt-a1i/archify',
    ], page);
    assert.deepEqual(links.filter(node => attr(node, 'aria-current') === 'page').map(resolvedHref),
      ['index', 'agent-diagrams', 'compare', 'cases/mco-runtime'].includes(page) ? [] : [hrefFor(page)], page);
    const community = links.find(node => resolvedHref(node) === hrefFor('community'));
    if (page === 'index' || page === 'guide') {
      assert.equal(attr(community, 'data-i18n'), page === 'index' ? 'nav-community' : 'navCommunity', page);
    } else {
      assert.equal(attr(community, 'data-en'), 'Community', page);
      assert.equal(attr(community, 'data-zh'), '社区包', page);
    }
    if (page === 'index') {
      const install = nodes(nav).find(node => hasClass(node, 'nav-cta'));
      const destination = new URL(resolvedHref(install));
      assert.equal(destination.href, `${origin}${lang === 'zh' ? `zh${extension}` : ''}#quickstart`, 'homepage installation opens the quick start');
    }
    const row = nodes(nav).find(node => hasClass(node, 'nav-links'));
    assert.equal(nodes(row).filter(node => node.tagName === 'a').length, 5, page);
  }
});

test('the homepage retains its footer catalog link alongside the top entry', () => {
  const dom = parse(fs.readFileSync(new URL('index.html', output), 'utf8'));
  const footer = nodes(dom).find(node => node.tagName === 'footer');
  const base = nodes(dom).filter(node => node.tagName === 'base');
  assert.equal(base.length, 1);
  assert.equal(attr(base[0], 'href'), './');
  const baseUri = new URL(attr(base[0], 'href'), new URL(cloudflare ? '' : 'index.html', origin));
  assert.ok(nodes(footer).some(node => node.tagName === 'a' && new URL(attr(node, 'href'), baseUri).href === `${origin}community${extension}`));
});


test('both localized homepages link to the existing architecture source case', () => {
  for (const lang of ['en', 'zh']) {
    const file = lang === 'zh' ? 'zh.html' : 'index.html';
    const dom = parse(fs.readFileSync(new URL(file, output), 'utf8'));
    const baseUri = new URL(attr(nodes(dom).find(node => node.tagName === 'base'), 'href'), new URL(file, origin));
    const expected = `${origin}${lang === 'zh' ? 'zh/' : ''}cases/mco-runtime${extension}`;
    const link = nodes(dom).find(node => node.tagName === 'a' && hasClass(node, 'type-more') &&
      new URL(attr(node, 'href'), baseUri).href === expected);
    assert.ok(link, `${lang}: architecture panel offers the localized source case`);
    assert.ok(nodes(link).some(node => node.nodeName === '#text' && node.value.trim()), 'case entry has readable link text');
    assert.ok(fs.existsSync(new URL(`${lang === 'zh' ? 'zh/' : ''}cases/mco-runtime.html`, output)), 'case destination is built');
  }
});
