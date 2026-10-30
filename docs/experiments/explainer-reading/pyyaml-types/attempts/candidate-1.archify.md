# 为什么 `on` 变成了 `True`？ {#yaml-on}

因为默认 `yaml.safe_load` 把未加引号的 `on` 识别成布尔值 `True`。想保留文字，可以在 YAML 中写 `"on"` 或 `!!str on`，得到字符串 `'on'`。[](source:resolver)[](source:constructor)[](source:probe)

@answer span=12 scope="PyYAML 6.0.3 · 默认 SafeLoader · Python 3.12"
@meta locale=zh-CN style=editorial
@source entry title="PyYAML safe_load 入口" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/__init__.py#L117-L125
@source loader title="SafeLoader 的组成" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/loader.py#L31-L40
@source resolver title="标量解析与布尔拼写" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/resolver.py#L143-L176
@source constructor title="布尔值构造" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L224-L235
@source mapping title="映射构造" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L132-L145

@source probe title="两次实测中的输入、值和类型" path=probe-1.json
@source script title="完整本地探针" path=probe.py

## 输入写法和实际结果 {#results span=6}

每条输入都写成 `flag: ...`；左列只列出冒号后面的值。中列是 `repr(value)` 的结果，用来区分布尔值、数值和字符串。这里的引号属于 YAML 输入。[](source:probe)

| YAML 里的值 | Python 结果 | 类型 |
| --- | --- | --- |
| `on` | `True` | `bool` |
| `"on"` | `'on'` | `str` |
| `'on'` | `'on'` | `str` |
| `!!str on` | `'on'` | `str` |
| `off` | `False` | `bool` |
| `42` | `42` | `int` |
| `"42"` | `'42'` | `str` |
| `oN` | `'oN'` | `str` |

## 先判断类型，再得到 Python 值 {#mechanism span=6}

`safe_load` 使用默认的 `SafeLoader`。读到未加引号的 `on` 时，它会匹配内置的布尔规则，再生成 Python 的 `True`，类型为 `bool`。[](source:entry)[](source:loader)[](source:resolver)[](source:constructor)

引号使这里的 `on` 保持字符串；`!!str` 则明确指定字符串类型。规则只列出特定拼写：例如 `oN` 在这次实验中仍是字符串。

`safe_load` 的 safe 关乎允许构造哪些对象，并不表示把所有值都当成字符串。[](source:entry)[](source:resolver)

## 复制代码，对照值和类型 {#reproduce span=8}

在已安装 PyYAML 6.0.3 的 Python 环境运行。外层引号是 Python 字符串语法；字符串内部的引号属于 YAML。

```python title="比较值和类型"
import yaml

for text in [
    'flag: on',
    'flag: "on"',
    'flag: !!str on',
]:
    value = yaml.safe_load(text)['flag']
    print(
        text, '=>',
        repr(value),
        type(value).__name__,
    )
```

输出：

```text
flag: on => True bool
flag: "on" => 'on' str
flag: !!str on => 'on' str
```

## 如果 `on` 是键呢？ {#keys span=4}

在此加载器中，未加引号的 `on` 和 `yes` 都会成为布尔键 `True`。若同一段 YAML 里依次有 `on: first` 和 `yes: second` 这两行，结果是 `{True: 'second'}`：第二次赋值覆盖了第一个值。给两个键加引号则得到两个字符串键，两个值都保留。[](source:resolver)[](source:mapping)[](source:probe)

@callout level=note title="适用范围"
| 结论针对 PyYAML 6.0.3 的默认 Python SafeLoader。自定义解析器、其他加载器或其他 YAML 实现可能不同。完整探针和额外对照可从来源中打开。[](source:script) |
