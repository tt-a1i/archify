# 为什么 `on` 变成了 `True`？ {#yaml-on}

在默认 `yaml.safe_load` 中，未加引号的 YAML `on` 会被识别为布尔值，得到 Python 的 `True`，类型是 `bool`。给它加引号或写成 `!!str on`，则得到字符串 `'on'`，类型是 `str`。[](source:resolver)[](source:constructor)

@answer scope="PyYAML 6.0.3 · 默认 SafeLoader · Python 3.12"
@meta locale=zh-CN style=editorial
@source entry title="PyYAML safe_load 入口" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/__init__.py#L117-L125
@source loader title="SafeLoader 的组成" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/loader.py#L31-L40
@source resolver title="标量解析与布尔拼写" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/resolver.py#L143-L176
@source constructor title="布尔值构造" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L224-L235
@source mapping title="映射构造" url=https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L132-L145

## 同样的字母，得到什么？ {#results}

左列是完整的 YAML 输入；中列用 Python 的 `repr` 表示结果。引号是 YAML 输入的一部分。下表来自随附的本地探针。 

| YAML 输入 | Python 值的 repr | Python 类型 |
| --- | --- | --- |
| `flag: on` | `True` | `bool` |
| `flag: "on"` | `'on'` | `str` |
| `flag: 'on'` | `'on'` | `str` |
| `flag: !!str on` | `'on'` | `str` |
| `flag: off` | `False` | `bool` |
| `flag: 42` | `42` | `int` |
| `flag: "42"` | `'42'` | `str` |
| `flag: oN` | `'oN'` | `str` |

## 为什么会这样？ {#mechanism}

`safe_load` 使用 `SafeLoader`。它的解析器会为未加引号的标量匹配隐式类型；`on` 匹配布尔规则。构造器再把它转换为 Python 的 `True`。[](source:entry)[](source:loader)[](source:resolver)[](source:constructor)

引号使这里的 `on` 保持字符串；`!!str` 则显式指定字符串标签。匹配规则列出特定拼写，不能把它理解成任意大小写组合：`oN` 在此例中是字符串。`safe_load` 的名称涉及支持哪些对象构造，不表示所有标量都保留为文本。[](source:entry)[](source:resolver)

## 如何自己复现？ {#reproduce}

在已安装 PyYAML 6.0.3 的 Python 环境运行。外层引号是 Python 字符串语法；字符串内部的引号属于 YAML。

```python title="比较值和类型"
import yaml

for text in ['flag: on', 'flag: "on"', 'flag: !!str on']:
    value = yaml.safe_load(text)['flag']
    print(text, '=>', repr(value), type(value).__name__)
```

输出：

```text
flag: on => True bool
flag: "on" => 'on' str
flag: !!str on => 'on' str
```

## 如果 `on` 是键呢？ {#keys}

在此加载器中，未加引号的 `on` 和 `yes` 都会成为布尔键 `True`。若依次写入 `on: first` 和 `yes: second`，结果是 `{True: 'second'}`：第二次赋值覆盖了第一个值。给两个键加引号则得到两个字符串键。[](source:resolver)[](source:mapping)

@callout level=note title="证据边界"
| 结论针对 PyYAML 6.0.3 的默认 Python SafeLoader。自定义解析器、其他加载器或其他 YAML 实现可能不同。随附的 `probe.py` 和两次 JSON 结果记录了本地探针。 |
