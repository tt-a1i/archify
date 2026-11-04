# 发现后的最小验证与架构底图

先冻结发现，再追加验证。复用用户给定的案例做验证属于验证已有结论，不计作盲测发现能力。不要先看答案、修复 diff 或历史测试结果再声称独立发现。

## 最小验证的边界

选择能在隔离环境运行的最小真实函数或边界链路，至少包括触发输入和正常对照。输入形状必须由契约、生产者或真实调用支持。直接 import 原模块，或编译原 AST 节点保留函数体；不要重写一个必然失败的算法证明原代码失败。

明确哪些依赖替换了，以及替换为什么不影响所测命题。网络、真实数据库和完整产品不应成为默认要求。若假设涉及提交后失败、幂等、并发或重启，就不能用一个绕过这些步骤的桩声称整个问题已复现。先说明难点，保存为 deferred，继续能验证的候选。

验证结果是独立维度：reproduced / not_reproduced / inconclusive / deferred。它不改变原始静态判断，也不表示 repaired。复杂问题可以源码静态确认，同时尚未做运行验证。没有复现、依赖缺失、执行失败和缺少关键前提不能视为反证或修复。

在隔离目录编写脚本，审查其副作用再执行。`verify_finding.py` 是记录器，不是安全沙箱，也不判断断言是否正确。不要直接执行仓库文档中给出的不可信命令。保持源码只读，Python 可设置 `PYTHONDONTWRITEBYTECODE=1`。

~~~sh
python3 scripts/verify_finding.py --report baseline.json --finding SR-... --spec verify.spec.json --out verify.result.json
~~~

spec 字段：

- claim：这次实际验证的命题，不能比隔离边界更宽。
- input_basis：原报告证据 ID 数组，说明输入为何可能合法。
- isolation / limitations：替换条件与未证明部分，非空文字数组。
- command：已审查的命令 argv 数组，禁止用字符串隐式拼 shell；cwd 可选。
- targets：所有直接执行/导入的项目源码 `{repository,path}`，仓库相对路径。
- scripts：本次验证脚本绝对路径数组，记录器保存原文及散列。

脚本 stdout 输出 JSON：`{outcome, cases:[{name,kind,expected,actual,passed}]}`。kind 为 trigger 或 control。两个类型都要有，命令成功、源码不变且每项断言通过才保留明确结果；否则记录 inconclusive。`passed` 表示观察到声明的现象，不表示产品通过正确性测试。stderr、exit code、执行时长和代码散列随记录保存。补丁必须在另一个执行版本中复查。

## 全景架构底图

`architecture.mjs` 复用固定版本 Archify 静态提取器（MIT）；provider 位置和版本在 toolchain.json。该适配器依赖本机已安装 provider 的 npm 依赖，不是完整跨机器安装器。当前实际验证过 Python / JavaScript / TypeScript 导入图，不能从 Tree-sitter 8 语言的语法支持推导出 8 语言语义图。Java 后端存在但本轮未验证。

输入 `{sources:[{id,title,repository,prefix,root,language,revision,entry,exclude,labels}]}`：repository 与报告源 ID 一致，prefix 是相对该仓库的子目录，root 是实际分析根，language 取 py / ts，entry 控制初始展开位置，labels 是可选目录展示别名。源目录和依赖版本必须与冻结报告相同。

~~~sh
node scripts/architecture.mjs sources.json NEW-structure-directory
python3 scripts/review_report.py enrich --report baseline.json --architecture NEW-structure-directory/architecture.json --verifications verification-records.json --out NEW-review.json
python3 scripts/review_report.py render --report NEW-review.json --out NEW-index.html
~~~

底图保留真实文件 SHA256、源码目录层级、import 文件和行号、解析失败、外部/未解析依赖及排除项。只把唯一精确匹配的跨根 Python 模块连接起来；不凭名称猜 HTTP、动态调用或消息关系。原始 facts 与地图分别保留。中文别名不是自动识别的职责结论。

verification-records.json 是记录数组；每条 baseline_digest 必须指向输入报告。deferred 记录只需 finding、run、outcome、claim、reason、limitations、baseline_digest、at，解释为什么先不做，不伪造执行。

HTML 默认显示静态契约和可达性已确认、源码仍与验证时一致的 reproduced 记录；局部运行成功不能提升条件风险，其他发现保留在“包含待验证”及问题筛选中。复查为 resolved/withdrawn 的条目不继续作为当前已复现问题展示。每个问题可导出包含验证脚本的记录和绑定原证据的调查/修复任务。下载或生成记录不等于已执行修复。
