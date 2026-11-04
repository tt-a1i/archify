# Source Review Discovery

从源码提出可反证的调查假设，保存证据和未知，按需执行隔离最小验证，再交付“系统全景 → 问题路径 → 源码与验证 → 修复任务”的本地报告。图与分析器输出都不自动等于缺陷结论。

这是独立的实验性 skill，未改变 Archify 的主命令、发布包或已安装版本。入口是 [SKILL.md](SKILL.md)。将整个目录放入支持本地 skills 的 Agent 配置目录即可使用；也可以直接要求 Agent 读取它。不要只复制 SKILL.md。

## 全景与问题路径

全景按实际源码目录分区，模块显示文件/行数、问题位置及关联发现。点击模块查看其文件和带原始位置的静态 import；点击发现进入结构化问题路径。路径图展示输入字段、处理变化和验证输出，点击节点查看源码。返回全景保留模块选择和阅读位置。

全景不把 import 画成生产调用流，也不以“没有发现”表示安全。默认问题列表只展示契约已确认、原文件仍一致且完成最小验证的未解决发现；其余记录可筛选查看。数量来自同一份报告，模块之间可关联同一发现，全局数量不重复相加。

查看器复用固定版本 Archify 的相机、聚焦、主题与动效；我们实现数据绑定、节点内容、模块查阅及页面导航。源码摘录与历史运行结果保持独立。报告 HTML 完全内嵌，可离线打开。

配对视图的语义、继承样式与当前交互边界见 [全景设计说明](references/panorama-design.md)。

```sh
python3 scripts/review_report.py publish --input draft.json --out .source-review/run-1/review.json
# 在新版本中 enrich 架构底图及验证；scene 必须绑定最终 report digest。
python3 scripts/review_report.py bundle --report .source-review/run-1/review.json \
  --scene .source-review/run-1/scene.json --out .source-review/run-1/site
```

`bundle` 接受多个 `--scene`，每项对应一个 finding。没有专门 scene 的发现链接到通用证据视图。需要已提取的 architecture；只有单项发现时仍可用 `render`。输出目录必须不存在，绑定错误或渲染失败不会替换旧报告。

报告内含源码、绝对路径、验证脚本及执行记录，属于被审项目资料。**只提交此 skill 的通用实现和测试代码；报告、截图、快照、运行时与验证产物留在 `.source-review/` 或仓库外。** `.gitignore` 已排除本地默认输出；自定义输出位置仍需自行保持在提交范围外。

## 运行环境

报告协议与校验只需 Python 3.11+。原生画布需要 Node.js 18+；本轮浏览器验证使用 Node.js 24。分析器按调查需要安装，未安装就是能力缺口。

从本目录运行以下命令，为本 skill 建独立运行时：

```sh
python3 -m venv .runtime/venv
.runtime/venv/bin/python -m pip install -r requirements-tools.txt
npm install --prefix .runtime/node --save-exact pyright@1.1.414
# 只有需要模式扫描时再安装；不下载云规则，不上传源码。
.runtime/venv/bin/python -m pip install semgrep==1.183.0
python3 scripts/source_tools.py capabilities --language python --language typescript
```

可用 `SOURCE_REVIEW_RUNTIME=/absolute/runtime` 复用另一套安装。默认 `.runtime` 相对于 skill 目录，未绑定开发者电脑。Tree-sitter 提供 8 种语言语法；jscpd/Lizard 注册 15 种语言并保留解析限制；LSP 当前默认 Pyright，其他服务须显式配置；Joern 查询入口保留，但需要单独安装官方 Joern 4.0.672、合适的 JDK，并按 [工具说明](references/tools.md) 配置。外部工具各有许可证，不因经此适配而改变。

目录/import 提取器暂复用 Archify 实验分支的固定版本，安装在独立位置：

```sh
git clone --no-checkout https://github.com/tt-a1i/archify.git .runtime/analysis-provider
git -C .runtime/analysis-provider checkout 883f37df4c06e4d3a6948293537e34c2f0890781
npm ci --prefix .runtime/analysis-provider/archify/modules/code-analysis
export SOURCE_REVIEW_ARCHITECTURE_PROVIDER="$PWD/.runtime/analysis-provider/archify/modules/code-analysis"
node scripts/architecture.mjs sources.json .source-review/structure
```

`sources.json` 的格式、语言与提取边界见 [verification.md](references/verification.md)。上述命令不会修改已有 Archify live 安装。分析不执行目标项目；`verify_finding.py` 会执行审查者指定命令，它是记录器，不是沙箱，须先检查代码及依赖隔离。

## 用公开代码复现交付流程

使用 [Requests #6586](https://github.com/psf/requests/issues/6586) 的历史回放，固定 Requests 2.31.0 与 urllib3 2.0.7。它检验公开源码 → 实际隔离执行 → 验证记录 → 全景 → 问题路径的连接，**不声称新发现或盲审命中**。

```sh
git clone --branch v2.31.0 --depth 1 https://github.com/psf/requests.git .source-review/requests
python3 -m pip install --target .source-review/deps urllib3==2.0.7 charset-normalizer==3.4.4 idna==3.11 certifi==2025.10.5
python3 tests/requests_demo.py --requests .source-review/requests --deps .source-review/deps --out .source-review/public-run
```

先按上节设置 `SOURCE_REVIEW_ARCHITECTURE_PROVIDER`。用例检查 ASCII 为 2/2、中文为 2/6、预编码 bytes 为 6/6；执行原版准备、编码和头部处理，只替换网络发送端，并禁止创建 socket。生成的 `site/index.html` 在本地打开；报告不随本目录提交。接收端截断等后果未在此试验中验证。

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

## 边界与来源

- 目录图覆盖源码结构，未解析引用和排除范围须保留。动态图、HTTP、消息关系需另找证据。
- 节点显示的是审查者整理的语义，不是分析器自动证明。没有验证记录时输出为“未验证”。
- 原生 renderer 拒绝布局时保留失败，不能删掉事实关系来生成漂亮图。未证明任意规模都能自动布局。
- 两页共享报告版本与 finding 身份。场景切换只读记录，不重新执行产品。
- [Archify 来源清单](assets/vendor/archify/UPSTREAM.json) 固定为 `a4065941f12be7967436261d9934784e381d423c`，保留原许可证、NOTICE、第三方声明，未修改 vendor 文件。
- 方法、提示词、能力限制及参考资料均在 `references/`。这里不分发公司案例、报告或源码快照。
