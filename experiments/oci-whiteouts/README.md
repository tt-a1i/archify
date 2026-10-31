# OCI whiteouts：同层 new 为什么还在？

[解释页](final/explainer.html) · [原生关系图](final/native.html) · [同一图模型](final/native.json) · [实际 inventory 与规范投影](final/observation.json)

`upper.tar` 中新文件先出现，opaque 标记后出现；按 OCI 规范，同层新文件仍应保留。普通 whiteout 只隐藏下层指定目标，opaque 隐藏该目录的下层 children；两个标记自身都不可见。

这是**原创合成输入的内容实验**。实际测量的是两份 tar 的 bytes、成员顺序、类型与 payload 摘要；可见路径是**固定 OCI 规范推导的模型**。没有运行 Docker、mount、任何解压程序或上游工具，没有观察运行容器文件系统，不承诺 OCI 兼容、压缩大小或磁盘回收收益。六种排列的检查也不是六次容器运行。

## 一个问题、一个图模型

每层显式记录 `app/`、`app/cache/` 两个目录及三个 regular 成员：

| 层 | regular 成员 | 规范推导 |
| --- | --- | --- |
| lower | `app/config.txt`、`app/cache/old.txt`、`app/keep.txt` | config 和 old 被 upper 标记遮蔽；keep 保留 |
| upper | `app/cache/new.txt`、`app/.wh.config.txt`、`app/cache/.wh..wh..opq`，按此顺序 | new 属于 upper，保留；两个标记不显示 |

图中 `cache/old.txt`、`cache/new.txt` 是 `app/cache/` 下的简写；完整路径、所有目录成员及原始顺序在解释页 inventory 和 observation 中逐项保留。节点的 upper/lower 标签区分归档来源，另有明确的规范推导可见路径类型。连接表示遮蔽或保留的规则关系，不是调用、执行时间或依赖。原生图与 Explainer 引用同一个 `native.json`，没有第二份手绘拓扑。

`fixture.py` 只处理这六个已声明 regular 路径：先核 payload/路径集合，后用一个明确标注的固定规则模型求投影。它没有任意归档路径入口、OCI manifest、解压、symlink/hardlink、registry 或通用 whiteout 支持。`inventory()` 的 `extractfile` 仅读成员 payload 到内存，不调用 `extract` / `extractall`，不写出成员文件。

## 固定来源与许可

完整原件、字节数和 SHA-256 在 [upstream/manifest.json](upstream/manifest.json)。

