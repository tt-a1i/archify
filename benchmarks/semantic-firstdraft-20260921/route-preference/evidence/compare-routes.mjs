import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseRuntime = '/Users/tushaokun/.codex/worktrees/archify-semantic-firstdraft-20260921/archify';
const candidateRuntime = '/private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe/runtime';
const c1 = '/Users/tushaokun/.codex/visualizations/2026/09/20/01a0bd05-f71b-7461-a1ea-6437b90d3f2c/semantic-firstdraft-20260921/p-retry-C1/snapshot-001.json';
const output = new URL('./route-comparison.json', import.meta.url);
const { createRouter: createBaseRouter } = await import(pathToFileURL(path.join(baseRuntime, 'renderers/architecture/routing.mjs')).href);
const { createRouter: createCandidateRouter } = await import(pathToFileURL(path.join(candidateRuntime, 'renderers/architecture/routing.mjs')).href);
const { collectRouteRhythmIssues } = await import(pathToFileURL(path.join(candidateRuntime, 'renderers/shared/geometry.mjs')).href);

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function measuredComponents(document) {
  return new Map(document.components.map(component => {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    return [component.id, { ...component, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
  }));
}

function authored(connection) {
  return Boolean(connection.via || (connection.route && connection.route !== 'auto')
    || connection.channelX !== undefined || connection.channelY !== undefined);
}

function evaluate(create, document) {
  const connections = structuredClone(document.connections);
  const router = create(measuredComponents(document), connections);
  const routes = connections.map(connection => {
    const result = router.pathFor(connection);
    return {
      id: connection.id,
      authored: authored(connection),
      points: result.points,
      selectedSides: router.connectionSides(connection),
      rhythmCodes: collectRouteRhythmIssues({ routedRelations: [{ relation: connection, points: result.points }] }).map(issue => issue.code),
    };
  });
  return { routes, metrics: router.routingMetrics() };
}

function comparison(name, file) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const baseline = evaluate(createBaseRouter, document);
  const candidate = evaluate(createCandidateRouter, document);
  const routeDiffs = baseline.routes.flatMap((route, index) => {
    const next = candidate.routes[index];
    return JSON.stringify(route.points) === JSON.stringify(next.points)
      && JSON.stringify(route.selectedSides) === JSON.stringify(next.selectedSides) ? [] : [{
        id: route.id, authored: route.authored, baseline: route, candidate: next,
      }];
  });
  return {
    name, path: file, sha256: sha256(file), componentCount: document.components.length,
    connectionCount: document.connections.length, authoredConnectionCount: document.connections.filter(authored).length,
    routeDiffs, baselineMetrics: baseline.metrics, candidateMetrics: candidate.metrics,
  };
}

function cloneC1(clusterCount) {
  const source = JSON.parse(fs.readFileSync(c1, 'utf8'));
  const components = [];
  const connections = [];
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const prefix = `cluster-${cluster}-`;
    const xOffset = cluster * 2_000;
    for (const component of source.components) {
      components.push({
        ...component,
        id: `${prefix}${component.id}`,
        pos: [component.pos[0] + xOffset, component.pos[1]],
      });
    }
    for (const connection of source.connections) {
      connections.push({
        ...connection,
        id: `${prefix}${connection.id}`,
        from: `${prefix}${connection.from}`,
        to: `${prefix}${connection.to}`,
        via: connection.via?.map(([x, y]) => [x + xOffset, y]),
        labelAt: connection.labelAt && [connection.labelAt[0] + xOffset, connection.labelAt[1]],
      });
    }
  }
  return { components, connections };
}

const examples = [
  'brand-aware-delivery.architecture.json',
  'checkout-platform.base.architecture.json',
  'checkout-platform.head.architecture.json',
  'production-deployment.architecture.json',
  'source-to-diagram/source-to-diagram.architecture.json',
  'starter.architecture.json',
  'web-app.architecture.json',
].map(relative => comparison(relative, path.join(candidateRuntime, 'examples', relative)));

const stressDocument = cloneC1(7);
const stressBase = evaluate(createBaseRouter, stressDocument);
const stressCandidate = evaluate(createCandidateRouter, stressDocument);
const clusterRhythm = Array.from({ length: 7 }, (_, cluster) => ({
  cluster,
  baselineIssues: stressBase.routes.filter(route => route.id.startsWith(`cluster-${cluster}-`))
    .flatMap(route => route.rhythmCodes).length,
  candidateIssues: stressCandidate.routes.filter(route => route.id.startsWith(`cluster-${cluster}-`))
    .flatMap(route => route.rhythmCodes).length,
}));

fs.writeFileSync(output, `${JSON.stringify({
  baseRuntime, candidateRuntime, examples,
  c1: { path: c1, sha256: sha256(c1) },
  budgetStress: {
    fixture: 'seven non-overlapping deterministic translations of frozen p-retry-C1',
    componentCount: stressDocument.components.length,
    connectionCount: stressDocument.connections.length,
    baselineMetrics: stressBase.metrics,
    candidateMetrics: stressCandidate.metrics,
    clusterRhythm,
  },
}, null, 2)}\n`);
