import assert from 'node:assert/strict';
import test from 'node:test';
import { GENERIC_ICONS, KEYWORDS, genericIconFor, keywordIconFor } from '../archify/renderers/architecture/generic-icons.mjs';
import { AUTO_BRAND_TERMS, autoBrandIdFor, findBrandMark } from '../archify/renderers/shared/brand-marks.mjs';

test('every keyword rule names a drawn icon and each meaning has its own icon', () => {
  for (const [name, priority, re] of KEYWORDS) {
    assert.ok(GENERIC_ICONS[name], `${name} has a symbol`);
    assert.equal(typeof priority, 'number');
    assert.ok(re instanceof RegExp);
  }
  const bodies = Object.values(GENERIC_ICONS);
  assert.equal(new Set(bodies).size, bodies.length, 'no two icon names share a drawing');
  for (const name of ['gateway', 'edge', 'firewall', 'event-bus', 'worker', 'job', 'scheduler', 'observability',
    'monitoring', 'logs', 'tracing', 'auth', 'identity', 'key', 'search', 'model', 'notification', 'email',
    'payment', 'analytics', 'warehouse', 'container', 'cluster', 'network', 'webhook', 'users']) {
    assert.ok(GENERIC_ICONS[name], `${name} icon exists`);
  }
});

test('english labels pick the closest meaning, by priority', () => {
  const cases = {
    'Global Edge': 'edge', 'API Gateway': 'gateway', 'Edge Gateway': 'gateway', 'Cloud WAF': 'firewall',
    'Event Bus': 'event-bus', 'Order Events': 'event-bus', 'Clickstream': 'service', 'Kinesis stream': 'stream',
    Workers: 'worker', 'Nightly cron': 'scheduler', 'Batch jobs': 'job', Observability: 'observability',
    Metrics: 'monitoring', 'Log pipeline': 'logs', 'Distributed tracing': 'tracing', 'Identity Provider': 'identity',
    'Auth service': 'auth', 'Secrets manager': 'key', 'Search index': 'search', 'LLM': 'model',
    Notifications: 'notification', 'Email sender': 'email', Payments: 'payment', 'Product analytics': 'analytics',
    'Data warehouse': 'warehouse', 'API pods': 'container', 'Node cluster': 'cluster', VPC: 'network',
    Webhooks: 'webhook', Customers: 'users', Customer: 'user', 'Customer Portal': 'browser',
    'Route handlers': 'api', 'Audit Archive': 'bucket', 'Session cache': 'cache',
  };
  for (const [label, icon] of Object.entries(cases)) assert.equal(genericIconFor({ type: 'backend', label }), icon, label);
});

test('chinese labels map by specific compounds and never misfire', () => {
  const cases = {
    'API 网关': 'gateway', 事件总线: 'event-bus', 消息队列: 'queue', 事件流: 'stream', 定时任务: 'scheduler',
    链路追踪: 'tracing', 日志: 'logs', 可观测平台: 'observability', 支付服务: 'payment', 用户: 'user',
    用户群: 'users', 密钥管理: 'key', 大模型: 'model', 邮件通知: 'email', 数据仓库: 'warehouse', 防火墙: 'firewall',
  };
  for (const [label, icon] of Object.entries(cases)) assert.equal(genericIconFor({ type: 'backend', label }), icon, label);
  assert.equal(keywordIconFor({ label: '消费事件' }), null, '「消费事件」 is not a stream');
  assert.equal(genericIconFor({ type: 'backend', label: '消费事件' }), 'service');
  assert.equal(keywordIconFor({ label: '订单任务' }), null, 'plain 任务 is not a job');
});

test('word boundaries and the precedence of icon over keywords over type', () => {
  assert.equal(keywordIconFor({ label: 'Mailroom pipeline' }), 'job', 'mail inside a word does not match');
  assert.equal(keywordIconFor({ label: 'Lobby' }), null, 'lb inside a word does not match');
  assert.equal(genericIconFor({ type: 'backend', label: 'Event Bus', icon: 'clock' }), 'scheduler');
  assert.equal(genericIconFor({ type: 'database', label: 'Orders' }), 'database');
  assert.equal(genericIconFor({ type: 'backend', label: 'x', id: 'event_bus' }), 'event-bus', 'ids count too');
});

test('brands auto-apply only when the label or id names them', () => {
  const cases = {
    Kafka: 'apache-kafka', 'K8s cluster': 'kubernetes', Prometheus: 'prometheus', Grafana: 'grafana',
    Datadog: 'datadog', Auth0: 'auth0', Okta: 'okta', 'Cloudflare WAF': 'cloudflare', Nginx: 'nginx',
    Elasticsearch: 'elasticsearch', 'OpenAI API': 'openai', 'Postgres primary': 'postgresql',
  };
  for (const [label, id] of Object.entries(cases)) assert.equal(autoBrandIdFor({ label }), id, label);
  assert.equal(autoBrandIdFor({ label: 'x', id: 'kafka_cluster' }), 'apache-kafka');
  for (const label of ['Go service', 'X feed', 'Render worker', 'Vault', 'Event Bus', 'Sparkle', 'Okay', 'Linear']) {
    assert.equal(autoBrandIdFor({ label }), null, label);
  }
  for (const id of Object.keys(AUTO_BRAND_TERMS)) assert.ok(findBrandMark(id), `${id} is a catalog brand`);
});
