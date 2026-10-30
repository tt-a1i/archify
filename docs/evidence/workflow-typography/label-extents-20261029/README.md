# PR #649：缩放标签边界修正

- 修复前：`ad17e4ba2fe3195558960fde9eec480486d45838`。
- 源码、测试和 ZIP 修复：`7516a237ea369bd3cf3e8b28ee0ea29935dbdedc`；后续提交仅增加本目录证据。
- 基线 dev 仍为 `847146ae`；生成物过期修复由 [#1150](https://github.com/tt-a1i/archify/pull/1150) 单独跟踪。

## 问题与局部修复

`workflowEdgeLabelPoint` 的节点避让与泳道范围检查曾使用固定 10px 上沿／14px 高度。现在两处都使用渲染蒙版与下游检查已有的 `typography.edgeAscent`、`typography.edgeHeight`。线段优先级、路线策略、作者坐标和既有容差不变。

单一复现输入：[label-boundary.workflow.json](../../../../test/fixtures/workflow-typography/label-boundary.workflow.json)。这是合成回归输入，不是自然发生的 Agent 生成失败或新的生成质量实验。

scale 2 时，旧代码选中首选水平段，实际标签矩形约为 `[109,292,221,28]`，与节点 A 的 `[48,242,92,60]` 重叠，公开 validate/render 因此失败。使用实际高度后，同一条显式折线上的备用水平段可容纳标签，验证和绘制成功，原始 `via` 与输入字节不变。

默认 scale 1 对照使用默认节点中心对应的固定正交坐标。修复前后完整 SVG 和编译回执相同；现有省略／显式 1、v1 冻结输出及普通字体用例继续通过。测试检查实际 SVG 蒙版与节点交叠、保留的路线及输入，不冻结自动标签坐标。

## 验证

- TDD RED：新增公开 CLI 回归在旧实现上失败（默认倍率控制先通过，scale 2 因实际标签覆盖 A 失败）。
- [受影响测试](focused-tests.txt)：169 通过，0 失败／跳过，覆盖字体、放置标签、竖边标签、受限分叉、路由与 hard-contract。
- [真实 Chrome 字体套件](browser-tests.txt)：6 通过，0 失败／跳过。`npm run test:generated` 通过。
- 新边界用例另在 Chrome 156.0.8078.73、1440×900、Classic、light、100% zoom 下测量：[实际边界](browser-boundary.json)、[截图](label-boundary.png)。文字完整位于蒙版内，蒙版不覆盖节点。Codex AI 检查了该截图；未声称人类感知验收。
- 官方 Node 22.23.1 / zlib `1.3.1-e00f703` 两次 ZIP 构建字节一致。解压包的公开 validate/render 对新输入成功，完整 HTML 与源码版本相同。
- ZIP SHA256：`6c660db6d491346225ec637f09e72b32cc302055034d48ea4e8dfe64fabfbf66`。

前一轮 [dev 同步证据](../dev-sync-20261029/README.md)保留原修订；其未受本次局部计算修正影响的整合和默认输出证据可复用，浏览器字体检查及新边界结果为本轮重新执行。没有重新开展五项目实验。远程检查以最终 head 的 PR checks 为准，历史 #1150 失败不计作已通过。

## 复现

```sh
npm run test:focus -- test/workflow-typography.test.mjs '--test-name-pattern=^scaled edge labels select'
node archify/bin/archify.mjs validate workflow test/fixtures/workflow-typography/label-boundary.workflow.json --json
node archify/bin/archify.mjs render workflow test/fixtures/workflow-typography/label-boundary.workflow.json /new/output/label-boundary.html
```
