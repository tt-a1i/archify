import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIO_RECIPES,
  detectGuideLanguage,
  listScenarioRecipes,
  publicGuideData,
  recommendScenario,
} from '../recipes/scenarios.mjs';

test('guide: exposes 12 unique recipes across every diagram type, including repair', () => {
  assert.equal(SCENARIO_RECIPES.length, 12);
  assert.equal(new Set(SCENARIO_RECIPES.map((recipe) => recipe.id)).size, 12);
  assert.deepEqual(
    Object.fromEntries(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].map((type) => [
      type,
      SCENARIO_RECIPES.filter((recipe) => recipe.type === type).length,
    ])),
    { architecture: 3, workflow: 3, sequence: 2, dataflow: 2, lifecycle: 2 },
  );
});

test('guide: every recipe has complete English and Chinese decision copy', () => {
  for (const recipe of SCENARIO_RECIPES) {
    assert.match(recipe.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(recipe.signals.length >= 8, recipe.id);
    assert.ok(['classic', 'signal-flow', 'blueprint', 'editorial'].includes(recipe.presentation.preset), recipe.id);
    for (const lang of ['en', 'zh']) {
      const copy = recipe[lang];
      assert.ok(copy.title.length >= 4, `${recipe.id}.${lang}.title`);
      for (const field of ['question', 'summary', 'useWhen', 'avoidWhen', 'prompt']) {
        assert.ok(copy[field].length > 10, `${recipe.id}.${lang}.${field}`);
      }
      assert.equal(copy.include.length, 4, `${recipe.id}.${lang}.include`);
    }
  }
});

test('guide: language detection and localization are deterministic', () => {
  assert.equal(detectGuideLanguage('show an API request'), 'en');
  assert.equal(detectGuideLanguage('展示 API 请求'), 'zh');
  assert.equal(listScenarioRecipes('zh')[0].title, '系统总览');
  assert.equal(listScenarioRecipes('en')[0].title, 'System overview');
});

test('guide: representative scenarios map to specialized recipes', () => {
  const cases = [
    ['Show an API request with Redis cache miss', 'api-request'],
    ['Show CI/CD build deploy rollback', 'delivery-workflow'],
    ['展示 Kafka topic 消费者组和死信队列', 'event-stream'],
    ['梳理 ETL 数仓 PII 数据血缘', 'data-lineage'],
    ['deployment lifecycle approval rollback state', 'deployment-lifecycle'],
    ['agent tool call approval gate MCP', 'agent-tool-call'],
    ['Show a system overview via an architecture diagram', 'system-overview'],
    ['Draw deployment topology with named boundary crossings', 'deployment-ownership'],
    ['Explain an API request via a webhook callback', 'async-roundtrip'],
  ];

  for (const [query, expected] of cases) {
    assert.equal(recommendScenario(query).recommendation.id, expected, query);
  }
});

test('guide: repair questions select actionable repair guidance in both languages', () => {
  const queries = [
    'viewport overflow', 'why does it still overflow', 'scrollHeight', 'scrollWidth',
    'overlap', 'label overlap', 'edge through node', 'crossing', 'via',
    'how do via waypoints work', 'layout repair', 'which fix order', 'repair order',
    'architecture label overlap', 'workflow layout repair', 'sequence viewport overflow',
    'dataflow edge through node', 'lifecycle layout repair',
    '视口溢出', '为什么还是溢出', '滚动高度', '滚动宽度', '节点重叠', '标签重叠',
    '连线穿过节点', '连线交叉', '途经点', '布局修复', '修复顺序', '架构图标签重叠',
  ];
  for (const query of queries) {
    const result = recommendScenario(query);
    assert.equal(result.recommendation.id, 'layout-repair', query);
    assert.notEqual(result.confidence, 'low', query);
    assert.ok(result.matchedSignals.length > 0, query);
  }
});

test('guide: repair recipe supports exact selection and explicit language overrides', () => {
  for (const lang of ['en', 'zh']) {
    const exact = recommendScenario('layout-repair', { lang });
    assert.equal(exact.recommendation.id, 'layout-repair');
    assert.equal(exact.confidence, 'high');
    assert.equal(exact.lang, lang);
    assert.equal(recommendScenario('viewport overflow', { lang }).recommendation.prompt, exact.recommendation.prompt);
    assert.equal(recommendScenario('视口溢出', { lang }).recommendation.prompt, exact.recommendation.prompt);
  }
});

test('guide: exact ids win and unknown questions fall back honestly', () => {
  const exact = recommendScenario('incident-runbook');
  assert.equal(exact.recommendation.id, 'incident-runbook');
  assert.equal(exact.confidence, 'high');

  const unknown = recommendScenario('make it delightful');
  assert.equal(unknown.recommendation.id, 'system-overview');
  assert.equal(unknown.confidence, 'low');
  assert.deepEqual(unknown.matchedSignals, []);
});

test('guide: public data includes both languages and weighted signals', () => {
  const data = publicGuideData();
  assert.equal(data.length, 12);
  for (const recipe of data) {
    assert.ok(recipe.en.title);
    assert.ok(recipe.zh.title);
    assert.ok(recipe.proof, `${recipe.id}: verified proof is required`);
    assert.ok(recipe.signals.every(([signal, weight]) => typeof signal === 'string' && weight > 0));
  }
});
