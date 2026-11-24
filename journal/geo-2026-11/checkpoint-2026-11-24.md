# Archify GEO + SEO Day-9 复盘与 v4 升级记录（2026-11-24）

> **评测性质**：基于 `2026-11-24` 在 Google Search Console（`sc-domain:archify.si`）、Bing Webmaster Tools（`https://archify.si/`，含 AI Performance Beta）、Google Grounding 实测检索与 GitHub API 上直接观测到的数据，以及随 `v3.3.0` / `v3.3.1` 发布触发的 GEO / Technical SEO v4 升级。
>
> **统计窗口说明**：GSC 效果报告更新至 `2026-11-22`；Bing Search Performance 与 AI Performance Beta 更新至 `2026-11-22`；GSC 索引编入报告仍停留在 `2026-11-16`（尚未完成 v3 `robots.txt` 封堵后的首次重算）；Sitemap 于 `2026-11-24` 已刷新为 **42 个网页**。

---

## 一、Google Search Console（更新至 2026/11/22）

### 1. 生成式 AI 功能（Beta）持续走强

- **近 28 天（10/26 – 11/22）**：总曝光 **`1.72 万`**（较 `11/21` 记录的 `1.57 万` 上升 **`+9.6%`**）。
- **近 7 天（11/16 – 11/22）**：总曝光 **`5,220`**（连续三期攀升：`4,820 -> 5,080 -> 5,220`）。
- **核心落地页 AI 曝光突破**：
  - `https://archify.si/agent-diagrams`：升至 **`171`** 次 AI 曝光（站内第 3 大 AI 曝光页）。
  - `https://archify.si/compare`：3 天内 AI 曝光连续翻倍（`13 -> 22 -> 29`，**`+123%`**），网页自然曝光同步升至 **`68`**（平均排名 **`5.3`**）。
  - 非代码案例 `https://archify.si/cases/explainer/first-rental`：首次进入近 7 天自然搜索 Top 10（`1 点击 / 24 曝光 / 4.2% CTR / 排名 7.8`）。

### 2. Sitemap 与 `v3.3` 新页面提交（2026-11-24）

- `v3.3.0`（`2026-11-22`）与 `v3.3.1` 发布后，`sitemap.xml` 由 38 条扩展至 **42 条 URL**（新增 4 个图型画廊样本：`payments.class`、`payment-platform.tree`、`payment-incident.timeline`、`checkout-request.waterfall`）。
- `2026-11-24` 已完成：
  - GSC `sitemap.xml` 重新提交并刷新为 **`2026年11月24日 · 成功 · 42 个网页`**。
  - 5 个重点页面（上述 4 个新图型页面 + `/gallery`）全部在 GSC 完成**请求编入索引**。
  - `node website/scripts/indexnow.mjs --submit` 返回 `HTTP 200`（`status: "accepted"`, `urlCount: 42`），并在 Bing IndexNow 面板确认于 `2026-11-24 22:14` 入队。
- **GSC 索引编入报告**：截至 `2026-11-24`，界面仍显示上次更新于 `2026/11/16`（`35 已编入索引 / 750 未编入索引 / 613 个 404`），需待 Google 下一轮索引重算检验 v3 `robots.txt` 封堵效果。

---

## 二、Bing Webmaster Tools 首份全量审计（2026-11-24）

### 1. 自然搜索表现（近 3 个月）

- **总点击 `3.9K` / 总曝光 `37.3K` / 平均点击率 `10.41%`**。
- 站点地图 `https://archify.si/sitemap.xml` 已在 Bing 重新提交（状态：`Success · Processing`）。

### 2. Bing AI Performance Beta（Microsoft Copilots & Partners，10/12 – 11/22）

- **总引用量（Total Citations）**：**`17.3K`**，覆盖 **16 个被引用页面**，说明 Archify 在微软 Copilot / Bing Grounding 生态已具备极高品牌和文档引用密度。
- **高引用页面分布**：
  - `https://archify.si/`：**`10.7K`**
  - `https://archify.si/zh`：**`5.2K`**
  - `https://archify.si/agent-diagrams`：**`669`**
  - `https://archify.si/start?...`：**`468`**
  - `https://archify.si/guide`：**`42`**
  - `https://archify.si/gallery/artifacts/cache-miss.sequence`：**`29`**
  - `https://archify.si/compare`：**`7`**
  - `https://archify.si/cases/explainer/p99-tail-latency`：**`6`**
  - `https://archify.si/cases/explainer/tls-first-visit`：**`6`**
  - `https://archify.si/cases/explainer/first-rental`：**`2`**
