import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';

export const PIN = '6fd8bbe723677254ff1130a1a416988b8b3e285e';
export const SOURCE_HASH = 'b17fa02df4a8584d230ad1014ef3578c2f141795681a8c682a644cf7eaf9d1f2';
export const INDICES = Object.freeze([2077, 2078, 2079, 2082, 2083, 2084]);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

// A fixed-record audit, not an importer, parser of slices, or inferred task graph.
export function audit(rawBytes, selection) {
  if (digest(rawBytes) !== SOURCE_HASH) fail('Original fixture digest mismatch');
  const raw = JSON.parse(rawBytes.toString('utf8'));
  if (selection.version !== 1 || selection.kind !== 'explicit-fixed-raw-record-selection' || !isDeepStrictEqual(selection.indices, INDICES)) fail('Expected the six explicit raw indices in original order');
  const selected = INDICES.map(index => ({ index, event: raw.traceEvents[index] }));
  if (!isDeepStrictEqual(selection.events, selected)) fail('Selected fields differ from exact original records');
  const from = selected.find(record => record.index === selection.link?.from);
  const to = selected.find(record => record.index === selection.link?.to);
  if (!from || !to || from.event.ph !== 's' || to.event.ph !== 'f') fail('Recorded link must run from selected s to selected f');
  const key = event => JSON.stringify([event.cat, event.name, event.id]);
  if (key(from.event) !== key(to.event)) fail('Flow category, name and ID must agree');
  const allMatches = raw.traceEvents.map((event, index) => ({ event, index })).filter(record => ['s', 't', 'f'].includes(record.event.ph) && key(record.event) === key(from.event));
  if (!isDeepStrictEqual(allMatches.map(record => record.index), [from.index, to.index])) fail('Selected key is not exactly one s/f pair in the complete input');
  if (from.event.pid !== to.event.pid || from.event.tid === to.event.tid || to.event.ts <= from.event.ts) fail('Expected the fixed cross-thread forward link');
  const phases = {};
  for (const event of raw.traceEvents) phases[event.ph] = (phases[event.ph] ?? 0) + 1;
  return { version: 1, kind: 'fixed-record-flow-evidence', origin: { repository: 'https://github.com/catapult-project/catapult', commit: PIN, path: 'tracing/test_data/flow.json', sha256: SOURCE_HASH, bytes: rawBytes.length },
    provenance: 'Upstream published historical fixture; collection not independently reproduced; no new execution measurement.',
    originalEventCount: raw.traceEvents.length, selectedCount: selected.length, notProjectedCount: raw.traceEvents.length - selected.length, phases,
    clientInfo: raw.clientInfo, records: selected,
    link: { from: from.index, to: to.index, key: { cat: from.event.cat, name: from.event.name, id: from.event.id }, allMatchingFlowIndices: allMatches.map(record => record.index), meaning: 'Explicit recorded flow association, not a complete causal proof or inferred slice dependency.' },
    endpointDifferenceUs: to.event.ts - from.event.ts,
    sourceQueueDurationField: to.event.args.queue_duration,
    timeMeaning: 'Timestamp difference between the selected s/f records only. queue_duration is preserved without interpreting its unit, rounding or instrumentation.' };
}

