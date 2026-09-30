import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

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
      assert.equal(attr(frame, 'src'), 'gallery/artifacts/agent-tool-call.workflow.html?embed=1&theme=dark#focus=planner&reach=downstream');
      assert.equal(attr(open, 'href'), 'gallery/artifacts/agent-tool-call.workflow.html?present=1#focus=planner&reach=downstream');
      const proofScript = elements(next, 'script').find(script => (script.childNodes || []).some(child => (child.value || '').includes("hash: '#lens=backend~database'")));
      assert.ok(proofScript, 'homepage proof configuration must remain present');
      const scriptText = proofScript.childNodes.map(child => child.value || '').join('');
      assert.match(scriptText, /hash: '#lens=backend~database'/);
      assert.match(scriptText, /hash: '#route=web~db'/);
      assert.match(scriptText, /embedHash: '#focus=web&reach=downstream'/);
      assert.match(scriptText, /proof\.embedHash \|\| proof\.hash/);
      assert.doesNotMatch(current, /play=1|#view=|Guided views|Play story/);
    } else {
      assert.deepEqual(semantic(elements(next, 'body')[0]), semantic(elements(old, 'body')[0]));
    }
    assert.deepEqual(elements(next, 'style').map(n => n.childNodes[0]?.value.trim()).filter(css => !css.startsWith('/*! tailwindcss')), elements(old, 'style').map(n => n.childNodes[0]?.value.trim()));
    assert.ok(!read(dist, page).includes('[[ARCHIFY_VERSION]]'));
  });
}

test('homepage version labels and translations match the release identity baseline', () => {
  const baseline = parse(read(docs, 'index.html'));
  const generated = parse(read(dist, 'index.html'));
  for (const key of ['hero-badge', 'footer-meta']) {
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
    assert.deepEqual(translations(generated), translations(baseline), `${key}: translated identity`);
  }
});

test('all existing non-page public URLs retain exact file bytes', () => {
  function visit(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(rel, entry.name);
      if (entry.isDirectory()) visit(path.join(dir, entry.name), file);
      else if (!pages.includes(file)) assert.deepEqual(fs.readFileSync(path.join(dist, file)), fs.readFileSync(path.join(docs, file)), file);
    }
  }
  visit(docs);
});

test('every generated Astro asset referenced by a page exists under the Pages base', () => {
  for (const page of pages) {
    for (const match of read(dist, page).matchAll(/(?:href|src)="(\/archify\/[^"?#]+)"/g)) {
      assert.ok(fs.existsSync(path.join(dist, match[1].slice('/archify/'.length))), match[1]);
    }
  }
});
