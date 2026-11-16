import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  { file: 'README.md', href: '#support-archify', style: 'for-the-badge' },
  { file: 'README_EN.md', href: '#support-archify', style: 'for-the-badge' },
  { file: 'README_ZH.md', href: '#支持-archify', style: 'for-the-badge' },
  { file: 'README_JA.md', href: '#archify-を支援する', style: 'for-the-badge' },
  { file: 'README_KO.md', href: '#archify-지원하기', style: 'flat-square' },
];

test('every README language has a top Support badge that jumps to its support section', () => {
  const badge = style => `https://img.shields.io/badge/Support-E2500E?style=${style}`;
  for (const { file, href, style } of supportBadges) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const firstHeading = text.search(/\n## /);
    assert.ok(firstHeading > 0, `${file}: missing first heading`);
    const prefix = text.slice(0, firstHeading);
    const expected = `<a href="${href}"><img src="${badge(style)}" alt="Support Archify" /></a>`;
    assert.ok(prefix.includes(expected), `${file}: expected Support badge linking to ${href} with ${style} style before the first heading`);
    assert.equal((text.match(/img\.shields\.io\/badge\/Support-E2500E/g) || []).length, 1, `${file}: Support badge should appear once`);
  }
});
