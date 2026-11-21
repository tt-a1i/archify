# Archify GEO + SEO Day-6 复盘与 v3 止血升级记录（2026-11-21）

> **评测性质**：基于 `2026-11-21` 在 Google Search Console（`sc-domain:archify.si`）、Google Grounding 实测检索与 GitHub API 上直接观测到的数据，以及由此触发的 GEO / Technical SEO v3 修复动作。
>
> **统计窗口说明**：截至 `2026-11-21 08:00 CST`，GSC 效果报告数据更新至 `2026-11-18`（即包含 `11/15` GEO v1 上线后的 4 天放量，尚未完整覆盖 `11/19` 凌晨部署的 GEO v2 通用破圈定位）。

---

## 一、Google Search Console（真实 SEO + 生成式 AI 数据）

### 1. 网页自然搜索表现（Web Search，更新至 2026/11/18）

- **全周期概览（2026/10/07 – 2026/11/18）**：总点击 **`9,328`** 次；GSC 数据洞见提示品牌词 **`archify` 近期曝光涨幅 `+117%`**。
- **近 28 天（10/22 – 11/18）**：总点击 **`6,740`**、总曝光 **`5.65 万`**、平均点击率 **`11.9%`**、平均排名 **`3.5`**（647 个有数据查询词）。
- **近 7 天（11/12 – 11/18）**：总点击 **`1,670`**、总曝光 **`1.51 万`**、平均点击率 **`11.1%`**、平均排名 **`3.8`**（350 个查询词）。
- **核心着陆页（近 28 天）**：
  - `https://archify.si/`：6,571 点击 / 54,053 曝光 / 12.2% CTR / 排名 3.4
  - `https://archify.si/start`：99 点击 / 6,917 曝光 / 1.4% CTR / 排名 4.6
  - `https://archify.si/zh`：29 点击 / 866 曝光 / 3.3% CTR / 排名 5.8
  - `https://archify.si/zh/start`：18 点击 / 100 曝光 / 18.0% CTR / 排名 4.2
  - `https://archify.si/guide`：13 点击 / 1,916 曝光 / 0.7% CTR / 排名 1.9
  - `https://archify.si/agent-diagrams`：9 点击 / 666 曝光 / 1.4% CTR / 排名 6.1
  - `https://archify.si/compare`：**2 点击 / 32 曝光 / 6.2% CTR / 排名 5.9**（`11/15` 上线后 3 天内即编入索引并获真实点击）
- **外部反链（Links）**：全站共 **1,954** 条外部链接，其中 **`github.com` 占 1,050 条（53.7%）**，其余为导航收录站（`biapy.com` 39、`vibecoding.app` 32、`lessaitools.com` 26、`hebbmind.com` 21）。`/compare` 缺少来自技术社区的高权重外部反链。

### 2. GSC「生成式 AI 功能（Beta）」官方数据

- **近 28 天（10/22 – 11/18）**：总曝光 **`1.57 万`**（占全站网页搜索总曝光的 **27.8%**）。
  - 曝光页分布：`https://archify.si/`（15,020）、`/start`（610）、`/zh`（154）、`/agent-diagrams`（149）、`/guide`（59）、`http://archify.si/`（14）、**`/compare`（13）**、`/zh/agent-diagrams`（13）、`/gallery`（11）、`/zh/start`（6）。
- **近 7 天日级放量曲线（总计 `4,820` 曝光）**：
  - `11/12`：**697** | `11/13`：**658** | `11/14`：**271**（周末） | **`11/15`（GEO v1 上线）：`550`** → **`11/16`：`822`** → **`11/17`：`882`** → **`11/18`：`935`**。

### 3. 索引与技术 SEO 排查（关键发现）

- **Sitemap 状态**：`https://archify.si/sitemap.xml` 状态为「成功」（发现 38 条 URL），但**上次读取时间停在 `2026-11-15`**；且 `11/19` v2 上线后尚未补跑 `indexnow.mjs --submit`。
- **索引健康度（2026/11/16 数据）**：**35 个已编入索引** / **750 个未编入索引**，其中 **`未找到 (404)` 高达 613 个**。
- **404 根因定位**：GSC 404 样本全部为 `https://archify.si/panels/1/blocks/0/rows/2/cells`、`https://archify.si/panels/1/blocks/1/items/3/target/diagram` 等路径。排查证实它们源于已发布的 Explainer HTML（`docs/cases/explainer/*.html`）内嵌 `<script id="archify-explainer-prepared">` 的 `sourceMap` RFC 6901 JSON Pointer 字符串（仅包含 `/panels/`、`/answer/`、`/meta/`、`/sources/` 四个根前缀），被爬虫误当作站内相对路径抓取，严重浪费抓取预算（注：实际源码文件在 `/gallery/sources/` 与 `/cases/` 下，不在 `/sources/` 根下）。

