# 为什么 ripgrep 找不到明明存在的文本？ {#ripgrep-missing}

递归搜索时，文件可能先被忽略规则或隐藏路径过滤掉；即使文件被搜索，模式也可能没有按你预期匹配。[](source:guide)

- `--no-ignore` 放宽忽略文件规则；`--hidden` 放宽隐藏路径过滤。[](source:flags)
- 文件同时命中两种过滤时，需要同时使用这两个选项。
- `-F` 把模式当作字面文本；它解决的是匹配方式，不是路径过滤。[](source:flags)

@answer scope="Git 仓库内的普通递归目录搜索 · POSIX shell"
@meta locale=zh-CN style=editorial
@source guide title="ripgrep Guide，固定版本" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/GUIDE.md
@source flags title="ripgrep 参数定义，固定版本" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs

## 文件在哪一道过滤处被跳过？ {#filters}

下面是排查思路示意，不表示 ripgrep 内部实现的判断顺序。

@workflow id=filter-flow title="递归搜索的两道路径过滤"
| start | 递归候选路径 | external |
| ignore | 忽略规则 | backend |
| hidden | 隐藏路径 | backend |
| search | 搜索文件内容 | backend |
| start > ignore | |
| ignore > hidden | 通过 |
| hidden > search | 通过 | emphasis |

| 情况 | 默认递归搜索 | 排查时放宽 |
| --- | --- | --- |
| 普通路径被 `.gitignore` 忽略 | 跳过 | `--no-ignore` |
| 隐藏路径未被忽略规则排除 | 跳过 | `--hidden` |
| 隐藏路径也被忽略规则排除 | 跳过 | 两个选项都用 |

忽略规则还可能来自 `.ignore`、`.rgignore` 和 Git 的其他忽略位置。`--no-ignore` 不会取消命令行显式指定的 `--ignore-file`。[](source:flags) 隐藏路径被忽略文件放行或直接作为参数传入时，即使没有 `--hidden` 也会搜索。[](source:flags)

## 怎样缩小范围并检查路径？ {#inspect}

下面假设当前目录是仓库根目录，目标在 `./src`。先列出默认会搜索的文件，再查看跳过原因；这两条命令不搜索文本。[](source:flags)

```sh title="检查 src 中的候选文件"
rg --no-config --files ./src
rg --no-config --files --debug ./src
```

`--debug` 会输出跳过文件的原因，输出可能很长。`--no-config` 避免本机 ripgrep 配置改变这组排查命令。[](source:flags) 按目标路径检查日志，再决定需要放宽哪道过滤。

```sh title="同时放宽两道过滤并排除 Git 元数据"
rg --no-config --hidden \
  --no-ignore -g '!.git' \
  -F '[ready]' ./src
```

这里 `[ready]` 是要原样查找的示例文本；`-F` 避免把方括号当作正则语法。[](source:flags) 将它和 `./src` 换成自己的文本与最小目录。`-g '!.git'` 排除名为 `.git` 的路径；扩大搜索前仍要确认范围。[](source:flags)

## 扩大范围后找到了，说明什么？ {#meaning}

找到结果说明这次命令在扩大的范围内匹配到了文本。它不能证明原命令的模式正确：示例还用了 `-F`，模式解释也发生了变化。要区分原因，保持模式不变，逐一改变路径选项；再单独检查是否需要字面匹配。[](source:flags)

默认递归搜索还会跳过二进制文件；路径被列出也不保证内容会被当作普通文本搜索。需要排查二进制内容时，先了解 `--text` 可能向终端输出控制字符。[](source:guide)

## 搜索前检查 {#checklist}

- [ ] 确认当前目录和目标子目录。
- [ ] 用 `--files` 与 `--debug` 检查目标路径是否被跳过。
- [ ] 分别判断是否需要 `--no-ignore` 和 `--hidden`。
- [ ] 确认模式是正则还是字面文本；字面方括号可用 `-F`。
- [ ] 扩大范围时排除不需要的目录，并留意二进制内容。
