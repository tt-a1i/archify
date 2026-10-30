import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const fixture = new URL('./fixtures/workflow-first-draft/automatic-port-slot.workflow.json', import.meta.url);

test('automatic branches use a clear port slot without reversing over an incoming line', () => {
  // The unconnected nodes and spare lane reserve the same columns and gutters
  // as surrounding work. Both branches must fit beside an incoming arrow;
  // shifting only their corners used to leave a reverse shared segment.
  const workflow = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, original);
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.equal(result.receipt.nodes.length, workflow.nodes.length);
  assert.equal(result.receipt.edges.length, workflow.edges.length);
  for (const node of workflow.nodes) {
    assert.equal(result.receipt.nodes.find(item => item.id === node.id).width, node.width);
    assert.ok(result.svg.includes(node.label));
  }
  const incoming = result.receipt.edges.find(edge => edge.id === 'prepare-spawn');
  const branches = result.receipt.edges.filter(edge => edge.from === 'spawn');
  // Where ports share a node side, keep the arrow's 3.5-stroke half-width
  // clear of each outgoing stroke. Do not prescribe the selected side or slot.
  for (const branch of branches) {
    const tip = incoming.points.at(-1), start = branch.points[0];
    if (Math.abs(tip[0] - start[0]) < 0.0001) {
      assert.ok(Math.abs(tip[1] - start[1]) >= 4 * 1.4 - 0.0001);
    }
  }
  const reordered = structuredClone(workflow);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(compileWorkflow({ workflow: reordered, qualityProfile: 'showcase' }), result);
});

// Complete first-draft Archify delivery workflow; retain its authored context.
// Fixture SHA-256: a6af57b8976d74cb59f0ca89baba71f0fae86cdf7f0df4c98b5c53c2e566b789.
// The same input previously failed showcase with composition/proper-crossing.
test('the full delivery workflow clears fan-in ports without losing authored topology', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-fanin-port-clearance.json', import.meta.url), 'utf8'));
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.deepEqual(workflow, original);
  assert.deepEqual(result.receipt.nodes.map(node => node.id).sort(), workflow.nodes.map(node => node.id).sort());
  const relationships = edges => edges.map(({ from, to }) => JSON.stringify([from, to])).sort();
  assert.deepEqual(relationships(result.receipt.edges), relationships(workflow.edges));
  for (const node of workflow.nodes) assert.ok(result.svg.includes(node.label));

  // Read the rendered marker and stroke, independently of router collision code.
  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
  const markers = new Map([...result.svg.matchAll(/<marker\b[^>]*>/g)].map(([tag]) => {
    const marker = attrs(tag);
    return [marker.id, marker];
  }));
  const arrivals = new Map();
  for (const [tag] of result.svg.matchAll(/<path\b[^>]*marker-end="url\(#[^"]+\)"[^>]*>/g)) {
    const path = attrs(tag);
    const node = result.receipt.nodes.find(({ id }) => id === path["data-edge-to"]);
    const points = path["data-composition-points"].split(";").map(point => point.split(",").map(Number));
    const tip = points.at(-1), previous = points.at(-2);
    const marker = markers.get(path["marker-end"].slice(5, -1));
    assert.ok(marker, "the rendered arrival references a real SVG marker");
    const scale = marker.markerUnits === "userSpaceOnUse" ? 1 : Number(path["stroke-width"]);
    const before = Number(marker.refY) * scale;
    const after = (Number(marker.markerHeight) - Number(marker.refY)) * scale;
    const vertical = tip[0] === previous[0];
    const side = vertical ? (tip[1] === node.y ? "top" : "bottom") : (tip[0] === node.x ? "left" : "right");
    assert.equal(vertical ? tip[1] : tip[0], side === "top" ? node.y : side === "bottom" ? node.y + node.height : side === "left" ? node.x : node.x + node.width);
    assert.ok(side === "top" ? previous[1] < tip[1] : side === "bottom" ? previous[1] > tip[1] : side === "left" ? previous[0] < tip[0] : previous[0] > tip[0], "arrows arrive from outside their node side");
    const position = vertical ? tip[0] : tip[1];
    const origin = vertical ? node.x : node.y;
    const extent = vertical ? node.width : node.height;
    assert.ok(position >= origin + 16 - 1e-7 && position <= origin + extent - 16 + 1e-7, "arrival retains the corner gutter");
    const key = `${node.id}:${side}`;
    if (!arrivals.has(key)) arrivals.set(key, []);
    arrivals.get(key).push([position - before, position + after]);
  }
  let sharedArrivalPairs = 0;
  for (const intervals of arrivals.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) {
      sharedArrivalPairs++;
      assert.ok(intervals[i][0] >= intervals[i - 1][1] - 1e-7, "rendered incoming marker bounds on the same side stay disjoint");
    }
  }
  assert.ok(sharedArrivalPairs > 0, "the complete fixture exercises shared-side incoming arrows");
});
