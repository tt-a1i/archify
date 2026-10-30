# 合入 #1150 后的最终同步

- 先前修正及证据：`296b7ddc1426fefc3e226efdb152e6918e6c5bc8`。
- 最新 dev：`5ecbd1bfdbf83ea747072112493c940e707569cb`，包含已合并的 #1150 与 DSH #1157。
- 本轮整合提交：`b4c75da98623cc139282a8f62ec68054cdcc090b`。后续提交只记录本次验证。

历史 CI [40808533114](https://github.com/tt-a1i/archify/actions/runs/40808533114) 的两个完整回归分片各有一处失败：README motion proof 指纹和 Checkout compare 产物新鲜度。该结果保留，不计作通过。上游 #1150 已负责刷新这两处产物；本分支以普通合并保留其作者提交和来源，没有重复实现该修复。

dev 相对旧基线 `847146ae` 仅改变生成证明与 DSH 包装/验收，未改变 `archify/` 渲染器、schema、Viewer 或浏览器清单；因此已有字体修正的 169 项回归、6 项真实 Chrome 检查、新边界截图和包解压检查继续按原修订复用。合并无冲突。

在整合提交上使用官方 Node 22.23.1，重新执行：

```sh
npm run test:focus -- test/readme-showcase.test.mjs test/architecture-delta.test.mjs test/workflow-typography.test.mjs
scripts/build-zip.sh /tmp/pr649-after-1150.zip
cmp archify.zip /tmp/pr649-after-1150.zip
```

[实际日志](after-1150-tests.txt)：92 项中 91 通过、0 失败、1 跳过（macOS 上的 Windows Git Bash 专用检查）；历史失败的两个具体用例均通过。重新构建的 ZIP 与已提交 ZIP 字节相同，SHA256 仍为 `6c660db6d491346225ec637f09e72b32cc302055034d48ea4e8dfe64fabfbf66`。本次上游变更不影响包内输入，没有需要替换的新增 ZIP 字节；未重建无关 Gallery。远程最终 head CI 结果记录在 PR checks 和跟进回复中。

个人审阅确认：上次用户明确确认对应 `ad17e4ba`；本轮新增局部修正及同步尚不能据此声称已获本人审阅。该差异在 PR 描述中明确列出。