- [OCI image-spec @ 4feed4a6674e59d301b9294f187ac46acb2de99f](https://github.com/opencontainers/image-spec/blob/4feed4a6674e59d301b9294f187ac46acb2de99f/layer.md)：完整 layer.md 及 Apache-2.0 LICENSE。以 **Whiteouts** 和 **Opaque Whiteout** 两节为规则依据；末尾包含明确的 archive order 反例。页面按章节链接，不依赖 GitHub/raw 的行号展示差异。
- [dive @ d6c691947f8fda635c952a17ee3b7555379d58f0](https://github.com/wagoodman/dive/tree/d6c691947f8fda635c952a17ee3b7555379d58f0/dive/filetree)：完整 file_tree.go、file_node.go、file_tree_test.go 与 MIT LICENSE，Copyright (c) 2018 Alex Goodman。其当前 filetree 明确忽略 double-whiteout 标记；本实验没有借它给 opaque 作 oracle，也没有声称复现了 dive bug。

[NOTICE.md](NOTICE.md) 区分完整第三方原件与本仓 Apache-2.0 下的原创输入、脚本和解释。没有复制上游 test 构造/expected 作为本次输出，没有导入或运行上游代码。前轮 retained-size 解释支配字节、byte-views 解释相同存储位的不同解释；本例只问跨层路径可见性，不再制作求和或依赖图 adapter。

## 复现与输出保护

基线 `e837dc4cb83042d2b6c596e039692e25ec62c2da`，分支 `codex/lab-oci-whiteouts`。实际环境 Python **3.15.0**、Node **v22.23.3**、Archify **3.2.1-dev.1**。使用 stdlib Python、已有 root/archify lockfile 依赖和 Chrome；本次仅 `npm ci --ignore-scripts` 准备依赖，没有修改 lockfile、live Skill 安装或产品代码。

在实验目录运行，输出目录必须尚不存在：

```sh
cd experiments/oci-whiteouts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_fixture.py
ARCHIFY_NODE=/opt/homebrew/opt/node@22/bin/node PYTHONDONTWRITEBYTECODE=1 python3 build.py my-new-output
```

`build.py` 先以 fresh-only mkdir 拒绝已有目录，再构造 tar、观察成员并写 authored JSON，调用当前仓库 public `finalize`。此命令不运行 Docker，也不执行 tar 里的内容。CLI 原始 stdout/stderr/receipts 外置到本目录忽略的 `raw/run-*`；公开 `build-evidence.json` 明确标为 portable summary，不冒充原始 provenance receipt。CLI 子进程设 180s 上限，失败不报告成功；超时或缺运行时可能保留部分新目录，但不会覆盖旧输出。

独立显式 browser gate 的复现命令（可能返回下面记录的键盘诊断）：

```sh
node ../../archify/bin/archify.mjs browser-check final/explainer.html --json --require-provenance --out-dir raw/new-browser-receipts
```

复制后的 checkout 不继承本机 current provenance；需要先在 fresh 输出目录重新生成与交付。相邻 delivery receipts 含本机路径，因此被忽略；公开 HTML/JSON 不含该本机路径。

## 实际证据与未通过项

- 七项 focused tests 全部通过，见 [tests.json](tests.json)：完整成员与空 marker、lower 遮蔽与 same-layer survivor、六种顺序、错误隐藏/marker 泄漏、缺 marker/变 payload、确定性归档/重复顺序，以及 occupied 目录保留原文件。负例与 exact expected 保护这份 authored 模型；不是独立 OCI engine 的验证。
- **首稿** `draft-1/` 原生图 finalize 的 validate/deliver/check/browser-check 全通过。Explainer 首次失败：nodeBlocks 错指 comparison（仅支持 prose/callout/list/facts），以及字面 `.wh.*` 的未转义星号；已保留失败 JSON 和摘要。随后只修 authored 输入：内容指针改为现有规则 prose、移除歧义星号、收短路径较多的 prose。没有修改 validator、schema、Viewer 或隐去控制。
- **final/** 原生图再次四门通过；Explainer finalize 的 validate/deliver/check 通过，默认 browser-check 为 not-run，零 diagnostics。原始 stdout/receipt 在 ignored raw；[公开阶段摘要](final/build-evidence.json) 绑定 exact source/artifact hashes。
- 额外执行 strict-provenance Explainer browser-check **exit 1**：共 **16 个** `explainer/browser-keyboard-traversal` 诊断，均是末尾 order-json Copy 和三个 footer 来源链接，在四个视口/主题组合报告未达。见 [browser-summary.json](final/browser-summary.json)。没有改 test budget、禁用诊断或删除控制来制造 pass。协调者另做实际 Tab 核对；在其证据完成前，不宣称键盘门禁通过或诊断已被证明误报。
- 第一条写 build.py 的 shell 命令曾误用相对工作目录，报 no-such-file，未写文件；正确路径重写后进入上述首稿交付。没有把失败首稿替换成第一次成功。

实际 Ego 截图与人工操作由协调 agent 独立完成，文件归其 `root-review/` 责任范围，本次没有并行操作浏览器；本文不代替那些 observations 或提前宣称人类验收。小图是否帮助理解仍是内容假设，没有读者计时、生产工作负载或用户接受结论。

AI 协助：Codex / gpt-6.1-sol 完成来源读取、原创固定输入、模型、原生图、解释页、聚焦验证与写作；另有独立 agent 复核。没有修改已有实验或产品运行时，也未创建 PR、push 或发布。

## Coordinator browser observations · 2026-10-27

Root inspected the [original native draft](root-review/draft-1-native-light.png), final [light](root-review/final-light.png), [dark](root-review/final-dark.png), [interactive modal](root-review/open-diagram-dark.png), [footer focus](root-review/footer-tab.png), and mobile [light](root-review/mobile-light.png)/[dark](root-review/mobile-dark.png) images. The first viewport states that archive inventory was measured and visibility was derived from the OCI specification. The same-layer survivor is visible; further diagram rows and inventory require scrolling.

Actual Open interactive diagram and Escape return worked, with focus restored to the opener. Fresh Tab input without focus injection reached inventory/order copy controls at steps 32–33, source links 34–35 and the Archify footer 36; step 37 returned BODY. [Raw Tab observations](root-review/tab-traversal.json) and [artifact/image hashes](root-review/README.json) are separate evidence: the **16 automated keyboard diagnostics remain failed**. Desktop CSS viewport was 1440×900; mobile light/dark 390×844 had document width 390. No human accessibility, comprehension, container execution or speed acceptance is claimed.
