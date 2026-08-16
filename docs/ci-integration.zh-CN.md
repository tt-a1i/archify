# CI 与 Pull Request 集成

Archify 暴露了两个适合自动化的边界：

- `validate` 校验 Typed JSON 源文件和临时渲染成品，不会替换用户文件。
- `deliver` 冻结源文件，执行同一套最终检查，并以原子方式提交带哈希的可信 HTML 成品。

两个命令失败时都会返回非零退出码。CI 任务或 Pull Request 机器人需要结构化证据时，请加上 `--json`。

## 运行仓库测试

Renderer 包位于 `archify/`。仓库基线 CI 流程如下：

```bash
cd archify
npm ci
npm test
```

`npm test` 会检查生成 Validator（校验器）是否新鲜、Release Identity（发布身份）、Golden File（基准文件）以及仓库级测试。修改 Renderer、Schema、Package 或生成成品时都应运行它。

## 在 GitHub Actions 中校验图表

下面的 Job 即使校验失败也会保存完整回执。命令退出码仍会让 Job 失败，因此绿色工作流不会掩盖无效源文件：

```yaml
name: Validate Archify diagram

on:
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install renderer dependencies
        run: npm ci
        working-directory: archify
      - name: Validate source
        run: |
          node bin/archify.mjs validate workflow ../examples/agent-tool-call.workflow.json \
            --quality showcase --json > validation.json
        working-directory: archify
      - name: Upload validation receipt
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: archify-validation-receipt
          path: archify/validation.json
```

请把图表类型改成与输入文件匹配的值。如果是带仓库证据的 Architecture 源文件，还要增加 `--repo-root`，并确保检出目录包含固定版本的 commit。

## 在 CI 中生成可信成品

当 CI 要生成 Release、文档网站或下游任务真正消费的 HTML 时，使用 `deliver`：

```bash
node bin/archify.mjs deliver workflow ../examples/agent-tool-call.workflow.json \
  workflow.html --quality showcase --json > delivery.json
```

成功回执会记录源文件和成品的 SHA-256、字节数、成品检查、构图状态，以及可选的仓库证据详情。当审阅者需要可复现证据时，请把 `workflow.html` 和 `delivery.json` 一起作为 CI 产物上传。

不要把 `deliver` 当成视觉复核结论。它证明的是确定性渲染和成品检查；只有人工或具备能力的图像读取器检查最终成品后，才能报告 `visual_review: passed`。

## 比较 Architecture 快照

Architecture Delta 可以作为只读的 Pull Request 成品：

```bash
node bin/archify.mjs compare architecture base.json head.json \
  architecture-delta.html --quality showcase --json
```

该命令会同时提交 HTML 和旁边的 `architecture-delta.receipt.json`。两者必须来自同一次运行；回执会绑定被比较源文件的哈希和生成成品。

## 安全消费回执

把回执当作数据，而不是成功提示：

1. 先检查进程退出码。
2. 只有使用 `--json` 时才解析 JSON。
3. 发布成品前必须确认 `ok: true`。
4. 失败时，把 `stage`、`diagnostics[]` 和 `checker` 详情保留在 CI 日志或上传的产物中。
5. `deliver` 失败后，绝不要替换上一份可信输出。

成功的 `validate` 重点关注 `checks` 和 `composition`。成功的 `deliver` 还应记录 `specification.sha256`、`artifact.sha256` 和 `validation` 对象。`visual-check` 回执是额外的浏览器证据，不能替代确定性校验。

## Package 新鲜度

只修改文档时不需要重建 `archify.zip`。如果修改了 `archify/` 运行时代码、Schema、Renderer 行为或发布版 `SKILL.md`，请重新构建并比较仓库中的压缩包：

```bash
scripts/build-zip.sh /tmp/archify-fresh.zip
```

CI 的 `zip-freshness` Job 是最终依据。不要提交与当前 Package 内容不一致的压缩包。

完整 Pull Request 检查项请阅读[贡献指南](../CONTRIBUTING.md)；诊断前缀和修复行为请阅读[排错指南](troubleshooting.zh-CN.md)。

