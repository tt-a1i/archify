# 为什么 ripgrep 找不到明明存在的文本？ {#ripgrep-missing}

在 Git 仓库递归搜索时，文本可能在默认跳过的路径里。**忽略规则和隐藏路径是两道独立过滤**：分别用 `--no-ignore` 和 `--hidden` 检查；搜索范围变大也不能证明原来的模式正确。[](source:guide)

- `.gitignore` 等规则可能排除文件；`--no-ignore` 不会自动包含隐藏路径。[](source:ignore)
- 点号开头的路径通常是隐藏路径；`--hidden` 不会自动关闭忽略规则。[](source:hidden)
- `rg` 默认把模式当正则；要按原文查方括号，用 `-F`。[](source:fixed)
- 二进制检测、搜索目录和其他过滤条件也可能影响结果。[](source:guide)

@answer scope="Git 仓库 · 递归目录搜索 · 默认过滤"
@meta locale=zh-CN style=editorial
@source guide title="ripgrep Guide：递归搜索与过滤" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/GUIDE.md
@source ignore title="ripgrep 标志：--no-ignore" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs#L4321-L4352
@source hidden title="ripgrep 标志：--hidden" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs#L2770-L2807
@source fixed title="ripgrep 标志：--fixed-strings" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs#L2285-L2311
@source files title="ripgrep 标志：--files 和 --debug" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs#L1456-L1481
@source files-list title="ripgrep 标志：--files" url=https://github.com/BurntSushi/ripgrep/blob/e89fff89ac9af12e8d4ce9d5fd07beb408ca730f/crates/core/flags/defs.rs#L2131-L2152

## 哪道过滤挡住了路径？ {#filters}

@workflow id=filter-flow title="递归搜索的两道路径过滤"
| start | 目录内路径 | external |
| ignore | 忽略规则 | backend |
| hidden | 隐藏路径 | backend |
| search | 检查内容 | backend |
| start > ignore | |
| ignore > hidden | 未排除 |
| hidden > search | 未跳过 | emphasis |

| 路径情况 | 要检查的选项 | 原因 |
| --- | --- | --- |
| 普通路径被忽略规则排除 | `--no-ignore` | 不使用 `.gitignore`、`.ignore` 等规则。[](source:ignore) |
| 隐藏路径未被忽略 | `--hidden` | 包含隐藏文件和目录。[](source:hidden) |
| 隐藏路径也被忽略 | 两个选项都用 | 两道过滤都可能挡住它。[](source:ignore)[](source:hidden) |

隐藏路径有例外：忽略文件中的白名单或显式传入路径可使其被搜索。`--no-ignore` 也不会关闭命令行显式指定的 `--ignore-file`。[](source:hidden)[](source:ignore)

## 怎样缩小范围，再查原文？ {#try}

假设目标在仓库的 `src` 目录；先替换成你要检查的具体目录。下面查找原文 `[ready]`，并排除 `.git` 目录。`-F` 把方括号当普通字符；单引号也让 shell 保留这段模式。[](source:fixed)

```bash title="在指定目录查找原文"
rg --no-config --no-ignore --hidden -g '!.git' -F '[ready]' ./src
```

`--hidden` 可能包含 `.git` 等目录；扩大范围也可能读到生成文件或敏感内容，并产生大量输出。只在需要的目录运行，检查输出的分享范围。[](source:hidden)

扩大路径范围只改变候选文件，不能证明原来的正则表达式符合意图。若需要查字面文本，请用 `-F`；若需要正则，请另行核对模式和预期匹配。[](source:fixed)

## 怎样检查哪些路径被跳过？ {#inspect}

先在同一个小目录列出候选文件，再查看跳过原因。`--files` 只列出会搜索的文件，不搜索内容；`--debug` 输出跳过信息。[](source:files-list)[](source:files)

```bash title="检查指定目录"
rg --no-config --files ./src
rg --no-config --files --debug ./src
```

对照时，可在相同命令中逐个加入 `--no-ignore`、`--hidden`，再同时加入两者。调试输出可能很长，也可能暴露路径；不要直接公开。配置文件可改变默认选项，这里的 `--no-config` 用于排除配置影响。[](source:guide)

@callout level=note title="仍然没有结果？"
| 确认目录和文本是否准确。递归搜索还会尝试跳过二进制文件；不要把路径已列出等同于内容一定会匹配。[](source:guide) |

## 搜索前后核对什么？ {#checklist}

- [ ] 确认当前目录与目标子目录。
- [ ] 用 `--files` 和 `--debug` 检查目标路径及跳过原因。
- [ ] 分别检查忽略规则与隐藏路径，必要时同时放开。
- [ ] 确认要查原文还是正则；原文含方括号时使用 `-F`。
- [ ] 检查扩大范围后的输出，再决定是否分享。
