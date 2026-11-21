import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisLocale, createTranslator, messagesFor } from '../overlay/i18n.mjs';
import { buildOverview } from '../overlay/overview.mjs';
import { architectureHandoff } from '../overlay/architecture-handoff.mjs';

test('analysis UI locale is explicit, falls back to English and preserves literal substitutions', () => {
  for (const input of [undefined, 'en', 'fr', 'zh', '__proto__']) {
    assert.equal(analysisLocale(input), 'en');
    assert.equal(createTranslator(messagesFor(input))('Code Analysis'), 'Code Analysis');
  }
  const tr = createTranslator(messagesFor('zh-CN'));
  assert.equal(tr('Code Analysis'), '架构诊断');
  assert.equal(tr('{count} error-level diagnostics still present', { count: 3 }), '仍有 3 项错误级发现');
  assert.equal(tr('Unknown {name}', { name: '$&<source>' }), 'Unknown $&<source>');
});

test('architecture handoff retains the shared reading order and coverage limits without declaring runtime impact', () => {
  const repository = { language: 'ts', snapshotId: 'a'.repeat(64) };
  const module = (id, loc, fanIn) => ({ id, path: id, files: 2, loc, fanIn, fanOut: 1, entry: [] });
  const graph = { repository, modules: [module('small', 10, 2), module('large', 90, 0)], edges: [],
    excluded: { roles: ['test'], files: 4 }, unresolved: { unknown: 2, opaque: 1 } };
  const overview = buildOverview({ graph, facts: { files: [], parse_errors: [{ path: 'bad.ts' }] }, unmapped: graph.modules,
    run: { rules: ['coupling/cycle'], otherLanguages: [{ adapter: 'py', files: 3 }] } });
  assert.deepEqual(overview.investigation.architecture.hotspots.map(m => m.id), ['large', 'small']);
  const en = architectureHandoff({ overview, repository, locale: 'en' });
  assert.match(en, /Excluded by role: 4/);
  assert.match(en, /Parse failures: 1/);
  assert.match(en, /Unresolved dependency records: 3/);
  assert.match(en, /Other languages not analyzed: py: 3/);
  assert.ok(en.indexOf('- large') < en.indexOf('- small'));
  assert.match(en, /does not determine runtime dispatch/);
  assert.match(en, /verify current source before editing/i);
  const zh = architectureHandoff({ overview, repository, locale: 'zh-CN' });
  assert.match(zh, /整仓架构诊断简报/);
  assert.match(zh, /解析失败：1/);
  assert.match(zh, /运行时分派/);
  assert.match(zh, new RegExp(repository.snapshotId));
});
