# Benchmark v2：Archify 改动前后对比

在已有 repair-rounds benchmark 基础上，增加最终图的内容、布局、速度、成本和可选人评。本轮维护 Archify 前后版本结果的展示能力：原始测量、0–100 分项与加权总分、逐题表格和柱状图，以及可选人评。跨工具实验独立归档。第二个 PR 再通过 autodev 跑 autoresearch，进行实际性能优化与对比实验，并补充多人评分机制。

## 看什么

| 分项 | 衡量内容 | 原始数据 |
| --- | --- | --- |
| 内容 | 所需节点、关系及标签是否正确出现在最终图中 | 节点／关系 precision、recall、F1 和缺陷列表 |
| 布局 | 必需对象的遮挡、裁切、字体大小、连线穿越 | 每个对象的几何检查和四个子项 |
| 速度 | 正确、可编辑、成功交付的整轮生成效率 | 从开始到结束的毫秒数，另列最终提交耗时 |
| 成本 | 正确交付所消耗的整轮费用 | 累计输入／输出 tokens、USD；包含失败尝试 |
| 人评（可选） | 可读性、层次、布局、风格、美观 | 每人五项 1–5 整数评分 |

内容分为 `100 × (0.4 × 节点F1 + 0.6 × 关系F1)`；无关系题只用节点F1。布局分为四个子项的均值，必需对象缺失不会缩小分母。几何分反映可测缺陷，不能替代视觉判断。

速度和成本分别按固定 good/bad 锚点线性缩放并截断到 0–100：`100 × clamp((bad - 实测值)/(bad - good), 0, 1)`。小／中／大题耗时锚点分别为 10–60、30–180、60–360 秒，成本为 $0.01–0.25、$0.03–0.75、$0.06–1.50。这些是未校准的试点策略，改变策略须升级版本。错误交付不获得效率奖励；明确的交付失败自动分计 0。未知数据为 null，不填 0；没有人评不影响自动分项。

人评先按每位评分者的五项均值映射到 `25 × (均值 - 1)`，再平均不同评分者；单人结果标记 provisional，至少两名独立评分者才标记 complete。原始评分仍保留。

当前 corpus 只有四道公开、人工编写的架构／流程试点题，gold 尚未独立确认。它用于检查评估链路，不代表全面覆盖。实际性能比较应冻结真实仓库任务、prompt、gold、模型配置、预算和重复次数，只改变 Archify revision。保留首次源码、每次修改、CLI 验收和最终产物，才能解释分数变化。

## 加权总分

分项与原始数据始终保留。指标版本 `archify-comparison-weighted-v1` 沿用试点权重：内容 45%、布局 20%、速度 10%、成本 10%、人评 15%。

- 自动总分 = `(0.45C + 0.20L + 0.10S + 0.10K) / 0.85`，范围 0–100；无需人评。
- 综合分 = `0.45C + 0.20L + 0.10S + 0.10K + 0.15H`，范围 0–100。有一份完成的独立人评即可计算，单人结果标为试点；未评分时为 null。
- 已知失败的运行总分为 0，不伪造人评分数。自动测量不完整或计划运行缺失时，对应总分为 null，不对剩余指标或成功题重新归一化。
- 先计算每次运行总分，同题重复取均值，再对题等权平均。HTML、CSV 和 JSON 共用结果，JSON 同时记录权重与指标版本；修改权重需升级版本。这些权重是优化策略，不是对指标有效性的实证结论。

## 记录与验收

先检查题集：

```sh
node benchmarks/diagram-quality/benchmark.mjs check
```

生成由外部 agent 执行，本工具不调用模型。为每次运行保存 run.json：

```json
{
  "runId": "base-workflow-01-1",
  "taskId": "workflow-01", "arm": "base", "model": "your-fixed-model", "repeat": 1,
  "modelConfiguration": {"temperature": 0},
  "status": "completed",
  "startedAt": "2026-10-23T00:00:00Z", "completedAt": "2026-10-23T00:00:20Z",
  "identity": {"budget": {"maxCandidates": 3, "maxDurationMs": 60000}},
  "candidates": [{"submittedAt": "2026-10-23T00:00:19Z", "sourceHash": "SOURCE_SHA256", "artifactHash": "HTML_SHA256"}],
  "usage": {"inputTokens": 100, "outputTokens": 50, "costUsd": 0.01}
}
```

