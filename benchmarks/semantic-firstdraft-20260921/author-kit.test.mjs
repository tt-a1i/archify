import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { architecture, edge, node, ref, writeArchitecture } from './author-kit.mjs';

test('preserves authored semantics, unicode, evidence, boundaries, views, cards, and repair routes', () => {
  const objectEvidence = { path: 'src/审核.ts', line: 8, end_line: 12, label: '原始证据', future: { keep: true } };
  const api = node(
    'api', 'backend', '订单 API', '接收 支付 ✓', [40, 80, 160, 64],
    ['src/api.ts:9-22', objectEvidence],
    { tag: '人工标记', brand: 'custom-mark' },
  );
  const database = node('db', 'database', '账本', undefined, [360, 80, 120, 64]);
  const route = [[220, 112], [300, 112], [300, 60]];
  const connection = edge('api-to-db', 'api', 'db', '写入 “订单”', {
    route: 'orthogonal-h', via: route, fromSide: 'right', toSide: 'left', labelAt: [280, 94],
  });
  const extras = {
    boundaries: [{ kind: 'region', label: '支付域', wraps: ['api', 'db'], pad: 18 }],
    cards: [{ dot: 'cyan', title: '边界', items: ['人工确认', '不推断'] }],
    future_top_level: { preserve: ['unknown', 'for validator'] },
  };
  const meta = {
    title: '订单审计',
    repository: { url: 'https://example.test/repo', revision: 'a'.repeat(40) },
    views: [{ id: 'write-path', label: '写入路径', focus: ['api', 'db'], note: '显示明确路由。' }],
  };
  const actual = architecture(meta, [api, database], [connection], extras);
  const expected = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { ...meta, quality_profile: 'showcase' },
    components: [
      {
        id: 'api', type: 'backend', label: '订单 API', sublabel: '接收 支付 ✓', pos: [40, 80], size: [160, 64],
        sources: [{ path: 'src/api.ts', line: 9, end_line: 22 }, objectEvidence], tag: '人工标记', brand: 'custom-mark',
      },
      { id: 'db', type: 'database', label: '账本', pos: [360, 80], size: [120, 64] },
    ],
    ...extras,
    connections: [{ id: 'api-to-db', from: 'api', to: 'db', label: '写入 “订单”', route: 'orthogonal-h', via: route, fromSide: 'right', toSide: 'left', labelAt: [280, 94] }],
  };
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(actual.components[0].sources[1], objectEvidence);
  assert.equal(actual.connections[0].via, route);
});

test('parses valid source ranges and rejects malformed or reversed ranges', () => {
  assert.deepEqual(ref('repo/relative.ts:4'), { path: 'repo/relative.ts', line: 4 });
  assert.deepEqual(ref('repo/relative.ts:4-19'), { path: 'repo/relative.ts', line: 4, end_line: 19 });
  for (const value of ['repo/a.ts', 'repo/a.ts:0', 'repo/a.ts:4-0', 'repo/a.ts:9-4', ':2', 'repo/a.ts:2-x', 'repo/a.ts:9007199254740993']) {
    assert.throws(() => ref(value));
  }
});

test('rejects malformed arguments and positional-field collisions instead of dropping data', () => {
  assert.throws(() => node('a', 'backend', 'A', undefined, [0, 0, 0, 50]), /positive/);
  assert.throws(() => node('a', 'backend', 'A', undefined, [0, 0, Infinity, 50]), /finite/);
  assert.throws(() => node('a', 'backend', 'A', undefined, [0, 0, 50, 50], undefined, { label: 'replace' }), /reserved/);
  assert.throws(() => edge('a-b', 'a', 'b', 'A → B', { from: 'replace' }), /reserved/);
  assert.throws(() => architecture({ title: 'A' }, [], [], { diagram_type: 'workflow' }), /reserved/);
  assert.throws(() => edge('a-b', 'a', 'b', 'A → B', { via: [undefined] }), /JSON-serializable/);
});

test('preserves empty optional labels and rejects data JSON would silently transform or omit', () => {
  assert.equal(node('a', 'backend', 'A', '', [0, 0, 50, 50]).sublabel, '');
  assert.equal(edge('a-b', 'a', 'b', '').label, '');
  assert.throws(() => node('a', 'backend', 'A', undefined, [0, 0, 50, 50], [{ path: 'a.ts', observed: new Date() }]), /plain objects/);
  assert.throws(() => edge('a-b', 'a', 'b', 'A → B', { metadata: new Map([['key', 'value']]) }), /plain objects/);
  assert.throws(() => architecture({ title: 'A', [Symbol('hidden')]: 'lost' }, [], []), /symbol-keyed/);
});

test('preserves caller quality profiles and writes the exact normal JSON candidate', async () => {
  const spec = architecture({ title: 'Explicit profile', quality_profile: 'standard' }, [], []);
  assert.equal(spec.meta.quality_profile, 'standard');
  const directory = await mkdtemp(join(tmpdir(), 'archify-author-kit-'));
  try {
    const output = join(directory, 'nested', 'candidate.architecture.json');
    await writeArchitecture(output, spec);
    assert.equal(await readFile(output, 'utf8'), `${JSON.stringify(spec, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
