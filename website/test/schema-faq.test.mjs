import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';
import { pageMetadata } from '../src/data/site-metadata.mjs';
import { faqFacts } from '../src/data/faq-facts.mjs';
import { sitePages } from '../src/data/site-urls.mjs';

const nodeOf = (schema, type) => schema['@graph'].find(node => node['@type'] === type);
function textWithoutScripts(node) {
  if (!node || node.tagName === 'script' || node.tagName === 'style' || node.nodeName === '#comment') return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textWithoutScripts).join(' ');
}

test('every page graph binds the software entity, public source, and license without rating claims', () => {
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const { schema } = pageMetadata(page, lang, '1.2.3');
    const serialized = JSON.stringify(schema);
    assert.deepEqual(JSON.parse(serialized), schema, `${page}/${lang}: JSON-LD must round-trip`);
    const app = nodeOf(schema, 'SoftwareApplication');
    assert.equal(app['@id'], 'https://archify.si/#software');
    assert.equal(app.url, 'https://archify.si/');
    assert.equal(app.applicationCategory, 'DeveloperApplication');
    assert.equal(app.operatingSystem, 'macOS, Linux, Windows');
    assert.equal(app.isAccessibleForFree, true);
    assert.deepEqual(app.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    assert.equal(app.license, 'https://www.apache.org/licenses/LICENSE-2.0');
    assert.equal(app.softwareVersion, '1.2.3');
    assert.deepEqual(app.sameAs, ['https://github.com/tt-a1i/archify', 'https://skills.sh/tt-a1i/archify/archify']);
    assert.deepEqual(app.subjectOf.map(item => [item['@type'], item.url]), [
      ['NewsArticle', 'https://www.qbitai.com/2026/09/482469.html'],
      ['NewsArticle', 'https://www.qbitai.com/2026/09/488519.html'],
    ]);
    const source = nodeOf(schema, 'SoftwareSourceCode');
    assert.equal(source.targetProduct['@id'], app['@id']);
    const article = nodeOf(schema, 'TechArticle');
    assert.equal(Boolean(article), ['agent-diagrams', 'compare', 'cases/mco-runtime'].includes(page), `${page}: TechArticle scope`);
    if (article) assert.equal(article.about['@id'], app['@id']);
    assert.equal(Boolean(nodeOf(schema, 'FAQPage')), page === 'index', `${page}/${lang}: FAQPage scope`);
    assert.doesNotMatch(serialized, /aggregateRating|ratingValue|reviewCount|interactionStatistic/);
  }
});

test('homepages expose the visible FAQ answers as FAQPage entries from one shared source', () => {
  assert.equal(faqFacts.length, 7);
  for (const lang of ['en', 'zh']) {
    const schema = pageMetadata('index', lang, '1.2.3').schema;
    const faq = nodeOf(schema, 'FAQPage');
    assert.equal(faq.mainEntity.length, faqFacts.length);
    const index = lang === 'zh' ? 1 : 0;
    faq.mainEntity.forEach((entry, position) => {
      assert.equal(entry['@type'], 'Question');
      assert.equal(entry.name, faqFacts[position].question[index]);
      assert.equal(entry.acceptedAnswer['@type'], 'Answer');
      assert.equal(entry.acceptedAnswer.text, faqFacts[position].answer[index]);
    });
  }
});

const output = new URL(process.env.ARCHIFY_SITE_TARGET === 'cloudflare' ? '../dist-cloudflare/' : '../dist/', import.meta.url);
function readGraphs(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1])).filter(data => data['@graph']);
}

test('built graphs describe software features and the localized Home-to-page navigation', () => {
  const labels = {
    'cases/mco-runtime': ['MCO Case', 'MCO 案例'],
    'agent-diagrams': ['Agent Diagrams', 'Agent 画图'],
    compare: ['Compare', '工具对比'],
    gallery: ['Proof Lab', '验证作品集'],
    guide: ['Guide', '场景指南'],
    start: ['Get started', '开始使用'],
    community: ['Community', '社区包'],
  };
  for (const page of sitePages) for (const [lang, home, name, index] of [
    ['en', 'https://archify.si/', 'Home', 0],
    ['zh', 'https://archify.si/zh', '首页', 1],
  ]) {
    const file = lang === 'zh' ? page === 'index' ? 'zh.html' : `zh/${page}.html` : `${page}.html`;
    const [schema] = readGraphs(fs.readFileSync(new URL(file, output), 'utf8'));
    const features = nodeOf(schema, 'SoftwareApplication').featureList;
    assert.ok(Array.isArray(features) && features.every(feature => typeof feature === 'string' && feature.trim()), file);
    const expectedFeatures = lang === 'zh'
      ? [/10 种.*原生.*图型/, /四种.*一页式解答/, /架构诊断/, /1080p Story/, /GitHub PR.*GitLab MR/]
      : [/10 native diagram types/, /one-page explainers.*four/i, /Architecture Diagnosis/, /1080p Story/, /PR walkthroughs.*GitHub.*GitLab/];
    for (const capability of expectedFeatures) {
      assert.ok(features.some(feature => capability.test(feature)), `${file}: missing feature ${capability}`);
    }
    const breadcrumbs = nodeOf(schema, 'BreadcrumbList');
    if (page === 'index') {
      assert.equal(breadcrumbs, undefined, file);
      continue;
    }
    assert.deepEqual(breadcrumbs?.itemListElement, [
      { '@type': 'ListItem', position: 1, name, item: home },
      { '@type': 'ListItem', position: 2, name: labels[page][index], item: `${home.replace(/\/$/, '')}/${page}` },
    ], file);
    assert.equal(nodeOf(schema, 'FAQPage'), undefined, file);
  }
});

test('built homepages carry the same FAQ text in visible markup and default-open facts', () => {
  for (const [lang, file] of [['en', 'index.html'], ['zh', 'zh.html']]) {
    const html = fs.readFileSync(new URL(file, output), 'utf8');
    const graphs = readGraphs(html);
    assert.equal(graphs.length, 1, `${file}: one primary graph`);
    const faq = graphs[0]['@graph'].find(node => node['@type'] === 'FAQPage');
    assert.ok(faq, `${file}: FAQPage`);
    const index = lang === 'zh' ? 1 : 0;
    const visibleText = textWithoutScripts(parse(html)).replace(/\s+/g, ' ');
    faq.mainEntity.forEach((entry, position) => {
      assert.equal(entry.name, faqFacts[position].question[index]);
      assert.equal(entry.acceptedAnswer.text, faqFacts[position].answer[index]);
      assert.ok(visibleText.includes(entry.name), `${file}: visible question ${position}`);
      assert.ok(visibleText.includes(entry.acceptedAnswer.text), `${file}: visible answer ${position}`);
    });
    assert.match(html, /<details class="facts-drawer" open(?:="")?[\s>]/, `${file}: answers must be readable without a click`);
  }
});
