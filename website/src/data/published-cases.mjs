// Website discovery copy for existing standalone cases. This inventory does not
// regenerate diagrams or assert renderer validation; source artifacts own that.
// `documentDescription: true` marks artifacts that already ship their own
// <meta name="description">, so publication metadata must not inject a second one.
export const PUBLISHED_CASES = [
  {
    artifact: 'cases/life/leave-plan.workflow.html',
    input: 'cases/life/leave-plan.workflow.json',
    title: '一年的年假怎么排',
    description: '想把分散的年假和调休安排放到同一张图上？打开 Archify 中文交互工作流图，按时间查看各段休假、调休组合、规则提醒和剩余额度。点击节点追踪请假路径，再核对每段用掉的额度如何汇入全年合计，避免重复扣减。也可以对照结构化源文件查看图中的节点与连线。此为示例计划，不代表真实日历或公司的休假政策。',
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
    description: '第一次租房，想弄清每一步该和谁确认？打开 Archify 中文交互时序图，按时间查看租客、中介和房东在联系看房、议价、核对合同、签约付款和交接房屋时如何沟通。点击消息查看当时谁向谁提出要求，再沿角色路径查看下一步由谁接手，例如谁核对合同条款，谁在交接时确认房屋状况。金额和流程仅为示例。',
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
    description: '想了解 Astron Agent 如何组织运行时职责？打开固定提交 a77c92a 对应的 Archify 交互架构图，查看入口层、核心服务、状态存储和模块调用边界。点击组件聚焦其职责，沿连线查看上下游，再对照结构化源文件与固定版本代码。图中关系依据该提交的静态源码整理，非运行时 trace。',
    language: 'zh-CN',
  },
];
