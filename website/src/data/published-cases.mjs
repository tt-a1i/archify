// Website discovery copy for existing standalone cases. This inventory does not
// regenerate diagrams or assert renderer validation; source artifacts own that.
// `documentDescription: true` marks artifacts that already ship their own
// <meta name="description">, so publication metadata must not inject a second one.
export const PUBLISHED_CASES = [
  {
    artifact: 'cases/life/leave-plan.workflow.html',
    input: 'cases/life/leave-plan.workflow.json',
    title: '一年的年假怎么排',
    description: '查看一份基于 Archify 生成的中文年假安排可交互工作流图：清晰串联全年休假节点、调休组合、剩余额度与规则提醒，支持节点聚焦与链路追踪。此为示例计划，不代表真实日历或公司的休假政策。',
    language: 'zh-CN',
  },
  {
    artifact: 'cases/life/job-search.lifecycle.html',
    input: 'cases/life/job-search.lifecycle.json',
    title: 'Where Each Job Application Stands',
    description: 'Explore an example job-application lifecycle, from saved roles and submitted applications through interviews, waiting states, and final outcomes.',
    language: 'en',
  },
  {
    artifact: 'cases/life/monthly-money.dataflow.html',
    input: 'cases/life/monthly-money.dataflow.json',
    title: 'Where a Paycheck Goes Each Month',
    description: 'Follow an example monthly paycheck through checking, bills, emergency savings and retirement transfers in an interactive data-flow diagram. Amounts are illustrative.',
    language: 'en',
  },
  {
    artifact: 'cases/life/renting.sequence.html',
    input: 'cases/life/renting.sequence.json',
    title: '租一套房，一来一回都在这里',
    description: '用 Archify 中文可交互时序图完整梳理租客、中介与房东之间的看房、议价、合同核对、签约、付款与房屋交接全流程，支持点击聚焦单步交互与角色路径。金额和流程仅为示例。',
    language: 'zh-CN',
  },
  {
    artifact: 'cases/mco-runtime.architecture.html',
    input: 'cases/mco-runtime.architecture.json',
    title: 'MCO Runtime Architecture',
    description: 'Explore the MCO runtime architecture at pinned revision 9f1a1cf: entry points, provider invocation, streamed answers and artifacts. This is an authored source-backed diagram, not an execution trace.',
    language: 'en',
  },
  {
    artifact: 'cases/explainer/tls-first-visit.html',
    input: 'cases/explainer/tls-first-visit.archify.md',
    title: 'What happens when a browser opens an HTTPS site for the first time?',
    description: 'A one-page answer covering DNS lookup, TCP connect and the one-round-trip TLS 1.3 handshake before the first HTTP request, with a step-by-step sequence diagram.',
    language: 'en',
    documentDescription: true,
  },
  {
    artifact: 'cases/explainer/p99-tail-latency.html',
    input: 'cases/explainer/p99-tail-latency.archify.md',
    title: 'P99 从 80 ms 涨到 600 ms，为什么平均值几乎没变？',
    description: '一页式解答解释长尾延迟：少数慢请求被平均值摊平，以及从抓取慢请求 trace、按维度切分到对照变更的排查顺序。示例数值仅用于说明。',
    language: 'zh-CN',
    documentDescription: true,
  },
  {
    artifact: 'cases/explainer/finalize-delivery.html',
    input: 'cases/explainer/finalize-delivery.archify.md',
    title: 'Archify finalize 经过哪些模块？失败时旧产物怎么保住？',
    description: '一页式解答拆解 finalize 的交付链路：三道检查门、暂存与原子换入、交付锁与回滚边界，以及失败时旧产物如何保留。',
    language: 'zh-CN',
    documentDescription: true,
  },
  {
    artifact: 'cases/explainer/first-rental.html',
    input: 'cases/explainer/first-rental.archify.md',
    title: '第一次在大城市租房，签合同前要确认哪些事？',
    description: '一页式解答按顺序说明首次租房签约前要确认的事：核实房东身份与产权、把所有承诺写进合同、付款留凭证并逐项验房。',
    language: 'zh-CN',
    documentDescription: true,
  },
  {
    artifact: 'cases/astron-agent-runtime.architecture.html',
    input: 'cases/astron-agent-runtime.architecture.json',
    title: 'Astron Agent 运行时架构',
    description: '查看 Astron Agent 在固定提交 a77c92a 的源码实证运行时架构图：完整呈现入口层、核心服务职责、状态存储与模块调用边界，支持节点聚焦与链路追踪。此图依据源码编写对齐，非运行时 trace。',
    language: 'zh-CN',
  },
];
