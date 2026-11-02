// Archify's own full-colour generic node icons (Apache-2.0, drawn for
// Archify). 24px grid, 1.7px rounded strokes like the chosen card design,
// with a soft same-hue fill so the icon reads as colour rather than ink.
// Colour comes from the node's semantic theme tokens (--<tone>-stroke), so
// one SVG serves every preset in light and dark.
import { esc } from '../shared/utils.mjs';
import { iconSymbol } from '../shared/brand-marks.mjs';

// `f` marks accent shapes painted with the soft fill.
export const GENERIC_ICONS = Object.freeze({
  user: '<circle class="f" cx="12" cy="8" r="4"/><path class="f" d="M4.5 20.5v-1.2A4.8 4.8 0 0 1 9.3 14.5h5.4a4.8 4.8 0 0 1 4.8 4.8v1.2z"/>',
  users: '<circle class="f" cx="9" cy="8.5" r="3.5"/><path class="f" d="M2.8 20v-1a4.5 4.5 0 0 1 4.5-4.5h3.4a4.5 4.5 0 0 1 4.5 4.5v1z"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.6a4.5 4.5 0 0 1 3.2 4.3V20"/>',
  admin: '<circle class="f" cx="10" cy="8" r="4"/><path class="f" d="M3 20.5v-1.2A4.8 4.8 0 0 1 7.8 14.5h3.7"/><path class="f" d="M18 13.5l3 1.2v2.4c0 2-1.3 3.4-3 3.9-1.7-.5-3-1.9-3-3.9v-2.4z"/>',
  browser: '<rect class="f" x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 9h19"/><circle cx="5.5" cy="6.5" r=".6"/><circle cx="7.7" cy="6.5" r=".6"/><circle cx="9.9" cy="6.5" r=".6"/><path d="M7 13h6M7 16h10"/>',
  mobile: '<rect class="f" x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  desktop: '<rect class="f" x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 16.5V21"/>',
  server: '<rect class="f" x="3" y="3.5" width="18" height="7" rx="2"/><rect class="f" x="3" y="13.5" width="18" height="7" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
  service: '<path class="f" d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5M12 22V12"/>',
  api: '<rect class="f" x="3" y="3" width="18" height="18" rx="4"/><path d="M9.5 8.5 6.5 12l3 3.5M14.5 8.5l3 3.5-3 3.5"/>',
  function: '<rect class="f" x="3" y="3" width="18" height="18" rx="4"/><path d="M8 18l4.2-9.5M10.2 6.5c.7-.9 1.8-1 2.6-.2L17 18"/>',
  container: '<rect class="f" x="2.5" y="6" width="19" height="13" rx="2"/><path d="M6.5 6v13M10.5 6v13M14.5 6v13M18 6v13M2.5 4.5h19"/>',
  gateway: '<path class="f" d="M4 4h4v16H4zM16 4h4v16h-4z"/><path d="M2 12h20M18.5 9l3 3-3 3"/>',
  'load-balancer': '<circle class="f" cx="12" cy="5" r="2.5"/><circle class="f" cx="5" cy="19" r="2.5"/><circle class="f" cx="12" cy="19" r="2.5"/><circle class="f" cx="19" cy="19" r="2.5"/><path d="M12 7.5v9M10.5 7 6 16.6M13.5 7l4.5 9.6"/>',
  cloud: '<path class="f" d="M7 18.5h10.2a4.3 4.3 0 0 0 .6-8.56A6 6 0 0 0 6.3 9.2 4.7 4.7 0 0 0 7 18.5z"/>',
  cdn: '<circle class="f" cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9M12 3C9.5 5.6 8.3 8.6 8.3 12s1.2 6.4 3.7 9"/>',
  database: '<ellipse class="f" cx="12" cy="5.5" rx="8" ry="3"/><path class="f" d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cache: '<ellipse class="f" cx="10" cy="6" rx="7" ry="2.7"/><path class="f" d="M3 6v11c0 1.5 3.1 2.7 7 2.7"/><path d="M17 6v4M3 11.5c0 1.5 3.1 2.7 7 2.7"/><path class="f" d="M16.5 11.5 13 17h3.5l-1 4.5 4.5-6h-3.5z"/>',
  queue: '<rect class="f" x="2.5" y="7" width="5" height="10" rx="1.4"/><rect class="f" x="9.5" y="7" width="5" height="10" rx="1.4"/><path d="M16.5 7h3.6a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4h-3.6" stroke-dasharray="2 2"/>',
  stream: '<path class="f" d="M3 7h12l3 3-3 3H3z"/><path d="M3 17h15M15 14.5l3 2.5-3 2.5M18 4.5v0"/>',
  bucket: '<path class="f" d="M4 6.5l1.8 13a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.7L20 6.5"/><ellipse class="f" cx="12" cy="6.5" rx="8" ry="2.8"/>',
  file: '<path class="f" d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/>',
  search: '<circle class="f" cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
  scheduler: '<circle class="f" cx="12" cy="13" r="8"/><path d="M12 9v4l2.8 2M9 2.5h6"/>',
  auth: '<rect class="f" x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 15v2.5"/>',
  monitoring: '<rect class="f" x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="M6 15l3.5-4 3 2.5L18 8"/>',
  external: '<circle class="f" cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c-2.4 2.6-3.6 5.6-3.6 9s1.2 6.4 3.6 9M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9"/>',
  edge: '<circle class="f" cx="10.5" cy="12" r="7.5"/><path d="M3 12h15M10.5 4.5c1.9 2.1 2.8 4.6 2.8 7.5s-.9 5.4-2.8 7.5M10.5 4.5C8.6 6.6 7.7 9.1 7.7 12s.9 5.4 2.8 7.5M18.5 8l3 4-3 4"/>',
  firewall: '<rect class="f" x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M3 9.5h18M3 14.5h18M9 4.5v5M15 4.5v5M6 9.5v5M12 9.5v5M18 9.5v5M9 14.5v5M15 14.5v5"/>',
  'event-bus': '<rect class="f" x="2.5" y="10" width="19" height="4" rx="2"/><path d="M6 10V5.5M12 10V4M18 10V5.5M6 14v4.5M12 14v6M18 14v4.5"/>',
  worker: '<circle class="f" cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  job: '<rect class="f" x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7 9l1.6 1.6L11.5 7.7M14 9.2h3.5M7 15.5l1.6 1.6 2.9-2.9M14 15.7h3.5"/>',
  observability: '<path class="f" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  logs: '<rect class="f" x="4" y="3" width="16" height="18" rx="2"/><path d="M7.5 7.5h1M10.5 7.5h6M7.5 11.5h1M10.5 11.5h6M7.5 15.5h1M10.5 15.5h4"/>',
  tracing: '<rect class="f" x="3" y="4" width="9" height="3" rx="1.5"/><rect class="f" x="6" y="10.5" width="11" height="3" rx="1.5"/><rect class="f" x="10" y="17" width="11" height="3" rx="1.5"/><path d="M4.5 7v5h1.5M8 13.5v5h2"/>',
  identity: '<rect class="f" x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="2.2"/><path d="M5.3 16c.6-1.6 1.8-2.5 3.2-2.5s2.6.9 3.2 2.5M14.5 10h4.5M14.5 13.5h3"/>',
  key: '<circle class="f" cx="8" cy="15.5" r="4.5"/><path d="M11.2 12.3 20 3.5M16.5 7l2.5 2.5M14 9.5l2 2"/><circle cx="7" cy="16.5" r="1"/>',
  model: '<rect class="f" x="5" y="5" width="14" height="14" rx="2.5"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5M12 8.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
  notification: '<path class="f" d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  email: '<rect class="f" x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  payment: '<rect class="f" x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  analytics: '<path class="f" d="M4.5 20v-6h3.5v6zM10.25 20V9h3.5v11zM16 20V4.5h3.5V20z"/><path d="M3 20.5h18"/>',
  warehouse: '<path class="f" d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  cluster: '<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="2"/><circle cx="8" cy="15" r="2"/><circle cx="16" cy="15" r="2"/><path d="M10.9 9.7 9 13.3M13.1 9.7l1.9 3.6M10 15h4"/>',
  network: '<rect class="f" x="9" y="2.5" width="6" height="5" rx="1"/><rect class="f" x="2.5" y="16.5" width="6" height="5" rx="1"/><rect class="f" x="15.5" y="16.5" width="6" height="5" rx="1"/><path d="M12 7.5V12M5.5 16.5V12h13v4.5"/>',
  webhook: '<circle class="f" cx="12" cy="12" r="9"/><path d="M13 6.5 9 13h4l-2 4.5 5-6.5h-4z"/>',
});

