import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeAutomaticLabels } from '../archify/renderers/shared/automatic-labels.mjs';

const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));

function layoutReport(t, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-aesthetic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(spec));
  return JSON.parse(execFileSync(process.execPath, [renderer, input, '--layout-json'], { encoding: 'utf8' }));
}

test('inferred vertical columns harmonize card widths to flush edges', t => {
  const report = layoutReport(t, {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Spine alignment', output: 'out.html', quality_profile: 'showcase' },
    layout: { mode: 'auto' },
    components: [
      { id: 'sdk', type: 'frontend', label: 'Python SDK', sublabel: 'Remote client' },
      { id: 'cli', type: 'frontend', label: 'CLI Runner', sublabel: 'Local dev' },
      { id: 'api', type: 'external', label: 'API Gateway', sublabel: 'Service' },
      { id: 'runtime', type: 'backend', label: 'Execution Runtime', sublabel: 'Plan · Dispatch · Commit' },
      { id: 'cache', type: 'database', label: 'Checkpoint DB', sublabel: 'SQLite' },
      { id: 'tasks', type: 'backend', label: 'Task Runner', sublabel: 'Retries' },
      { id: 'store', type: 'database', label: 'Store', sublabel: 'Key-value state' },
    ],
    connections: [
      { from: 'sdk', to: 'api', label: 'HTTP stream' },
      { from: 'cli', to: 'api', label: 'Start server' },
      { from: 'api', to: 'runtime', label: 'Load graph' },
      { from: 'runtime', to: 'cache', label: 'Save checkpoint' },
      { from: 'runtime', to: 'tasks', label: 'Dispatch', variant: 'emphasis' },
      { from: 'tasks', to: 'store', label: 'Read and write' },
    ],
  });

  assert.equal(report.ok, true);
  const byId = new Map(report.components.map(component => [component.id, component]));
  const spine = ['sdk', 'api', 'runtime', 'tasks', 'store'].map(id => byId.get(id));
  assert.equal(new Set(spine.map(card => card.width)).size, 1, `expected uniform spine width, got ${JSON.stringify(spine)}`);
  assert.equal(new Set(spine.map(card => card.x)).size, 1, `expected flush left edges, got ${JSON.stringify(spine)}`);
});

test('lateral pendant subtrees lift into open vertical space alongside the main spine', t => {
  const report = layoutReport(t, {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Lateral subtree', output: 'out.html', quality_profile: 'showcase' },
    layout: { mode: 'auto' },
    components: [
      { id: 'cfg', type: 'external', label: 'Config CLI', sublabel: 'Admin API' },
      { id: 'core', type: 'backend', label: 'Core Runtime', sublabel: 'Lifecycle' },
      { id: 'http', type: 'backend', label: 'HTTP App', sublabel: 'Routing chain' },
      { id: 'proxy', type: 'backend', label: 'Reverse Proxy', sublabel: 'Upstream pool' },
      { id: 'up', type: 'external', label: 'Upstream', sublabel: 'Origin' },
      { id: 'files', type: 'backend', label: 'File Server', sublabel: 'Static files' },
      { id: 'disk', type: 'database', label: 'Local Disk', sublabel: 'OS filesystem' },
      { id: 'tls', type: 'security', label: 'TLS Manager', sublabel: 'Handshake & certs' },
      { id: 'acme', type: 'external', label: 'ACME CA', sublabel: 'Certificate issuer' },
      { id: 'pki', type: 'security', label: 'Internal PKI', sublabel: 'Local CA' },
      { id: 'vault', type: 'database', label: 'Cert Storage', sublabel: 'Keys & PEM' },
    ],
    connections: [
      { from: 'cfg', to: 'core', label: 'Load JSON' },
      { from: 'core', to: 'http', label: 'Start HTTP' },
      { from: 'http', to: 'proxy', label: 'Route proxy', variant: 'emphasis' },
      { from: 'proxy', to: 'up', label: 'Forward', variant: 'emphasis' },
      { from: 'http', to: 'files', label: 'Serve files' },
      { from: 'files', to: 'disk', label: 'Read file' },
      { from: 'http', to: 'tls', label: 'Manage TLS domains', variant: 'security' },
      { from: 'tls', to: 'acme', label: 'Request ACME', variant: 'security' },
      { from: 'tls', to: 'pki', label: 'Sign internal', variant: 'security' },
      { from: 'tls', to: 'vault', label: 'Store certs' },
    ],
  });

  assert.equal(report.ok, true);
  const byId = new Map(report.components.map(component => [component.id, component]));
  assert.ok(byId.get('tls').y < byId.get('proxy').y,
    `expected TLS subtree root (${byId.get('tls').y}) above lower main-spine rank (${byId.get('proxy').y})`);
  const bridge = report.connections.find(conn => conn.from === 'http' && conn.to === 'tls');
  assert.ok(bridge.points.length <= 3, `expected direct or single-elbow bridge, got ${JSON.stringify(bridge.points)}`);
});

test('vertical spine labels share the unobstructed side and reciprocal horizontals use outer sides', () => {
  const verticalRoutes = [
    { relationIndex: 0, points: [[160, 80], [160, 160]] },
    { relationIndex: 1, points: [[160, 220], [160, 300]] },
    { relationIndex: 2, points: [[160, 360], [160, 440]] },
  ];
  const verticalLabels = verticalRoutes.map((route, relationIndex) => ({
    relation: {}, relationIndex, label: `Step ${relationIndex}`,
    x: 120, y: route.points[0][1] - 20, width: 80, height: 14, lx: 160, ly: route.points[0][1] - 10,
  }));
  const endpointCards = [
    { x: 100, y: 20, width: 120, height: 60 },
    { x: 100, y: 160, width: 120, height: 60 },
    { x: 100, y: 300, width: 120, height: 60 },
    { x: 100, y: 440, width: 120, height: 60 },
    { x: 40, y: 235, width: 112, height: 50 },
  ];
  const placedSpine = placeAutomaticLabels({
    routes: verticalRoutes,
    labels: verticalLabels,
    components: endpointCards,
    titles: [],
    viewBox: [360, 520],
    repairOwnership: true,
    ownershipMargin: 4,
  });
  assert.ok(placedSpine.every(label => label.lx > 160),
    `expected all spine labels on unobstructed right side, got ${JSON.stringify(placedSpine.map(l => l.lx))}`);

  const horizontalRoutes = [
    { relationIndex: 0, points: [[60, 120], [260, 120]] },
    { relationIndex: 1, points: [[260, 150], [60, 150]] },
  ];
  const horizontalLabels = [
    { relation: {}, relationIndex: 0, label: 'Mount scene', x: 120, y: 100, width: 80, height: 14, lx: 160, ly: 110 },
    { relation: {}, relationIndex: 1, label: 'onChange', x: 125, y: 130, width: 70, height: 14, lx: 160, ly: 140 },
  ];
  const [upper, lower] = placeAutomaticLabels({
    routes: horizontalRoutes,
    labels: horizontalLabels,
    components: [],
    titles: [],
    viewBox: [320, 240],
    repairOwnership: true,
    ownershipMargin: 4,
  });
  assert.ok(upper.y + upper.height <= 120, `expected upper label above top shaft: ${JSON.stringify(upper)}`);
  assert.ok(lower.y >= 150, `expected lower label below bottom shaft instead of wedged between: ${JSON.stringify(lower)}`);
});
