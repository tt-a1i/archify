import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkspace, formatWorkspaceContext } from '../overlay/workspace.mjs';
import { observedCycles } from '../overlay/pull-request.mjs';

test('the workspace lists captured files independently of findings or Atlas membership', () => {
  const facts = {
    repository: { root: 'packages/api', language: 'ts', sourceKind: 'git-tree', revision: '1'.repeat(40), snapshotId: 'a'.repeat(64) },
    files: [
      { path: 'root.ts', sourceText: 'import "./app/index";\n' },
      { path: 'app/index.ts', sourceText: 'export const original = 1;\n' },
      { path: 'lib/index.ts', sourceText: 'export const separate = 2;\n' },
      { path: 'spec/index.ts', role: 'test', sourceText: 'case\n' },
      { path: 'large.ts', sourceText: 'x'.repeat(100_000) },
      { path: '../private.ts', sourceText: 'must not ship' },
    ],
    parse_errors: [{ path: 'app/broken.ts' }],
    imports: [
      { from: 'root.ts', to: 'app/index.ts', resolved: true, line: 1 },
      { from: 'root.ts', to: 'app/index.ts', resolved: true, line: 1 },
      { from: 'root.ts', to: 'spec/index.ts', resolved: true, line: 2 },
      { from: 'root.ts', to: 'not-present.ts', resolved: false, line: 3 },
      { from: 'root.ts', to: 'lib/index.ts', resolved: true, line: null },
    ],
  };
  const graph = { modules: [{ id: 'frontend', label: 'Front End' }], excluded: { roles: ['test'] } };
  const atlas = { modules: graph.modules, files: [['app/index.ts', 0], ['lib/index.ts', 0], ['root.ts', 0]] };
  const snippet = { total: 1, lines: ['bound existing excerpt'] };
  const snippets = { 'app/index.ts': snippet };
  const workspace = buildWorkspace({ facts, graph, atlas, snippets });
  assert.deepEqual(workspace.files, [
    ['app/broken.ts', null, 'parse-error'], ['app/index.ts', 'frontend', 'analyzed'],
    ['large.ts', null, 'unmapped'], ['lib/index.ts', 'frontend', 'analyzed'],
    ['root.ts', 'frontend', 'analyzed'], ['spec/index.ts', null, 'excluded'],
  ]);
  assert.deepEqual(workspace.imports, [[4, 1, 1]]);
  assert.deepEqual(workspace.outsideTargets, [0, 0, 0, 0, 2, 0]);
  assert.equal(workspace.revision, '1'.repeat(40));
  assert.equal(workspace.scope, 'packages/api');
  assert.equal(snippets['app/index.ts'], snippet);
  assert.deepEqual(snippets['lib/index.ts'].lines, ['export const separate = 2;']);
  for (const name of ['large.ts', 'app/broken.ts', 'spec/index.ts', '../private.ts']) assert.equal(Object.hasOwn(snippets, name), false);
  assert.equal(buildWorkspace({ facts: null, graph, atlas, snippets }), null, 'old artifacts still open the original reader');
});

test('new, existing and no-longer-detected cycles cite their own location and comparison side', () => {
  const cycle = (id, first, line, extra = {}) => ({
    id, code: 'coupling/import-cycle',
    subject: { files: [first, 'partner.ts'] },
    evidence: { pathImports: [{ file: first, line, to: 'partner.ts' }], imports: [{ file: 'unrelated.ts', line: 1 }] },
    ...extra,
  });
  const base = [cycle('existing', 'same.ts', 1), cycle('gone', 'old.ts', 10)];
  const head = [cycle('existing', 'same.ts', 4), cycle('new', 'new.ts', 8), cycle('external', 'external.ts', 1, { external: { format: 'eslint' } })];
  assert.deepEqual(observedCycles(base, head, { comparable: false }), { records: [], omitted: 0 });
  const { records, omitted } = observedCycles(base, head, { comparable: true });
  assert.equal(omitted, 0);
  assert.deepEqual(records.map(row => [row.id, row.status, row.locations]), [
    ['gone', 'not-detected', [{ file: 'old.ts', line: 10, side: 'base' }]],
    ['new', 'detected', [{ file: 'new.ts', line: 8, side: 'head' }]],
    ['existing', 'existing', [{ file: 'same.ts', line: 4, side: 'head' }]],
  ]);
  assert.ok(records.every(row => !row.paths.includes('unrelated.ts')));
});

test('Agent context keeps side, capture, and omissions in at most 8 KiB', () => {
  const capture = { scope: 'packages/service', language: 'ts', pr: 'example/service#42', base: 'a'.repeat(40), head: 'b'.repeat(40),
    note: 'Coverage limited or incomparable; missing change evidence is unknown.' };
  const target = { kind: 'file', path: 'new.ts', state: { status: 'Renamed', before: 'old.ts', after: 'new.ts' } };
  const rows = Array.from({ length: 25 }, (_, i) => ['観'.repeat(400) + i, 'imports', '路'.repeat(400) + i]);
  const anchors = ['base old.ts:3', 'head new.ts:4', ...rows.map(row => row[0])];
  const output = formatWorkspaceContext({ target, capture, section: 'Observed PR changes and known references', rows, available: 25, anchors });
  assert.ok(Buffer.byteLength(output) <= 8192);
  assert.match(output, /example\/service#42/);
  assert.match(output, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(output, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(output, /Renamed.*old\.ts.*new\.ts/);
  assert.match(output, /Coverage limited/);
  assert.match(output, /base old\.ts:3/);
  assert.match(output, /head new\.ts:4/);
  assert.match(output, /Omitted relationship\/change records in this selection: [1-9]\d*/);
});