const TONE_BY_TYPE = {
  frontend: 'frontend', backend: 'backend', database: 'database', cloud: 'cloud',
  security: 'security', messagebus: 'messagebus', external: 'external',
};

// Keyword rules matched against the node's label and id (sublabels describe
// behaviour, not the node). Each rule has a priority; the highest-priority
// match wins and ties go to list order. English terms use word boundaries;
// CJK terms are specific compounds so generic words (事件, 任务) never
// misfire — 「消费事件」 is not a stream.
export const KEYWORDS = Object.freeze([
  ['observability', 95, /\b(observability|o11y|telemetry)\b|可观测/],
  ['tracing', 95, /\b(tracing|traces?|spans?|apm)\b|链路追踪|追踪/],
  ['logs', 92, /\b(logs?|logging|log pipeline|audit log)\b|日志/],
  ['firewall', 92, /\b(waf|firewall|ddos|shield|guardrails?|fraud|risk)\b|防火墙/],
  ['load-balancer', 90, /\b(load ?balancers?|lb|alb|elb|nlb|haproxy)\b|负载均衡/],
  ['gateway', 90, /\b(gateway|gw|ingress|api gw|reverse proxy|proxy|bff)\b|网关|代理/],
  ['edge', 85, /\b(edge|pop|edge network)\b|边缘/],
  ['cdn', 88, /\b(cdn|cloudfront|static assets?)\b|内容分发/],
  ['event-bus', 90, /\b(event ?bus|event ?bridge|eventbridge|topics?|pub\/?sub|events?)\b|事件总线|消息总线|主题/],
  ['stream', 88, /\b(streams?|streaming|kinesis|firehose)\b|事件流|消息流|数据流/],
  ['queue', 88, /\b(queues?|sqs|mq|broker|dead.?letter|dlq)\b|队列/],
  ['webhook', 92, /\b(webhooks?|callbacks?|triggers?)\b|回调/],
  ['notification', 88, /\b(notif(y|ication|ications)|push|alerts?|alerting|pager)\b|通知|推送|告警/],
  ['email', 90, /\b(e-?mail|smtp|mailer|mail|gmail|inbox)\b|邮件|邮箱/],
  ['payment', 90, /\b(payments?|billing|checkout|invoice|wallet|psp)\b|支付|账单|计费|结算/],
  ['model', 90, /\b(llm|ml|ai|model|models|inference|embedding|embeddings|gpt|rag)\b|模型|推理|智能体|大模型/],
  ['analytics', 86, /\b(analytics|bi|report(s|ing)?|insights?)\b|分析|报表/],
  ['warehouse', 88, /\b(warehouse|data ?lake|lakehouse|olap)\b|数仓|数据湖|数据仓库/],
  ['key', 92, /\b(secrets?|kms|keys?|vault|certificates?|certs?|hsm)\b|密钥|证书|凭据/],
  ['identity', 90, /\b(identity|idp|sso|directory|iam|users? service|accounts?)\b|身份|账号|账户/],
  ['auth', 88, /\b(auth|authn|authz|oauth|oidc|login|jwt|permissions?|rbac)\b|认证|鉴权|登录|权限/],
  ['search', 88, /\b(search|index|indexer|elastic|retriever|retrieval|reranker|rerank)\b|搜索|检索|索引/],
  ['scheduler', 90, /\b(cron|scheduler|schedule|timer|scheduled)\b|定时|调度/],
  ['job', 86, /\b(jobs?|batch|etl|pipelines?|tasks?|workflows?|ci|cd|ci gates?|checks?|validators?|tests?)\b|批处理|作业/],
  ['worker', 88, /\b(workers?|consumers?|processors?|daemon)\b|消费者|工作节点/],
  ['monitoring', 86, /\b(monitor|monitoring|metrics|dashboards?|grafana|status)\b|监控|指标|仪表盘/],
  ['network', 86, /\b(vpc|vnet|subnets?|network|nat|vpn|peering|dns)\b|网络|专线|子网/],
  ['cluster', 84, /\b(cluster|clusters|k8s|kubernetes|eks|gke|aks|node pool)\b|集群/],
  ['container', 84, /\b(containers?|pods?|docker|ecs|fargate|runtime|sandbox)\b|容器/],
  ['function', 84, /\b(lambda|functions?|serverless|faas)\b|函数/],
  ['admin', 82, /\b(admins?|operators?|ops team|sre|on.?call)\b|管理员|运维/],
  ['users', 80, /\b(users|customers|clients|visitors|buyers|tenants|teams|people|members|audience)\b|用户群|客户群|用户们/],
  ['user', 78, /\b(user|customer|client|person|actor|visitor|buyer|developer)\b|用户|客户|访客/],
  ['mobile', 80, /\b(mobile|ios|android|app clients?|phone)\b|移动|手机|小程序/],
  ['desktop', 80, /\b(desktop|electron|workstation)\b|桌面/],
  ['browser', 80, /\b(browser|web ?app|spa|frontend|front-end|website|portal|ui)\b|浏览器|前端|网页|门户/],
  ['cache', 84, /\b(cache|caching|memcache|memcached|redis|valkey)\b|缓存/],
  ['bucket', 82, /\b(buckets?|s3|object stor(e|age)|blob|gcs|r2|assets|archives?|backups?)\b|对象存储|存储桶|归档|备份/],
  ['file', 76, /\b(file|files|documents?|csv|uploads?|prompts?|schemas?|templates?|artifacts?|md|html|json|zip)\b|文件|文档/],
  ['api', 74, /\b(api|apis|handlers?|routes?|endpoints?|rest|graphql|grpc|rpc|server actions?|backend)\b|接口|路由/],
  ['database', 76, /\b(db|database|sql|postgres|mysql|ledger|table|replicas?|primary)\b|数据库|主库|从库/],
  ['server', 70, /\b(server|vm|host|ec2|instance|machine)\b|服务器|主机/],
]);
const DEFAULT_BY_TYPE = {
  frontend: 'browser', backend: 'service', database: 'database', cloud: 'cloud',
  security: 'auth', messagebus: 'queue', external: 'user',
};