- **高频 Grounding 查询词**：`archify`（`11.8K`, `25.29%`）、`archify skill`（`2.2K`, `28.39%`）、`archify使用/怎么用`（`314`），以及旧命令 `npx skills add tt-a1i/archify -g`（`26`, `33.77%` —— 证明旧命令仍被搜索，持续保留 v3 的新旧命令时间覆盖说明非常必要）。

### 3. Bing SEO Recommendations 暴露的 12 项可修复问题

1. **`<img>` 缺少有效 `alt` 文本（2 个画廊页，共 8 张展示截图）**：`/gallery` 与 `/zh/gallery` 顶部 8 张 Showcase 预览图（4 张 Explainer + 4 张生活规划图）此前为 `alt=""`，导致可访问性与图片语义检索信号缺失。
2. **中文页 Meta Description 偏短（10 个中文页）**：`/zh`、`/zh/start`、`/zh/guide`、`/zh/gallery`、`/zh/community`、`/zh/agent-diagrams`、`/zh/compare`、`/zh/cases/mco-runtime` 及部分生活案例页的中文描述偏短，被 Bing 判定为可优化项。

---

## 三、Google Grounding 实测与 GitHub 里程碑（2026-11-24）

- **最大突破 — 英文 Mermaid 替代泛词登顶 #1**：
  - 查询 `Mermaid alternatives interactive architecture diagram AI coding agent`：Archify 在 3 天内实现三级跳（`11/21` 未上榜 → `11/23` 第三梯队 → **`11/24` 综合推荐 #1**），且**直接将 `https://archify.si/compare` 列为 `[1]` 首号引用源**。
  - `2026-11-21` 在 Dev.to 发布的英文对比长文（`https://dev.to/tta1i/mermaid-alternatives-for-ai-coding-agents-why-typed-json-ir-browser-checks-beat-syntax-prompting-4l8k`）已在 32 小时内被 Google 编入索引并同步强化外部语义信号。
- **非代码破圈稳居首位**：`AI turn travel itinerary or everyday workflow into interactive HTML explainer` 持续保持 **Method 1（#1）**，直引 `[1] archify.si`。
- **GitHub 逼近 10 万 Star 里程碑**：`tt-a1i/archify` 达 **`99,399 ★` / `6,804 forks`**（距离 **`100,000 ★`** 仅差 **`601 ★`**）；最新版本 `v3.3.1`。6 个高星 Awesome PR 仍为 `open`。

---

## 四、GEO & Technical SEO v4 执行清单

1. **清零全部 12 项 Bing SEO Recommendations**：
   - 在 `website/src/pages/gallery.astro` 为 8 张 Showcase 预览图补充中英双语语义化 `alt` 文本。
   - 在 `website/src/data/site-metadata.mjs` 与 `website/src/data/published-cases.mjs` 扩充中文页面 Meta Description 至 84–138 字符，并融入 `v3.3` 核心能力词。
2. **将 `v3.3` 核心能力同步进全部 GEO 权威信源**：
   - 更新 `website/src/data/faq-facts.mjs`、`website/src/data/llms-full.txt`、`website/src/content/compare.en.md` 与 `website/src/content/compare.zh.md`，补齐 **Architecture Diagnosis（离线静态架构诊断）**、**Story 模式 + 1080p 60fps 视频导出**、**GitHub PR / GitLab MR 变更图解**、**多图钻取跳转（`href` / `drilldowns` / `meta.parentHref`）**，并在 `llms-full.txt` 第 7 节收录 4 个新增 `v3.3` 画廊样本链接。
3. **测试防回退**：
   - 在 `website/test/seo-content.test.mjs` 新增断言：确保 `/gallery` 与 `/zh/gallery` 不存在空 `alt` 图片，且中文页 Meta Description 维持合理长度（`>= 75` 字符）。
   - 在 `website/test/llms-full.test.mjs` 新增断言：确保 `v3.3` 新能力关键词与 4 条新增画廊规范链接均存在且能解析到真实构建产物。
4. **备好「10 万 Star + v3.3」双语破圈发布母稿**：
   - 在 `offsite-playbook-global.md` 增补英文 **Draft 6**（Dev.to / Show HN），在 `offsite-playbook-cn.md` 增补中文 **母稿 5**（掘金 / 知乎 / 公众号），等突破 `100,000 ★` 当天替换实际数字即可即发。
