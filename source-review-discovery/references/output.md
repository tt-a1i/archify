# 可视化交付与复查

统一交付版本化 JSON 和由它生成的离线 HTML。JSON 是事实与判断的载体，HTML 是视图。不要为聊天、图和修复任务分别编造结论。工具检查结构、引用及文件一致性，不替代语义审查。

## 先决定怎样向读者解释

面向没有参与调查的开发者、产品同事和负责人。每项先回答：
1. 用户、下游或维护者会遇到什么影响？标题写行为后果或具体维护负担，内部函数和字段放详情。维护性条目说明一项改变需要修改哪些位置；不要把预期改进收益写成已证实的故障。
2. 什么条件下发生？条件没有证明时直接写“还需确认”。
3. 哪一步产生差异，影响到哪里？区分保存、执行、回答和显示；展示缺失不是数据丢失。
4. 已有保护能做什么，为什么没有覆盖这条路径？
5. 下一步是补证、修复还是重新复查？

机器标签 static_confirmed / conditional 保留；页面使用“代码路径已确认 / 条件还需确认”。这只指源码论证，不代表线上复现。不要用圆点数、百分比或健康分暗示可信度。五项论证检查放详情，不塞进总览。

按解释的关系选图：
- 数据流/分支对照：同一输入经过不同消费者，哪里遗漏、转换或使用不同值。
- 对照表：两个模块的错误码、字段、状态含义或版本选择是否一致。
- 失败窗口图：先保存什么，后执行什么，中间失败留下什么，恢复从哪里继续。
- 决策流程图：哪项判断把一个事实错误地解释成另一结论。
- 时序图：已核实的多方交错。不能把 A、B 同时存在画成 A 导致 B。

图必须解释箭头或列的含义，显示具体未知。节点和边分别关联证据；inference 只表示推导，不能伪装为分析器自动证明。图是审查者整理的解释，不是完整调用图。普通 SVG/HTML 足够，不要求全仓拓扑框架。

支持另附真实目录/import 全景图作为主入口，证据文件关联到模块，再展开上述单项图。发现后的最小验证单独追加，不覆盖发现或冒充修复复查；格式及命令见 [verification.md](verification.md)。

共同输入的路径对照可使用 [结构化证据画布](evidence-scene.md)。`review.json` 保存事实、判断和闭环；`scene.json` 只绑定呈现分区与场景。v2 支持多节点分区及原图中的分叉、汇合、回边；v1 继续兼容。先 `validate --report review.json --scene scene.json`，再 `render --report review.json --scene scene.json --out index.html`。不传 `--scene` 仍生成原报告。版本校验通过不代表语义判断正确。

## 产物与命令

scripts/review_report.py 只需 Python 标准库。每轮用新目录；已有输出拒绝覆盖。被审源码默认只读，可以创建审查产物。

~~~sh
python3 /path/to/skill/scripts/review_report.py publish --input draft.json --out runs/initial/review.json
python3 /path/to/skill/scripts/review_report.py render --report runs/initial/review.json --out runs/initial/index.html
python3 /path/to/skill/scripts/review_report.py validate --report runs/initial/review.json
python3 /path/to/skill/scripts/review_report.py verify --report runs/initial/review.json
python3 /path/to/skill/scripts/review_report.py task --report runs/initial/review.json --finding SR-... --out task.json
~~~

templates/review.draft.json 是空白运行骨架，不附带问题或答案。替换路径和版本，再依据下面的字段契约填写实际发现、presentation、证据和 graph.kind。publish 从文件读取真实摘录和 SHA256，拒绝越界行号、目录越界和断开的引用。

浏览器能筛选、看图、看源码、下载相同 JSON/任务；不会启动分析器或修改产品。Agent 按 skill 继续工作，生成新版报告。新鲜度是生成时校验，非实时监控。图表、字体和源码摘录内嵌，可离线打开。

## 输入契约

draft.json 顶层：
- project：项目与范围名称。
- run：id、label、mode(source/runtime)、reviewer、sources、coverage、tools。
- run.sources[]：id、绝对 root、revision。声明实际 Git/锁文件版本；快照需说明来源，文件散列另采集。
- coverage：status(complete/partial)、checked 范围标识数组、excluded、limitations。complete 仅指声明范围，不是全仓。
- evidence[]：id、repository(对应 source id)、相对 path、1 基 start/end、kind(source/document/tool)、label。
- findings[]：以下发现记录。id/run 由 publish 填入。