// The existing `icon` enum still steers the pick when authored.
const ICON_FIELD = {
  person: 'user', frontend: 'browser', backend: 'service', database: 'database',
  cloud: 'cloud', security: 'auth', messagebus: 'queue', external: 'external',
  calendar: 'scheduler', clock: 'scheduler',
};

// Keyword pick for a node, or null. Exported for tests and the icon audit.
export function keywordIconFor(c) {
  const text = `${c.label ?? ''} ${c.id ?? ''}`.replace(/[_-]+/g, ' ').toLowerCase();
  let best = null;
  for (const [name, priority, re] of KEYWORDS) {
    if (re.test(text) && (!best || priority > best.priority)) best = { name, priority };
  }
  return best?.name ?? null;
}

// Precedence: brand (handled by the card renderer) > authored `icon` >
// label/id keywords > the type's default.
export function genericIconFor(c) {
  if (c.icon && ICON_FIELD[c.icon]) return ICON_FIELD[c.icon];
  return keywordIconFor(c) || DEFAULT_BY_TYPE[c.type] || 'service';
}

export function renderGenericIcon(c, { x, y, size, symbols }) {
  const name = genericIconFor(c);
  const tone = TONE_BY_TYPE[c.type] || 'external';
  const symbolId = `gi-${name}`;
  if (!symbols.has(symbolId)) symbols.set(symbolId, iconSymbol(symbolId, [0, 0, 24, 24], GENERIC_ICONS[name]));
  return `<use aria-hidden="true" class="generic-icon gi-${tone}" data-generic-icon="${esc(name)}" href="#${symbolId}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}
