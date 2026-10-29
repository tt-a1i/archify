# jq 读到了 false，为什么结果还是 true？ {#jq-default}

`.enabled // true` 会把左侧结果中的 `false` 当作不可用的备选值；当左侧没有其他可用结果时，jq 输出右侧的 `true`。如果 `false` 是有意义的设置，请显式判断 `null` 或键是否存在。[](source:manual)[](source:probe)

- 读取对象中不存在的键会得到 `null`。[](source:index)
- 判断 `null` 可保留 `false`，同时给 `null` 和缺失键设默认值。[](source:probe)
- 用 `has("enabled")` 判断键是否存在，可同时保留 `false` 和显式的 `null`。[](source:has)[](source:probe)

@answer scope="JSON 对象字段 · jq 1.7.1 语义 · POSIX shell"
@meta locale=zh-CN style=editorial
@source manual title="jq 1.7.1 手册：备选运算符" url=https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L2405-L2460
@source index title="jq 1.7.1 手册：对象索引" url=https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L408-L435
@source has title="jq 1.7.1 手册：has" url=https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L954-L971
@source probe title="本地 jq 探针：24 个结果" url=https://github.com/tt-a1i/archify/blob/8ccb79ff716b6b53afd8be76415c9c8c97d62a53/docs/experiments/explainer-reading/jq-default/probe-output.json
@source empty title="jq 1.7.1 手册：empty" url=https://github.com/jqlang/jq/blob/71c2ab509a8628dbbad4bc7b3f98a64aa90d3297/docs/content/manual/v1.7/manual.yml#L1213-L1226

## 先看这个开关 {#switch}

假设 `enabled: false` 表示用户明确关闭功能。下面的过滤器读到这个值后，`//` 仍选择了默认值。[](source:probe)

```bash title="复现：明确关闭却得到 true"
jq -cn '{"enabled":false} | .enabled // true'
# 输出：true
```

`//` 输出左侧结果流中除 `false` 和 `null` 之外的值；如果没有这样的值，就输出右侧结果。`0`、空字符串和空数组都可保留。`empty` 则是不产生结果，既不是 `null`，也不是 `[]`。[](source:manual)[](source:empty)[](source:probe)

## 你希望哪种情况使用默认值？ {#policy}

| 输入对象的 enabled | `// true` | 仅 null 或缺失时默认 | 仅缺失时默认 |
| --- | --- | --- | --- |
| `false` | `true` | `false` {good:保留} | `false` {good:保留} |
| `null` | `true` | `true` | `null` |
| 缺失 | `true` | `true` | `true` |

表中是过滤器输出，不会修改输入文件。缺失键读取为 `null`，因此仅凭读取结果无法区分两者；需要保留显式 `null` 时，先用 `has` 检查键。[](source:index)[](source:probe)

```bash title="保留 false：null 或缺失时默认"
jq -cn '{"enabled":false} | .enabled | if . == null then true else . end'
# 输出：false
```

```bash title="只在缺失键时默认：也保留 null"
jq -cn '{"enabled":false} | if has("enabled") then .enabled else true end'
# 输出：false
```

## 多个结果时，默认值作用在哪里？ {#stream}

左侧可以产生多个结果。整个结果流中只要有可用值，`//` 就输出这些可用值；把每个值通过管道送入另一个 `//`，则会分别判断。[](source:manual)[](source:probe)

```bash title="整个左侧结果流"
jq -cn '(false, null, 0) // "fallback"'
# 输出：0
```

```bash title="逐个结果判断"
jq -cn '(false, null, 0) | . // "fallback"'
# 输出：
# "fallback"
# "fallback"
# 0
```

@callout level=note title="验证范围"
| 例子由本地 jq-1.7.1-apple 运行；其版本标签不能证明它与上游固定版本的二进制完全相同。命令使用 POSIX shell 引号。 |
