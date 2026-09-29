import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'parse5';
import { assembleViewer } from '../../scripts/generate-viewer.mjs';
import { applyTemplate } from '../renderers/shared/utils.mjs';
import { viewerCatalog } from '../renderers/shared/i18n.mjs';
import { viewerContractSource } from './helpers/viewer-contract-source.mjs';
import { assertOfflineArtifact } from './helpers/offline-fonts.mjs';

const source = assembleViewer({ compact: false });
const compact = assembleViewer();
const bytes = value => Buffer.byteLength(value);
const scripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

// Ignore only owned code/style text. All author-facing DOM, text, accessibility,
// JSON, geometry and element order must survive compilation unchanged.
function structure(html) {
  function visit(node) {
    const value = { name: node.nodeName };
    if (node.attrs) value.attrs = node.attrs;
    if (node.nodeName === '#text') value.text = node.value;
    if (node.childNodes && !['style', 'script'].includes(node.tagName)) {
      value.children = node.childNodes.map(visit);
    } else if (node.tagName === 'script' && node.attrs.some(a => a.name === 'type')) {
      value.children = node.childNodes.map(visit);
    }
    return value;
  }
  return visit(parse(html));
}

test('delivered Viewer saves at least 120 KiB with a bounded standalone template', () => {
  assert.ok(bytes(source) - bytes(compact) >= 120 * 1024);
  assert.ok(bytes(compact) <= 700000, `Template budget: ${bytes(compact)} B`);
  assert.equal(scripts(compact).length, scripts(source).length);
  for (const script of scripts(compact)) new vm.Script(script);
  assertOfflineArtifact(compact, 'compact template');
  assert.equal(viewerContractSource(compact), source);
  assert.throws(() => viewerContractSource(compact.replace('Archify.semanticLens', 'Archify.brokenLens')), /Missing\/stale/);
});

for (const locale of ['en', 'zh-CN', 'es']) test(`compilation preserves authored DOM, data and custom-template locale contract: ${locale}`, () => {
  const data = {
    locale, title: 'A Ā Ѡ Ж Ω ắ 中文 $& <unsafe>', subtitle: 'Caption & details',
    svg: '<svg viewBox="0 0 20 20"><text>Full author text</text></svg>',
    cards: '<div class="cards">Authored note</div>',
    guidedViews: [{ id: 'first', label: 'Example', focus: ['first'] }],
    sourceEvidence: { verified: true, nodes: { first: { text: '</script><script>unsafe()</script>' } } },
  };
  const before = applyTemplate(source, data);
  const after = applyTemplate(compact, data);
  assert.deepEqual(structure(after), structure(before));
  assert.ok(bytes(before) - bytes(after) >= 120 * 1024);
  assert.doesNotMatch(after, /<script>unsafe\(\)/);
  const payload = JSON.parse(after.match(/id="archify-i18n-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  // Custom templates may construct a normally static key at runtime. Keep this
  // compatibility path instead of treating unobserved literal keys as dead.
  const key = ['view', 'er.', 'export.', 'menu'].join('');
  assert.equal(payload.messages[key], viewerCatalog(locale)[key]);
});
