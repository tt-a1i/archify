# Luna/medium repository-inspection trial

Frozen source: honojs/hono at `28e8572cd265b4da1160ce6cd51919bb70516e2c`, cloned read-only to `/tmp/archify-inspect-luna-hono-20260921`.
Frozen Archify package: performance branch `ba978c0a592b12c53584f3d59da4b4a4aefea43d`, at `/Users/tushaokun/.codex/worktrees/pr486-performance-integration/archify/archify`.
Both independent authors use Luna/medium, the same prompt, the same local Skill/package, and distinct output directories. Candidate runs `inspect-repo` first; baseline uses targeted repository navigation without it. Candidate runs first, so order/cache effects remain a limitation. There is one author per arm, not a statistical performance study.

Shared user task: “为 Hono 画一张源码支持的架构总览，解释一次普通 HTTP 请求从入口到响应的执行路径。涵盖路由匹配、中间件/handler 执行、错误与未匹配路径；HEAD 有特殊处理的话也要准确表达。保留独立职责与边界，避免把每个 API 操作都画成平行线。交付 Archify 的 JSON、HTML 和完整 finalize 回执。”

Acceptance key fixed before dispatch: source-backed entry point and registration; default router and route matching; Context construction; single-handler fast path versus composed middleware path; normal response and finalized requirement; onError/notFound semantics; HEAD delegates to GET and strips body. The overview must be readable at the default 1440 viewport and pass formal finalize. A passing machine gate alone does not establish semantic or perceptual acceptance.

Timing: author-reported UTC start/end plus controller dispatch/completion, kept distinct from CLI stage times. Count source reads and repair cycles from public tool history where observable. Do not infer total token use from output bytes. Preserve unsuccessful arms and do not turn an unmatched or quality-failed pair into a speedup claim.
