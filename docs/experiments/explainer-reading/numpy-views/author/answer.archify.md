# 为什么修改 NumPy 选区会改变原数组？ {#numpy-selection}

切片通常得到共享数据的**视图**，所以修改选区也会改原数组；整数数组索引读取则得到副本。直接对索引赋值会写入原数组。[](source:copies)

- 视图是另一个数组对象，但指向同一份数据。[](source:copies)
- 需要独立数据时，可以对切片调用 `copy()`。[](source:copies)

@answer scope="一维 int64 数组 · 固定且不重复的整数索引"
@meta locale=zh-CN style=editorial
@source copies title="NumPy：Copies and views（固定版本）" url=https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.copies.rst#L23-L98
@source indexing title="NumPy：Indexing assignments（固定版本）" url=https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.indexing.rst#L781-L812

## 同样修改 b，为什么结果不同？ {#compare}

每行都从新的 `a = [10, 20, 30, 40]` 开始，再执行 `b[0] = 99`。表中结果来自本地探针；数组为 `int64`。

| 选区 | b 与 a 的数据 | 修改后的 a | 修改后的 b |
| --- | --- | --- | --- |
| `b = a[1:3]` | 共享，视图 | `[10, 99, 30, 40]` | `[99, 30]` |
| `b = a[1:3].copy()` | 独立，副本 | `[10, 20, 30, 40]` | `[99, 30]` |
| `b = a[[1, 2]]` | 独立，副本 | `[10, 20, 30, 40]` | `[99, 30]` |

切片中的 `b[0]` 对应 `a[1]`；副本中的 `b[0]` 则属于另一份数据。[](source:copies)

## 整数索引：读取和直接赋值有什么区别？ {#assignment}

读取 `a[[1, 2]]` 会先产生副本。直接写 `a[[1, 2]] = [99, 88]` 则把值赋给 `a` 的对应位置。[](source:copies) [](source:indexing)

| 从新的 a 开始 | 修改后的 a | 原因 |
| --- | --- | --- |
| `a[[1, 2]] = [99, 88]` | `[10, 99, 88, 40]` | 直接赋值给 a |
| `a[[1, 2]][0] = 99` | `[10, 20, 30, 40]` | 修改的是读取产生的临时副本 |

## 如何亲自检查？ {#check}

以下程序每次重新创建数组。`shares_memory` 的结果只描述这里的数组。

```python title="比较切片与整数索引"
import numpy as np

for label, select in [
    ("slice", lambda a: a[1:3]),
    ("copy", lambda a: a[1:3].copy()),
    ("integer index", lambda a: a[[1, 2]]),
]:
    a = np.array([10, 20, 30, 40], dtype=np.int64)
    b = select(a)
    b[0] = 99
    print(label, np.shares_memory(a, b), a.tolist(), b.tolist())
```

本地运行输出：

```text
slice True [10, 99, 30, 40] [99, 30]
copy False [10, 20, 30, 40] [99, 30]
integer index False [10, 20, 30, 40] [99, 30]
```

探针使用 Python 3.12.13 和 NumPy 2.5.4；不涉及对象类型或重复索引。安装包报告的 Git 版本与标签提交一致，但未验证二进制可复现构建。
