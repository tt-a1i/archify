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
    assert.deepEqual(semantic(elements(next, 'body')[0]), semantic(elements(old, 'body')[0]));
    const styles = (doc) => elements(doc, 'style').map(n => n.childNodes[0]?.value.trim()).filter(css => !css.startsWith('/*! tailwindcss'));
    assert.deepEqual(styles(next), styles(old));
    assert.ok(!read(dist, page).includes('[[ARCHIFY_VERSION]]'));
  });
}

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
