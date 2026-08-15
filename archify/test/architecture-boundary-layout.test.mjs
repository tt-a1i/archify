import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function numberAttr(source, name) {
  const match = source.match(new RegExp(`${name}="([\\d.]+)"`));
  assert.ok(match, `missing ${name} in ${source}`);
  return Number(match[1]);
}

function frame(svg, index) {
  const match = svg.match(new RegExp(`<rect[^>]*data-composition-frame-id="${index}"[^>]*>`));
  assert.ok(match, `missing boundary frame ${index}`);
  return {
    x: numberAttr(match[0], 'x'),
    y: numberAttr(match[0], 'y'),
    width: numberAttr(match[0], 'width'),
    height: numberAttr(match[0], 'height'),
  };
}

test('architecture reserves a title band and expands a parent around its nested boundary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-layout-'));
  const input = path.join(tmp, 'nested.json');
  const output = path.join(tmp, 'nested.html');
  const document = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Nested boundaries', viewBox: [900, 700] },
    components: [
      { id: 'gateway', type: 'cloud', label: 'Gateway', pos: [240, 240], size: [120, 60] },
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [440, 240], size: [120, 60] },
      { id: 'store', type: 'database', label: 'Store', pos: [440, 440], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Application', wraps: ['gateway', 'runtime', 'store'], pad: 20 },
      { kind: 'security-group', label: 'Runtime policy', wraps: ['gateway', 'runtime'], pad: 20 },
    ],
    connections: [],
  };
  fs.writeFileSync(input, JSON.stringify(document));

  execFileSync('node', [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    input,
    output,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const html = fs.readFileSync(output, 'utf8');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  const parent = frame(svg, 0);
  const child = frame(svg, 1);
  const parentRight = parent.x + parent.width;
  const parentBottom = parent.y + parent.height;
  const childRight = child.x + child.width;
  const childBottom = child.y + child.height;

  assert.ok(child.x - parent.x >= 32, 'parent should clear the nested boundary on the left');
  assert.ok(child.y - parent.y >= 32, 'parent should reserve a separate title row above the child');
  assert.ok(parentRight - childRight >= 32, 'parent should clear the nested boundary on the right');
  assert.ok(parentBottom - childBottom >= 32, 'parent should clear the nested boundary at the bottom');

  const childTitle = svg.match(/<text x="228" y="([\d.]+)"[^>]*>Runtime policy<\/text>/);
  assert.ok(childTitle, 'expected the nested boundary title');
  assert.ok(240 - Number(childTitle[1]) >= 24, 'title should remain clear of the first component row');
});

test('architecture expands a boundary away from a nearby parallel route', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-route-'));
  const input = path.join(tmp, 'route.json');
  const output = path.join(tmp, 'route.html');
  const document = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary route clearance', viewBox: [900, 700] },
    components: [
      { id: 'service', type: 'backend', label: 'Service', pos: [200, 200], size: [120, 60] },
      { id: 'store', type: 'database', label: 'Store', pos: [378, 420], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'security-group', label: 'Policy', wraps: ['service'], pad: 20 },
    ],
    connections: [
      { id: 'service-store', from: 'service', to: 'store' },
    ],
  };
  fs.writeFileSync(input, JSON.stringify(document));

  execFileSync('node', [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    input,
    output,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const html = fs.readFileSync(output, 'utf8');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  const boundary = frame(svg, 0);
  assert.ok(boundary.x + boundary.width >= 363, 'boundary should keep 14px from the parallel route');
});

test('architecture separates coincident edges of partially overlapping boundaries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-edge-'));
  const input = path.join(tmp, 'edges.json');
  const output = path.join(tmp, 'edges.html');
  const document = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary edge clearance', viewBox: [900, 700] },
    components: [
      { id: 'gateway', type: 'backend', label: 'Gateway', pos: [200, 200], size: [120, 60] },
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [400, 400], size: [120, 60] },
      { id: 'integration', type: 'external', label: 'Integration', pos: [600, 400], size: [120, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Runtime', wraps: ['gateway', 'runtime'], pad: 20 },
      { kind: 'security-group', label: 'Policy', wraps: ['gateway', 'integration'], pad: 20 },
    ],
    connections: [],
  };
  fs.writeFileSync(input, JSON.stringify(document));

  execFileSync('node', [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    input,
    output,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const html = fs.readFileSync(output, 'utf8');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  const first = frame(svg, 0);
  const second = frame(svg, 1);
  const firstBottom = first.y + first.height;
  const secondBottom = second.y + second.height;
  assert.ok(secondBottom - firstBottom >= 14, 'partially overlapping boundaries should not share a bottom edge');
});
