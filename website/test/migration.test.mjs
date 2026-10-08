import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment } from 'parse5';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { artifactMetadata, SEO_BLOCK_START, SEO_BLOCK_END, stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = path.resolve(root, '../docs');
const dist = path.join(root, 'dist');
const pages = ['index.html', 'gallery.html', 'guide.html', 'start.html'];
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

function elements(node, tag) {
  return [ ...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap(child => elements(child, tag)) ];
}
function attr(node, name) {
  return node?.attrs?.find(attribute => attribute.name === name)?.value;
}
function byId(node, id) {
  if (!node) return undefined;
  return [node, ...(node.childNodes || []).flatMap(child => byId(child, id)).filter(Boolean)]
    .find(candidate => attr(candidate, 'id') === id);
}

function semantic(node) {
  if (node.nodeName === '#comment') return null;
  if (node.nodeName === '#text') {
    const text = node.value.replace(/\s+/g, ' ').trim();
    return text || null;
  }
  const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
  if (node.tagName === 'script' && attrs.type === 'application/json') {
    return { tag: 'script', attrs, data: JSON.parse(node.childNodes.map(n => n.value || '').join('')) };
  }
  return { tag: node.tagName || node.nodeName, attrs, children: (node.childNodes || []).map(semantic).filter(Boolean) };
}

for (const page of pages) {
  test(`${page}: DOM, content, accessibility, scripts and styles match the migration baseline`, () => {
    const old = parse(read(docs, page)), next = parse(read(dist, page));
    if (page === 'index.html') {
      // Intentional homepage visual redesign (branch web-redesign, October 2026):
      // index.html no longer tracks the docs/ legacy baseline, so the DOM/CSS
      // parity comparisons are skipped for this page only. Every structural
      // assertion below (proof stage/frame/open, shortcut box, proof-config
      // hashes, forbidden strings) is kept in full.
      const current = read(dist, page);
      const body = elements(next, 'body')[0];
      const stage = byId(body, 'hero-proof-stage');
      const frame = byId(body, 'hero-proof-frame');
      const open = byId(body, 'proof-open');
      const shortcuts = elements(body, 'div').filter(node => (attr(node, 'class') || '').split(/\s+/).includes('shortcut-box'));
      assert.ok(stage, 'homepage proof stage must remain present');
      assert.ok(frame, 'homepage proof iframe must remain present');
      assert.ok(open, 'homepage proof link must remain present');
      assert.equal(shortcuts.length, 1, 'homepage shortcut card must remain present');
      const base = elements(next, 'base');
      assert.equal(base.length, 1);
      assert.equal(attr(base[0], 'href'), './');
      const baseUri = new URL(attr(base[0], 'href'), 'https://tt-a1i.github.io/archify/index.html');
      assert.equal(new URL(attr(frame, 'src'), baseUri).href, 'https://tt-a1i.github.io/archify/gallery/artifacts/agent-tool-call.workflow.html?embed=1&theme=dark#focus=planner&reach=downstream');
      assert.equal(new URL(attr(open, 'href'), baseUri).href, 'https://tt-a1i.github.io/archify/gallery/artifacts/agent-tool-call.workflow.html?present=1#focus=planner&reach=downstream');
      const proofScript = elements(next, 'script').find(script => (script.childNodes || []).some(child => (child.value || '').includes("hash: '#lens=backend~database'")));
      assert.ok(proofScript, 'homepage proof configuration must remain present');
      const scriptText = proofScript.childNodes.map(child => child.value || '').join('');
      assert.match(scriptText, /hash: '#lens=backend~database'/);
      assert.match(scriptText, /hash: '#route=web~db'/);
      assert.match(scriptText, /embedHash: '#focus=web&reach=downstream'/);
      assert.match(scriptText, /proof\.embedHash \|\| proof\.hash/);
      assert.doesNotMatch(current, /play=1|#view=|Guided views|Play story/);
    } else {
      // The site-wide redesign restyles every inner page and the shared
      // navigation, so DOM/CSS parity with docs/ no longer applies. Page
      // scripts and deep links still address the legacy ids, so every id in
      // the baseline body must survive.
      const ids = node => [attr(node, 'id'), ...(node.childNodes || []).flatMap(ids)].filter(Boolean);
      const nextIds = new Set(ids(elements(next, 'body')[0]));
      for (const id of ids(elements(old, 'body')[0])) assert.ok(nextIds.has(id), `${page}: #${id} must remain`);
    }
    assert.ok(!read(dist, page).includes('[[ARCHIFY_VERSION]]'));
  });
}

test('homepage version labels and translations match the release identity baseline', () => {
  const baseline = parse(read(docs, 'index.html'));
  const generated = parse(read(dist, 'index.html'));
  // The redesigned eyebrow separates the version chip from its channel label.
  const version = JSON.parse(read(path.resolve(root, '../archify'), 'package.json')).version;
  const spans = elements(generated, 'span');
  const badge = spans.find(node => attr(node, 'data-i18n') === 'hero-badge');
  assert.equal(semantic(badge).children.join(' '), "Development Agent Skill · see what's new");
  const versionChip = spans.find(node => (attr(node, 'class') || '').split(/\s+/).includes('eyebrow-tag'));
  assert.equal(semantic(versionChip).children.join(' '), `v${version}`);
  const copyNode = byId(generated, 'site-copy');
  assert.ok(copyNode, 'built page must carry its shared translation dictionary');
  const copy = JSON.parse(copyNode.childNodes.map(child => child.value || '').join(''));
  assert.equal(copy.en['hero-badge'], "Development Agent Skill · see what's new");
  assert.equal(copy.zh['hero-badge'], '开发版 Agent 技能 · 查看更新');
  for (const key of ['footer-meta']) {
    const labels = (tree) => [...elements(tree, 'span'), ...elements(tree, 'p')]
      .filter(node => attr(node, 'data-i18n') === key).map(semantic);
    assert.equal(labels(baseline).length, 1);
    assert.deepEqual(labels(generated), labels(baseline), `${key}: initial identity`);
    const translations = (tree) => elements(tree, 'script').flatMap(node => {
      const source = (node.childNodes || []).map(child => child.value || '').join('');
      return [...source.matchAll(new RegExp(`['"]${key}['"]\\s*:\\s*(['"])(.*?)\\1`, 'g'))]
        .map(match => match[2]);
    });
    assert.equal(translations(baseline).length, 2, 'both built-in languages must be covered');
    assert.deepEqual([copy.en[key], copy.zh[key]], translations(baseline), `${key}: translated identity`);
  }
});

test('all existing non-page public URLs retain exact bytes outside the declared artifact metadata block', () => {
  const manifest = JSON.parse(read(docs, 'gallery/manifest.json'));
  const selected = new Map(CASES.map(presentation => {
    const entry = manifest.entries.find(item => item.id === presentation.id);
    assert.ok(entry, presentation.id);
    return [entry.artifact, { entry, presentation }];
  }));
  function publishedBytes(file) {
    const bytes = fs.readFileSync(path.join(dist, file));
    const proof = selected.get(file.replaceAll(path.sep, '/'));
    if (!proof) return bytes;
    const html = bytes.toString('utf8');
    assert.equal(html.split(SEO_BLOCK_START).length, 2, `${file}: one metadata start marker`);
    assert.equal(html.split(SEO_BLOCK_END).length, 2, `${file}: one metadata end marker`);
    const start = html.indexOf(SEO_BLOCK_START), end = html.indexOf(SEO_BLOCK_END) + SEO_BLOCK_END.length;
    assert.ok(start > html.indexOf('<head>') && end < html.indexOf('</head>'), `${file}: metadata belongs only in head`);
    const block = html.slice(start, end) + '\n';
    assert.equal(block, artifactMetadata(proof.entry, proof.presentation), `${file}: exact publication metadata`);
    const metadataNodes = (parseFragment(block).childNodes || []).filter(node => node.tagName);
    assert.deepEqual(metadataNodes.map(node => node.tagName), ['link', 'meta', 'meta', 'meta', 'meta', 'meta', 'script']);
    const structured = metadataNodes.at(-1);
    assert.equal(attr(structured, 'type'), 'application/ld+json', `${file}: no executable script permitted`);
    assert.equal(structured.attrs.length, 1);
    const data = JSON.parse(structured.childNodes.map(node => node.value || '').join(''));
    assert.equal(data['@type'], 'CreativeWork');
    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data.isBasedOn, `https://archify.si/${proof.entry.input}`);
    return Buffer.from(stripPublishedArtifactMetadata(html), 'utf8');
  }
  function visit(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(rel, entry.name);
      if (entry.isDirectory()) visit(path.join(dir, entry.name), file);
      else if (!pages.includes(file)) assert.deepEqual(publishedBytes(file), fs.readFileSync(path.join(docs, file)), file);
    }
  }
  visit(docs);
});

test('every generated Astro asset referenced by a page exists under the Pages base', () => {
  for (const page of [...pages, 'community.html', 'zh.html', ...['gallery', 'guide', 'start', 'community'].map(page => `zh/${page}.html`)]) {
    for (const match of read(dist, page).matchAll(/(?:href|src)="(\/archify\/[^"?#]+)"/g)) {
      const relative = match[1].slice('/archify/'.length) || 'index.html';
      assert.ok(fs.statSync(path.join(dist, relative)).isFile(), match[1]);
    }
  }
});
