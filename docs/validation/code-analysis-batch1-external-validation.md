# 第一批外部真实项目闭环验收

日期：2026-10-17。范围：CLI 导出任务 → 编码 AI 阅读并修改 → 证据失效检查 → 同配置重新分析。页面导出 UI 与视觉验收不在本案例内。

## 项目与隔离方式

- 外部项目：CodeBoarding，本机源码 checkout `C:/Users/hhu63/projects/CodeBoarding`。
- 原始提交：`130c1c79b2f05383989e5b9a801ee048b88b4cc9`。
- 用 `git archive HEAD` 导出 tracked 内容，解压到 `out/batch1-external-validation/project/`；没有复制 `.env`、未跟踪文件或原项目的工作树修改。
- 原项目未修改；所有重构和测试发生在隔离副本。未安装或更新 live Archify，未创建外部项目 PR。
- 分析器：Archify `3c4c4766` 加当前 Claude C1–C5 未提交工作树；不是已发布版本。
- 执行修改的编码 AI：本聊天 Codex；没有调用 Claude 模型，也没有冒称为 Claude 的执行结果。Claude交付的分析/任务功能源码未在本次验收中修改。

本次隔离副本位于 Archify 工作树内，提取器捕获的 Git 背景 URL/HEAD 来自外层 Archify。真正的外部源码出处以上面的 archive 提交为准，不能用任务里的 Git HEAD 指认 CodeBoarding 版本。源码证据摘要仍针对隔离副本中的实际内容；此项作为任务来源展示的后续改进，不伪造结果字段。

## 具体任务与修改

首次分析：Python、303 个源码文件、82 项 findings（22 warning、60 info），默认规则与默认阈值。未配置架构边界。

选择 `COMP-5ef5f7a5823d`：`health/config.py` 中 `_load_health_exclude_patterns`，嵌套深度 5、圈复杂度 6。它是可改善阅读的维护信号，未将其宣称为运行错误。

生成的任务为 `TASK-d4f442b81a7f`，JSON 和 Markdown 同源，初次工作树校验为 `valid`。任务限定修改 `health/config.py`，要求保持签名、返回值、异常及副作用。

Codex读取完整源码与项目规范后，采用“缺失 `.healthignore` 时提前返回”的 guard clause，减少正常读取路径的一层嵌套；同时给返回列表补 `list[str]` 注解，避免提前返回产生新的 mypy 推断错误。没有提取机械 helper，没有改函数名、规则、阈值或扫描范围。

验证特别覆盖：空行、注释、空白、内联 `#`、Unicode、文件缺失、exists/open/context enter/迭代/close 异常，以及迭代中途失败时保留已读取结果。原代码的广义异常捕获与 debug/warning 日志行为均保留。

## 实际流程与可复现入口

以下命令从 Archify 仓库根目录执行。目录为本次本地证据，未作为发布 fixture 提交。

```powershell
node archify/modules/code-analysis/bin/check.mjs out/batch1-external-validation/project --language py --out out/batch1-external-validation/before --fail-on never --json
node archify/modules/code-analysis/bin/task.mjs out/batch1-external-validation/before --finding COMP-5ef5f7a5823d --root out/batch1-external-validation/project --format json --out out/batch1-external-validation/task.json --require-valid --json
node archify/modules/code-analysis/bin/task.mjs out/batch1-external-validation/before --finding COMP-5ef5f7a5823d --root out/batch1-external-validation/project --out out/batch1-external-validation/task.md --require-valid --json
# 编码 AI 读取任务并修改 health/config.py，补丁保存于 change.patch。
node archify/modules/code-analysis/bin/task.mjs --verify out/batch1-external-validation/task.json --root out/batch1-external-validation/project --format json --out out/batch1-external-validation/task.after.json --require-valid --json
node archify/modules/code-analysis/bin/check.mjs out/batch1-external-validation/project --language py --out out/batch1-external-validation/after --compare out/batch1-external-validation/before/findings.json --fail-on never --json
```

