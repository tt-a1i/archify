import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';
import { parseSitemap } from '../scripts/indexnow.mjs';
import { stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';
const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const read = file => nodes(parse(fs.readFileSync(new URL(file, output), 'utf8')));

test('MCO case exposes pinned source, honest limits, stable sections and nested routes without JavaScript', () => {
  for (const lang of ['en', 'zh']) {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const route = `${prefix}cases/mco-runtime`;
    const all = read(`${route}.html`);
    const url = new URL(route + (cloudflare ? '' : '.html'), origin);
    const base = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), url);
    assert.equal(base.href, origin, 'nested case resolves to the deployed site root');
    const article = all.find(node => node.tagName === 'article');
    assert.equal(nodes(article).filter(node => node.tagName === 'h1').length, 1);
    const visible = text(article);
    for (const value of ['9f1a1cf1afdc04d7b5406782b40dfec76d9bc798', '04dc1916e1651086564f16076eab6d2f6ba1ae42', 'include_token_usage', 'TemporaryDirectory']) assert.ok(visible.includes(value), value);
    assert.match(visible, lang === 'en' ? /does not mean zero disk writes/ : /不等于没有文件写入/);
    assert.match(visible, lang === 'en' ? /not a captured runtime trace/ : /不是采集到的运行时 trace/);
    assert.doesNotMatch(visible, /\[\d+\]|source ledger|workspace\/shared/);
    const sourceLinks = nodes(article).filter(node => node.tagName === 'a' && attr(node, 'href')?.startsWith('https://github.com/'));
    assert.ok(sourceLinks.length >= 12);
    for (const link of sourceLinks) assert.match(attr(link, 'href'), /\/blob\/(9f1a1cf1afdc04d7b5406782b40dfec76d9bc798|04dc1916e1651086564f16076eab6d2f6ba1ae42)\//);
    const schema = JSON.parse(text(all.find(node => attr(node, 'type') === 'application/ld+json')));
    assert.equal(schema['@graph'].find(item => item['@type'] === 'TechArticle').url, `https://archify.si/${route}`);
    const toc = all.find(node => attr(node, 'class') === 'article-toc');
    for (const link of nodes(toc).filter(node => node.tagName === 'a')) {
      const destination = new URL(attr(link, 'href'), base);
      assert.equal(destination.origin + destination.pathname, url.href);
      const targets = nodes(article).filter(node => attr(node, 'id') === destination.hash.slice(1));
      assert.equal(targets.length, 1);
      const target = targets[0].parentNode.tagName === 'p' ? targets[0].parentNode : targets[0];
      const siblings = target.parentNode.childNodes;
      const next = siblings.slice(siblings.indexOf(target) + 1).find(node => node.tagName);
      assert.equal(next.tagName, 'h2');
      assert.equal(text(next), text(link));
    }
    const start = nodes(article).find(node => node.tagName === 'a' && attr(node, 'href')?.includes('input=repository'));
    assert.ok(start, 'the case offers a repository-mode installation next step');
    const startUrl = new URL(attr(start, 'href'), base);
    assert.equal(startUrl.pathname, new URL(`${prefix}start${cloudflare ? '' : '.html'}`, origin).pathname);
    assert.equal(startUrl.searchParams.get('type'), 'architecture');
    assert.equal(startUrl.hash, '#install');
    const replay = nodes(article).find(node => node.tagName === 'pre');
    assert.ok(text(replay).includes('--repo-root mco-source'), 'replay can verify declared repository evidence');
    const artifact = nodes(article).find(node => attr(node, 'href') === 'cases/mco-runtime.architecture.html');
    assert.ok(artifact);
    assert.equal(new URL(attr(artifact, 'href'), base).href, origin + 'cases/mco-runtime.architecture.html');
    for (const entry of ['gallery', 'agent-diagrams']) {
      const dom = read(`${prefix}${entry}.html`);
      const link = dom.find(node => node.tagName === 'a' && attr(node, 'href') === route + (cloudflare ? '' : '.html'));
      assert.ok(link, `${lang}/${entry}: contextual case link`);
    }
  }
});

test('MCO case inventory includes both wrappers and preserves original artifact and typed source bytes', () => {
  const urls = parseSitemap(fs.readFileSync(new URL('sitemap.xml', output), 'utf8'));
  for (const prefix of ['', 'zh/']) assert.ok(urls.includes(`https://archify.si/${prefix}cases/mco-runtime`));
  assert.ok(urls.includes('https://archify.si/cases/mco-runtime.architecture'), 'the standalone artifact is distinct from the explanatory article');
  for (const extension of ['html', 'json']) {
    const file = `cases/mco-runtime.architecture.${extension}`;
    const published = fs.readFileSync(new URL(file, output));
    const original = extension === 'html' ? Buffer.from(stripPublishedArtifactMetadata(published.toString('utf8'))) : published;
    assert.deepEqual(original, fs.readFileSync(new URL(`../../docs/${file}`, import.meta.url)), file);
  }
});
