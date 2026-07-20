const RAW_RECIPES = [
  {
    id: 'system-overview', type: 'architecture', proof: 'web-app',
    presentation: { preset: 'classic', motion: 'static', views: 'optional' },
    signals: [['system overview', 12], ['architecture', 10], ['components', 6], ['services', 4], ['repository', 5], ['trust boundary', 8], ['架构', 10], ['系统总览', 12], ['组件', 6], ['服务', 4], ['仓库', 5], ['信任边界', 8]],
    en: {
      title: 'System overview', question: 'What exists, who owns it, and how is it connected?',
      summary: 'A bounded map of core components, external dependencies, primary paths, and trust boundaries.',
      useWhen: 'Onboarding, design reviews, repository orientation, or explaining a service landscape.',
      avoidWhen: 'The audience needs exact call order, state transitions, or row-level data lineage.',
      include: ['8–12 core components', 'one primary path', 'external dependencies', 'trust boundaries'],
      prompt: 'Analyze this repository, then use Archify to create a high-level architecture diagram. Show 8–12 core runtime components, one primary request or data path, external dependencies, ownership or trust boundaries, and put supporting detail in cards instead of adding more edges.',
    },
    zh: {
      title: '系统总览', question: '系统里有什么、归谁负责、彼此如何连接？',
      summary: '用一张有边界的图展示核心组件、外部依赖、主路径和信任边界。',
      useWhen: '适合新人上手、方案评审、仓库梳理和服务全景说明。',
      avoidWhen: '如果重点是精确调用顺序、状态流转或字段级血缘，请换其他配方。',
      include: ['8–12 个核心组件', '一条主路径', '外部依赖', '归属或信任边界'],
      prompt: '分析这个仓库，然后用 Archify 生成高层系统架构图。展示 8–12 个核心运行时组件、一条主要请求或数据路径、外部依赖、归属或信任边界；支持性细节放进卡片，不要继续堆连线。',
    },
  },
  {
    id: 'deployment-ownership', type: 'architecture', proof: 'deployment-ownership',
    presentation: { preset: 'blueprint', motion: 'trace', views: 'recommended' },
    signals: [['deployment topology', 14], ['region', 7], ['vpc', 9], ['cluster', 6], ['availability zone', 8], ['ownership', 7], ['cloud deployment', 12], ['部署拓扑', 14], ['区域', 6], ['集群', 6], ['可用区', 8], ['资源归属', 9], ['跨区', 8]],
    en: {
      title: 'Deployment ownership', question: 'Where does each workload run, and what crosses a boundary?',
      summary: 'A deployment-focused map of regions, networks, clusters, workloads, stores, and cross-boundary mechanisms.',
      useWhen: 'Cloud reviews, production readiness, multi-region planning, or infrastructure ownership handoffs.',
      avoidWhen: 'Deployment facts are unknown or the real question is application behavior rather than placement.',
      include: ['regions and networks', 'workload ownership', 'stateful services', 'named boundary crossings'],
      prompt: 'Use Archify to draw the production deployment topology. Group resources by region, network, cluster, and owner; show workloads and stateful services; label every cross-boundary mechanism. Do not invent deployment facts—mark unknown areas explicitly.',
    },
    zh: {
      title: '部署与归属', question: '每个工作负载运行在哪里，哪些连接跨越了边界？',
      summary: '围绕 Region、网络、集群、工作负载、存储和跨边界机制组织部署图。',
      useWhen: '适合云上评审、生产就绪、多区域规划和基础设施交接。',
      avoidWhen: '部署事实不清楚，或真正问题是应用行为而不是资源位置时不要使用。',
      include: ['区域与网络', '工作负载归属', '有状态服务', '明确的跨边界机制'],
      prompt: '用 Archify 绘制生产部署拓扑。按区域、网络、集群和负责人分组，展示工作负载与有状态服务，并标注每一种跨边界机制。不要编造部署事实，不确定的区域要明确标出。',
    },
  },
  {
    id: 'agent-tool-call', type: 'workflow', proof: 'agent-tool-call',
    presentation: { preset: 'signal-flow', motion: 'trace', views: 'recommended' },
    signals: [['agent tool call', 16], ['tool call', 12], ['approval gate', 10], ['human in the loop', 9], ['mcp', 7], ['planner', 6], ['agent loop', 10], ['智能体工具调用', 16], ['工具调用', 12], ['审批门', 10], ['人在回路', 9], ['规划器', 6], ['智能体循环', 10]],
    en: {
      title: 'Agent tool-call loop', question: 'How does an agent plan, get permission, act, recover, and report?',
      summary: 'A lane-based agent loop with policy gates, tool execution, exception recovery, evidence, and final response.',
      useWhen: 'Explaining agent runtimes, MCP/tool orchestration, approvals, retries, or observability.',
      avoidWhen: 'The goal is only to show static agent components or exact API message timing.',
      include: ['request and planning', 'policy or approval gate', 'tool execution', 'exception and evidence paths'],
      prompt: 'Use Archify workflow mode to explain this agent tool-call loop. Separate user surface, agent runtime, policy boundary, exception handling, tool execution, and observability into lanes. Make the successful path primary and show approval, retry, blocked, and evidence paths explicitly.',
    },
    zh: {
      title: '智能体工具调用', question: '智能体如何规划、获批、执行、恢复并汇报？',
      summary: '用泳道表达策略门、工具执行、异常恢复、证据和最终回复。',
      useWhen: '适合解释 Agent Runtime、MCP/工具编排、审批、重试和可观测性。',
      avoidWhen: '如果只想看静态组件，或重点是精确 API 消息时序，请换其他配方。',
      include: ['请求与规划', '策略或审批门', '工具执行', '异常与证据路径'],
      prompt: '用 Archify 工作流模式解释这段智能体工具调用。把用户界面、Agent Runtime、策略边界、异常处理、工具执行和可观测性分成泳道；突出成功主路径，并明确展示审批、重试、阻塞和证据路径。',
    },
  },
  {
    id: 'delivery-workflow', type: 'workflow', proof: 'delivery-workflow',
    presentation: { preset: 'classic', motion: 'trace', views: 'optional' },
    signals: [['ci/cd', 14], ['release workflow', 14], ['deployment pipeline', 11], ['pull request', 7], ['staging', 7], ['rollback', 8], ['发布流程', 14], ['流水线', 9], ['上线', 7], ['预发', 7], ['回滚', 8], ['审批发布', 10]],
    en: {
      title: 'Delivery workflow', question: 'How does a change move safely from commit to production?',
      summary: 'A delivery flow with build, checks, environments, approvals, smoke tests, rollback, and ownership lanes.',
      useWhen: 'CI/CD design, release reviews, deployment governance, or onboarding developers to delivery.',
      avoidWhen: 'The question is where infrastructure runs or what states a deployment object can occupy.',
      include: ['trigger and build', 'blocking checks', 'approval and environments', 'rollback and verification'],
      prompt: 'Use Archify workflow mode to draw this delivery process from commit to production. Separate developer, CI, approval, environment, and exception lanes; mark blocking checks, smoke tests, ownership, and the rollback path. Keep one unmistakable happy path.',
    },
    zh: {
      title: '研发交付流程', question: '一次变更如何安全地从提交走到生产？',
      summary: '展示构建、检查、环境、审批、冒烟、回滚和负责人泳道。',
      useWhen: '适合 CI/CD 设计、发布评审、部署治理和研发新人上手。',
      avoidWhen: '如果重点是基础设施位置或部署对象的状态集合，请换架构图或生命周期图。',
      include: ['触发与构建', '阻断检查', '审批与环境', '回滚与验证'],
      prompt: '用 Archify 工作流模式绘制从代码提交到生产发布的流程。拆分开发者、CI、审批、环境和异常泳道；标出阻断检查、冒烟测试、负责人和回滚路径，并保留一条一眼可见的成功主路径。',
    },
  },
  {
    id: 'incident-runbook', type: 'workflow', proof: 'incident-runbook',
    presentation: { preset: 'signal-flow', motion: 'trace', views: 'recommended' },
    signals: [['incident response', 15], ['runbook', 12], ['outage', 9], ['triage', 8], ['mitigation', 8], ['escalation', 7], ['事故处置', 15], ['故障', 9], ['应急预案', 12], ['排障', 9], ['缓解', 7], ['升级响应', 8]],
    en: {
      title: 'Incident runbook', question: 'How do responders detect, triage, mitigate, verify, and escalate?',
      summary: 'An operational workflow that separates signals, responders, mitigation, communications, and recovery proof.',
      useWhen: 'Incident playbooks, on-call handoffs, reliability reviews, and tabletop exercises.',
      avoidWhen: 'The audience needs live metrics or a post-incident component topology instead of response actions.',
      include: ['detection signal', 'triage owner', 'mitigation and rollback', 'verification and communication'],
      prompt: 'Use Archify workflow mode to turn this incident runbook into responder lanes. Show detection, triage, mitigation, escalation, communication, rollback, and recovery verification. Separate decision gates from actions and make missing ownership visible.',
    },
    zh: {
      title: '事故处置 Runbook', question: '响应者如何发现、分诊、缓解、验证并升级？',
      summary: '把信号、响应者、缓解动作、沟通和恢复证据拆成可执行流程。',
      useWhen: '适合故障预案、On-call 交接、稳定性评审和桌面演练。',
      avoidWhen: '如果受众需要实时指标仪表盘或事故后的组件拓扑，而不是响应动作，请换其他视图。',
      include: ['发现信号', '分诊负责人', '缓解与回滚', '恢复验证与沟通'],
      prompt: '用 Archify 工作流模式把事故处置预案画成响应者泳道。展示发现、分诊、缓解、升级、沟通、回滚和恢复验证；把决策门与操作分开，并让缺失的负责人清晰可见。',
    },
  },
  {
    id: 'api-request', type: 'sequence', proof: 'cache-miss',
    presentation: { preset: 'classic', motion: 'trace', views: 'optional' },
    signals: [['api request', 14], ['request response', 12], ['call chain', 11], ['cache miss', 13], ['jwt', 8], ['who calls whom', 12], ['api 请求', 14], ['请求响应', 12], ['调用链', 11], ['缓存未命中', 13], ['谁调用谁', 12], ['鉴权链路', 9]],
    en: {
      title: 'API request chain', question: 'Who calls whom, in what order, and what returns?',
      summary: 'A time-ordered request path with authentication, cache fallback, persistence, return traffic, and async trace.',
      useWhen: 'API documentation, debugging request latency, auth reviews, or explaining cache fallback.',
      avoidWhen: 'Order is unimportant and the audience only needs the stable service topology.',
      include: ['callers and callees', 'request and return messages', 'fallback or error path', 'async side effects'],
      prompt: 'Use Archify sequence mode to show this request from caller to final response. Include authentication, cache hit or miss, persistence fallback, return messages, and asynchronous trace or event emission. Keep message labels short and order unambiguous.',
    },
    zh: {
      title: 'API 请求链', question: '谁调用谁、顺序如何、最终返回什么？',
      summary: '按时间展示鉴权、缓存回退、持久化、返回流量和异步追踪。',
      useWhen: '适合 API 文档、请求耗时排查、鉴权评审和缓存回退说明。',
      avoidWhen: '如果顺序不重要，受众只需要稳定的服务拓扑，请用架构图。',
      include: ['调用方与被调用方', '请求与返回消息', '回退或错误路径', '异步副作用'],
      prompt: '用 Archify 时序模式展示从调用方到最终响应的完整请求。包含鉴权、缓存命中或未命中、持久化回退、返回消息，以及异步 Trace 或事件上报；消息标签保持简短，顺序必须明确。',
    },
  },
  {
    id: 'async-roundtrip', type: 'sequence', proof: 'async-roundtrip',
    presentation: { preset: 'signal-flow', motion: 'trace', views: 'recommended' },
    signals: [['async roundtrip', 14], ['webhook', 10], ['callback', 10], ['acknowledgement', 8], ['timeout', 7], ['retry message', 8], ['异步回调', 14], ['回调', 10], ['确认消息', 8], ['超时', 7], ['消息重试', 9], ['webhook', 10]],
    en: {
      title: 'Async roundtrip', question: 'What happens after the initial request returns?',
      summary: 'A sequence view of enqueue, acknowledgement, background work, callbacks, retries, timeout, and final consistency.',
      useWhen: 'Webhooks, jobs, queues, payment callbacks, eventual consistency, or async API contracts.',
      avoidWhen: 'The primary question is topic topology and consumer ownership rather than time order.',
      include: ['initial acknowledgement', 'queue or scheduler', 'background work', 'callback, retry, and timeout'],
      prompt: 'Use Archify sequence mode to explain this asynchronous roundtrip. Show the initial acknowledgement, enqueue or scheduling step, background processing, callback or polling, retry and timeout behavior, and the point where the caller can observe final consistency.',
    },
    zh: {
      title: '异步往返链路', question: '初始请求返回之后，后台还会发生什么？',
      summary: '按时间展示入队、确认、后台处理、回调、重试、超时和最终一致。',
      useWhen: '适合 Webhook、后台任务、队列、支付回调、最终一致和异步 API 契约。',
      avoidWhen: '如果重点是 Topic 拓扑和消费者归属，而不是时间顺序，请用事件数据流配方。',
      include: ['初始确认', '队列或调度器', '后台处理', '回调、重试与超时'],
      prompt: '用 Archify 时序模式解释这段异步往返链路。展示初始确认、入队或调度、后台处理、回调或轮询、重试与超时，以及调用方何时能观察到最终一致结果。',
    },
  },
  {
    id: 'data-lineage', type: 'dataflow', proof: 'product-analytics',
    presentation: { preset: 'classic', motion: 'trace', views: 'recommended' },
    signals: [['data lineage', 15], ['etl', 12], ['warehouse', 9], ['pii', 11], ['governance', 9], ['analytics pipeline', 12], ['数据血缘', 15], ['数据管道', 11], ['数仓', 9], ['治理', 9], ['隐私数据', 10], ['用户同意', 9]],
    en: {
      title: 'Data lineage', question: 'Where does data come from, how does it change, and who consumes it?',
      summary: 'A governed path from sources through consent, transforms, sensitive stores, warehouse, and consumers.',
      useWhen: 'Analytics architecture, ETL/ELT review, PII assessment, warehouse design, or model feature lineage.',
      avoidWhen: 'The audience needs request timing or operational task ownership rather than data assets.',
      include: ['sources and assets', 'transform stages', 'classification or consent', 'stores and consumers'],
      prompt: 'Use Archify dataflow mode to map this data lineage. Name every data asset and transform, show consent or classification boundaries, distinguish streaming from batch paths, and identify stores plus downstream consumers. Do not use unlabeled flows.',
    },
    zh: {
      title: '数据血缘', question: '数据从哪里来、如何变化、最终被谁消费？',
      summary: '从来源经过同意、转换、敏感存储、数仓直到消费者的治理路径。',
      useWhen: '适合分析架构、ETL/ELT 评审、PII 评估、数仓设计和特征血缘。',
      avoidWhen: '如果受众需要请求时序或操作负责人，而不是数据资产，请换其他配方。',
      include: ['数据来源与资产', '转换阶段', '分类或同意边界', '存储与消费者'],
      prompt: '用 Archify 数据流模式梳理这段数据血缘。为每个数据资产和转换命名，展示用户同意或数据分类边界，区分流式与批处理路径，并标明存储和下游消费者；所有数据流都必须有标签。',
    },
  },
  {
    id: 'event-stream', type: 'dataflow', proof: 'event-stream',
    presentation: { preset: 'signal-flow', motion: 'trace', views: 'recommended' },
    signals: [['event stream', 15], ['kafka topology', 14], ['topic', 8], ['consumer group', 11], ['dead letter', 10], ['dlq', 10], ['事件流', 15], ['kafka 拓扑', 14], ['主题', 7], ['消费者组', 11], ['死信', 10], ['事件地铁图', 12]],
    en: {
      title: 'Event-stream topology', question: 'Which events move through which topics, processors, groups, and failure paths?',
      summary: 'A stream map of producers, topics, ordered processors, consumer groups, state, replay, and DLQ.',
      useWhen: 'Kafka/event-platform design, stream processing reviews, ownership, replay, and failure handling.',
      avoidWhen: 'Topic names, consumer groups, and delivery semantics are not known—use a generic workflow instead.',
      include: ['producers and event names', 'topics and ordering', 'processors and consumer groups', 'state, replay, and DLQ'],
      prompt: 'Use Archify dataflow mode to draw this event-stream topology. Name producers, events, topics, ordered processors, consumer groups, state stores, replay paths, and the DLQ. Show ownership and delivery semantics only when supported by evidence.',
    },
    zh: {
      title: '事件流拓扑', question: '哪些事件经过哪些 Topic、处理器、消费者组和失败路径？',
      summary: '展示生产者、Topic、有序处理器、消费者组、状态、重放和 DLQ。',
      useWhen: '适合 Kafka/事件平台设计、流处理评审、归属、重放和失败处理。',
      avoidWhen: '如果 Topic、消费者组和投递语义都不清楚，请先用通用工作流，不要编造事件拓扑。',
      include: ['生产者与事件名', 'Topic 与顺序', '处理器与消费者组', '状态、重放与 DLQ'],
      prompt: '用 Archify 数据流模式绘制这段事件流拓扑。命名生产者、事件、Topic、有序处理器、消费者组、状态存储、重放路径和 DLQ；只有在证据充分时才标注归属和投递语义。',
    },
  },
  {
    id: 'object-lifecycle', type: 'lifecycle', proof: 'agent-run',
    presentation: { preset: 'classic', motion: 'trace', views: 'optional' },
    signals: [['state machine', 15], ['object lifecycle', 14], ['status transition', 11], ['terminal state', 9], ['retry state', 8], ['状态机', 15], ['生命周期', 13], ['状态流转', 11], ['终态', 9], ['等待态', 8], ['重试状态', 8]],
    en: {
      title: 'Object lifecycle', question: 'Which states exist, what events move between them, and how does it end?',
      summary: 'A state model with active work, waits, retries, cancellation, failure, and explicit terminal outcomes.',
      useWhen: 'Tasks, orders, tickets, subscriptions, jobs, agent runs, or any durable object with status.',
      avoidWhen: 'The object has no durable state and the real question is participant interaction over time.',
      include: ['start and active states', 'event-labelled transitions', 'wait and retry states', 'all terminal outcomes'],
      prompt: 'Use Archify lifecycle mode to model this object. Separate main progress, waiting or interruption states, and terminal outcomes. Label transitions with events, include retry, cancellation, timeout, success, and failure where real, and never hide an ending.',
    },
    zh: {
      title: '对象生命周期', question: '有哪些状态、什么事件触发流转、最终如何结束？',
      summary: '展示执行、等待、重试、取消、失败以及明确终态的状态模型。',
      useWhen: '适合任务、订单、工单、订阅、作业、Agent Run 等带持久状态的对象。',
      avoidWhen: '对象没有持久状态，真正问题是参与者随时间的交互时，请使用时序图。',
      include: ['开始与执行态', '带事件的转换', '等待与重试态', '所有终态'],
      prompt: '用 Archify 生命周期模式建模这个对象。分开主进度、等待或中断状态和终态；用事件标注转换，并在真实存在时展示重试、取消、超时、成功和失败，不能隐藏任何结束方式。',
    },
  },
  {
    id: 'deployment-lifecycle', type: 'lifecycle', proof: 'deployment-lifecycle',
    presentation: { preset: 'signal-flow', motion: 'trace', views: 'recommended' },
    signals: [['deployment lifecycle', 15], ['release state', 10], ['promotion state', 9], ['approval status', 8], ['rollback state', 10], ['部署生命周期', 15], ['发布状态', 10], ['晋级', 7], ['审批状态', 8], ['回滚状态', 10]],
    en: {
      title: 'Deployment lifecycle', question: 'What state is a release in, and what can happen next?',
      summary: 'A deployment state model covering queued, building, verifying, approval, promotion, rollback, and terminal outcomes.',
      useWhen: 'Release controllers, GitOps reconciliation, environment promotion, or deployment status APIs.',
      avoidWhen: 'The question is the human/CI sequence of delivery actions rather than the deployment object state.',
      include: ['queued and running states', 'verification and approval', 'promotion and rollback', 'success, failure, cancellation'],
      prompt: 'Use Archify lifecycle mode to model the deployment object. Show queued, building, verifying, waiting for approval, promoting, rolling back, and every terminal outcome. Label the events and guards that permit each transition.',
    },
    zh: {
      title: '部署生命周期', question: '一次发布当前处于什么状态，下一步可能发生什么？',
      summary: '覆盖排队、构建、验证、审批、晋级、回滚和终态的部署状态模型。',
      useWhen: '适合发布控制器、GitOps 对账、环境晋级和部署状态 API。',
      avoidWhen: '如果重点是人员与 CI 的交付动作顺序，而不是部署对象状态，请用交付工作流。',
      include: ['排队与执行态', '验证与审批', '晋级与回滚', '成功、失败与取消'],
      prompt: '用 Archify 生命周期模式建模部署对象。展示排队、构建、验证、等待审批、晋级、回滚以及所有终态，并标注允许每次状态转换的事件和守卫条件。',
    },
  },
];