---

## 二、Google Grounding 实测与 GitHub 增长（2026-11-21）

- **GitHub 仓增速**：`tt-a1i/archify` 达 **`98,329 ★` / `6,714 forks`**（相比 `2026-11-17` 的 `97,168 ★` / `6,635 forks`，4 天净增 **`+1,161 ★`** / **`+79 forks`**）。6 个高星 Awesome PR（`VoltAgent#1432`、`composio#443`、`travisvn#1437`、`BehiSecc#1352`、`heilcheng#699`、`Prat011#334`）均保持 `open` 等待维护者合入。
- **10 组实测查询结果**：
  1. **英文非代码破圈词**（`AI turn travel itinerary or everyday workflow into interactive HTML explainer`）：**重大突破** —— Archify 成为 **Method 1（唯一具名推荐工具）**，直接引用 `https://archify.si/`。
  2. **中文非代码破圈词**（`除了写代码 Claude Code Cursor 旅游攻略 租房 可交互 HTML 工具`）：**重大突破** —— 作为 **通用可视化与解释器工具** 上榜，准确识别旅游与租房决策流。
  3. **官网直接能力检索**（`site:archify.si` & `"Archify" 10种图型 Explainer 介绍`）：准确输出 **10 种图型 + 无需仓库纯文本 + 新安全安装命令**，直引 `https://archify.si/` 与 `https://archify.si/guide`。
  4. **中英文品类推荐（E4 / C4）与同名消歧（E1）**：稳居 **#1**；Product Hunt 同名扩展消歧保持干净（未复发混淆）。
  5. **未攻克短板 ① 品牌裸搜惯性**：`"Archify" diagram agent skill archify.si OR tt-a1i/archify` 与中文社区词仍优先复用 2026 年 9 月高权重旧媒体（量子位/36kr/Medium），继续复读“5 大图型”和旧安装命令 `npx skills add tt-a1i/archify -g`。
  6. **未攻克短板 ② 英文 Mermaid 替代泛词**：`Mermaid alternatives interactive architecture diagram AI coding agent` 仍被 `Eraser.io`、`D2`、`LikeC4`、`Excalidraw via MCP` 占据，`/compare` 缺少外部反链推高词权重。

---

## 三、v3 改进动作清单

1. **封堵 613 个 Explainer JSON Pointer 假 404**：在 `website/scripts/publish-seo.mjs` 为 `robots.txt` 增加 `Disallow: /panels/`、`/answer/`、`/meta/`、`/sources/`（保留 `/gallery/sources/` 与 `/cases/` 可抓取以读取 `X-Robots-Tag: noindex`）。
2. **Temporal Supersession + 权威媒体 `subjectOf`**：在 JSON-LD `SoftwareApplication.subjectOf` 锚定两篇已核验量子位报道（`2026-09-01` & `2026-09-13`），并在首页第 6 条 FAQ 与 `llms-full.txt` 增设“从早期 5 种图/旧命令到当前 10 种图+Explainer/官方安装命令”的显式时间覆盖说明。
3. **`/compare` 竞品词扩容 + 英文技术长文母稿**：在 `/compare`、`/zh/compare` 与 `llms-full.txt` 正式纳入 `LikeC4`、`Eraser.io`、`Excalidraw (including MCP)` 客观边界对比，并在 `offsite-playbook-global.md` 新增面向 Dev.to / Hashnode / Medium / r/ClaudeAI 的英文对比实战母稿（Draft 5）。
4. **上线后立即补跑 IndexNow + GSC Sitemap/URL 重提交**：合入 `dev` → `main` 并等待生产部署成功后，执行 `node website/scripts/indexnow.mjs --submit`（覆盖 `main` 38 条 URL），并在 GSC 触发 Sitemap 重读与首页/对比页实时编入索引请求。
