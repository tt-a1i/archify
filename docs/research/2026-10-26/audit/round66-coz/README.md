# Round 66：Coz 原生点数与证据边界

结论：本轮不推进 Archify 产品功能或 Coz importer。原生 viewer 已能在同一公开 profile 上显示门槛变化和单点读数；过滤口径及原始点为何被排除，仍需结合固定源码与原始记录核对。本轮缺少配对的实际优化前后测量和相应工作负载、progress point 定义，不能证明额外图形或转换器对用户有收益。

## 自然问题与观测

研究入口是 [issue #103](https://github.com/plasma-umass/coz/issues/103) 对 progress point 定义的理解需求，以及 [issue #231](https://github.com/plasma-umass/coz/issues/231) 的报告。后者在本轮没有复现。主研究者通过 GitHub connector 读取两条 issue 和 #103 的维护者评论，归档为[检索及 issue 摘要](runtime/issue-summaries.json)，未复制完整正文。#103 维护者[说明](https://github.com/plasma-umass/coz/issues/103#issuecomment-486744882)：progress point 应标记一个工作单元完成，如迭代、事务或流水线最后阶段；单纯选频繁执行的代码不能建立这个语义。#231 报告涉及 pthread/usleep/barrier 与 Windows 11 WSL，本轮没有复现。不能把公开 fixture 的成功回放视作对原报告的复现或否证。

主研究者在 [在线 viewer](https://coz-profiler.github.io/coz-ui/) 使用原生文件选择和 Open 打开公开 `sqlite.coz`。最少点数为 10 时有 12 张图，改成 5 后有 17 张图；`sqlite3.c:14853` 显示 8 个圆点。悬停第 6 个点时原生 tooltip 为 Line Speedup `+60.0%`、Progress Speedup `+12.5%`。这是虚拟加速实验的原生度量，不是已实施优化获得 12.5% 提速的测量。

“最少点数”筛选的是保留的不同 speedup 测量数，包含 baseline，不是实验运行次数，也不是源码采样记录数。14853 有 13 条实验记录、10 个原始 speedup 值，0 baseline 汇总了 3 条；0.15 和 0.55 的 progress 分别约 -3.17206 和 -1.07109e13，因超出闭区间 [-1, 2] 被过滤，剩 8 点。此次不是 current 的 `MIN_DELTA=5` 导致少点。Python 与原生 VM 的详细数字见 [分析](analysis/analysis.json) 和 [VM 审计](runtime/vm-audit/audit.json)。

[minimum-10](runtime/minimum-10.png)、[minimum-5](runtime/minimum-5.png)、[14853 hover](runtime/point-14853.png) 三张截图均由主研究者打开查看。最少点数 5 的坐标刻度有拥挤/重叠现象，原因未诊断，不分类为已确认缺陷，也不构成可用性 benchmark。

## 数据、版本与执行范围

公开 fixture 有 39,546 行：40 startup、30 shutdown、58 runtime、1,233 experiment、1,233 progress-point、36,952 samples。280 个 selected source line / progress point 组合，其中 108 个含零 baseline；唯一 progress point 名称是 `main.c:73`。生成版本和各会话边界未知；多个 startup/shutdown 不应被称为一次完整 profiler 运行。

归档 current 源固定于 `plasma-umass/coz@dfc22c6c6f54cfbf085199440089cb29552f67d6`。在线资产比对固定于 `coz-profiler/coz-ui@7fe33c0be8dca7b35b172cc4692fd9ae9cc9820b`。浏览器 DOM 记录到的 script URL 经独立 HTTP 获取，`profile.js` blob 为 `044e69ddbd5a8c1f5e3693802762ce0e6f63ad68`，`ui.js` 为 `f728e86a703d7c2c5349ffde8e61dd8c4f74fb38`，与独立 Git tree 相同。未验证浏览器 cache 响应字节、其他资产或整个部署版本。current 有额外 MIN_DELTA5 行为，未在本轮原生浏览器 UI 中运行。比对明细见 [source-verification](source-verification.json)、[原始源元数据](analysis/source-manifest.json) 与两份 [current tree](runtime/tree-0-selected.json) / [online tree](runtime/tree-1-selected.json)。

先前 VM 审计在 Node v22.23.3 环境以 stubs 初始化源文件，调用原生解析与 getSpeedupData。在线与 current 的 280 个预期行、测量数、speedup 顺序以及 progress 数值（Python 四舍五入至 8 位、容差 5.01e-9）没有 mismatch，min10/min5 总数均为 12/17。它不执行 drawPlots、tooltip、平滑或浏览器布局，也不明确排除 280 行之外的额外 native 行。Python 使用任意精度整数，JS 使用 Number；结果只支持此 fixture，不能外推通用精度或 latency parser 正确性。

VM attempt01 完成 online 比对后在 current 初始化缺 XMLHttpRequest 失败；02 缺 document.getElementById 失败；03 增加 document / XMLHttpRequest stubs 后成功。其 command/output/exit 是原会话工具历史转录，未在归档时重跑；原工具只有合并输出，没有原始独立 stdout/stderr 和起止时间。保留的 14 个文件包含失败记录与精确 stdin 脚本，见 [VM provenance](runtime/vm-audit/README.txt)。

浏览器保留 8 组脚本、exit、stdout、stderr。browser-03 在选文件后、点 Open 前等待数据超时；04 展示 modal 与已选文件，05 点 Open 成功。这是工具步骤失误，不是上游缺陷。08 完成关闭 space19，没有本地服务器。完整会话摘要见 [observations](runtime/observations.json)；所有失败照存。没有执行 profiler、benchmark、历史测试，也没有真实优化前后结果。

## 归档与复现

[source](source/LICENSE.md) 完整保留 BSD 版权、条件和免责声明。仅将 current `sqlite.coz`、`index.htm`、`profile.ts`、`current-profile.js` 和 `LICENSE.md` 按原字节归档；不包含 vendored dependencies。online 仓库源文件及 live HTTP JS 不归档全文，只保留 URL、blob、SHA256、字节数与 tree 元数据。

公开文本仅将两个精确采集根路径前缀替换为 `ARCHIVED_SOURCE` / `ARCHIVED_RUNTIME`。源文件（包括其中路径）和 PNG 不改。外部原件仍保留在采集位置；[copy-map](copy-map.json) 逐项记录原件与公开件 SHA256、字节数、相对路径及转换类型。路径代号只是来源标签，不是可执行目录。`analysis/analyze.py` 是首次分析脚本的路径转写副本，和便携入口分开保存；analysis.json 与 analysis-summary.txt 保留首次分析结果。

在此目录运行下列命令，输出路径须尚不存在，父目录须已存在：

```sh
python3 analysis/reproduce.py source/sqlite.coz /tmp/coz-fresh-analysis.json
```

便携入口只替换原分析脚本的两处固定输入/输出路径，再执行原计算逻辑。归档时已在新临时目录重跑，结果与首次 analysis.json 逐字节相同，stdout 与首次 summary 相同，见 [reproduction](analysis/reproduction.json)。这是分析者 projection 重跑，不是原生 profiler、VM 或浏览器重跑。离线复核 online VM 需另行按固定 URL 获取未归档源，不能把 metadata-only 当作完整离线部署。

[manifest](manifest.json) 覆盖包内所有其他文件并排除自身，包含 SHA256 与字节数；[validation](validation.json) 记录 JSON、相对文档链接、文件数和源验证结果。此包仅新增研究证据；不宣称用户验收、性能收益或 importer 必要性。后续只有拿到真实 workload、progress point 定义、实际优化前后证据和原生交付中的未满足需求，才值得重开产品判断。
