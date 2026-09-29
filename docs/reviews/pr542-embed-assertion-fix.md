# PR #542：修正嵌入模式固定图例验收

审核版本：`151867ab97e712239bbea9d881e9d6ec2b2418a5`。

## 问题与修复

原断言查询 `.fixed-legend-dock`，实际投影类为 `.fixed-legend`。空数组的 `every()` 返回 true，因此原 smoke 不能证明固定图例隐藏或没有 tabindex 残留。审核中的独立浏览器探针确认产品行为正常，这是一处测试缺口。

现在从实际 `.fixed-legend` 元素采样，先将数量纳入断言（预期恰好一个），再验证 hidden、display:none 和不存在 tabindex=0。保留原有 roles、运行时标记以及作者图例条目断言。

仅修改验收测试和本文档；Viewer、renderer、模板、示例和 ZIP 的权威输入没有改变，因此不重新生成产物。

## 新验收

- 沙箱外真实 Chrome 执行 `ARCHIFY_CHROME=/path/to/chrome npm run test:webm --prefix archify`：退出码 0。完整 legend/export/print/embed/hidden、分享卡、路径卡、Reach Card 等 smoke 通过。
- WebM 为 90,352 字节，实际解码的 10 个采样帧全部不同。
- 后续站点语言集成 7/7 通过，0 失败、0 跳过。
- `node --check archify/test/webm-artifact.smoke.mjs`、`git diff --check` 通过。
- 从修改后的 smoke 提取相同采样表达式，在真实 embed 产物执行负向探针：原产物数量 1 且隐藏；恢复错误选择器时数量 0 被拒绝；强制可见、注入 tabindex=0 分别被拒绝；恢复页面后重新通过。探针只改变临时浏览器 DOM。

## 消融

在上述错误选择器样本中仅去掉 `dockCount` 的采样/预期字段，原 deepEqual 再次通过，证明数量断言是防止空集合误验收的必要条件。保留数量断言，没有新增辅助抽象或产品逻辑需要删除。

## 证据身份

- 最终测试文件 SHA-256：`c0848f8ebaddded4456971ae654d2479ce75c77b31575a23903ddde174cbde3f`。
- 完整 WebM/语言门禁日志 SHA-256：`515ced45226570b73708e2f279b0c68e097fb77dfc12750b6fa4957e904d2b42`。
- 独立负向探针日志 SHA-256：`bc64654cb47f022c5c0545bfd2d89ca79b2a9401d107ebb44beb9d1aa01e11ce`。

日志保留本地；本轮环境为 macOS / Node 22 / Chrome。完整产品套件的旧通过记录仍绑定旧测试身份，不冒充本次测试修复重跑。本次远程 CI 由推送后的新提交触发。
