# 为什么 make check 没有执行命令？

这里的 `check` 是一个没有依赖的普通文件目标。目录里已有同名文件，Make 就认为无需更新它，跳过下面的命令。用 `.PHONY: check` 把它声明为动作，便不受同名文件影响。[](source:phony)

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

`up to date` 的意思是“这个文件无需更新”，不代表检查执行过或通过了。这个规则没有依赖，Make 不会通过比较依赖文件来判断是否需要更新。[](source:phony)

| 同名文件 | 两次调用的输出 |
| --- | --- |
| 不存在 | 两次都是 `checked` |
| 存在 | 两次都提示 `up to date`，命令未执行 |

这些结果来自 GNU Make 3.81 的临时目录实验；每种情况各调用两次。

## `.PHONY` 改变了什么？ {#fix}

在 Makefile 中声明 `check` 是动作名，保留原来的命令：

```makefile title="声明动作目标"
.PHONY: check
check:
	@printf 'checked\n'
```

实验中，无论同名文件是否存在，两次调用都输出 `checked`；已有文件的内容保留。`.PHONY` 声明的是要执行的动作，同名文件的存在不再让它跳过。[](source:phony)

## 依赖的真实文件，不必每次重建 {#real-output}

只把 `check` 声明为动作；`report.txt` 仍是要生成的文件。文件不存在或比依赖的输入旧时，Make 才需要更新它。[](source:freshness)

在新建的空目录中，将下面内容保存为 `Makefile`：

```makefile title="动作依赖真实文件"
.PHONY: check
check: report.txt
	@printf 'checked\n'
report.txt: input.txt
	@printf 'built\n'
	@cp input.txt report.txt
```

再创建输入文件，连续调用两次：

```sh title="在同一目录运行"
printf 'hello\n' > input.txt
make check
make check
```

第一次输出 `built` 和 `checked`，第二次只输出 `checked`。输入没有变化，已有的报告无需重建；`.PHONY` 声明不会从 `check` 传给 `report.txt`。[](source:real)
