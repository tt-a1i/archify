# 可继续调查的工作目录

这层保存工具观察和未解问题，让 Agent 能查询已有事实、检查反证、跨进程继续调查。它不判断业务缺陷，不自动重扫，不增加报告状态机。命令中的 `/review` 必须位于被审源码之外；将 `/skill` 替换为本 skill 的绝对路径。

## 初始化、采集和恢复

```sh
python3 /skill/scripts/review_workspace.py --workspace /review init --source repo=/source/repo --source sdk=/source/sdk --revision '注明各仓库固定版本'
python3 /skill/scripts/source_tools.py capabilities --language python --language typescript
python3 /skill/scripts/source_tools.py --workspace /review syntax /source/repo/src/service.py --line 24
python3 /skill/scripts/source_tools.py --workspace /review metrics --root /source/repo --scope src --out /review/metrics-01
python3 /skill/scripts/review_workspace.py --workspace /review import --input /old-review/duplicates/result.json
python3 /skill/scripts/review_workspace.py --workspace /review list --provider lizard --limit 10
python3 /skill/scripts/review_workspace.py --workspace /review question list
```

init 只创建新目录，恢复时直接读取现有目录。source id 不重复；各依赖源码须显式登记。import 仅接受现有 duplicates/metrics 产物，检查版本、manifest 与当前输入，读取原始 JSON 中的完整记录，不执行分析器。原来源已变化时拒绝新导入；已经留存的历史观察仍可读取。

六个后端通过 `source_tools.py --workspace` 留存为同一 observation：operation、provider/version、parameters、analysis_profile_digest、input_identity/input_digest、coverage、status、limitations、records、native。规范化记录有 rec_ ID，观察有 ev_ ID；内容相同可复用，内容冲突拒绝覆盖。CLI 返回摘要。输入身份含声明文件散列、可枚举的文件清单及缺口，分析配置另含适配脚本散列。散列检测意外变化，不是防篡改认证。

目录包含 `workspace.json`、`evidence/ev_….json`、`questions/q_…/000001.json`。原始扫描目录保留，登记后可查询的原始 JSON 已复制到 observation；Joern CPG 本体不复制，图身份及查询结果会留存。保存只是快照，不会因为有缓存就自动跳过新的调查。

## 先摘要，再局部查看

```sh
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID --kind records --offset 20 --limit 5
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID --kind records --path src/service.py
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID --kind records --name dispatch
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID --kind records --record rec_FULL_ID
python3 /skill/scripts/review_workspace.py --workspace /review view --id ev_FULL_ID --kind raw --pointer /data/0
```

ID 必须使用真实返回值。offset 从 0 开始，limit 为 1–100；next_offset 指向下一页。路径为记录中原样返回的路径，可能是相对路径、绝对路径或 URI，不做模糊匹配；name 只匹配该记录确有的 name 字段。多条件取交集。raw 的 pointer 从 native 根开始，使用记录返回的 raw_pointer；不同提供者结构不同，不能假定都用示例的 `/data/0`。

list/view 不启动分析器，仍会检查输入散列和文件清单。freshness=checked_inputs_unchanged 只指已捕获的输入；changed/unavailable 的局部视图标记 historical_only，不能当作当前事实。status=partial、identity_gaps、provider_errors 和 producer_truncated 需分别读：分页结束不代表整个业务范围已检查。

单份 JSON（含留存序列化）限制 64 MiB，输出视图限制 128 KiB；过大时缩小页或选择更深的 pointer，不能为缩短响应重跑同一个扫描。当前实现仍解析完整留存 JSON，不是数据库索引或无限规模查询。目录身份最多枚举 10,000 文件，源码散列默认不含超过 1 MiB 文件及依赖/构建排除目录；缺口会保留。LSP/分析器可能读取其他依赖，不能据此宣称全部依赖未变。

## 一个位置的上下文与能力边界

```sh
python3 /skill/scripts/source_tools.py --workspace /review context --root /source/repo --file /source/repo/src/service.py --line 24 --column 5 --facet syntax --facet definition --facet references --facet callers --facet callees --extra-path /source/sdk
```

