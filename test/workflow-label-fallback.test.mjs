import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

test('implicit labels preserve the full workflow without unnecessary outer width', () => {
  // Keep the complete motivating diagram, including nodes unrelated to this edge.
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-fanin-port-clearance.json', import.meta.url), 'utf8'));
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.deepEqual(workflow, original);
  assert.deepEqual(result.receipt.nodes.map(({ id }) => id).sort(), workflow.nodes.map(({ id }) => id).sort());
  const topology = edges => edges.map(({ from, to }) => JSON.stringify([from, to])).sort();
  assert.deepEqual(topology(result.receipt.edges), topology(workflow.edges));
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(), workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());

  const route = result.receipt.edges.find(edge => edge.from === 'check' && edge.to === 'repair').points;
  // Bound the detour relative to authored node extent, not a frozen automatic x.
  const rightmostNode = Math.max(...result.receipt.nodes.map(node => node.x + node.width));
  assert.ok(Math.max(...route.map(([x]) => x)) <= rightmostNode + 64, 'label placement must not manufacture a distant outer corridor');
  assert.ok(result.receipt.viewBox[0] <= rightmostNode + 80, 'the full canvas must not gain unnecessary outer width for this label');

  const group = result.svg.match(/<g\b(?=[^>]*data-edge-from="check")(?=[^>]*data-edge-to="repair")(?=[^>]*data-edge-label=)[^>]*>([\s\S]*?)<\/g>/)?.[1];
  assert.ok(group, 'the semantic failure label must be rendered');
  assert.match(group, />失败<\/text>/);
  const read = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  const mask = read(group.match(/<rect\b[^>]*>/)[0]);
  const text = read(group.match(/<text\b[^>]*>/)[0]);
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(mask[key])]));
  const point = [Number(text.x), Number(text.y)];
  const receiptLabel = result.receipt.labels.find(label => label.label === '失败' && label.x === point[0] && label.y === point[1]);
  assert.ok(receiptLabel, 'the receipt and actual SVG text identify the same label point');
  assert.deepEqual(rect, { x: receiptLabel.x - receiptLabel.width / 2, y: receiptLabel.y - 10, width: receiptLabel.width, height: receiptLabel.height });

});
