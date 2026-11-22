import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architecture as validateArchitecture } from '../archify/renderers/shared/generated-validators.mjs';
import {
  isSiblingHtmlHref,
  normalizeDrilldowns,
  resolveNodeDrilldowns,
  focusNodeAttrs,
  svgRootAttrs,
} from '../archify/renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const overviewPath = path.join(skillRoot, 'examples/drilldown-overview.architecture.json');
const platformPath = path.join(skillRoot, 'examples/drilldown-platform.architecture.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drilldown-'));

/**
 * 校验 drilldowns / href 简写 / parentHref 契约与渲染透传：
 * - schema 接受同目录 .html，拒绝 ../、/、协议
 * - href 简写收成一项；与 drilldowns 同时存在时数组优先
 * - 单目标写出原生 <a> + 角标；多目标只写 Passport 属性
 * - Viewer 侧 isSafeRelativeHtmlHref 与 isSiblingHtmlHref 对齐
 */
test('schema accepts authored drilldowns on architecture components', () => {
  const document = JSON.parse(fs.readFileSync(overviewPath, 'utf8'));
  assert.equal(validateArchitecture(document), true, JSON.stringify(validateArchitecture.errors));
});

test('schema accepts href sugar and rejects path escape', () => {
  const document = JSON.parse(fs.readFileSync(platformPath, 'utf8'));
  assert.equal(validateArchitecture(document), true, JSON.stringify(validateArchitecture.errors));

  const escaped = structuredClone(document);
  escaped.components[2].href = '../escape.html';
  assert.equal(validateArchitecture(escaped), false);
});

test('isSiblingHtmlHref allows only same-directory html files', () => {
  assert.equal(isSiblingHtmlHref('child.html'), true);
  assert.equal(isSiblingHtmlHref('child.html#focus=api'), true);
  assert.equal(isSiblingHtmlHref('child.html?from=overview.html'), true);
  assert.equal(isSiblingHtmlHref('child.html?theme=light&embed=0#focus=api'), true);
  assert.equal(isSiblingHtmlHref('../x.html'), false);
  assert.equal(isSiblingHtmlHref('dir/x.html'), false);
  assert.equal(isSiblingHtmlHref('/abs.html'), false);
  assert.equal(isSiblingHtmlHref('https://example.com/x.html'), false);
});

test('normalizeDrilldowns keeps ordered targets and drops incomplete or unsafe entries', () => {
  const normalized = normalizeDrilldowns([
    { href: 'child-a.html', label: 'A' },
    { href: 'child-b.html#focus=api', label: 'B', diagram_type: 'sequence' },
    { href: '../escape.html', label: 'bad' },
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

test('resolveNodeDrilldowns prefers drilldowns over href sugar', () => {
  assert.deepEqual(resolveNodeDrilldowns({ href: 'child.html', label: 'Node' }), [
    { href: 'child.html', label: 'Node' },
  ]);
  assert.deepEqual(resolveNodeDrilldowns({
    href: 'ignored.html',
    label: 'Node',
    drilldowns: [{ href: 'wins.html', label: 'From array' }],
  }), [
    { href: 'wins.html', label: 'From array' },
  ]);
});

test('focusNodeAttrs and svgRootAttrs emit drilldown hooks', () => {
  const attrs = focusNodeAttrs('api', 'API', {
    kind: 'backend',
    href: 'sugar.html',
    drilldowns: [
      { href: 'a.html', label: 'Dataflow' },
      { href: 'b.html', label: 'Sequence' },
    ],
  }, 'zh-CN');
  assert.match(attrs, /data-node-drilldowns="/);
  assert.match(attrs, /a\.html/);
  assert.match(attrs, /Dataflow/);
  assert.doesNotMatch(attrs, /sugar\.html/);

  const sugar = focusNodeAttrs('int', 'Integrations', {
    kind: 'external',
    href: 'child.html',
  }, 'en');
  assert.match(sugar, /child\.html/);
  assert.match(sugar, /Integrations/);

  const root = svgRootAttrs({ title: 'Child', parentHref: 'overview.html', locale: 'zh-CN' });
  assert.match(root, /data-parent-href="overview\.html"/);
  const rejected = svgRootAttrs({ title: 'Child', parentHref: '../escape.html' });
  assert.doesNotMatch(rejected, /data-parent-href=/);
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
  assert.match(html, /function rewriteDrilldownAnchors/);
  assert.match(html, /function syncParentBackControls/);
  assert.match(html, /archify-drilldown-mark/);
  // 多目标只写 Passport 属性；模板 JS 会提到 data-archify-drilldown，但 SVG 里不该出现单目标 <a>
  assert.doesNotMatch(html, /<a class="archify-drilldown-link"/);
});

test('single-child href sugar wraps a native SVG anchor and mark', () => {
  const output = path.join(tmp, 'platform.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    platformPath,
    output,
  ]);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-archify-drilldown="1"/);
  assert.match(html, /href="drilldown-integrations\.html"/);
  assert.match(html, /archify-drilldown-mark/);
  assert.match(html, /function rewriteDrilldownAnchors/);
});

// Exercise each current renderer entrypoint, including the extracted Dataflow compiler.
test('all five supported native modes render authored sibling navigation', () => {
  for (const [type, example, nodes] of [
    ['architecture', 'web-app.architecture.json', 'components'],
    ['workflow', 'agent-tool-call.workflow.json', 'nodes'],
    ['sequence', 'cache-miss-request.sequence.json', 'participants'],
    ['dataflow', 'product-analytics.dataflow.json', 'nodes'],
    ['lifecycle', 'agent-run.lifecycle.json', 'states'],
  ]) {
    const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example)));
    model[nodes][0].href = 'detail.html';
    const input = path.join(tmp, `${type}.json`);
    const output = path.join(tmp, `${type}.html`);
    fs.writeFileSync(input, JSON.stringify(model));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers', type, `render-${type}.mjs`), input, output]);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /<a class="archify-drilldown-link"[^>]*href="detail\.html"/, type);
  }
});
