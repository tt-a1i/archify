import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmes = [
  { file: 'README.md', contributing: '## Contributing', contributors: '## Contributors' },
  { file: 'README_EN.md', contributing: '## Contributing', contributors: '## Contributors' },
  { file: 'README_ZH.md', contributing: '## 参与贡献', contributors: '## 贡献者' },
  { file: 'README_JA.md', contributing: '## コントリビュート', contributors: '## コントリビューター' },
  { file: 'README_KO.md', contributing: '## 기여하기', contributors: '## 기여자' },
];

test('every README language places the maintainer support QR codes after contributing', () => {
  for (const { file, contributing, contributors } of readmes) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const contributeAt = text.indexOf(`\n${contributing}\n`);
    const supportWechat = text.indexOf('docs/assets/support/wechat-pay.png');
    const supportAlipay = text.indexOf('docs/assets/support/alipay.png');
    const contributorsAt = text.indexOf(`\n${contributors}\n`);
    assert.ok(contributeAt >= 0, `${file}: missing contributing section`);
    assert.ok(contributorsAt > contributeAt, `${file}: contributors should follow contributing`);
    assert.ok(supportWechat > contributeAt && supportWechat < contributorsAt, `${file}: WeChat Pay QR must sit between contributing and contributors`);
    assert.ok(supportAlipay > supportWechat && supportAlipay < contributorsAt, `${file}: Alipay QR must follow the WeChat Pay QR`);
    assert.equal((text.match(/docs\/assets\/support\/wechat-pay\.png/g) || []).length, 1, `${file}: WeChat Pay QR should appear once`);
    assert.equal((text.match(/docs\/assets\/support\/alipay\.png/g) || []).length, 1, `${file}: Alipay QR should appear once`);
  }
});

const supportBadges = [
  { file: 'README.md', heading: 'Support Archify' },
  { file: 'README_EN.md', heading: 'Support Archify' },
  { file: 'README_ZH.md', heading: '支持 Archify' },
  { file: 'README_JA.md', heading: 'Archify を支援する' },
  { file: 'README_KO.md', heading: 'Archify 지원하기' },
];

function checkSupportLink(text, heading, file) {
  const firstHeading = text.search(/^##\s/m);
  assert.ok(firstHeading > 0, `${file}: missing first heading`);
  const headingLine = `## ${heading}`;
  assert.ok(text.split(/\r?\n/).includes(headingLine), `${file}: missing support heading ${headingLine}`);
  // These headings contain only letters and spaces, so GitHub's heading ID is
  // their lowercase text with spaces replaced by hyphens.
  const target = `#${heading.toLowerCase().replace(/ /g, '-')}`;
  const links = [];
  const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
  function visit(node, anchor) {
    const parentLink = node.tagName === 'a' ? node : anchor;
    if (node.tagName === 'img' && attr(node, 'alt') === 'Support Archify') {
      assert.ok(attr(node, 'src')?.trim(), `${file}: Support badge must have an image source`);
      links.push(parentLink && attr(parentLink, 'href'));
    }
    for (const child of node.childNodes || []) visit(child, parentLink);
  }
  visit(parseFragment(text.slice(0, firstHeading)));
  assert.equal(links.length, 1, `${file}: expected one top Support badge`);
  assert.equal(links[0], target, `${file}: Support badge must link to ${target}`);
}

test('every README language has a top Support badge that jumps to its support section', () => {
  for (const { file, heading } of supportBadges) {
    checkSupportLink(fs.readFileSync(path.join(repoRoot, file), 'utf8'), heading, file);
  }
});
