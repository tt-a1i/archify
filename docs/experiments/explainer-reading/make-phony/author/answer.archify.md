# 为什么 `make check` 没有执行命令？

如果当前目录已有名为 `check` 的文件，普通的无前置条件目标 `check` 会被 Make 判为已更新。把它声明为 `.PHONY` 后，在这里测试的普通调用中，Make 会执行它的命令。[](source:phony)

@answer scope="GNU Make 3.81 · 普通显式调用 · 不使用 -n、-q、-t"
@meta locale=zh-CN style=editorial
@source phony title="GNU Make 3.81：Phony Targets" url=https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L2591-L2650
@source real title="GNU Make 3.81：真实目标与虚假目标" url=https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L2703-L2735
@source freshness title="GNU Make 3.81：目标何时过期" url=https://github.com/mirror/make/blob/776d8b7bc2ff83f8ebf5d357ec89e3bbe6d83962/doc/make.texi#L1947-L1960

## 同名文件如何挡住命令？ {#collision}

这个示例的命令只打印标记，并没有运行测试。命令行前是一个真正的 Tab。

```makefile title="普通目标"
check:
	@printf 'checked\n'
```

目标没有前置条件时，Make 看到同名文件，就认为目标已更新。这里的 `up to date` 是文件判断结果，不代表检查曾经完成。[](source:phony)

| 当前目录 | 连续两次 `make check` 的观察结果 |
| --- | --- |
| 没有 `check` 文件 | 两次都输出 `checked` |
| 已有 `check` 文件 | 两次都报告 `check` 已更新，命令没有输出 |

这些结果来自 GNU Make 3.81 的临时目录实验；每种情况各调用两次。

## `.PHONY` 改变了什么？ {#fix}

在 Makefile 中声明 `check` 是动作名，保留原来的命令：

```makefile title="声明动作目标"
.PHONY: check
check:
	@printf 'checked\n'
```

实验中，无论同名文件是否存在，两次调用都输出 `checked`；已有文件的内容保留。`.PHONY` 让 Make 不把同名文件当成该动作目标已更新的理由。[](source:phony)

## 真实输出文件怎么办？ {#real-output}

把 `check` 用作动作名，把 `report.txt` 用作真实输出目标。真实文件不存在或比前置条件旧时，Make 才会按规则更新它。[](source:freshness)

```makefile title="动作依赖真实文件"
.PHONY: check
check: report.txt
	@printf 'checked\n'
report.txt: input.txt
	@printf 'built\n'
	@cp input.txt report.txt
```

实验中，输入不变：第一次输出 `built` 和 `checked`，第二次只输出 `checked`。`check` 的虚假目标属性不会传给 `report.txt`。[](source:real)

## 如何检查自己的 Makefile？ {#verify}

- [ ] 检查当前目录是否有名为 `check` 的文件。
- [ ] 如果 `check` 表示动作，在 Makefile 中声明 `.PHONY: check`。
- [ ] 如果目标代表真实输出，保留文件目标和正确的前置条件。