export const SCENARIO_RECIPES = Object.freeze(RAW_RECIPES.map((recipe) => Object.freeze({
  ...recipe,
  presentation: Object.freeze({ ...recipe.presentation }),
  signals: Object.freeze(recipe.signals.map((signal) => Object.freeze(signal.slice()))),
  en: Object.freeze({ ...recipe.en, include: Object.freeze(recipe.en.include.slice()) }),
  zh: Object.freeze({ ...recipe.zh, include: Object.freeze(recipe.zh.include.slice()) }),
})));

export function detectGuideLanguage(value = '') {
  return /[\u3400-\u9fff]/u.test(value) ? 'zh' : 'en';
}

function normalized(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function localized(recipe, lang) {
  const copy = recipe[lang === 'zh' ? 'zh' : 'en'];
  return {
    id: recipe.id,
    type: recipe.type,
    proof: recipe.proof,
    presentation: { ...recipe.presentation },
    ...copy,
    include: copy.include.slice(),
  };
}

export function listScenarioRecipes(lang = 'en') {
  return SCENARIO_RECIPES.map((recipe) => localized(recipe, lang));
}

function scoreRecipe(recipe, query) {
  const text = normalized(query);
  if (!text) return { recipe, score: 0, matched: [] };
  if (text === recipe.id || text === recipe.id.replace(/-/g, ' ')) {
    return { recipe, score: 100, matched: [recipe.id] };
  }
  let score = 0;
  const matched = [];
  for (const [signal, weight] of recipe.signals) {
    if (text.includes(normalized(signal))) {
      score += weight;
      matched.push(signal);
    }
  }
  return { recipe, score, matched };
}

export function recommendScenario(query, options = {}) {
  const lang = options.lang === 'zh' || options.lang === 'en' ? options.lang : detectGuideLanguage(query);
  const ranked = SCENARIO_RECIPES.map((recipe) => scoreRecipe(recipe, query))
    .sort((left, right) => right.score - left.score || SCENARIO_RECIPES.indexOf(left.recipe) - SCENARIO_RECIPES.indexOf(right.recipe));
  const winner = ranked[0].score > 0 ? ranked[0] : { recipe: SCENARIO_RECIPES[0], score: 0, matched: [] };
  const confidence = winner.score >= 14 ? 'high' : winner.score >= 7 ? 'medium' : 'low';
  return {
    ok: true,
    mode: 'recommendation',
    lang,
    query: String(query || ''),
    confidence,
    matchedSignals: winner.matched.slice(),
    recommendation: localized(winner.recipe, lang),
    alternatives: ranked.filter((entry) => entry.recipe.id !== winner.recipe.id && entry.score > 0)
      .slice(0, 2)
      .map((entry) => ({ ...localized(entry.recipe, lang), score: entry.score })),
  };
}

export function formatScenarioList(lang = 'en') {
  const isZh = lang === 'zh';
  const heading = isZh ? 'Archify 场景配方（11）' : 'Archify scenario recipes (11)';
  const intro = isZh
    ? '先选择你要回答的问题，再选择图表类型。可运行：archify guide "你的场景"'
    : 'Choose the question before the diagram type. Run: archify guide "your scenario"';
  return [heading, '', intro, '', ...listScenarioRecipes(lang).flatMap((recipe) => [
    `${recipe.id}  [${recipe.type}]  ${recipe.title}`,
    `  ${recipe.question}`,
  ])].join('\n');
}

export function formatScenarioRecommendation(result) {
  const isZh = result.lang === 'zh';
  const recipe = result.recommendation;
  const labels = isZh ? {
    heading: '推荐', question: '要回答的问题', use: '适合', avoid: '不要这样用', include: '必须包含', presentation: '表现建议', prompt: '可直接复制的提示词', alternatives: '其他可能', confidence: '置信度',
  } : {
    heading: 'Recommendation', question: 'Question answered', use: 'Use when', avoid: 'Avoid when', include: 'Must include', presentation: 'Presentation', prompt: 'Copy-ready prompt', alternatives: 'Other possible fits', confidence: 'Confidence',
  };
  const lines = [
    `${labels.heading}: ${recipe.title}  [${recipe.type}]`,
    `${labels.confidence}: ${result.confidence}`,
    `${labels.question}: ${recipe.question}`,
    '',
    `${labels.use}: ${recipe.useWhen}`,
    `${labels.avoid}: ${recipe.avoidWhen}`,
    `${labels.include}: ${recipe.include.join(isZh ? '、' : '; ')}`,
    `${labels.presentation}: ${recipe.presentation.preset} · ${recipe.presentation.motion} · views ${recipe.presentation.views}`,
    '',
    `${labels.prompt}:`,
    recipe.prompt,
  ];
  if (result.alternatives.length) {
    lines.push('', `${labels.alternatives}: ${result.alternatives.map((item) => `${item.title} [${item.type}]`).join(' · ')}`);
  }
  return lines.join('\n');
}

export function publicGuideData() {
  return SCENARIO_RECIPES.map((recipe) => ({
    ...localized(recipe, 'en'),
    en: recipe.en,
    zh: recipe.zh,
    signals: recipe.signals.map(([signal, weight]) => [signal, weight]),
  }));
}
