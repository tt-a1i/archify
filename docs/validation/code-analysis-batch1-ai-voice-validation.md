# 第一批 AI Voice 真实项目闭环验收

日期：2026-10-17。结论：CLI 导出任务 → 编码 AI 修改 → 证据失效检测 → 同配置重分析的案例完成；局部行为对照通过，非 UI 测试没有新增失败。全项目测试未完成，不宣称整体项目门禁通过。

## 来源与执行范围

- 项目：本机 `C:/Users/hhu63/OneDrive/桌面/ai-voice-assistant`。
- 源码提交：`591f6bcaf188d54a685e7b5fc01dba021abbf1c6`，通过 `git archive HEAD` 创建独立副本。
- 副本：`out/batch1-ai-voice-validation/project/`。未复制未跟踪的 `.env`、原工作树修改或原项目的 venv；测试仅复用现有 Python 环境。
- 原项目源码未修改。未安装、更新 live Archify，未启动语音主程序或向外部项目提交修改。
- 分析器：Archify `3c4c4766` 加当前 Claude C1–C5 未提交工作树。执行重构的 AI 是本聊天 Codex，本次未调用 Claude 模型。

与 CodeBoarding 案例相同，副本位于 Archify 工作树内，任务的 Git 背景信息继承外层 Archify；真正的 AI Voice 来源以上述 archive 提交为准，不把任务中的 Git HEAD 当作 AI Voice 提交。实际源码与证据哈希仍来自副本。

## 选择的问题与修改

初次 Python 分析：182 个源码文件、58 项 findings（16 warning、42 info）。使用默认配置、默认阈值，没有配置边界规则。

问题 `COMP-b9ebcd902b66` 位于 `utils/text_split.py` 的 `split_stream`：圈复杂度 19、嵌套深度 5。该函数把 LLM 流式文本分成适合语音合成的片段，是实际使用路径，不是演示或人为插入的问题。

导出任务 `TASK-0cea347540df` 的 JSON 与 Markdown 来自同一生成器；提供已知项目命令 `python -m tests.run`，初次 `--require-valid` 校验通过，证据状态为 `valid`。任务只允许修改 `utils/text_split.py`。

Codex读取任务及完整源码后，将“寻找切分位置”的规则提取成 `_find_cut`：按原顺序优先句末标点、长度达到阈值后的逗号/停顿、长度翻倍后的硬切。`split_stream` 继续负责缓冲、首段阈值、空白过滤和流式产出。没有改变 public 签名、默认配置、标点集合、函数名字或分析阈值。

这次拆分按规则职责划分，不增加机械转发函数，也不通过移除检查来让问题消失。它改善可读性，未宣称修复已有运行错误。

## 实际结果

- `split_stream`：复杂度 **19 → 10**，嵌套 **5 → 3**。
- 新增 `_find_cut`：复杂度 **8**，嵌套 **2**，未产生新告警。
- 修改后旧任务校验为 `changed`，`--require-valid` 返回 1，符合证据失效预期。
- 重分析仍覆盖 182 个源码文件，规则和配置未变；findings **58 → 57**。
- `comparison.comparable: true`、`reasons: []`、`new: []`；目标 finding 出现在 `notDetected`。
- 56 项旧 finding 未变，1 项覆盖 utils 模块的既有 hub finding 证据摘要随源码变动刷新；它不是新增问题。

## 行为与项目测试

额外行为对照：**12810 组全部一致**。测试直接分别加载原始与最终模块，对照产出的片段、输入 chunk 消费与输出的交错顺序、上游异常的传播时机。覆盖默认和显式长度、空输入/空 chunk、空白、多种中英文标点、Unicode、短首段、停顿兜底、硬切以及 `min_len` 大于长度限制的情况；其中 5000 组使用固定种子 `20261017` 的随机文本和分块。该对照验证新旧行为一致，不代替真实语音设备集成测试。

项目已有 `python -m tests.run` 在 UI 测试期间提前退出，虽然进程退出码为 0，但没有生成最终汇总，因此记录为**未完成**，不计作通过。未据此推断退出的具体根因。

随后使用项目自身支持的名称过滤，在同一副本、同一 Python 环境分别执行原始和最终版本：

```powershell
python -m tests.run asr llm tools utils voice_lock test_main
```

两轮均为 **474 项执行，465 通过、9 失败、21 跳过**；9 项 FAIL/ERROR 的测试名称完全一致。跳过统计沿用原 runner，既包含文件级导入失败，也包含需要 pytest fixture 的用例，不能解释为 21 个完整测试文件。没有把这批检查称作全套测试。

失败项包含 search 的 preflight/错误恢复、新闻归档异常、缓存到期及角色碰撞检查；本次没有逐项修复或归因。原文件复查完已恢复最终修改，副本文件 SHA-256 与 `text_split.after.py` 一致。

## 复现与证据

在 Archify 仓库根目录，原始副本状态下执行：

```powershell
node archify/modules/code-analysis/bin/check.mjs out/batch1-ai-voice-validation/project --language py --out out/batch1-ai-voice-validation/before --fail-on never --json
node archify/modules/code-analysis/bin/task.mjs out/batch1-ai-voice-validation/before --finding COMP-b9ebcd902b66 --root out/batch1-ai-voice-validation/project --command 'python -m tests.run' --format json --out out/batch1-ai-voice-validation/task.json --require-valid --json
```

应用已保存的修改后：

```powershell
node archify/modules/code-analysis/bin/task.mjs --verify out/batch1-ai-voice-validation/task.json --root out/batch1-ai-voice-validation/project --format json --out out/batch1-ai-voice-validation/task.after.json --require-valid --json
node archify/modules/code-analysis/bin/check.mjs out/batch1-ai-voice-validation/project --language py --out out/batch1-ai-voice-validation/after --compare out/batch1-ai-voice-validation/before/findings.json --fail-on never --json
```

`--fail-on never` 仅用于记录已有问题并完成对比，退出码 0 不代表无问题；需同时核对 comparison 和行为证据。

全部本地材料位于 `out/batch1-ai-voice-validation/`：

- `source.zip`、`text_split.before.py`、`text_split.after.py`、`change.patch`：来源及修改。
- `before/`、`after/`、`before-receipt.json`、`after-receipt.json`：原始分析数据及回执。
- `task.json`、`task.md`、`task-receipt.json`、`task.after.json`、`verify-after-receipt.json`：任务及证据状态。
- `verify_behavior.py`、`behavior.json`：行为对照。
- `tests-before.log`：没有完成汇总的全项目测试运行。
- `nonui-before.log`、`nonui-after.log`、`summary.json`：可完成的项目检查及结果对照。

这些是本地复核证据，未把外部源码或测试数据加入 tracked fixtures。本案例不包含页面导出按钮、UI 可用性或真实音频端到端验收。
