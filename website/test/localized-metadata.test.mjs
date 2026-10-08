import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'parse5';
import { canonicalUrl, localPagePath, sitePages } from '../src/data/site-urls.mjs';
import { localizeHtml } from '../src/data/localize-html.mjs';
import { pageMetadata } from '../src/data/site-metadata.mjs';
import { defaultProofLabels } from '../src/data/default-proof-labels.mjs';
import { indexCopy } from '../src/data/site-translations.mjs';

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes || []).map(text).join('');

test('shared static localization translates authored copy and preserves markup contracts', () => {
  const html = '<h1 data-i18n="title">English</h1><p data-en="A &amp; B" data-zh="甲 &lt;乙&gt;">A</p><input data-i18n-placeholder="input"><a href="start.html?agent=codex&amp;input=repository#install">Start</a><a href="#section">Section</a><script src="assets/site-language.js"></script>';
  const localized = localizeHtml(html, { page: 'guide', lang: 'zh', cloudflare: true, copy: { zh: { title: '中文 <em>标题</em>', input: '输入' } } });
  const all = nodes(parse(localized));
  assert.equal(text(all.find(node => node.tagName === 'h1')), '中文 标题');
  assert.ok(all.some(node => node.tagName === 'em'));
  assert.equal(text(all.find(node => node.tagName === 'p')), '甲 <乙>');
  assert.equal(attr(all.find(node => node.tagName === 'input'), 'placeholder'), '输入');
  assert.deepEqual(all.filter(node => node.tagName === 'a').map(node => attr(node, 'href')), ['zh/start?agent=codex&input=repository#install', 'zh/guide#section']);
  assert.ok(!all.some(node => node.tagName === 'script'));
});

test('metadata points both hosts to real localized canonical pages and honest source schema', () => {
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const metadata = pageMetadata(page, lang, '1.2.3');
    assert.equal(metadata.canonical, canonicalUrl(page, lang));
    assert.equal(metadata.schema['@graph'][1].version, '1.2.3');
    assert.equal(metadata.schema['@graph'][1].codeRepository, 'https://github.com/tt-a1i/archify');
    assert.match(metadata.schema['@graph'][1].license, /\/LICENSE$/);
    assert.doesNotMatch(JSON.stringify(metadata.schema), /aggregateRating|ratingValue|downloadCount|interactionStatistic/);
  }
  assert.equal(canonicalUrl('index', 'zh'), 'https://archify.si/zh');
  assert.equal(localPagePath('index', 'zh'), 'zh.html');
  assert.equal(localPagePath('start', 'zh', true), 'zh/start');
});

