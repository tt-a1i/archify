# 改了 `b`，`a` 为什么也变了？ {#numpy-selection}

`b = a[1:3]` 得到的是**视图**：两个数组对象共享数据。把 `b[0]` 改成 99，`a[1]` 也会变成 99。加上 `.copy()` 后，修改 `b` 就不会影响 `a`。[](source:copies)

- 两个示例都用 `np.array(...)` 创建原数组，元素都是 10、20、30、40。
- 整数数组索引**取出的结果**是副本；直接写 `a[[1, 2]] = ...` 仍会修改 `a`。[](source:indexing)

@answer scope="NumPy 2.5.4 · Python 3.12.13 · 一维 int64 数组"
@meta locale=zh-CN style=editorial
@source copies title="NumPy 2.5.4：视图、复制与索引读取" url=https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.copies.rst#L23-L98
@source indexing title="NumPy 2.5.4：直接通过索引赋值" url=https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.indexing.rst#L781-L812
@source probe title="六组固定输入的实际结果" path=source/probe-1.json

## 先看原数组有没有改变 {#compare span=12}

每次用新的 NumPy 数组开始，再执行 `b[0] = 99`。三种写法都让 `b` 变成 `[99, 30]`，区别在原数组 `a`。[](source:probe)

| 怎样得到 `b` | 修改后的原数组 `a` |
| --- | --- |
| 切片视图 | `b = a[1:3]` 共享数据，`a` 变为 `[10, 99, 30, 40]`。 |
| 显式复制 | `b = a[1:3].copy()` 复制数据，`a` 保持 `[10, 20, 30, 40]`。 |
| 整数数组索引 | `b = a[[1, 2]]` 取出副本，`a` 保持 `[10, 20, 30, 40]`。 |

## 复现：两段代码只差 copy {#examples span=6}

`a[1:3]` 取出原来的 20 和 30。此时 `b[0]` 对应 `a[1]`，修改的是共享的数据。[](source:copies)

```python title="修改视图"
import numpy as np

a = np.array(
    [10, 20, 30, 40], dtype=np.int64
)
b = a[1:3]
b[0] = 99
print("a:", a.tolist())
print("b:", b.tolist())
```

```text title="实际输出"
a: [10, 99, 30, 40]
b: [99, 30]
```

重新创建 `a`，只在取切片时加上 `.copy()`。`b` 有独立的数据，原数组中的 20 保留下来。[](source:copies)

```python title="修改独立副本"
import numpy as np

a = np.array(
    [10, 20, 30, 40], dtype=np.int64
)
b = a[1:3].copy()
b[0] = 99
print("a:", a.tolist())
print("b:", b.tolist())
```

```text title="实际输出"
a: [10, 20, 30, 40]
b: [99, 30]
```

## 直接赋值，会写到哪里？ {#assignment span=6}

下面每行都从新的 NumPy 数组开始，元素仍是 10、20、30、40。固定且不重复的索引只用于本例。[](source:probe)

| 操作 | 原数组 `a` 会怎样？ |
| --- | --- |
| 直接写入 `a` | 执行 `a[[1, 2]] = [99, 88]`，`a` 变成 `[10, 99, 88, 40]`。 |
| 连续索引后修改 | 执行 `a[[1, 2]][0] = 99`。改的是临时副本，`a` 仍为 `[10, 20, 30, 40]`。 |

读取会得到什么，与赋值写到哪里，需要分别看。这里的结果来自实际运行，不涉及对象数组、重复索引或性能比较。
