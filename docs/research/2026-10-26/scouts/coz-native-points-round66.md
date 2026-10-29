# Coz：核对原生点数，暂不新增功能

2026-10-29；Round 66。决策：不推进 Archify Coz importer 或新产品功能。

自然问题入口是 [#103 的 progress point 定义需求](https://github.com/plasma-umass/coz/issues/103) 和 [#231 的报告](https://github.com/plasma-umass/coz/issues/231)。#231 本轮未复现；公开 fixture 的回放并非原问题环境。主研究者已通过 GitHub connector 阅读原 issue 和 #103 维护者评论；[摘要](../audit/round66-coz/runtime/issue-summaries.json)保留标题、状态与自行转述，不复制全文。维护者[指出](https://github.com/plasma-umass/coz/issues/103#issuecomment-486744882) progress point 应代表工作单元完成，如迭代、事务或流水线末端，不能仅靠代码执行频率选择。#231 涉及 pthread/usleep/barrier 与 Windows 11 WSL。

同一公开 `sqlite.coz` 在在线原生 viewer 的 minimum points=10 下有 12 张图，改为 5 有 17 张，`sqlite3.c:14853` 有 8 个圆点。该筛选统计有效的不同虚拟 speedup 点数，不是运行次数；14853 原有 13 条记录、10 个不同 speedup，baseline 汇总 3 条，另两点因 progress 小于 -1 被过滤。当前上游源码的 MIN_DELTA5 不是这两点被过滤的原因。原生 hover 直接显示虚拟 Line Speedup +60.0% / Progress Speedup +12.5%；后者不代表已实施优化的实际提速。

原生交互已能显示门槛变化和单点读数；10 个原始档位为何只剩 8 个，需要结合源码和原始记录核对。证据交接仍需要真实工作负载、progress point 定义、真实优化前后结果和交付对象；本轮没有证明将 profile 转为 Archify 图能帮用户完成额外任务。先保留证据，等待可验证的未满足需求。

数据有 39,546 行、280 个 selected line / progress point 组合，108 个含 baseline；生成版本及多会话边界未知。VM 以 stubs 对 online/current 原生函数和 Python 比对全部 280 个预期行，8 位小数下无 mismatch，但没有跑 profiler、benchmark、drawPlots 或当前源码的原生浏览器 UI。在线 script URL 与独立 HTTP 字节匹配固定 online Git blob；浏览器 cache 及整个部署版本未核验。三张截图已由主研究者查看，min5 轴刻度拥挤尚未诊断。

browser-03 在 Open 前等待数据而超时，04/05 证明 modal 和正确 Open 流程；归为工具步骤失误。VM 前两次环境初始化失败和第三次成功全部保留为原会话转录，非新执行日志；浏览器 8 组日志、3 张 PNG、固定源/许可和原件/公开件 hash map 均见 [证据包](../audit/round66-coz/README.md)。便携分析重跑与首次 analysis.json 逐字节相同；这只是分析者 projection 的复现，不是原生性能实验。

协调者[归档复核](../audit/round66-validation.json)确认 63 份原件／公开件转换和 staged Git 字节一致，69 个 manifest 条目共 2,470,807 bytes（不含自身）。另存 Node 候选 4 份完整源码／许可，共 8,029 bytes。15 条 whitespace 诊断仅来自原始源码或浏览器 stderr，原字节保留；其余 staged 文件检查通过。没有产品改动、完整测试、CI 或新 PR。
