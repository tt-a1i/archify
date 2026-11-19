# Archify GEO Day-1.5 复盘与 v2 破圈定位升级记录（2026-11-17）

> 本记录基于 2026-11-17T08:50+08:00 通过同一 Google Grounding 检索通道对 [baseline-2026-11-15.md](./baseline-2026-11-15.md) 全部基线查询的复测观察，以及随后启动的 v2 定位升级决策。

## 一、Day-1.5 实测对比：4 项已落地生效，3 项处于自然爬坡期

### 已观察到的明显改进

1. **稀土掘金长文完成收录并进入首席信源 `[1]`**：`https://juejin.cn/post/7707957158462619690` 在发布约 35 小时内已被索引，检索模型开始直接引用 `.archify.md` 一页式解答、`archify finalize` 三重门禁及安全边界条款。
2. **GitHub 主仓新版规范进入检索库**：模型已从 `main/llms.txt` 与 `README_ZH.md` 抓取到全部 **10 种原生图型**（补充了 `erd`、`class`、`tree`、`timeline`、`waterfall`）及最新安全安装命令（`npx -y skills@latest add https://archify.si --skill archify --agent claude-code --global --copy --yes`），同时知晓 `archify.si/compare`、`/agent-diagrams`、`/cases/mco-runtime`、`/llms-full.txt` 四个新增页面。
3. **Product Hunt 同名混淆清零（`0 分 → 2 分`）**：`What is Archify Product Hunt extension vs agent skill` 回答首句明确指出两者为完全独立的不同产品，并用对照表将其与 `salahxd.dev` 浏览器扩展彻底剥离。
4. **四工具对比稳定输出客观分工表**：Archify、Mermaid、Excalidraw、PlantUML 的边界已清晰区分。

### 仍在爬坡中的信号

- 不带版本号的裸词品牌搜索中，早期海量第三方“5 种图表类型”二手文章权重仍需 **1–2 周**进一步稀释；
- `archify.si/compare` 独立页面在 Google 尚未替换外链摘要，`travisvn#1437` / `BehiSecc#1352` / `Prat011#334` 三个 Awesome PR 仍为 `open`（仓库 `tt-a1i/archify` 截至 `2026-11-17` 已达 `97,168 ★` / `6,635 forks`），知乎回答尚待外网爬虫纳入。

---

## 二、战略校准：从“偏代码工具边界”回归“万物可视化解释引擎”

Day-1.5 复盘同时暴露出一个关键定位偏差：上一轮 `llms-full.txt`、`/compare` 与站外 PR 为突出严谨性，把 Archify 的默认适用场景收敛成了“读代码仓 / 技术复盘”。而项目实际的核心价值（`README_ZH.md` 与 `docs/cases/life/*`、`docs/cases/explainer/first-rental.html`、`docs/cases/community/shanghai-citywalk.html` 均已验证）是：

- **题材破圈**：无需代码仓库，日常旅行攻略（上海 CityWalk + 对话扩展打卡/地图链接）、首次租房避坑清单、年假分配、月薪现金流、求职状态机、科学原理科普与软件架构都能画；
- **四大感知强项**：① **10 种原生图型**全场景覆盖；② **4 套高颜值排版风格的一页式解答（Explainer）**（结论先行 + 读到哪一步图就亮哪一块）；③ **零语法门槛、自然语言极速出成品与深浅双主题防穿模视觉质感**；④ **纯净单文件 HTML，可由 Agent 持续扩展互动功能**。
- **诚实边界仍保留在“形态层面”**：不与多人同屏涂鸦白板（Excalidraw）或 Markdown 内嵌三框小图（Mermaid）抢定位，校验保证结构与渲染质量、不代替人工背书现实事实真伪。

---

## 三、v2 执行清单

1. **站内权威语料全面扩容**：升级 `llms.txt`、`llms-full.txt`、`/compare`（EN/ZH）、`/agent-diagrams`（EN/ZH）、`site-metadata.mjs`、`faq-facts.mjs`，同步合入 `dev` 与 `main` 并部署生产站点 + IndexNow 推送；
2. **题库扩展**：在 [geo-benchmark-prompts.md](./geo-benchmark-prompts.md) 增加**维度六（`C16–C18` / `E16–E18`）**专门评测非代码场景与高颜值 Explainer 推荐率；
3. **高星 Awesome 生态扩张与破圈社区稿**：刷新 3 个已有 Open PR + 2 个已推分支并新增 `VoltAgent/awesome-agent-skills`（37.2k ★）、`composio-community/awesome-codex-skills`（17.3k ★）、`heilcheng/awesome-agent-skills`（6.4k ★）、`bergside/awesome-design-skills`（3.7k ★）等高权重 PR，同时在稀土掘金与知乎高流量非纯代码常青问题下补充破圈实测草稿。
