import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'parse5';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
const examples = {
  architecture: 'web-app', workflow: 'agent-tool-call', sequence: 'cache-miss-request',
  dataflow: 'product-analytics', lifecycle: 'agent-run', erd: 'orders',
  class: 'payments', tree: 'payment-platform', timeline: 'payment-incident', waterfall: 'checkout-request',
};
const example = type => JSON.parse(fs.readFileSync(path.join(root, 'examples', `${examples[type]}.${type}.json`)));
const descendants = node => [node, ...(node.childNodes || []).flatMap(descendants)];
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const text = node => descendants(node).filter(n => n.nodeName === '#text').map(n => n.value).join('');
function render(dir, type, doc) {
  const input = path.join(dir, `${type}.json`);
  const output = path.join(dir, `${type}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', type, input, output],
    { env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' }, stdio: 'pipe' });
  return fs.readFileSync(output, 'utf8');
}

test('native descriptions accept plain text up to 2,000 Unicode code points', () => {
  for (const type of Object.keys(examples)) {
    const doc = example(type);
    assert.doesNotThrow(() => validateSchema(type, doc));
    for (const description of ['', ' \n\t\r ', '界'.repeat(2000), '😀'.repeat(2000), '\uD7FF\uE000\uFFFD\u{10000}\u{10FFFF}']) {
      doc.meta.description = description;
      assert.doesNotThrow(() => validateSchema(type, doc), type);
    }
    for (const description of [null, 1, true, [], {}, '界'.repeat(2001), '😀'.repeat(2001)]) {
      doc.meta.description = description;
      assert.throws(() => validateSchema(type, doc), /description/, type);
    }
    delete doc.meta.description;
    doc.meta.translations = { [`diagram.description.${type}`]: 'a'.repeat(401) };
    assert.throws(() => validateSchema(type, doc), /400/, 'translation limit stays unchanged');
  }
});

test('native descriptions reject XML-forbidden characters before rendering', t => {
  const forbidden = [
    ...Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13].includes(code)),
    0xD800, 0xDFFF, 0xFFFE, 0xFFFF,
  ];
  for (const type of Object.keys(examples)) {
    const doc = example(type);
    for (const code of forbidden) {
      doc.meta.description = `A${String.fromCodePoint(code)}B`;
      assert.throws(() => validateSchema(type, doc), /description/, `${type}: U+${code.toString(16)}`);
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-description-xml-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const doc = example('architecture');
  doc.meta.description = 'A\u0001B';
  assert.throws(() => render(dir, 'architecture', doc), error => {
    assert.match(error.stderr.toString(), /meta\/description/);
    return true;
  });
  assert.equal(fs.existsSync(path.join(dir, 'architecture.html')), false);
});

test('public native renderers preserve descriptions as text without changing visible headers', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-description-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const description = '  中文 A&B <cache> "quoted"\n</desc><script>alert(1)</script> 😀  ';
  for (const type of Object.keys(examples)) {
    const doc = example(type);
    doc.meta.subtitle = 'A short visible subtitle';
    const before = descendants(parse(render(dir, type, doc)));
    doc.meta.description = description;
    const after = descendants(parse(render(dir, type, doc)));
    const svg = after.find(n => n.tagName === 'svg' && attr(n, 'role') === 'img');
    const desc = descendants(svg).find(n => n.tagName === 'desc');
    const title = descendants(svg).find(n => n.tagName === 'title');
    assert.equal(text(desc), description, type);
    assert.equal(attr(svg, 'aria-labelledby'), attr(title, 'id'));
    assert.equal(attr(svg, 'aria-describedby'), attr(desc, 'id'));
    assert.equal(descendants(svg).filter(n => n.tagName === 'script').length, 0);
    const header = elements => elements.find(n => attr(n, 'class') === 'header');
    assert.equal(text(header(after)), text(header(before)), type);
  }
});

test('absent and blank descriptions preserve subtitle and localized fallback output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-description-fallback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const subtitle of [undefined, 'Short subtitle', '  ']) {
    const doc = example('architecture');
    doc.meta.locale = 'zh-CN';
    doc.meta.subtitle = subtitle;
    doc.meta.translations = { 'diagram.description.architecture': '作者提供的翻译覆盖' };
    const absent = render(dir, 'architecture', doc);
    assert.match(absent, /aria-labelledby="archify-diagram-title archify-diagram-description"/);
    for (const blank of ['', ' \n\t ']) {
      doc.meta.description = blank;
      assert.equal(render(dir, 'architecture', doc), absent);
    }
    doc.meta.description = 'Independent description';
    const nodes = descendants(parse(render(dir, 'architecture', doc)));
    assert.equal(text(nodes.find(n => n.tagName === 'desc')), doc.meta.description);
    assert.ok(!text(nodes.find(n => attr(n, 'class') === 'header')).includes(doc.meta.description));
  }
});
