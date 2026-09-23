import { DIAGRAM_TYPE_LABELS } from '../../../scripts/site-copy.mjs';

export const CASES = [
  {
    id: 'agent-tool-call',
    type: 'workflow',
    input: 'agent-tool-call.workflow.json',
    output: 'agent-tool-call.workflow.html',
    focus: 'planner',
    view: 'happy-path',
    accent: '#67e8f9',
    featured: true,
    titleEn: 'Agent Tool Call',
    titleZh: '智能体工具调用',
    descriptionEn: 'Four consolidated lanes trace a policy-aware agent loop across user interaction, agent runtime, policy and recovery, and tool execution with evidence.',
    descriptionZh: '四条整合泳道呈现策略感知的智能体闭环：用户交互、智能体运行时、策略与恢复，以及带证据的工具执行。',
  },
  {
    id: 'deployment-ownership',
    type: 'architecture',
    input: 'production-deployment.architecture.json',
    output: 'production-deployment.architecture.html',
    focus: 'gateway',
    view: 'request-boundary',
    accent: '#38bdf8',
    titleEn: 'Production Deployment Ownership',
    titleZh: '生产部署与归属',
    descriptionEn: 'Regions, private networks, workload owners, state, cross-region replication, audit evidence, and named boundary crossings.',
    descriptionZh: '展示区域、私有网络、工作负载归属、状态、跨区复制、审计证据和明确的边界穿越。',
  },
  {
    id: 'cache-miss',
    type: 'sequence',
    input: 'cache-miss-request.sequence.json',
    output: 'cache-miss.sequence.html',
    focus: 'redis',
    view: 'cache-fallback',
    accent: '#c4b5fd',
    titleEn: 'Cache Miss Request',
    titleZh: '缓存未命中请求',
    descriptionEn: 'A time-ordered request path covering authentication, cache fallback, persistence, return traffic, and async tracing.',
    descriptionZh: '按时间展开鉴权、缓存回退、持久化、返回流量与异步追踪。',
  },
  {
    id: 'delivery-workflow',
    type: 'workflow',
    input: 'release-delivery.workflow.json',
    output: 'release-delivery.workflow.html',
    focus: 'approval',
    view: 'approval-to-production',
    accent: '#34d399',
    titleEn: 'Release Delivery Workflow',
    titleZh: '研发交付流程',
    descriptionEn: 'A change moves through reproducible build, blocking gates, human approval, canary verification, communication, and rollback.',
    descriptionZh: '一次变更依次经过可复现构建、阻断检查、人工审批、金丝雀验证、沟通和回滚。',
  },
  {
    id: 'incident-runbook',
    type: 'workflow',
    input: 'incident-response.workflow.json',
    output: 'incident-response.workflow.html',
    focus: 'triage',
    view: 'mitigate-and-verify',
    accent: '#fb7185',
    titleEn: 'Incident Response Runbook',
    titleZh: '事故处置 Runbook',
    descriptionEn: 'Detection, incident command, mitigation, stakeholder communication, escalation, rollback, and recovery evidence.',
    descriptionZh: '覆盖发现、事故指挥、缓解、干系人沟通、升级、回滚和恢复证据。',
  },
  {
    id: 'product-analytics',
    type: 'dataflow',
    input: 'product-analytics.dataflow.json',
    output: 'product-analytics.dataflow.html',
    focus: 'consent',
    view: 'consent-boundary',
    accent: '#f6c453',
    titleEn: 'Product Analytics',
    titleZh: '产品分析数据流',
    descriptionEn: 'Events move through consent, streaming, PII isolation, warehouse sync, and governed downstream consumers.',
    descriptionZh: '事件依次经过用户同意、流处理、PII 隔离、数仓同步和受治理的下游消费者。',
  },
  {
    id: 'async-roundtrip',
    type: 'sequence',
    input: 'async-job-roundtrip.sequence.json',
    output: 'async-job-roundtrip.sequence.html',
    focus: 'queue',
    view: 'work-and-retry',
    accent: '#a78bfa',
    titleEn: 'Async Job Roundtrip',
    titleZh: '异步任务往返链路',
    descriptionEn: 'A fast acknowledgement leads into durable queueing, background work, retry, final-state storage, webhook, and polling fallback.',
    descriptionZh: '快速确认后进入持久队列、后台处理、重试、终态存储、Webhook 和轮询回退。',
  },
  {
    id: 'event-stream',
    type: 'dataflow',
    input: 'event-stream.dataflow.json',
    output: 'event-stream.dataflow.html',
    focus: 'orders',
    view: 'order-transit',
    accent: '#fbbf24',
    titleEn: 'Order Event-stream Topology',
    titleZh: '订单事件流拓扑',
    descriptionEn: 'Named producers, partitioned topics, consumer groups, idempotent state, dead letters, operator ownership, and controlled replay.',
    descriptionZh: '展示命名生产者、分区 Topic、消费者组、幂等状态、死信、负责人和受控重放。',
  },
  {
    id: 'agent-run',
    type: 'lifecycle',
    input: 'agent-run.lifecycle.json',
    output: 'agent-run.lifecycle.html',
    focus: 'approval',
    view: 'main-lifecycle',
    accent: '#fb7185',
    titleEn: 'Agent Run Lifecycle',
    titleZh: '智能体运行生命周期',
    descriptionEn: 'Planning, execution, review, human approval, retry, cancellation, and terminal outcomes in one state model.',
    descriptionZh: '用一套状态模型表达规划、执行、复核、人工审批、重试、取消和终态。',
  },
  {
    id: 'deployment-lifecycle',
    type: 'lifecycle',
    input: 'deployment-release.lifecycle.json',
    output: 'deployment-release.lifecycle.html',
    focus: 'live',
    view: 'rollback-outcomes',
    accent: '#f472b6',
    titleEn: 'Deployment Release Lifecycle',
    titleZh: '部署发布生命周期',
    descriptionEn: 'The deployment object moves through build, verification, approval, promotion, health pause, rollback, and explicit terminal outcomes.',
    descriptionZh: '部署对象经过构建、验证、审批、晋级、健康暂停、回滚和明确终态。',
  },
  {
    id: 'web-app',
    type: 'architecture',
    input: 'web-app.architecture.json',
    output: 'web-app.architecture.html',
    focus: 'api',
    view: 'request-path',
    accent: '#6ee7b7',
    titleEn: 'Three-tier Web App',
    titleZh: '三层 Web 应用',
    descriptionEn: 'A classic AWS web stack with edge delivery, authentication, API services, cache, persistence, and background work.',
    descriptionZh: '经典 AWS Web 栈：边缘分发、鉴权、API 服务、缓存、持久化与后台任务。',
  },
  {
    id: 'orders',
    type: 'erd',
    input: 'orders.erd.json',
    output: 'orders.erd.html',
    focus: 'order',
    view: 'checkout',
    accent: '#f472b6',
    titleEn: 'Order Management Schema',
    titleZh: '订单管理表结构',
    descriptionEn: 'Six tables with their complete column lists, primary, foreign, and unique keys, crow-foot cardinality at both ends, and one optional non-identifying payment link.',
    descriptionZh: '六张表及其完整字段清单、主键/外键/唯一键标记、两端鸦爪基数，以及一条可选的非标识性支付连线。',
  },
];

