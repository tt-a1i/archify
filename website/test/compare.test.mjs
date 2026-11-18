import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { parseSitemap } from '../scripts/indexnow.mjs';

const website = fileURLToPath(new URL('../', import.meta.url));
const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = path.join(website, cloudflare ? 'dist-cloudflare' : 'dist');
const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
const extension = cloudflare ? '' : '.html';
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes || []).map(text).join('');

for (const lang of ['en', 'zh']) {
  test(`${lang} compare page answers first, compares four tools, and links verified artifacts`, () => {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const file = `${prefix}compare.html`;
    const documentUrl = new URL(`${prefix}compare${extension}`, origin);
    const all = nodes(parse(fs.readFileSync(path.join(output, file), 'utf8')));
    const base = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), documentUrl);
    const article = all.find(node => node.tagName === 'article');
    assert.ok(article, file);
    assert.equal(nodes(article).filter(node => node.tagName === 'h1').length, 1);

    const visible = text(article);
    for (const tool of ['Mermaid', 'Excalidraw', 'PlantUML', 'D2']) assert.ok(visible.includes(tool), `${lang}: ${tool}`);
    assert.match(visible, lang === 'en' ? /short answer/i : /先说结论/);
    assert.match(visible, lang === 'en' ? /not a lossless converter|not a Mermaid parser/i : /不是无损转换/);
    assert.doesNotMatch(visible, /aggregateRating|reviewCount|ratingValue/);

    const table = nodes(article).find(node => node.tagName === 'table');
    assert.ok(table, `${lang}: semantic comparison table`);
    const rows = nodes(table).filter(node => node.tagName === 'tr');
    assert.ok(rows.length >= 9, `${lang}: header plus all comparison dimensions`);
    const header = nodes(rows[0]).filter(node => node.tagName === 'th').map(node => text(node).trim());
    assert.equal(header.length, 5, `${lang}: four tools plus the dimension column`);
    for (const tool of ['Archify', 'Mermaid', 'Excalidraw', 'PlantUML / D2']) assert.ok(header.includes(tool), `${lang}: ${tool} column`);

    const ids = new Set(all.map(node => attr(node, 'id')).filter(Boolean));
    for (const id of ['answer', 'matrix', 'boundaries', 'workflows', 'limits']) assert.ok(ids.has(id), `${lang}: stable section ${id}`);
    const toc = all.find(node => attr(node, 'class') === 'article-toc');
    for (const link of nodes(toc).filter(node => node.tagName === 'a')) {
      const destination = new URL(attr(link, 'href'), base);
      assert.equal(destination.origin + destination.pathname, documentUrl.origin + documentUrl.pathname, 'TOC fragments stay on this page');
      const id = decodeURIComponent(destination.hash.slice(1));
      const anchor = nodes(article).find(node => attr(node, 'id') === id);
      assert.ok(anchor, `${lang}: TOC target ${id}`);
      const boundary = anchor.parentNode.tagName === 'p' ? anchor.parentNode : anchor;
      const siblings = boundary.parentNode.childNodes;
      const next = siblings.slice(siblings.indexOf(boundary) + 1).find(node => node.tagName);
      assert.equal(next?.tagName, 'h2', `${id}: anchor precedes its heading`);
      assert.equal(text(next), text(link), `${id}: TOC label matches the section`);
    }

    const links = nodes(article).filter(node => node.tagName === 'a')
      .map(node => new URL(attr(node, 'href'), base));
    const required = [`agent-diagrams${extension}#mermaid-input`, `start${extension}?type=workflow&input=description`, `cases/mco-runtime${extension}`, 'cases/mco-runtime.architecture.html', 'cases/explainer/p99-tail-latency.html', 'cases/explainer/tls-first-visit.html', 'cases/explainer/first-rental.html', 'cases/life/leave-plan.workflow.html', 'cases/community/shanghai-citywalk.html'];
    for (const target of required) {
      const url = new URL(target, base);
      const suffix = url.pathname.slice(url.pathname.lastIndexOf('/') + 1) + url.search + url.hash;
      assert.ok(links.some(link => link.pathname.endsWith(suffix.split('?')[0].split('#')[0]) && link.search === url.search && link.hash === url.hash), `${lang}: missing workflow link ${target}`);
    }
    for (const url of links) {
      if (url.origin !== new URL(origin).origin) continue;
      const relative = decodeURIComponent(url.pathname).replace(new RegExp(`^/${cloudflare ? '' : 'archify/'}`), '');
      const target = path.resolve(output, relative || 'index.html');
      assert.ok(target.startsWith(`${output}${path.sep}`), `${lang}: link escapes output ${url.href}`);
      const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
      assert.ok(candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()), `${lang}: dead internal link ${url.href}`);
    }

    const schema = JSON.parse(text(all.find(node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json')));
    const structured = schema['@graph'].find(item => item['@type'] === 'TechArticle');
    assert.equal(structured.url, `https://archify.si/${prefix}compare`);
    assert.equal(structured.inLanguage, lang === 'zh' ? 'zh-Hans' : 'en');

    const switcher = all.find(node => attr(node, 'data-language-switch') !== undefined);
    const switched = new URL(attr(switcher, 'href'), base);
    assert.equal(switched.pathname, new URL(`${lang === 'zh' ? '' : 'zh/'}compare${extension}`, origin).pathname);
  });
}

test('both compare routes are in the sitemap and IndexNow inventory', () => {
  const urls = parseSitemap(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8'));
  for (const url of ['https://archify.si/compare', 'https://archify.si/zh/compare']) assert.ok(urls.includes(url));
});
