import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { layOutParallelPaths } from '../archify/renderers/architecture/parallel-path-placement.mjs';
import { createArchitectureRouter } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection, rectsOverlap } from '../archify/renderers/shared/geometry.mjs';

const parallelBranches = [
  ['reader', 'service'], ['reader', 'updates'], ['service', 'worker'], ['service', 'scheduler'],
  ['worker', 'report'], ['scheduler', 'report'], ['report', 'service', 'dashed'],
  ['service', 'cache'], ['service', 'files'],
];

function topology(relationships) {
  const ids = new Set(relationships.flatMap(([from, to]) => [from, to]));
  return {
    components: [...ids].map((id) => ({ id, size: [160, 60] })),
    connections: relationships.map(([from, to, variant]) => ({ from, to, variant })),
  };
}

function routeSegments(points) {
  return points.slice(1).map((point, index) => [points[index], point]);
}

test('a hub can send work along two branches with a clear shared return path', () => {
  const arch = topology(parallelBranches);
  const positions = automaticComponentPositions(arch);
  assert.deepEqual(positions, automaticComponentPositions(arch));
  const boxes = new Map(arch.components.map(({ id, size: [width, height] }) => {
    const [x, y] = positions.get(id);
    return [id, { x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
  }));
  const measured = [...boxes.values()];
  for (const [index, box] of measured.entries()) {
    assert.ok(measured.slice(index + 1).every((other) => !rectsOverlap(box, other)));
  }
  const { pathFor } = createArchitectureRouter(boxes, arch.connections);
  const routes = arch.connections.map((relation) => routeSegments(pathFor(relation).points));
  for (const [index, segments] of routes.entries()) {
    for (const [offset, other] of routes.slice(index + 1).entries()) {
      assert.ok(!segments.some((a) => other.some((b) => properSegmentIntersection(...a, ...b))),
        `routes ${index} and ${index + offset + 1} cross`);
    }
  }
});

test('placement keeps a fixed card while arranging the rest of a shared-branch diagram', () => {
  const arch = topology(parallelBranches);
  arch.components.find((card) => card.id === 'service').pos = [330, 420];
  const positions = automaticComponentPositions(arch);
  assert.deepEqual(positions.get('service'), [330, 420]);
  assert.equal(positions.size, arch.components.length);
});

test('parallel-path placement leaves separate cycles and larger islands to the ordinary layout', () => {
  const cases = [
    // The bridge between the cycles does not yield three shared paths.
    [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 5], [5, 3]],
    // A shared path pattern with a long attached chain exceeds the work limit.
    [[0, 1], [0, 2], [2, 1], [0, 3], [3, 1],
      ...Array.from({ length: 61 }, (_, index) => [index + 3, index + 4])],
  ];
  for (const relationships of cases) {
    const { components, connections } = topology(relationships);
    const items = components.map(({ size: [width, height] }, index) => ({ index, width, height }));
    const neighbors = new Map(items.map((item) => [item, []]));
    const edges = connections.map(({ from, to }) => ({ from: items[from], to: items[to] }));
    for (const { from, to } of edges) {
      neighbors.get(from).push(to);
      neighbors.get(to).push(from);
    }
    assert.equal(layOutParallelPaths(items, edges, neighbors, false), undefined);
    assert.ok(items.every((item) => item.x === undefined && item.y === undefined));
  }
});
