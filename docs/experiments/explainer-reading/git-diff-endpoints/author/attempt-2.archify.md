# 为什么 `git diff HEAD` 为空，暂存区却有改动？ {#diff-endpoints}

`git diff HEAD` 比较的是最新提交和工作区。两端相同，它就没有输出，即使暂存区的内容不同。[](source:git-diff)

- `git diff --cached` 才显示暂存区相对 `HEAD` 的改动。
- `git diff` 显示工作区相对暂存区的改动。

@answer scope="已有 HEAD · 已跟踪文件 · 无冲突"
@meta locale=zh-CN style=editorial
@source git-status title="Git v2.50.1: git status 短格式（固定提交）" url=https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-status.adoc#L169-L224
@source git-diff title="Git v2.50.1: git diff（固定提交）" url=https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-diff.adoc#L26-L63

## 三份内容，两端相同 {#example}

这个构造的例子中，先把 `value=2` 暂存，再把工作区改回 `value=1`。文件名为 `value.txt`。

| 位置 | 文件内容 | 含义 |
| --- | --- | --- |
| `HEAD` | `value=1` | 最新提交中的内容 |
| 暂存区 | `value=2` | 已为下次提交暂存的内容 |
| 工作区 | `value=1` | 磁盘上的当前内容 |

| 命令 | 比较方向：旧 → 新 | 这个例子的结果 |
| --- | --- | --- |
| `git diff --cached` | `HEAD` → 暂存区 | `1 → 2` |
| `git diff` | 暂存区 → 工作区 | `2 → 1` |
| `git diff HEAD` | `HEAD` → 工作区 | 无输出：两端都是 `1` |

第三行只比较两端，不会把中间暂存区的变化单独列出来。`--staged` 是 `--cached` 的同义写法。[](source:git-diff)

## 实际输出怎么读？ {#observed}

下面是 Apple Git 2.50.1 在上述例子中的实测摘录。`-` 是比较的旧侧，`+` 是新侧；省略了 diff 文件头。

```diff title="git diff --cached"
-value=1
+value=2
```

```diff title="git diff"
-value=2
+value=1
```

`git diff HEAD` 的标准输出为空。`git status --short` 输出 `MM value.txt`：第一个 `M` 表示暂存区有改动，第二个表示工作区有改动。[](source:git-status)

## 如何核对自己的文件？ {#check}

- [ ] 运行 `git diff --cached -- path/to/file`，查看已暂存的差异。
- [ ] 运行 `git diff -- path/to/file`，查看工作区相对暂存区的差异。
- [ ] 运行 `git diff HEAD -- path/to/file`，比较最新提交与工作区。

这些结论针对已有 `HEAD` 的已跟踪文件。普通 `git diff` 不展示未跟踪文件；空输出不能证明所有文件都没有改动。