export function draft(evidence) {
  const record = index => evidence.records.find(row => row.index === index).event;
  const a = record(evidence.link.from), b = record(evidence.link.to);
  const rows = evidence.records.map(({ index, event }) => `| ${index} | ${event.pid} / ${event.tid} | ${event.ph} | ${event.ts} | \`${event.name}\` |`).join('\n');
  return `# 这条跨线程连线，依据是什么？ {#trace-flow-evidence}

它来自原始记录中的同一 flow 键；${evidence.endpointDifferenceUs} 微秒只是两个端点的时间戳差。

- 选取上游公开历史 trace 的 ${evidence.selectedCount} 条记录，没有重新采集。
- 连线只保留记录明确声明的 flow 关联，完整因果链未知。
- 原字段 queue_duration 为 ${evidence.sourceQueueDurationField}，其仪器化含义未核。

@answer scope="公开历史fixture · 非本轮采集 · 仅选6条记录"
@meta locale=zh-CN
@source raw title="Catapult 固定原始 trace" url=https://github.com/catapult-project/catapult/blob/${PIN}/tracing/test_data/flow.json
@source binding title="固定 v1 flow 配对与端点绑定源码" url=https://github.com/catapult-project/catapult/blob/${PIN}/tracing/tracing/extras/importer/trace_event_importer.html#L2107-L2350

## 连线只来自两个明示的 flow 端点 {#flow-panel span=12}

@callout level=warning title="78微秒不是工作耗时"
| 这不是本轮实测。端点差不表示 CPU、排队、网络或任务耗时，也不能据此判定关键路径。原始 queue_duration=${evidence.sourceQueueDurationField} 按原样保留。 |

@architecture id=flow-map title="原记录的 flow 关联"
| flow-start | 记录2078 · s | backend | block:start-note | source:raw |
| flow-end | 记录2082 · f | backend | block:end-note | source:raw |
| flow-start > flow-end | 记录flow | |

@steps id=read-endpoints
| source-endpoint | 记录2078 · s | tid=${a.tid}；原 ts=${a.ts}。 | flow-map | flow-start |
| destination-endpoint | 记录2082 · f | tid=${b.tid}；原 ts=${b.ts}，同一 cat/name/id。 | flow-map | flow-end |

@prose id=start-note
| 原始索引2078，pid=${a.pid}，tid=${a.tid}。这个 s 记录位于源线程的 B/E 区间中。 |

@prose id=end-note
| 原始索引2082，pid=${b.pid}，tid=${b.tid}。这个 f 记录在目标线程的下一条 B 之前5微秒。不要用区间包含推断目标。 |

## 原字段与索引逐条保留 {#records span=12}

索引为原 traceEvents 数组的零起始位置，没有按名称合并。[](source:raw)

| 原索引 | pid / tid | ph | 原ts（微秒） | 原name |
| --- | --- | --- | --- | --- |
${rows}

所选 flow 的 cat 为 \`${a.cat}\`，name 为 \`${a.name}\`，id 为 \`${a.id}\`。完整原件中的 s/t/f 记录只有2078与2082匹配这个三元键。

## 三种时间量不要混读 {#time-meaning span=12}

| 量 | 算法或原字段 | 本选段的值 | 能说明什么 |
| --- | --- | --- | --- |
| flow端点差 | 1496640971809减1496640971731 | ${evidence.endpointDifferenceUs}微秒 | 两个记录时间戳的差 |
| 源线程B/E区间 | 1496640971745减1496640971725 | ${record(2079).ts - record(2077).ts}微秒 | SyncChannel记录区间 |
| 目标线程B/E区间 | 1496640971839减1496640971814 | ${record(2084).ts - record(2083).ts}微秒 | RunTask记录区间 |
| queue_duration | 原始args字段 | ${evidence.sourceQueueDurationField} | 单位、舍入与计算含义未核 |

B/E只保留区间上下文，没有因此增加图边。原f比目标B早5微秒；固定Catapult v1在此使用下一slice绑定。图只连接原始s/f记录，不重建该slice映射。[](source:binding)

## 完整选择与原始JSON {#selection span=12}

原件${evidence.originalEventCount}条，选择${evidence.selectedCount}条，其余${evidence.notProjectedCount}条未投影。Chrome版本为 \`${evidence.clientInfo.version}\`。这不是完整执行图；同名、时间先后和相关ID都不能单独生成额外因果边。

完整原件SHA-256：\`${SOURCE_HASH}\`。来源固定commit：\`${PIN}\`。本地分支保留完整原件与许可，下面是六条记录的原字段副本。

\`\`\`json title="原始字段副本；只增加index定位外壳"
${JSON.stringify(evidence.records, null, 2)}
\`\`\`
`;
}

function build() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '../..');
  const out = path.resolve(process.argv[2] ?? path.join(here, 'output'));
  const raw = fs.readFileSync(path.join(here, 'upstream/flow.json'));
  const selection = JSON.parse(fs.readFileSync(path.join(here, 'selection.json'), 'utf8'));
  const evidence = audit(raw, selection);
  fs.mkdirSync(out); // refuse existing paths, including symlinks
  const write = (name, value) => fs.writeFileSync(path.join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  write('evidence.json', evidence);
  write('candidate.archify.md', draft(evidence));
  const receipts = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-trace-flow-'));
  const startedAt = new Date().toISOString();
  const args = [path.join(root, 'archify/bin/archify.mjs'), 'finalize', 'explainer', path.join(out, 'candidate.archify.md'), path.join(out, 'review.html'), '--json', '--receipt', path.join(receipts, 'finalize.json')];
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(receipts, 'stdout.json'), run.stdout ?? '');
  fs.writeFileSync(path.join(receipts, 'stderr.txt'), run.stderr ?? '');
  const delivery = path.join(out, 'review.delivery.json');
  if (fs.existsSync(delivery)) fs.copyFileSync(delivery, path.join(receipts, 'delivery.json'), fs.constants.COPYFILE_EXCL);
  let result;
  try { result = JSON.parse(run.stdout); } catch { result = { status: 'unparsed' }; }
  const safe = value => typeof value === 'string' ? value.split(out).join('<output>').split(root).join('<checkout>').split(receipts).join('<private-receipts>') : value;
  write('build-evidence.json', { kind: 'portable-stage-summary-not-original-receipt', startedAt, endedAt: new Date().toISOString(), productBase: 'e837dc4cb83042d2b6c596e039692e25ec62c2da', node: process.version, exitCode: run.status, error: run.error ? safe(run.error.message) : null,
    result: JSON.parse(JSON.stringify(result, (_key, value) => safe(value))),
    files: ['evidence.json', 'candidate.archify.md', 'review.html'].filter(name => fs.existsSync(path.join(out, name))).map(name => ({ name, sha256: digest(fs.readFileSync(path.join(out, name))) })) });
  console.log(JSON.stringify({ output: out, exitCode: run.status, privateReceipts: receipts }));
  if (run.status !== 0) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
