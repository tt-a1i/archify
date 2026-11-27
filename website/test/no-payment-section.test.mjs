import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'parse5';
import { siteTarget } from '../scripts/site-target.mjs';

// The website no longer carries a payment section. Guard against a page that
// still links to the removed #support anchor or embeds the payment QR codes;
// the README keeps its own support section.
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const pages = ['index', 'gallery', 'guide', 'start', 'community'];
const output = new URL(`${siteTarget().outDir}/`, new URL('../', import.meta.url));

function readPage(lang, page) {
  const file = page === 'index' ? (lang === 'zh' ? 'zh.html' : 'index.html') : `${lang === 'zh' ? 'zh/' : ''}${page}.html`;
  return { file, dom: parse(fs.readFileSync(new URL(file, output), 'utf8')) };
}

test('built pages have no payment section, QR codes or links to it', () => {
  for (const lang of ['en', 'zh']) {
    for (const page of pages) {
      const { file, dom } = readPage(lang, page);
      const all = nodes(dom);
      assert.equal(all.some(node => attr(node, 'id') === 'support'), false, `${file}: #support section is back`);
      const supportLinks = all.filter(node => node.tagName === 'a' && /#support$/.test(attr(node, 'href') || ''));
      assert.deepEqual(supportLinks.map(node => attr(node, 'href')), [], `${file}: links to the removed #support section`);
      const qr = all.filter(node => node.tagName === 'img' && /assets\/support\//.test(attr(node, 'src') || ''));
      assert.deepEqual(qr.map(node => attr(node, 'src')), [], `${file}: embeds a payment QR code`);
    }
  }
});