finding：
- key={repository,subject,concern}：逻辑对象及具体违反关系，组成稳定身份。标题/行号变化不改 ID；重命名须核对身份。
- title、severity(P0..P3)、verdict(static_confirmed/conditional/design_question/withdrawn)、scope[]。
- trigger、impact、recommendation、next_query：触发、影响、最小改进、下一次可执行调查。
- presentation={summary,condition,caption}：读者摘要、发生条件、图意解释，不改变原结论。
- checks 固定五键 contract/reachability/violation/impact/protections，每项 {state:supported/open/contradicted,reason,evidence:[ID]}。这是论证记录，不是业务问题分类。静态确认须五项 supported；非 open 必须引用。protections 表示检查了保护并限定结论，不表示穷尽全系统。
- counterevidence[]：{reason,evidence}；gaps[]：未知。关键未知同时使相关 check=open，不能藏在脚注。
- graph={kind,nodes,edges}。kind 为 data_flow/comparison/failure_window/decision_flow。节点 {id,title,role:step/failure/guard/unknown,detail,evidence}，可用非负整数 column/row 排分支。边 {from,to,label,basis:source/inference/unknown,evidence}。unknown 允许无证据，其他必须引用。
- 对照表使用 graph.comparison={columns:[标题],rows:[{cells:[单元格],evidence:[ID],attention:可选布尔}]}，列数须一致。纯对照表可省略 nodes/edges，不维护未使用的第二套节点图。
- acceptance[]：{id,text}，写原触发、相邻正常路径及有关保护应满足什么，不堆通用清单。

原始工具 JSON 保留；可以用 kind=tool 引用文本输出及错误。模式命中不等于业务缺陷。散列仅检测变化，不防恶意篡改。

`duplicates` / `metrics` 的 investigation_signal 不直接转成 finding。将 provider/version 与扫描范围记入 run.tools/coverage，保留 manifest 和原始结果；论证成立后仍引用真实源码。工具产物在源码根目录之外时，可为该次产物目录另声明 run.sources，再用 kind=tool 引用；不把分析器选出的范围当作已检查的所有业务路径。null 指标、partial/stale、截断和排除项须按实际情况进入限制或下一次查询。

## 连接调查记录

[调查工作目录](investigation-workspace.md) 中的 observation 和 question 是调查过程资料，报告继续使用上面的已有契约。为工作目录声明独立的 run.sources 项，记录其来源及当前快照说明；用 kind=tool 引用 `evidence/ev_….json` 的有关行，用 kind=document 引用 `questions/q_…/000003.json` 等具体修订。源码契约与违反路径仍引用真实 source 文件，不用调查者自己的结论代替源码证据。

允许 findings 为空，同时交付已查范围、证据和未解疑问。question 的 resolved/withdrawn 不自动创建或关闭 finding，已有发现的关闭仍走 recheck。question.finding_id 仅作人工关联，脚本只校验 ID 形状；交付前核对它确实属于报告。观察 ID、问题 revision 和最终 finding ID 各有用途，不混用。列出问题只显示历史判断，采信前用 question show/view 检查当前输入及缺口。

## 复查闭环

导出任务不等于已执行或修复。证据一致且结论已确认为 repair 候选；过期、条件风险或待复查为 investigate。已有授权允许修复就继续，否则完成调查交付；不为凑闭环擅自改业务。

1. 用 verify --root REPO=/current/checkout 对当前目标核对引用文件；重映射不改变基线。
2. 保留原触发与验收，重新查新版本和保护。运行验证不是发现问题的前置条件。区分 source/runtime。
3. 新建复查草稿，绑定 digest；重新采集证据，证据 ID 不重名。

~~~json
{
  "baseline_digest": "由 digest 子命令取得",
  "run": {
    "id":"recheck-02","label":"新版本源码复查","mode":"source","reviewer":"审查者",
    "sources":[{"id":"repo","root":"/new/snapshot","revision":"实际版本"}],
    "coverage":{"status":"complete","checked":["原问题的 scope"],"excluded":[],"limitations":[]},
    "tools":["实际使用的工具"]
  },
  "evidence":[{"id":"new-E1","repository":"repo","path":"src/service.py","start":1,"end":20,"kind":"source","label":"新保护"}],
  "items":[{"finding":"SR-...","outcome":"resolved","basis":"source","reviewer":"审查者",
    "reason":"原违反路径在哪里阻断，正常路径为何保留。",
    "evidence":["new-E1"],
    "acceptance":[{"id":"A1","status":"passed","reason":"逐项解释","evidence":["new-E1"]}]}]
}
~~~

~~~sh
python3 review_report.py digest --report baseline.json
python3 review_report.py recheck --report baseline.json --input recheck.draft.json --out runs/recheck-02/review.json
python3 review_report.py render --report runs/recheck-02/review.json --out runs/recheck-02/index.html
~~~

- resolved：范围 complete，包含原 scope，原 acceptance 全 passed，逐项引用本轮证据。区分源码复查/运行复验，不称线上已验证。
- present：问题仍在；之前 resolved 则重新打开。
- inconclusive：无命中、未覆盖、工具失败、不能核定，保留待复查。原问题未列入新 items 也自动保留，不会静默消失。
- withdrawn：新反证推翻旧结论，有理由及本轮证据；区别于代码修复。

历史发现、图和证据不改，新 run/event/evidence 追加。原图描述原问题，当前状态来自最新事件。partial 不准关闭，旧证据不能冒充新依据，不全的验收不准 resolved。脚本无法证明 passed 的语义，必须说明审查者与依据。
