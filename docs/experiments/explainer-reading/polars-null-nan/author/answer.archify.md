# 为什么 fill_null 后还有 NaN？ {#polars-missing}

`null` 和 `NaN` 是两种不同的状态：`fill_null(0)` 只替换 `null`，因此浮点值 `NaN` 仍会留下。把缺失值换成零也会改变均值的分母，不能默认等同于排除它。[](source:guide)

- `null` 表示缺失；`NaN` 是特殊浮点值，在 Polars 中不算 `null`。[](source:defs)
- 此例中均值跳过 `null`，但 `NaN` 会传播；换成零则把零纳入均值。[](source:guide)

@answer scope="Polars 2.1.0 · Float64 示例 · 实际运行结果"
@meta locale=zh-CN style=editorial
@source guide title="Polars: Missing data (pinned 2.1.0)" url=https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/docs/source/user-guide/expressions/missing-data.md#L166-L180
@source defs title="Polars: null and NaN definitions" url=https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/docs/source/user-guide/expressions/missing-data.md#L5-L12
@source fillnan title="Series.fill_nan" url=https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/py-polars/src/polars/series/series.py#L5705-L5735
@source fillnull title="Series.fill_null" url=https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/py-polars/src/polars/series/series.py#L5737-L5767

## 两种状态，分别处理 {#distinction}

| 状态 | 含义 | 对应操作 |
| --- | --- | --- |
| `null` | 缺失数据 | `fill_null` 替换它 [](source:fillnull) |
| `NaN` | 特殊浮点值，不计入 null 数 | `fill_nan` 替换它 [](source:fillnan) |

`NaN` 不是 null，并不意味着它是有效的现实测量值。[](source:defs)

## 同一组数据，均值为什么不同？ {#mean}

原始值为 `[1.0, null, NaN, 3.0]`。下表使用 Polars 显示记法；这是一个具体示例，不是通用清洗规则。

| 操作 | 结果 | 均值 |
| --- | --- | --- |
| `fill_null(0)` | `[1.0, 0.0, NaN, 3.0]` | `NaN` |
| `fill_nan(None)` | `[1.0, null, null, 3.0]` | `2.0` |
| 两者都填零 | `[1.0, 0.0, 0.0, 3.0]` | `1.0` |

转换为 `null`：`(1 + 3) / 2 = 2`；两者填零：`(1 + 0 + 0 + 3) / 4 = 1`。零被算作一个观测值，排除缺失值则不会。

## 自己运行这个例子 {#reproduce}

以下输出是 Python `to_list()` 的记法：`None` 对应 Polars 的 `null`，`nan` 对应 `NaN`。

```python title="复现三种结果"
import polars as pl

s = pl.Series("x", [1.0, None, float("nan"), 3.0], dtype=pl.Float64)
cases = {
    "fill_null": s.fill_null(0),
    "nan_to_null": s.fill_nan(None),
    "both_to_zero": s.fill_null(0).fill_nan(0),
}
for name, values in cases.items():
    print(name, values.to_list(), "mean:", values.mean())
```

## 选择前检查什么？ {#checks}

- [ ] 分别检查 `null_count()` 和 `is_nan().sum()`；null 数为零不代表没有 NaN。[](source:guide)
- [ ] 根据数据含义决定零是否是真实值；否则先确认要排除还是另行处理。
