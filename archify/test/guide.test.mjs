import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIO_RECIPES,
  detectGuideLanguage,
  listScenarioRecipes,
  publicGuideData,
  recommendScenario,
} from '../recipes/scenarios.mjs';

test('guide: exposes 11 unique recipes across every diagram type', () => {
  assert.equal(SCENARIO_RECIPES.length, 11);
  assert.equal(new Set(SCENARIO_RECIPES.map((recipe) => recipe.id)).size, 11);
  assert.deepEqual(
    Object.fromEntries(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].map((type) => [
      type,
      SCENARIO_RECIPES.filter((recipe) => recipe.type === type).length,
    ])),
    { architecture: 2, workflow: 3, sequence: 2, dataflow: 2, lifecycle: 2 },
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
  ];

  for (const [query, expected] of cases) {
    assert.equal(recommendScenario(query).recommendation.id, expected, query);
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
  assert.equal(data.length, 11);
  for (const recipe of data) {
    assert.ok(recipe.en.title);
    assert.ok(recipe.zh.title);
    assert.ok(recipe.proof, `${recipe.id}: verified proof is required`);
    assert.ok(recipe.signals.every(([signal, weight]) => typeof signal === 'string' && weight > 0));
  }
});
