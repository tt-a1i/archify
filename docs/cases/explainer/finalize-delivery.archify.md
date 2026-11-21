# 为什么 `finalize` 是发布安全的关键？ {#finalize-modules}

发布最怕“换入一半挂掉，现场全乱”。`finalize` 的设计哲学是 **“永远不损坏现场”**。我们使用“三道闸门+原子换入”：在隔离区铺好地砖，确认无误再瞬间互换，确保发布要么全成，要么原样不动。这是一次权衡：为了换来绝对的安全，我们多占用了磁盘空间来做原子暂存。

@answer scope="Archify @ 82c47ca · 交付安全指南"
@meta locale=zh-CN repo_url=https://github.com/tt-a1i/archify repo_revision=82c47ca31d83749020ff30d6b1172248e71d255d
@source finalize-mjs title="runFinalize 编排器" path=archify/bin/finalize.mjs lines=722:1050

## 为什么要拆分这三道门？ {#why-gates}

如果我们直接覆盖原文件，一旦渲染出错，整个线上环境就废了。引入三道门是为了明确责任归属，降低失败后的定位风险。`deliver` 负责暂存，`check` 负责验证完整性，最后由 `finalize` 原子互换，确保了系统的健壮性。

## 换入失败了怎么办？ {#failure-and-recovery}

最坏的情况是换入时断电，此时我们不仅有备份（`previous-output`），还有 `recoveryRequired` 回执。你需要做的只是运行恢复工具，它会通过备份把现场还原到发布前的一刻。这是一次权衡：虽然多占用了磁盘暂存，但换来了发布失败时的“撤销”能力，降低了人工修复的风险。

## 为什么这一过程在磁盘上留下多个文件？ {#sidecars}

生成这些文件（如 `.delivery.json`）是为了实现可追溯性。如果发布中途失败，我们需要记录下 `receiptId` 和校验信息，以防止现场被盲目覆盖导致数据丢失，这是风险管理的重要环节。

@workflow id=finalize-gates title="交付的三道保险"
| lane orch | 编排层 |
| lane del | 交付层 |
| lane ver | 复查层 |
| cli | 预编译依赖 | frontend | orch |
| snap | 快照状态 | frontend | orch |
| del | 加锁渲染 | backend | del |
| swap | 原子互换 | backend | del |
| chk | 严格复查 | security | ver |
| brw | 浏览器实测 | security | ver |
| rec | 汇总回执 | frontend | orch |
