// Regression coverage for nested boundaries (issue #410): a `wraps` entry
// may reference either a component id or another boundary's own `id`,
// nesting that boundary inside this one. Depth is capped at 2 levels
// (outer -> inner -> components) and cycles are rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-nested-boundaries-'));

function baseSpec(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'nested boundary test', output: 'out.html', quality_profile: 'standard' },
    components: [
      { id: 'cart-svc', type: 'backend', label: 'Cart Service', pos: [80, 80], size: [120, 60] },
      { id: 'payment-svc', type: 'backend', label: 'Payment Service', pos: [80, 200], size: [120, 60] },
      { id: 'inventory-svc', type: 'backend', label: 'Inventory Service', pos: [80, 320], size: [120, 60] },
      { id: 'shared-cache', type: 'database', label: 'Shared Cache', pos: [340, 200], size: [120, 60] },
      { id: 'notifications', type: 'external', label: 'Notifications', pos: [700, 200], size: [140, 60] },
    ],
    boundaries: [
      {
        id: 'checkout-subsystem',
        kind: 'security-group',
        label: 'Checkout Subsystem',
        wraps: ['cart-svc', 'payment-svc', 'inventory-svc'],
        pad: 20,
      },
      {
        id: 'platform',
        kind: 'region',
        label: 'Platform',
        wraps: ['checkout-subsystem', 'shared-cache'],
        pad: 50,
      },
    ],
    connections: [
      { id: 'c1', from: 'cart-svc', to: 'notifications', label: 'emits events' },
      { id: 'c2', from: 'inventory-svc', to: 'shared-cache', label: 'reads/writes' },
    ],
    ...overrides,
  };
}

function writeSpec(name, spec) {
  const file = path.join(tmp, `${name}.architecture.json`);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2));
  return file;
}

function deliver(inputPath) {
  const outPath = path.join(tmp, `${path.basename(inputPath, '.json')}.html`);
  const result = spawnSync(process.execPath, [cli, 'deliver', 'architecture', inputPath, outPath, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  const receipt = JSON.parse(result.stdout);
  return { receipt, outPath };
}

function rect(html, label) {
  const pattern = new RegExp(
    `<rect data-graph-role="structural-frame"[^>]*data-composition-frame-label="${label}"[^>]*>`,
  );
  const match = html.match(pattern);
  assert.ok(match, `expected a structural-frame rect for "${label}"`);
  const attrs = {};
  for (const [, key, value] of match[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[key] = value;
  return {
    x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height),
  };
}

function contains(outer, inner, epsilon = 1e-6) {
  return outer.x <= inner.x + epsilon
    && outer.y <= inner.y + epsilon
    && outer.x + outer.width + epsilon >= inner.x + inner.width
    && outer.y + outer.height + epsilon >= inner.y + inner.height;
}

test('a boundary can nest another boundary by referencing its id in wraps', () => {
  const { receipt, outPath } = deliver(writeSpec('two-level', baseSpec()));
  assert.equal(receipt.ok, true, receipt.error);
  assert.equal(receipt.validation.errors, 0);

  const html = fs.readFileSync(outPath, 'utf8');
  const outer = rect(html, 'Platform');
  const inner = rect(html, 'Checkout Subsystem');
  assert.ok(contains(outer, inner), 'Platform frame must fully contain Checkout Subsystem frame');

  // shared-cache is a direct Platform member sitting outside the inner frame,
  // so Platform's box must also cover it (bounding box of inner-frame ∪ shared-cache).
  assert.ok(outer.x <= 340 && outer.y <= 200 && outer.x + outer.width >= 460 && outer.y + outer.height >= 260);
});

test('a component nested two levels deep reports the full boundary scope chain', () => {
  const { receipt, outPath } = deliver(writeSpec('context-chain', baseSpec()));
  assert.equal(receipt.ok, true, receipt.error);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /data-node-id="cart-svc"[^>]*data-node-context="Platform › Checkout Subsystem"/);
});

test('nesting depth is capped at 2 levels (outer -> inner -> components)', () => {
  const spec = baseSpec();
  spec.components.push({ id: 'refund-svc', type: 'backend', label: 'Refund Service', pos: [80, 440], size: [120, 60] });
  spec.boundaries.unshift({
    id: 'refund-subsystem', kind: 'security-group', label: 'Refund Subsystem', wraps: ['refund-svc'], pad: 15,
  });
  spec.boundaries[1].wraps = ['refund-subsystem', 'payment-svc', 'inventory-svc']; // checkout-subsystem now nests a boundary too
  const { receipt } = deliver(writeSpec('depth-three', spec));
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /supported nesting is 2 levels deep/);
});

test('a wraps cycle between boundaries is rejected, not infinitely recursed', () => {
  const spec = baseSpec();
  spec.boundaries[0].wraps = ['platform', 'payment-svc', 'inventory-svc']; // checkout-subsystem now (wrongly) wraps platform
  const { receipt } = deliver(writeSpec('cycle', spec));
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /forms a cycle/);
});

test('wraps referencing an id that is neither a component nor a boundary still fails clearly', () => {
  const spec = baseSpec();
  spec.boundaries[1].wraps = ['checkout-subsystem', 'does-not-exist'];
  const { receipt } = deliver(writeSpec('unknown-id', spec));
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /wraps unknown component "does-not-exist"/);
});

test('a boundary id colliding with a component id is rejected', () => {
  const spec = baseSpec();
  spec.boundaries[1].id = 'cart-svc';
  const { receipt } = deliver(writeSpec('id-collision', spec));
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /boundary ids and component ids must not collide/);
});

test('deployment-ownership profile rejects nested boundaries rather than silently mis-scoping them', () => {
  const spec = baseSpec();
  spec.meta.engineering_profile = 'deployment-ownership';
  const { receipt } = deliver(writeSpec('deployment-ownership-nested', spec));
  assert.equal(receipt.ok, false);
  assert.match(receipt.error, /deployment-ownership does not yet support/);
});

test('a long inner-boundary label still converges without title collisions', () => {
  const spec = baseSpec();
  spec.boundaries[0].label = 'This Is A Very Long Checkout Subsystem Label For Stress Testing';
  const { receipt } = deliver(writeSpec('long-title', spec));
  assert.equal(receipt.ok, true, receipt.error);
  assert.equal(receipt.validation.errors, 0);
});

test('flat (non-nested) boundaries keep working exactly as before', () => {
  const spec = baseSpec();
  delete spec.boundaries[1]; // drop Platform, keep only the flat Checkout Subsystem boundary
  spec.boundaries = [spec.boundaries[0]];
  spec.connections = [{ id: 'c1', from: 'cart-svc', to: 'shared-cache', label: 'writes' }];
  const { receipt } = deliver(writeSpec('flat-unaffected', spec));
  assert.equal(receipt.ok, true, receipt.error);
  assert.equal(receipt.validation.errors, 0);
});
