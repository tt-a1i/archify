import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';

export const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const cli = path.join(skillRoot, 'bin/archify.mjs');
export function typographyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'test/fixtures/workflow-typography', `${name}.workflow.json`), 'utf8'));
}
export function runWorkflow(t, diagram, command = 'render') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-typography-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'output.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const args = [cli, command, 'workflow', input, ...(command === 'render' ? [output] : ['--json'])];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  const html = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  return { ...result, input, output, directory, html, svg: html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '',
    receipt: command === 'render' ? null : JSON.parse(result.stdout) };
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