context 默认只查 syntax。显式选择的 LSP 项共用一次服务连接；目前默认 Pyright 仅适用于 Python，其他语言须显式提供其 `--server '["language-server", "--stdio"]'`。无法查询的项保留 unsupported/error；综合 partial 不是其余语言已有完整语义分析。syntax 返回包含选中行的最小声明，LSP 解析选中 token；在调用点两者可能不是同一对象，应先定位定义再阅读。输入为 1 基行与 Unicode 字符列，原生 LSP range 仍为 0 基 UTF-16。

capabilities 显示已安装、可用、锁定验证版本、样例验证范围及字段限制。available=null 表示需要实际规则/语言前端/输入条件判断；不是已支持，也不是肯定不支持。它是当前环境清单，安装变化后重新查询。

Joern 的 workspace build 会为 CPG 留下 `.source-review.json` 来源绑定。query 使用 `cpgFile` 时验证图散列及原输入；源码变化需重建，不执行过期图查询。没有绑定或自定义脚本不声明 cpgFile 时明确来源缺口，不能当成当前源码证明。使用 `out` 参数时复制查询 JSON；查询脚本也是输入身份的一部分。直接运行不加 workspace 的旧命令仍可用，但不会自动拥有这些留存检查。

## 将候选写成可继续的问题

新建 JSON 只填写实际问题及下一步，证据 ID 取自上面的观察：

```json
{
  "question": "保存成功但答复失败后，调用方会再次提交同一业务操作吗？",
  "scope": "service.dispatch 及真实调用方",
  "hypothesis": "返回失败可能引发重复提交",
  "status": "investigating",
  "support": [{"evidence_id": "ev_真实返回值", "record_id": "rec_可选真实记录"}],
  "counterevidence": [],
  "unknowns": ["调用方是否使用同一幂等键重试"],
  "next_query": "读取调用方失败分支、提交参数和服务端去重路径"
}
```

```sh
python3 /skill/scripts/review_workspace.py --workspace /review question create --input question.json
python3 /skill/scripts/review_workspace.py --workspace /review question show --id q_FULL_ID
python3 /skill/scripts/review_workspace.py --workspace /review question update --id q_FULL_ID --expected-revision 1 --input question-patch.json
python3 /skill/scripts/review_workspace.py --workspace /review question list --status investigating --offset 0 --limit 20
```

update 是字段级覆盖；列表整体替换，未传字段沿用。历史不覆盖，过期 revision 或并发写入冲突拒绝更新，先重新读取。question 支持 open/investigating/blocked/resolved/withdrawn；前三者必须有具体 next_query 或解除阻塞步骤。resolved 要有支持依据和 conclusion，withdrawn 要有反证和 conclusion；关闭前清空已回答或已明确收窄的 unknowns，引用必须存在且输入未变，失败/过期观察不能用于关闭。不要为通过校验删除真正影响结论的未知。

同一引用不能同时支持和反驳；同一观察的不同记录可以承担不同作用。脚本只检查引用、版本和状态，不证明结论逻辑。问题已回答可能意味着“候选不成立”或“范围已收窄”，不等于代码修复。历史关闭状态不会随源码变化自动改写；show 会返回当前证据新鲜度，必要时追加新 revision 重新调查。

依据足够才按 [output.md](output.md) 进入原有 finding、publish/render、最小验证和 recheck。finding_id 为可选人工关联，格式检查不保证报告中真有该项。未形成发现的问题可作为文档证据及覆盖说明交付，不制造问题数。

## 复用与版本比较

input_digest 与 analysis_profile_digest 分开保存。范围、工具版本、参数、适配器或源码变化时不能把“命中消失”直接算作修复；仍需原问题的复查与验收。当前未提供自动候选差异或通用运行可比性判决，按实际输入、配置及覆盖人工核定。不要把这层描述为业务不变量提取器或统一跨语言数据流引擎。