示例数字只说明格式；替换为真实日志。usage 应覆盖所有调用，未知字段省略；不完整统计标记 `status: "partial"`。失败运行使用 failed、timeout、no_candidate、provider_error 或 invalid_source，保留 sourceHash、时间和拒绝日志。不能把反复检查同一源码算成多次修复。

对已有原生 JSON 和 HTML 进行独立 Chrome 验收：

```sh
node benchmarks/diagram-quality/benchmark.mjs verify \
  --task workflow-01 --source source.json --artifact final.html \
  --run run.json --chrome /absolute/path/to/chrome --output receipt.json
```

验收记录 corpus／几何 profile／evaluator 摘要，观察实际 DOM，并在临时副本上改标签后重渲染检查可编辑性。此探针使用当前 checkout 的 CLI，不能证明原生成版本的编辑能力。离线夹具须设置 `environment.measurementMode: "offline-render"`，不产生生成耗时或成本成绩。

## 输出前后比较

准备 plan.json；路径相对 plan 文件，两侧 revision 必须为不同的完整 commit SHA：

```json
{
  "baseRevision": "BASE_COMMIT_SHA40",
  "candidateRevision": "CANDIDATE_COMMIT_SHA40",
  "corpus": "corpus.json",
  "plannedRuns": [{"taskId": "workflow-01", "model": "your-fixed-model", "repeat": 1}],
  "runs": [{
    "arm": "base", "revision": "BASE_COMMIT_SHA40", "receipt": "receipt.json",
    "source": "source.json", "artifact": "final.html", "prompt": "prompt.md",
    "session": "session.json", "historyComplete": true,
    "candidates": [{"source": "source.json", "artifact": "final.html", "submittedAt": "2026-10-23T00:00:19Z"}]
  }]
}
```

增加 candidate 侧的对应 run；缺失一侧会明确显示缺失，不会被排除出计划。可选 preview 指向 PNG。历史完整性需要每次源码与原记录的摘要、时间绑定；session 应包含实际 prompt、响应和工具调用等可分享的实验记录。摘要用于核对文件一致性，不证明记录来自何处或没有遗漏。

```sh
node benchmarks/diagram-quality/benchmark.mjs compare --plan plan.json --output /tmp/archify-comparison
```

输出 index.html、comparison.csv、comparison.json、review.html 和摘要命名的证据文件。比较会从已保存的 observation 重算规则，不重新生成图或重新观察浏览器；JSON 保留原测量身份及当前计分器身份。保留原始运行版本，不能把离线重算标作新版模型实验。重复先在同一题内平均，再对题等权平均；缺失测量使对应汇总为空。报告列出交付数、失败数、缺失数、分项差值和原始均值。

## 可选多人评分

将整个输出目录打包给评分者，打开 review.html；匿名顺序展示图，每人填写稳定 reviewerId，独立完成五项整数评分并导出 JSON。只导出完整的条目，文字备注可选。不要提前透露方法标签；原 HTML 仍可能暴露实现特征，无法保证完全盲评。

将多人导出的 reviews 数组合并为 `{"reviews": [...]}`，再次运行：

```sh
node benchmarks/diagram-quality/benchmark.mjs compare --plan plan.json \
  --reviews reviews.json --output /tmp/archify-comparison-reviewed
```

评分绑定 taskId、artifactHash 和 rubricVersion；同一人同一 rubric 的后导入结果替换旧结果。保留原始评分文件供复核。这里没有多人在线服务。

## 验证与历史材料

Node 测试保护评分分母、缺失／失败、原始费用、版本与证据绑定、人评导入和文件输出。独立浏览器测试保护真实渲染观察、可见性、可编辑探针、报告和评分表；所有临时文件及浏览器 profile 均清理。

```sh
node --test test/diagram-quality-{cli,metrics,records,scoring,comparison,score-report}.test.mjs
ARCHIFY_CHROME=/absolute/path/to/chrome node --test test/diagram-quality-e2e-browser.test.mjs
```

[先前跨工具实验与交付失败原始材料](https://github.com/Momoyeyu/archify/blob/b75013b6e257bf1d3e6194fd3da944340a9ff7e8/docs/benchmarks/2026-10-22-peer-results/README.md)按原实验版本归档，其旧加权成绩不能当作本版本的前后性能结果。[完整实现存档](https://github.com/Momoyeyu/archify/tree/archive/benchmark-v2-full-20261023)保留拆分前代码。原 repair-rounds benchmark 保持独立。