function runtime({ href, base, lang = 'en', page = 'start', cloudflare = false, stored = 'zh' }) {
  let redirected, replaced, ready;
  const switcher = { href: '', addEventListener() {} };
  const window = {
    location: { href, replace(value) { redirected = value; } },
    localStorage: { getItem() { return stored; }, setItem() {} },
    history: { state: {}, replaceState(_state, _title, value) { replaced = value; } },
  };
  const document = {
    documentElement: {}, baseURI: base,
    getElementById() { return { textContent: JSON.stringify({ lang, page, cloudflare }) }; },
    addEventListener(_event, callback) { ready = callback; },
    querySelectorAll(selector) { return selector === '[data-language-switch]' ? [switcher] : []; },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../src/scripts/site-language.js', import.meta.url), 'utf8'), { window, document, URL });
  ready();
  return { api: window.ArchifySiteLanguage, redirected, replaced, switcher };
}

test('URL locale wins stored preference and route switches preserve query and hash', () => {
  for (const setup of [
    { href: 'https://tt-a1i.github.io/archify/start.html', base: 'https://tt-a1i.github.io/archify/', expected: 'https://tt-a1i.github.io/archify/zh/start.html' },
    { href: 'https://archify.si/start', base: 'https://archify.si/', cloudflare: true, expected: 'https://archify.si/zh/start' },
    { href: 'file:///tmp/export/start.html', base: 'file:///tmp/export/', expected: 'file:///tmp/export/zh/start.html' },
  ]) {
    const suffix = '?agent=codex&type=workflow&input=repository&source=artifact&query=cache&lang=zh#install';
    const result = runtime({ ...setup, href: setup.href + suffix });
    assert.equal(result.api.read(), 'en', 'storage must not change the route language');
    const next = new URL(result.redirected);
    assert.equal(next.origin + next.pathname, new URL(setup.expected).origin + new URL(setup.expected).pathname);
    assert.equal(next.searchParams.get('agent'), 'codex');
    assert.equal(next.searchParams.get('type'), 'workflow');
    assert.equal(next.searchParams.get('input'), 'repository');
    assert.equal(next.searchParams.get('source'), 'artifact');
    assert.equal(next.searchParams.get('query'), 'cache');
    assert.equal(next.searchParams.has('lang'), false);
    assert.equal(next.hash, '#install');
    assert.equal(result.switcher.href, result.redirected);
  }
  const chinese = runtime({ href: 'https://archify.si/zh/start?lang=zh#install', base: 'https://archify.si/', lang: 'zh', cloudflare: true, stored: 'en' });
  assert.equal(chinese.api.read(), 'zh');
  assert.equal(chinese.redirected, undefined);
  assert.equal(chinese.replaced, 'https://archify.si/zh/start#install');
});

const output = new URL(process.env.ARCHIFY_SITE_TARGET === 'cloudflare' ? '../dist-cloudflare/' : '../dist/', import.meta.url);
test('built pages contain localized HTML and reciprocal language metadata before JavaScript', () => {
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const file = lang === 'zh' ? page === 'index' ? 'zh.html' : `zh/${page}.html` : `${page}.html`;
    const all = nodes(parse(fs.readFileSync(new URL(file, output), 'utf8')));
    const one = (tag, name, value) => all.find(node => node.tagName === tag && attr(node, name) === value);
    assert.equal(attr(all.find(node => node.tagName === 'html'), 'lang'), lang === 'zh' ? 'zh-Hans' : 'en', file);
    assert.equal(attr(one('link', 'rel', 'canonical'), 'href'), canonicalUrl(page, lang), file);
    for (const alternate of ['en', 'zh-Hans', 'x-default']) {
      assert.equal(attr(one('link', 'hreflang', alternate), 'href'), canonicalUrl(page, alternate === 'zh-Hans' ? 'zh' : 'en'), file);
    }
    const title = text(all.find(node => node.tagName === 'title'));
    assert.ok(title.startsWith('Archify'));
    assert.equal(attr(one('meta', 'property', 'og:title'), 'content'), title, file);
    assert.equal(attr(one('meta', 'name', 'twitter:title'), 'content'), title, file);
    assert.equal(attr(one('meta', 'property', 'og:url'), 'content'), canonicalUrl(page, lang), file);
    if (page === 'index') {
      for (const [id, expected] of Object.entries({
        'beat-title': indexCopy[lang]['beat-0-t'], 'beat-body': indexCopy[lang]['beat-0-b'],
        'proof-title': defaultProofLabels.title[lang], 'proof-meta': defaultProofLabels.meta[lang],
      })) assert.equal(text(all.find(node => attr(node, 'id') === id)), expected, `${file}: #${id} before JavaScript`);
      const sharedLabels = all.find(node => attr(node, 'id') === 'site-proof-labels');
      assert.deepEqual(JSON.parse(text(sharedLabels)), defaultProofLabels, file);
    }
    const switcher = all.find(node => attr(node, 'data-language-switch') !== undefined);
    assert.equal(switcher.tagName, 'a', file);
    const main = all.find(node => node.tagName === 'body');
    const visible = nodes(main).filter(node => node.nodeName === '#text' && !['script', 'style'].includes(node.parentNode?.tagName)).map(node => node.value).join('');
    if (lang === 'zh') assert.match(visible, /[\u4e00-\u9fff]/, file);
    assert.ok(!all.some(node => node.tagName === 'script' && attr(node, 'src')?.endsWith('site-language.js')), file);
  }
});
