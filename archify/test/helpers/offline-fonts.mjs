import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parse } from 'parse5';

const FONT_LICENSE = fs.readFileSync(new URL('../../assets/JetBrainsMono-OFL.txt', import.meta.url), 'utf8').trim();

// Pinned Google Fonts v24 bytes and coverage, independent of CSS formatting.
const EXPECTED_FACES = [
  ['9343de2ca5d9549f792e7962375af8efb0f320c7643bfd36c884b5a30e5c396f', 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
  ['4995a9a43ac659ec32fcd8b463755cd6a07b31a6e6b3894a6a153b661cf490e2', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['49c3da6c9a2b279b0f1f860f5cfb1f5dc38d88a5c7be9c9b1837bbc4e3db6111', 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF'],
  ['d44eb1936043a56038eb02dd70b243f379bef65783f94ec12f277550720411f1', 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB'],
  ['9c38cb2d0d2d93c1ee6e21fa78db76f13ea7e15e15cc64214c7ca89b6aaa35c4', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  ['2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
].sort(([a], [b]) => a.localeCompare(b));

export function assertFontCss(css, subject) {
  assert.ok(css.includes(FONT_LICENSE), `${subject}: missing standalone font license`);
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const faces = [...clean.matchAll(/@font-face\s*\{([^}]+)\}/gi)].map(([, block]) => {
    const descriptor = (name) => block.match(new RegExp(`\\b${name}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim();
    assert.equal(descriptor('font-family')?.replace(/["']/g, ''), 'JetBrains Mono', subject);
    assert.equal(descriptor('font-style'), 'normal', subject);
    assert.equal(descriptor('font-weight')?.replace(/\s+/g, ' '), '400 800', subject);
    assert.doesNotMatch(block, /\blocal\s*\(/i, `${subject}: installed fonts must not override embedded bytes`);
    const encoded = block.match(/\bsrc\s*:\s*url\(\s*["']?data:font\/woff2;base64,([A-Za-z0-9+/=]+)["']?\s*\)/i)?.[1];
    assert.ok(encoded, `${subject}: missing embedded WOFF2 source`);
    const bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.toString('latin1', 0, 4), 'wOF2', subject);
    return [createHash('sha256').update(bytes).digest('hex'), descriptor('unicode-range')?.replace(/\s+/g, '').toUpperCase()];
  }).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(faces, EXPECTED_FACES, `${subject}: font bytes or character coverage changed`);
}

// Parse HTML instead of scanning script/comment strings. parse5 also decodes
// srcdoc exactly once, so each nested viewer must satisfy the contract itself.
export function inspectDocuments(html, subject = 'artifact') {
  const document = { subject, styles: [], scripts: [], resources: [], children: [] };
  const remote = (value) => /^(?:https?:)?\/\//i.test(value || '');
  function cssResources(css) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of clean.matchAll(/(?:url\(\s*|@import\s+)["']?((?:https?:)?\/\/[^"')\s;]+)/gi)) document.resources.push(match[1]);
  }
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
    const text = (node.childNodes || []).filter((child) => child.nodeName === '#text').map((child) => child.value).join('');
    if (node.tagName === 'style') { document.styles.push(text); cssResources(text); }
    if (node.tagName === 'script') document.scripts.push(text);
    if (attrs.style) cssResources(attrs.style);
    for (const name of ['src', 'poster', 'data']) if (remote(attrs[name])) document.resources.push(attrs[name]);
    if (attrs.srcset) for (const match of attrs.srcset.matchAll(/(?:^|[\s,])((?:https?:)?\/\/[^\s,]+)/g)) document.resources.push(match[1]);
    if (['image', 'use', 'feImage'].includes(node.tagName) || (node.tagName === 'link' && /\b(stylesheet|preconnect|dns-prefetch|preload|modulepreload|prefetch|icon)\b/.test(attrs.rel || ''))) {
      if (remote(attrs.href)) document.resources.push(attrs.href);
    }
    if (node.tagName === 'iframe' && attrs.srcdoc != null) document.children.push(...inspectDocuments(attrs.srcdoc, `${subject}/srcdoc[${document.children.length}]`));
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  return [document, ...document.children];
}

export function assertOfflineArtifact(html, subject) {
  const documents = inspectDocuments(html, subject);
  let viewers = 0;
  for (const document of documents) {
    assert.deepEqual(document.resources, [], `${document.subject}: external subresource`);
    const viewer = document.scripts.some((script) => /Archify\.readerLayout/.test(script));
    if (viewer) {
      assertFontCss(document.styles.join('\n'), document.subject);
      viewers += 1;
    }
  }
  assert.ok(viewers > 0, `${subject}: expected a viewer document`);
  return viewers;
}
