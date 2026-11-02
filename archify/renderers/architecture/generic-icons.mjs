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
  gateway: '<path class="f" d="M4 21V9.5L12 3l8 6.5V21z"/><path d="M9 21v-6h6v6M8 11h8"/>',
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
});

const TONE_BY_TYPE = {
  frontend: 'frontend', backend: 'backend', database: 'database', cloud: 'cloud',
  security: 'security', messagebus: 'messagebus', external: 'external',
};

// Ordered keyword rules: first match wins. Keywords are matched against the
// node's label and id (sublabels describe behaviour, not the node), case-insensitively; CJK terms are literal.
const KEYWORDS = [
  ['admin', /\b(admin|operator|ops team)\b|管理员|运维/],
  ['users', /\b(user groups|teams|tenants)\b|用户群|客户群/],
  ['user', /\b(users?|customers?|client|person|actor|visitor|buyer)\b|用户|客户|访客/],
  ['mobile', /\b(mobile|ios|android|app clients?|phone)\b|移动|手机|小程序/],
  ['browser', /\b(browser|web ?app|spa|frontend|front-end|website|portal|ui)\b|浏览器|前端|网页|门户/],
  ['desktop', /\b(desktop|electron|workstation)\b|桌面/],
  ['load-balancer', /\b(load ?balancer|lb|alb|elb|nlb|haproxy)\b|负载均衡/],
  ['gateway', /\b(gateway|ingress|api gw|proxy|edge)\b|网关|入口|代理/],
  ['cdn', /\b(cdn|cloudfront|edge cache|static assets?)\b|内容分发/],
  ['cache', /\b(cache|caching|memcache)\b|缓存/],
  ['queue', /\b(queue|sqs|mq|jobs? queue|broker)\b|队列/],
  ['stream', /\b(stream|topic|event bus|events|kinesis|pub\/?sub)\b|事件|消息流|主题/],
  ['bucket', /\b(bucket|s3|object stor(e|age)|blob|gcs|r2|assets|archives?)\b|对象存储|存储桶/],
  ['file', /\b(file|files|document|report|csv|logs?)\b|文件|文档|日志/],
  ['search', /\b(search|index|elastic)\b|搜索|检索/],
  ['scheduler', /\b(cron|scheduler|schedule|timer|batch)\b|定时|调度/],
  ['api', /\b(api|apis|handlers?|routes?|endpoints?|rest|graphql|grpc|rpc|server actions?|backend)\b|接口|路由/],
  ['function', /\b(lambda|function|functions|serverless|faas)\b|函数/],
  ['container', /\b(container|pod|k8s|cluster|ecs|fargate)\b|容器|集群/],
  ['auth', /\b(auth|oauth|identity|idp|sso|login|iam|jwt|vault|secrets?)\b|认证|鉴权|身份|登录/],
  ['monitoring', /\b(monitor|monitoring|metrics|observability|dashboard|alert|tracing)\b|监控|指标|告警/],
  ['worker', /\b(worker|workers|consumer|processor)\b|任务|消费者/],
  ['database', /\b(db|database|sql|postgres|mysql|warehouse|ledger|table)\b|数据库|数仓/],
  ['server', /\b(server|vm|host|ec2|instance|machine)\b|服务器|主机/],
];

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

export function genericIconFor(c) {
  if (c.icon && ICON_FIELD[c.icon]) return ICON_FIELD[c.icon];
  const text = `${c.label ?? ''} ${c.id ?? ''}`.toLowerCase();
  for (const [name, re] of KEYWORDS) {
    if (re.test(text)) return name === 'worker' ? 'scheduler' : name;
  }
  return DEFAULT_BY_TYPE[c.type] || 'service';
}

export function renderGenericIcon(c, { x, y, size, symbols }) {
  const name = genericIconFor(c);
  const tone = TONE_BY_TYPE[c.type] || 'external';
  const symbolId = `gi-${name}`;
  if (!symbols.has(symbolId)) symbols.set(symbolId, iconSymbol(symbolId, [0, 0, 24, 24], GENERIC_ICONS[name]));
  return `<use aria-hidden="true" class="generic-icon gi-${tone}" data-generic-icon="${esc(name)}" href="#${symbolId}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}
