# git restore 到底改了哪里？ {#restore}

`git restore` 先选恢复目标，再选内容来源：默认改工作区、取暂存区；加 `--staged` 后默认取 `HEAD`。显式的 `--source` 可以改来源。[](source:git)

- 普通恢复会覆盖工作区内容，暂存区不变。
- `--staged` 只改暂存区，工作区不变。
- 同时指定 `--staged --worktree` 会改两个位置。

@answer scope="一个已跟踪文件 · 非冲突状态 · HEAD 已存在 · Git 2.50.0"
@meta locale=zh-CN style=editorial
@source git title="Git 2.50.0: git-restore" url=https://github.com/git/git/blob/16bd9f20a403117f2e0d9bcda6c6e621d3763e77/Documentation/git-restore.adoc

## 三处内容如何流动？ {#places}

`HEAD` 指向当前提交。暂存区保存准备提交的版本；工作区是磁盘上正在编辑的文件。箭头表示恢复时的复制方向，不代表提交或切换分支。[](source:git)

@architecture id=restore-flow title="默认来源与目标"
| head | HEAD | database |
| index | 暂存区 | database |
| work | 工作区 | frontend |
| head > index | --staged |
| index > work | 默认 |
| head > work | --source=HEAD | emphasis |

## 四种命令分别改哪里？ {#comparison}

下面四种操作各自独立执行，文件在来源中存在。命令只处理 `file.txt`；`--` 后是路径。所有写法都不移动 `HEAD`。[](source:git)

**取回暂存版本**：暂存区 → 工作区。暂存区不变。

```sh
git restore -- file.txt
```

**取消暂存**：HEAD → 暂存区。工作区修改保留。

```sh
git restore --staged -- file.txt
```

**取回提交版本**：HEAD → 工作区。暂存区不变。

```sh
git restore --source=HEAD -- file.txt
```

**两处都恢复**：HEAD → 暂存区和工作区。两个位置都会被覆盖。

```sh
git restore --staged --worktree -- file.txt
```

最后一种写法含 `--staged`，所以默认来源是 `HEAD`；也可显式加 `--source=HEAD`。[](source:git)

## 覆盖前要知道什么？ {#risk}

@callout level=warning title="恢复会覆盖目标"
| 恢复工作区会丢弃目标文件中未暂存的内容；恢复暂存区会替换已暂存的内容。先保存想保留的改动。 |

若已跟踪路径在恢复来源中不存在，默认的非 overlay 模式会移除它，以匹配来源。`--overlay` 则不移除文件。[](source:git)

这里假设暂存区没有冲突条目，且文件在稀疏检出范围内。冲突路径从暂存区恢复到工作区时，可能需要 `--ours`、`--theirs` 或 `--merge`；稀疏检出也会限制默认恢复范围。[](source:git)

## 执行前检查什么？ {#check}

- [ ] 用 `git status --short` 确认文件状态和路径。
- [ ] 用 `git diff -- file.txt` 看未暂存改动；用 `git diff --cached -- file.txt` 看已暂存改动。
- [ ] 确认想保留的内容已有备份，再选择要覆盖的目标和来源。
- [ ] 确认 `HEAD` 存在，且目标路径在所选来源中的状态符合预期。
