import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment } from 'parse5';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { PUBLISHED_CASES } from '../src/data/published-cases.mjs';
import { canonicalPath, canonicalUrl, sitePages } from '../src/data/site-urls.mjs';
import { publishSeo, selectedArtifacts, caseMetadata, SEO_BLOCK_START, SEO_BLOCK_END, stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-search-'));
  fs.cpSync(path.join(docs, 'gallery'), path.join(root, 'gallery'), { recursive: true });
  fs.cpSync(path.join(docs, 'cases'), path.join(root, 'cases'), { recursive: true });
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const route = canonicalPath(page, lang).slice(1);
    const file = !route || route.endsWith('/') ? `${route}index.html` : `${route}.html`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `<html><head><link rel="canonical" href="${canonicalUrl(page, lang)}"></head></html>`);
  }
  return root;
}

for (const name of ['cloudflare', 'github']) test(`${name}: published discovery metadata retains proof bytes and advertises only real canonical HTML`, () => {
  const root = fixture();
  try {
    const urls = publishSeo(root, { name });
    assert.equal(urls.length, sitePages.length * 2 + CASES.length + PUBLISHED_CASES.length);
    assert.equal(urls.length, 42, '16 localized pages, 16 gallery artifacts and 10 standalone cases');
    assert.equal(new Set(urls).size, urls.length);
    for (const page of sitePages) for (const lang of ['en', 'zh']) assert.ok(urls.includes(canonicalUrl(page, lang)));
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /lastmod|priority|changefreq|\.json|\.html|tt-a1i\.github/);
    assert.equal((sitemap.match(/<loc>/g) || []).length, urls.length);
    for (const { entry, presentation } of selectedArtifacts(root)) {
      const original = fs.readFileSync(path.join(docs, entry.artifact), 'utf8');
      const published = fs.readFileSync(path.join(root, entry.artifact), 'utf8');
      assert.equal(stripPublishedArtifactMetadata(published), original, `${entry.id}: all renderer bytes preserved`);
      const url = `https://archify.si/${entry.artifact.replace(/\.html$/, '')}`;
      assert.ok(published.includes(`rel="canonical" href="${url}"`));
      const structured = JSON.parse(published.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
      assert.equal(structured.description, presentation.descriptionEn);
      assert.equal(structured.isBasedOn, `https://archify.si/${entry.input}`);
      assert.deepEqual(fs.readFileSync(path.join(root, entry.input)), fs.readFileSync(path.join(docs, entry.input)));
    }
    for (const entry of PUBLISHED_CASES) {
      const original = fs.readFileSync(path.join(docs, entry.artifact));
      const published = fs.readFileSync(path.join(root, entry.artifact), 'utf8');
      assert.deepEqual(Buffer.from(stripPublishedArtifactMetadata(published)), original, `${entry.artifact}: exact original bytes outside the metadata block`);
      assert.deepEqual(fs.readFileSync(path.join(root, entry.input)), fs.readFileSync(path.join(docs, entry.input)), `${entry.input}: unchanged source bytes`);
      if (entry.input.endsWith('.json')) {
        const source = JSON.parse(fs.readFileSync(path.join(docs, entry.input), 'utf8'));
        assert.equal(entry.title, source.meta.title);
        assert.equal(entry.language, source.meta.locale || 'en');
      }
      assertCaseMetadata(published, entry);
      assert.ok(urls.includes(`https://archify.si/${entry.artifact.replace(/\.html$/, '')}`));
    }
    const casesOnce = PUBLISHED_CASES.map(entry => fs.readFileSync(path.join(root, entry.artifact)));
    const once = fs.readFileSync(path.join(root, `gallery/artifacts/${CASES[0].output}`), 'utf8');
    publishSeo(root, { name });
    assert.equal(fs.readFileSync(path.join(root, `gallery/artifacts/${CASES[0].output}`), 'utf8'), once, 'repeat build is idempotent');
    for (const [index, entry] of PUBLISHED_CASES.entries()) assert.deepEqual(fs.readFileSync(path.join(root, entry.artifact)), casesOnce[index], `${entry.artifact}: repeat publication is idempotent`);
    const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
    assert.equal(robots, 'User-agent: *\nAllow: /\nDisallow: /panels/\nDisallow: /answer/\nDisallow: /answer$\nDisallow: /meta/\nDisallow: /meta$\nDisallow: /sources/\n\nSitemap: https://archify.si/sitemap.xml\n');
    const disallowRules = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(match => match[1]);
    const isBlocked = urlPath => disallowRules.some(rule => (rule.endsWith('$') ? urlPath === rule.slice(0, -1) : urlPath.startsWith(rule)));
    for (const blocked of ['/panels/1/blocks/0', '/answer', '/answer/reasons/0', '/meta', '/meta/title', '/sources/rfc8446']) {
      assert.equal(isBlocked(blocked), true, `expected robots.txt to block ${blocked}`);
    }
    for (const allowed of ['/gallery/sources/agent-run.lifecycle.json', '/cases/explainer/first-rental']) {
      assert.equal(isBlocked(allowed), false, `expected robots.txt to keep ${allowed} crawlable`);
    }
    assert.equal(fs.existsSync(path.join(root, '_headers')), name === 'cloudflare');
    if (name === 'cloudflare') assert.equal(fs.readFileSync(path.join(root, '_headers'), 'utf8'), '/*.json\n  X-Robots-Tag: noindex\n/*.archify.md\n  X-Robots-Tag: noindex\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node?.attrs?.find(item => item.name === name)?.value;
const text = node => (node.childNodes || []).map(child => child.value || '').join('');

function assertCaseMetadata(html, entry) {
  const all = nodes(parse(html));
  const head = nodes(all.find(node => node.tagName === 'head'));
  const url = `https://archify.si/${entry.artifact.replace(/\.html$/, '')}`;
  const canonical = all.filter(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical');
  assert.equal(canonical.length, 1);
  assert.ok(head.includes(canonical[0]));
  assert.equal(attr(canonical[0], 'href'), url);
  assert.equal(attr(all.find(node => node.tagName === 'html'), 'lang'), entry.language);
  const original = nodes(parse(fs.readFileSync(path.join(docs, entry.artifact), 'utf8')));
  assert.equal(text(head.find(node => node.tagName === 'title')), text(original.find(node => node.tagName === 'title')), 'original document title is preserved');
  assert.equal(html.split(SEO_BLOCK_START).length, 2);
  assert.equal(html.split(SEO_BLOCK_END).length, 2);
  const start = html.indexOf(SEO_BLOCK_START), end = html.indexOf(SEO_BLOCK_END) + SEO_BLOCK_END.length;
  assert.ok(start > html.indexOf('<head>') && end < html.indexOf('</head>'));
  const block = html.slice(start, end) + '\n';
  assert.equal(block, caseMetadata(entry));
  const metadata = nodes(parseFragment(block)).filter(node => node.tagName);
  assert.deepEqual(metadata.map(node => node.tagName), entry.documentDescription ? ['link', 'meta', 'meta', 'meta', 'meta', 'meta', 'meta', 'meta', 'script'] : ['link', 'meta', 'meta', 'meta', 'meta', 'meta', 'meta', 'meta', 'meta', 'script']);
  assert.deepEqual(metadata.at(-1).attrs, [{ name: 'type', value: 'application/ld+json' }], 'the only inserted script is non-executable structured data');
  const meta = key => metadata.find(node => attr(node, 'name') === key || attr(node, 'property') === key);
  for (const key of ['og:description', 'twitter:description']) assert.equal(attr(meta(key), 'content'), entry.description);
  if (entry.documentDescription) {
    assert.equal(meta('description'), undefined, 'publication metadata must not duplicate the document description');
    const descriptions = head.filter(node => node.tagName === 'meta' && attr(node, 'name') === 'description');
    assert.equal(descriptions.length, 1, 'the artifact keeps exactly one document description');
  } else {
    assert.equal(attr(meta('description'), 'content'), entry.description);
  }
  for (const key of ['og:title', 'twitter:title']) assert.equal(attr(meta(key), 'content'), entry.title);
  assert.equal(attr(meta('og:type'), 'content'), 'article');
  assert.equal(attr(meta('og:url'), 'content'), url);
  assert.equal(attr(meta('twitter:card'), 'content'), 'summary');
  assert.deepEqual(JSON.parse(text(metadata.at(-1))), {
    '@context': 'https://schema.org', '@type': 'CreativeWork', name: entry.title, description: entry.description,
    url, isBasedOn: `https://archify.si/${entry.input}`, inLanguage: entry.language,
  });
  assert.doesNotMatch(block, /hreflang|og:image|twitter:image|archify-social-preview/, 'no invented translation or stale preview image');
}

test('case discovery copy keeps the source-backed and illustrative boundaries explicit', () => {
  const byPath = file => PUBLISHED_CASES.find(entry => entry.artifact === file);
  assert.match(byPath('cases/life/leave-plan.workflow.html').description, /示例计划.*不代表真实日历或公司的休假政策/);
  assert.match(byPath('cases/life/renting.sequence.html').description, /金额和流程仅为示例/);
  assert.match(byPath('cases/life/monthly-money.dataflow.html').description, /Amounts are illustrative/);
  const mco = byPath('cases/mco-runtime.architecture.html');
  const source = JSON.parse(fs.readFileSync(path.join(docs, mco.input), 'utf8'));
  assert.ok(mco.description.includes(source.meta.repository.revision.slice(0, 7)));
  assert.match(mco.description, /authored source-backed diagram, not an execution trace/);
});

test('case metadata escapes HTML and JSON while retaining literal replacement tokens', () => {
  const root = fixture();
  const entry = PUBLISHED_CASES[0];
  const original = { title: entry.title, description: entry.description };
  try {
    entry.title = 'Price $& with $` and $\' and $$ <offer> "quoted"';
    entry.description = 'Text </script><script>alert("not executable")</script> & <meta name="extra">';
    publishSeo(root, { name: 'github' });
    assertCaseMetadata(fs.readFileSync(path.join(root, entry.artifact), 'utf8'), entry);
  } finally {
    Object.assign(entry, original);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication rejects every missing selected case HTML or JSON before writing metadata', () => {
  const root = fixture();
  try {
    const gallery = path.join(root, `gallery/artifacts/${CASES[0].output}`);
    const original = fs.readFileSync(gallery);
    for (const entry of PUBLISHED_CASES) for (const file of [entry.artifact, entry.input]) {
      fs.rmSync(path.join(root, file));
      assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Missing published case/);
      assert.deepEqual(fs.readFileSync(gallery), original, 'missing inventory must not partially publish gallery metadata');
      fs.copyFileSync(path.join(docs, file), path.join(root, file));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publication fails closed for missing localized pages or changed proof artifacts/sources', () => {
  const root = fixture();
  try {
    fs.rmSync(path.join(root, 'zh/guide.html'));
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Missing indexable page/);
    fs.writeFileSync(path.join(root, 'zh/guide.html'), '<html></html>');
    const first = CASES[0];
    fs.appendFileSync(path.join(root, `gallery/artifacts/${first.output}`), 'changed');
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Artifact proof hash mismatch/);
    fs.copyFileSync(path.join(docs, `gallery/artifacts/${first.output}`), path.join(root, `gallery/artifacts/${first.output}`));
    fs.appendFileSync(path.join(root, `gallery/sources/${first.input}`), 'changed');
    assert.throws(() => publishSeo(root, { name: 'cloudflare' }), /Source proof hash mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