修改后的旧任务校验为 `changed`，`--require-valid` 返回 1，这是预期的失效检测，不是导出失败。首次导出命令需在原始副本上执行；不能在最终已修改副本上期待再次得到 valid。

`--fail-on never` 用于保存和比较整个已有问题集，CLI 的退出码 0 只说明分析完成，不说明项目无问题。最终验收另行检查 comparison、目标函数指标及行为测试。

## 结果与验证

- 函数仍存在，名字与职责不变；圈复杂度保持 6，嵌套从 5 降至 4。
- 同配置重分析：303 文件、81 项 findings；`comparison.comparable: true`，`reasons: []`，`new: []`，目标 ID 位于 `notDetected`。
- 80 项旧 finding 未变；1 项覆盖 health 模块的既有 hub finding 证据摘要变化。这是文件内容变动导致的预期证据刷新，不是新增问题。
- 原项目已有 `tests/health/test_config.py`：9 项通过。
- 额外使用 AST 提取同一新旧函数，1813 组输入/故障组合的返回、异常、日志完全一致。该隔离检查不等同于整项目集成测试；它专门补足本次读取行为的异常路径。
- Black：修改文件通过 `--check`。
- mypy：候选仅剩 `static_analyzer/engine/process_memory.py:14` 的 Windows `os.sysconf` 错误；使用 `--shadow-file health/config.py ../config.before.py .` 对原始源码复查，错误完全一致。303 个源码文件均被检查，没有本次引入的类型错误。
- 外部项目要求的完整命令 `python -m pytest --cov=. --cov-report=term --cov-fail-under=80`：候选 2007 通过、69 失败、4 跳过，覆盖率 84.08%。完整套件未通过，不能宣称项目全绿。
- Archify 当前工作树的四项 Code Analysis Chrome 浏览器回归：4 通过、0 跳过。该结果不代替尚未实现的 AI 任务页面入口验收。

Python 测试环境为隔离 venv（3.12.11），通过 `PYTHONPATH` 只读复用本机 CodeBoarding 已安装的依赖；未重新同步其 lockfile，因此不构成干净依赖环境的发布验证。分析提取器使用现有 Python 3.11.9；前后保持相同，303 文件均完成提取。

原始文件完整套件复查：同样为 2007 通过、69 失败、4 跳过；逐项比较 69 个失败测试名称，候选与原始完全一致。完整套件不是绿色，但这次改动没有新增失败；未逐项修复或归因外部项目的基线失败。原始文件复查后已恢复最终修改，文件 SHA-256 与 `config.after.py` 一致。

结论：第一批的“外部真实项目 CLI 交接闭环”案例完成，并有行为与基线对照证据；不宣称外部项目所有门禁通过，不代表第一批 U1–U6 页面功能已完成。后续 UI 接入应复用该案例走页面导出与重新分析。

## 本地证据索引

均位于仓库根目录的 `out/batch1-external-validation/`：

- `source.zip`：原始外部提交的 archive；`config.before.py` / `config.after.py`：修改前后文件。
- `before/` / `after/`：完整事实、findings、overview 与 review JSON。
- `before-receipt.json` / `after-receipt.json`：两轮分析回执。
- `task.json` / `task.md`：真实导出任务；`task.after.json` / `verify-after-receipt.json`：失效校验结果。
- `change.patch`：可审阅的实际修改；`verify_behavior.py` / `behavior.json`：行为对照及结果。
- `project-tests.log` / `format.log` / `mypy.log` / `mypy-before.log`：项目局部检查。
- `full-project-tests.log` / `full-project-tests-before.log`：候选及原始文件全套结果。
- `archify-browser.log`：当前分析器工作树的浏览器回归。

这些是本地复核证据，非稳定发布资源，不将外部项目源码复制进 Archify 的 tracked fixtures。
