# git diff HEAD 为空，暂存区就没改动吗？ {#diff-endpoints}

`git diff HEAD` 比较的是最新提交和工作区。两端相同，它就没有输出，即使暂存区的内容不同。[](source:git-diff)

- `git diff --cached` 才显示暂存区相对 `HEAD` 的改动。
- `git diff` 显示工作区相对暂存区的改动。

@answer scope="已有 HEAD · 已跟踪文件 · 无冲突"
@meta locale=zh-CN style=editorial
@source git-status title="Git v2.50.1: git status 短格式（固定提交）" url=https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-status.adoc#L169-L224
@source git-diff title="Git v2.50.1: git diff（固定提交）" url=https://github.com/git/git/blob/d82adb61ba2fd11d8f2587fca1b6bd7925ce4044/Documentation/git-diff.adoc#L26-L71

## 三份内容，两端相同 {#example span=6}

这个构造的例子中，先把 `value=2` 暂存，再把工作区改回 `value=1`。文件名为 `value.txt`。

| 位置 | 内容与含义 |
| --- | --- |
| `HEAD` | `value=1`，最新提交里的内容 |
| 暂存区 | `value=2`，为下次提交保留的内容 |
| 工作区 | `value=1`，磁盘上的当前内容 |

`git diff HEAD` 直接比较第一行和第三行。两边相同，所以没有输出；中间那份 `value=2` 仍然保留在暂存区。[](source:git-diff)

## 实际输出怎么读？ {#observed span=6}

下面是 Apple Git 2.50.1 在上述例子中的实测摘录。`-` 是比较的旧侧，`+` 是新侧；省略了 diff 文件头。

先看已暂存的改动：`HEAD` → 暂存区，从 `1` 变成 `2`。

```diff title="git diff --cached"
-value=1
+value=2
```

再看未暂存的改动：暂存区 → 工作区，从 `2` 改回 `1`。

```diff title="git diff"
-value=2
+value=1
```

`git diff HEAD` 的标准输出为空。`git status --short` 输出 `MM value.txt`：第一个 `M` 表示暂存区有改动，第二个表示工作区有改动。[](source:git-status)

## 如何核对自己的文件？ {#check span=6}

把 `value.txt` 换成要检查的文件名，依次查看暂存区、工作区和最新提交之间的差异：

```sh
git diff --cached -- value.txt
git diff -- value.txt
git diff HEAD -- value.txt
```

`--staged` 是 `--cached` 的同义写法。[](source:git-diff)

这些结论针对已有 `HEAD` 的已跟踪文件。普通 `git diff` 不展示未跟踪文件；空输出不能证明所有文件都没有改动。
