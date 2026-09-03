import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';
import { normalizeDrilldowns, focusNodeAttrs, svgRootAttrs } from '../renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const overviewPath = path.join(skillRoot, 'examples/drilldown-overview.architecture.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drilldown-'));

/**
 * 校验 drilldowns / parentHref 契约与渲染透传：
 * - schema 接受合法相对 .html 目标
 * - normalizeDrilldowns 丢弃缺字段项并保留顺序
 * - SVG / 模板写出 Passport 子图列表与返回控件钩子
 * - Viewer 侧用 isSafeRelativeHtmlHref 拒绝协议型 URL（不在 normalize 层静默改写作者 href）
 */
test('schema accepts authored drilldowns on architecture components', () => {
  const document = JSON.parse(fs.readFileSync(overviewPath, 'utf8'));
  assert.equal(validateArchitecture(document), true, JSON.stringify(validateArchitecture.errors));
});

test('normalizeDrilldowns keeps ordered targets and drops incomplete entries', () => {
  const normalized = normalizeDrilldowns([
    { href: 'child-a.html', label: 'A' },
    { href: 'child-b.html#focus=api', label: 'B', diagram_type: 'sequence' },
    { label: 'missing-href' },
    { href: 'missing-label.html' },
    null,
  ]);
  assert.deepEqual(normalized, [
    { href: 'child-a.html', label: 'A' },
    { href: 'child-b.html#focus=api', label: 'B', diagram_type: 'sequence' },
  ]);
  assert.deepEqual(normalizeDrilldowns([]), []);
  assert.deepEqual(normalizeDrilldowns(undefined), []);
});

test('focusNodeAttrs and svgRootAttrs emit drilldown hooks', () => {
  const attrs = focusNodeAttrs('api', 'API', {
    kind: 'backend',
    drilldowns: [
      { href: 'a.html', label: 'Dataflow' },
      { href: 'b.html', label: 'Sequence' },
    ],
  }, 'zh-CN');
  assert.match(attrs, /data-node-drilldowns="/);
  assert.match(attrs, /a\.html/);
  assert.match(attrs, /Dataflow/);

  const root = svgRootAttrs({ title: 'Child', parentHref: 'overview.html', locale: 'zh-CN' });
  assert.match(root, /data-parent-href="overview\.html"/);
});

test('architecture render includes drilldown viewer surfaces', () => {
  const output = path.join(tmp, 'overview.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    overviewPath,
    output,
  ]);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-node-drilldowns="/);
  assert.match(html, /id="focus-drilldowns"/);
  assert.match(html, /id="parent-back-bar"/);
  assert.match(html, /function openPrimaryDrilldown/);
  assert.match(html, /function isSafeRelativeHtmlHref/);
  assert.match(html, /function syncParentBackControls/);
});