const TYPE_ACCENTS = {
  architecture: '#0891b2',
  workflow: '#047857',
  sequence: '#6d28d9',
  dataflow: '#b45309',
  lifecycle: '#be123c',
  erd: '#0f766e',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

export function renderCard(entry, index) {
  const classes = `showcase-card${entry.featured ? ' is-featured' : ''}`;
  const mode = entry.animation === 'trace' ? `${entry.visualPreset} + trace` : entry.visualPreset;
  const artifact = `gallery/artifacts/${entry.output}`;
  const source = `gallery/sources/${entry.input}`;
  const focusedArtifact = entry.view
    ? `${artifact}?present=1&play=1#view=${encodeURIComponent(entry.view)}`
    : `${artifact}#focus=${encodeURIComponent(entry.focus)}`;
  const exploreEn = entry.view ? 'Play named chapter ↗' : 'Explore focus ↗';
  const exploreZh = entry.view ? '播放命名章节 ↗' : '探索聚焦路径 ↗';
  const engineeringProof = entry.engineeringProfile
    ? `\n              <div class="engineering-proof" aria-label="Engineering profile validation"><span>Engineering profile</span><strong>${esc(entry.engineeringProfile.replaceAll('-', ' ').toUpperCase())} · PASS</strong></div>`
    : '';
  return `          <article class="${classes}" id="proof-${esc(entry.id)}" data-proof-id="${esc(entry.id)}" data-type="${esc(entry.type)}" style="--accent:${esc(TYPE_ACCENTS[entry.type] || entry.accent)}">
            <header class="card-header">
              <div class="card-index">${String(index + 1).padStart(2, '0')}</div>
              <div class="card-title-wrap">
                <div class="card-kicker">${esc(DIAGRAM_TYPE_LABELS.en[entry.type])} / ${entry.nodeCount} nodes${entry.viewCount ? ` / ${entry.viewCount} views · play` : ''}</div>
                <h3 class="card-title" data-en="${esc(entry.titleEn)}" data-zh="${esc(entry.titleZh)}">${esc(entry.titleEn)}</h3>
              </div>
              <div class="card-mode">${esc(mode)}</div>
            </header>
            <div class="preview-shell">
              <div class="live-flag">Live artifact</div>
              <iframe src="${esc(artifact)}?embed=1&amp;theme=dark" data-src-base="${esc(artifact)}" title="${esc(entry.titleEn)} live Archify preview" loading="${entry.featured ? 'eager' : 'lazy'}"></iframe>
            </div>
            <div class="card-body">
              <p class="card-description" data-en="${esc(entry.descriptionEn)}" data-zh="${esc(entry.descriptionZh)}">${esc(entry.descriptionEn)}</p>${engineeringProof}
              <div class="receipt" aria-label="Validation receipt">
                <div class="receipt-cell"><span class="receipt-label">Artifact</span><span class="receipt-value ok">${entry.checksPassed}/${entry.checkCount} pass</span></div>
                <div class="receipt-cell"><span class="receipt-label">Composition</span><span class="receipt-value ${entry.composition.status === 'pass' ? 'ok' : ''}" title="${entry.composition.metrics.properCrossings} crossings · ${entry.composition.metrics.containerBorderRuns} border runs · ${entry.composition.metrics.microSegmentCount} micro segments · ${entry.composition.metrics.shortInteriorSegmentCount} cramped turns">${esc(entry.composition.profile.toUpperCase())} · ${esc(entry.composition.status.toUpperCase())}</span></div>
                <div class="receipt-cell"><span class="receipt-label">Graph</span><span class="receipt-value">${entry.nodeCount}N · ${entry.edgeCount}E</span></div>
                <div class="receipt-cell"><span class="receipt-label">SHA-256</span><span class="receipt-value" title="${esc(entry.artifactSha256)}">${esc(entry.artifactSha256.slice(0, 12))}</span></div>
              </div>
              <div class="card-actions">
                <a class="card-link primary" href="${esc(focusedArtifact)}" target="_blank" rel="noopener" data-en="${esc(exploreEn)}" data-zh="${esc(exploreZh)}">${esc(exploreEn)}</a>
                <a class="card-link" href="${esc(artifact)}" target="_blank" rel="noopener" data-en="Full artifact" data-zh="完整成品">Full artifact</a>
                <a class="card-link" href="${esc(source)}" target="_blank" rel="noopener">JSON IR</a>
                <a class="card-link create-link" href="start.html?type=${esc(entry.type)}&amp;source=gallery" data-en="Create this type" data-zh="按此类型开始">Create this type</a>
              </div>
            </div>
          </article>`;
}
