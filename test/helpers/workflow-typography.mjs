import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const skillRoot = path.join(repoRoot, 'archify');
export const cli = path.join(skillRoot, 'bin/archify.mjs');
export function typographyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'test/fixtures/workflow-typography', `${name}.workflow.json`), 'utf8'));
}
export function runWorkflow(t, diagram, command = 'render', { repoRoot: sourceRoot, quality, layoutJson = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-typography-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'output.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const args = [cli, command, 'workflow', input, ...(command === 'render' ? [output] : ['--json']),
    ...(sourceRoot ? ['--repo-root', sourceRoot] : []), ...(quality ? ['--quality', quality] : []),
    ...(layoutJson ? ['--layout-json'] : [])];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  const html = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  return { ...result, input, output, directory, html, svg: html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '',
    receipt: command === 'render' ? null : JSON.parse(result.stdout) };
}

// 真实 Git 来源验证必须经过公开 CLI，不能仅伪造 sourceEvidence 对象。
export function sourceTypographyFixture(t, { scale, node = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'empty-hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(root, 'source.js'), 'export function ProcessData(input) { return input; }\n');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', hooks);
  const url = 'https://github.com/example/archify-review-fixture';
  git('remote', 'add', 'origin', url);
  git('add', 'source.js');
  git('commit', '-m', 'typography source fixture');
  const revision = git('rev-parse', 'HEAD');
  const diagram = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Source-backed workflow', output: 'source-workflow.html', quality_profile: 'showcase',
      repository: { url, revision }, ...(scale === undefined ? {} : { typography_scale: scale }) },
    lanes: [{ id: 'processing', label: 'Processing' }],
    nodes: [{ id: 'process', type: 'backend', lane: 'processing', col: 0,
      label: 'ProcessData', sublabel: 'subtitle', sources: [{ path: 'source.js', line: 1 }], ...node }],
    edges: [],
  };
  return { root, revision, url, diagram };
}

export function sourceEvidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Rendered HTML is missing verified source evidence.');
  return JSON.parse(match[1]);
}
function descendants(node, predicate, result = []) {
  if (predicate(node)) result.push(node);
  for (const child of node.childNodes || []) descendants(child, predicate, result);
  return result;
}
const attributes = node => Object.fromEntries((node.attrs || []).map(item => [item.name, item.value]));
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
export function svgFacts(svg) {
  const tree = parseFragment(svg);
  const texts = descendants(tree, node => node.tagName === 'text').map(node => ({
    text: text(node), font: Number(attributes(node)['font-size']), attrs: attributes(node),
  }));
  const nodes = descendants(tree, node => attributes(node)['data-node-id'] !== undefined).map(node => {
    const box = attributes((node.childNodes || []).find(child => child.tagName === 'rect' && attributes(child).class === 'c-mask'));
    return { id: attributes(node)['data-node-id'], ...Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(box[key])])) };
  });
  const masks = descendants(tree, node => node.tagName === 'g' && attributes(node)['data-edge-id'] !== undefined)
    .flatMap(node => (node.childNodes || []).filter(child => child.tagName === 'rect').map(child => ({
      id: attributes(node)['data-edge-id'], ...Object.fromEntries(['width', 'height'].map(key => [key, Number(attributes(child)[key])])),
      labelAt: ['x', 'y'].map(key => Number(attributes((node.childNodes || []).find(item => item.tagName === 'text'))[key])),
    })));
  const routes = descendants(tree, node => node.tagName === 'path' && attributes(node)['data-edge-id'] !== undefined)
    .map(node => ({ id: attributes(node)['data-edge-id'], points: attributes(node)['data-composition-points'].split(';').map(point => point.split(',').map(Number)) }));
  const root = descendants(tree, node => node.tagName === 'svg')[0];
  return { texts, nodes, masks, routes, viewBox: attributes(root).viewBox.split(' ').map(Number) };
}
