#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillRoot = path.join(repoRoot, 'archify');
const outputRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'docs'));
const artifactsRoot = path.join(outputRoot, 'gallery', 'artifacts');
const sourcesRoot = path.join(outputRoot, 'gallery', 'sources');
const templatePath = path.join(__dirname, 'gallery-template.html');
const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));

const CASES = [
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
    descriptionEn: 'A policy-aware agent loop with planning, approval, tool execution, exception handling, and observability lanes.',
    descriptionZh: '包含规划、审批、工具执行、异常处理与可观测泳道的策略感知智能体闭环。',
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
];

const SHAPES = {
  architecture: ['components', 'connections'],
  workflow: ['nodes', 'edges'],
  sequence: ['participants', 'messages'],
  dataflow: ['nodes', 'flows'],
  lifecycle: ['states', 'transitions'],
};

const TYPE_LABELS = {
  architecture: 'Architecture',
  workflow: 'Workflow',
  sequence: 'Sequence',
  dataflow: 'Data flow',
  lifecycle: 'Lifecycle',
};

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function renderCard(entry, index) {
  const classes = `showcase-card${entry.featured ? ' is-featured' : ''}`;
  const mode = entry.animation === 'trace' ? `${entry.visualPreset} + trace` : entry.visualPreset;
  const artifact = `gallery/artifacts/${entry.output}`;
  const source = `gallery/sources/${entry.input}`;
  const focusedArtifact = entry.view
    ? `${artifact}?present=1&play=1#view=${encodeURIComponent(entry.view)}`
    : `${artifact}#focus=${encodeURIComponent(entry.focus)}`;
  const exploreEn = entry.view ? 'Play named chapter ↗' : 'Explore focus ↗';
  const exploreZh = entry.view ? '播放命名章节 ↗' : '探索聚焦路径 ↗';
  return `          <article class="${classes}" id="proof-${esc(entry.id)}" data-proof-id="${esc(entry.id)}" data-type="${esc(entry.type)}" style="--accent:${esc(entry.accent)}">
            <header class="card-header">
              <div class="card-index">${String(index + 1).padStart(2, '0')}</div>
              <div class="card-title-wrap">
                <div class="card-kicker">${esc(TYPE_LABELS[entry.type])} / ${entry.nodeCount} nodes${entry.viewCount ? ` / ${entry.viewCount} views · play` : ''}</div>
                <h3 class="card-title" data-en="${esc(entry.titleEn)}" data-zh="${esc(entry.titleZh)}">${esc(entry.titleEn)}</h3>
              </div>
              <div class="card-mode">${esc(mode)}</div>
            </header>
            <div class="preview-shell">
              <div class="live-flag">Live artifact</div>
              <iframe src="${esc(artifact)}?embed=1&amp;theme=dark" data-src-base="${esc(artifact)}" title="${esc(entry.titleEn)} live Archify preview" loading="${entry.featured ? 'eager' : 'lazy'}"></iframe>
            </div>
            <div class="card-body">
              <p class="card-description" data-en="${esc(entry.descriptionEn)}" data-zh="${esc(entry.descriptionZh)}">${esc(entry.descriptionEn)}</p>
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
              </div>
            </div>
          </article>`;
}

fs.rmSync(artifactsRoot, { recursive: true, force: true });
fs.rmSync(sourcesRoot, { recursive: true, force: true });
fs.mkdirSync(artifactsRoot, { recursive: true });
fs.mkdirSync(sourcesRoot, { recursive: true });

const entries = [];
for (const item of CASES) {
  const inputPath = path.join(skillRoot, 'examples', item.input);
  const sourceBuffer = fs.readFileSync(inputPath);
  const source = JSON.parse(sourceBuffer.toString('utf8'));
  const artifactPath = path.join(artifactsRoot, item.output);
  const sourcePath = path.join(sourcesRoot, item.input);

  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', item.type, `render-${item.type}.mjs`),
    inputPath,
    artifactPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.copyFileSync(inputPath, sourcePath);

  const checkOutput = execFileSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'check-render-output.mjs'),
    artifactPath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const validation = JSON.parse(checkOutput);
  const artifactBuffer = fs.readFileSync(artifactPath);
  const [nodeKey, edgeKey] = SHAPES[item.type];
  const checksPassed = validation.checks.filter((check) => check.ok).length;

  entries.push({
    ...item,
    title: source.meta.title,
    subtitle: source.meta.subtitle || '',
    schemaVersion: source.schema_version,
    visualPreset: source.meta.visual_preset || 'classic',
    animation: source.meta.animation || 'static',
    viewCount: Array.isArray(source.meta.views) ? source.meta.views.length : 0,
    viewIds: Array.isArray(source.meta.views) ? source.meta.views.map((view) => view.id) : [],
    nodeCount: Array.isArray(source[nodeKey]) ? source[nodeKey].length : 0,
    edgeCount: Array.isArray(source[edgeKey]) ? source[edgeKey].length : 0,
    artifactBytes: artifactBuffer.byteLength,
    sourceBytes: sourceBuffer.byteLength,
    artifactSha256: digest(artifactBuffer),
    sourceSha256: digest(sourceBuffer),
    checkCount: validation.checks.length,
    checksPassed,
    checks: validation.checks.map((check) => ({ name: check.name, ok: check.ok })),
    composition: validation.composition,
  });
}

const manifest = {
  schemaVersion: 1,
  generator: 'scripts/build-gallery.mjs',
  archifyVersion: packageJson.version,
  entryCount: entries.length,
  checkCount: entries.reduce((sum, entry) => sum + entry.checkCount, 0),
  entries: entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    subtitle: entry.subtitle,
    input: `gallery/sources/${entry.input}`,
    artifact: `gallery/artifacts/${entry.output}`,
    focus: entry.focus,
    view: entry.view || null,
    viewCount: entry.viewCount,
    viewIds: entry.viewIds,
    guidedPlayback: entry.viewCount > 0,
    schemaVersion: entry.schemaVersion,
    visualPreset: entry.visualPreset,
    animation: entry.animation,
    nodeCount: entry.nodeCount,
    edgeCount: entry.edgeCount,
    artifactBytes: entry.artifactBytes,
    artifactSha256: entry.artifactSha256,
    sourceBytes: entry.sourceBytes,
    sourceSha256: entry.sourceSha256,
    checks: entry.checks,
    composition: entry.composition,
  })),
};

const manifestJson = JSON.stringify(manifest, null, 2);
fs.writeFileSync(path.join(outputRoot, 'gallery', 'manifest.json'), `${manifestJson}\n`);

const replacements = {
  '[[ARCHIFY_VERSION]]': packageJson.version,
  '[[ENTRY_COUNT]]': String(manifest.entryCount),
  '[[CHECK_COUNT]]': String(manifest.checkCount),
  '[[GALLERY_CARDS]]': entries.map(renderCard).join('\n'),
  '[[MANIFEST_JSON]]': manifestJson.replace(/<\/script/gi, '<\\/script'),
};

let html = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  html = html.split(placeholder).join(value);
}
if (/\[\[[A-Z0-9_]+\]\]/.test(html)) {
  throw new Error('Gallery template contains unresolved placeholders');
}
fs.writeFileSync(path.join(outputRoot, 'gallery.html'), html);

console.log(`gallery ${manifest.entryCount} artifacts / ${manifest.checkCount} checks`);
console.log(path.join(outputRoot, 'gallery.html'));
