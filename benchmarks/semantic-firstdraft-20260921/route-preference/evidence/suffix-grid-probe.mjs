import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseRuntime = '/Users/tushaokun/.codex/worktrees/archify-semantic-firstdraft-20260921/archify';
const candidateRuntime = '/private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe/runtime';
const sourcePath = '/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-firstdraft-20260921/p-retry-C1/snapshot-001.json';
const fixturePath = new URL('./seven-c1-plus-grid-suffix.json', import.meta.url);
const resultPath = new URL('./suffix-grid-result.json', import.meta.url);
const { createRouter: createBaseRouter } = await import(pathToFileURL(path.join(baseRuntime, 'renderers/architecture/routing.mjs')).href);
const { createRouter: createCandidateRouter } = await import(pathToFileURL(path.join(candidateRuntime, 'renderers/architecture/routing.mjs')).href);
const { collectRouteRhythmIssues, segmentIntersectsRect } = await import(pathToFileURL(path.join(candidateRuntime, 'renderers/shared/geometry.mjs')).href);

function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function measured(components) {
  return new Map(components.map(component => {
    const [x, y] = component.pos; const [width, height] = component.size;
    return [component.id, { ...component, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
  }));
}
function cloneC1(count) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const components = []; const connections = [];
  for (let cluster = 0; cluster < count; cluster += 1) {
    const prefix = `cluster-${cluster}-`; const xOffset = cluster * 2_000;
    components.push(...source.components.map(component => ({ ...component, id: `${prefix}${component.id}`, pos: [component.pos[0] + xOffset, component.pos[1]] })));
    connections.push(...source.connections.map(connection => ({
      ...connection, id: `${prefix}${connection.id}`, from: `${prefix}${connection.from}`, to: `${prefix}${connection.to}`,
      via: connection.via?.map(([x, y]) => [x + xOffset, y]),
      labelAt: connection.labelAt && [connection.labelAt[0] + xOffset, connection.labelAt[1]],
    })));
  }
  return { components, connections };
}
function evaluate(create, document) {
  const connections = structuredClone(document.connections); const boxes = measured(document.components);
  const router = create(boxes, connections); const suffix = connections.find(connection => connection.id === 'suffix-grid-route');
  const route = router.pathFor(suffix);
  const blocker = boxes.get('suffix-blocker');
  return {
    points: route.points, selectedSides: router.connectionSides(suffix),
    rhythmCodes: collectRouteRhythmIssues({ routedRelations: [{ relation: suffix, points: route.points }] }).map(issue => issue.code),
    blockerIntersections: route.points.slice(0, -1).filter((point, index) => segmentIntersectsRect({ start: point, end: route.points[index + 1] }, blocker, 2)).length,
    metrics: router.routingMetrics(),
  };
}

const document = cloneC1(7);
document.components.push(
  { id: 'suffix-source', type: 'backend', label: 'Suffix source', pos: [80, 3_000], size: [140, 60] },
  { id: 'suffix-blocker', type: 'security', label: 'Suffix blocker', pos: [780, 2_980], size: [160, 100] },
  { id: 'suffix-target', type: 'database', label: 'Suffix target', pos: [1_580, 3_000], size: [140, 60] },
);
document.connections.push({ id: 'suffix-grid-route', from: 'suffix-source', to: 'suffix-target' });
fs.writeFileSync(fixturePath, `${JSON.stringify(document, null, 2)}\n`);
fs.writeFileSync(resultPath, `${JSON.stringify({
  fixture: { path: fixturePath.pathname, sha256: sha256(fixturePath), components: document.components.length, connections: document.connections.length },
  base: evaluate(createBaseRouter, document), candidate: evaluate(createCandidateRouter, document),
}, null, 2)}\n`);
