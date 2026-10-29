# 为什么 groupby 后总和从 100 变成 80？ {#groupby-missing}

默认分组会排除分组键缺失的行：这例中 `None` 对应的 20 没有进入任何组，所以 100 − 20 = **80**。设置 `dropna=False` 会把缺失键作为一组，分组结果合计回到 100。[](source:guide)

- 默认值是 `dropna=True`；它控制的是分组键，不是原表的删除或填充。[](source:signature)
- 这里的 `None` 和结果中的 `NaN` 都表示缺失的分组键；20 是该行的金额。

@answer scope="pandas 3.1.0 · 单个 object 类型分组键 · 合成数据"
@meta locale=zh-CN style=editorial
@source guide title="pandas 用户指南：分组键中的缺失值" url=https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/doc/source/user_guide/groupby.rst#L211-L233
@source signature title="pandas DataFrame.groupby 默认值及 dropna 说明" url=https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/core/frame.py#L13566-L13575
@source dropna title="pandas groupby 的 dropna 参数" url=https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/core/frame.py#L13647-L13650
@source test title="pandas 上游缺失分组键测试" url=https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/tests/groupby/test_groupby_dropna.py#L116-L130

## 哪一行没有进入默认分组？ {#rows}

数据是合成的正整数，金额无单位。`region` 是分组键，`amount` 是求和列。

| region | amount | 默认分组 |
| --- | --- | --- |
| North | 10 | North |
| None | 20 | 排除 {caution:缺失键} |
| South | 30 | South |
| North | 40 | North |

原始合计：10 + 20 + 30 + 40 = 100。默认结果：North 的 10 + 40 = 50，South 为 30；50 + 30 = 80。三行参与分组，缺失键的那一行未参与。[](source:guide)

## 参数改变了什么？ {#comparison}

| 结果 | 默认 `dropna=True` | `dropna=False` |
| --- | --- | --- |
| North | 50 | 50 |
| South | 30 | 30 |
| 缺失键组 | 无 | NaN：20 {good:保留} |
| 参与行数 | 3 | 4 |
| 分组结果合计 | 80 | 100 |

`dropna=False` 把缺失键纳入分组。结果标签 `NaN` 是键的显示，不是金额缺失，也不是零。[](source:dropna)[](source:test)

## 如何复现并检查？ {#reproduce}

```python title="完整复现"
import pandas as pd

df = pd.DataFrame({
    "region": pd.Series(["North", None, "South", "North"], dtype=object),
    "amount": [10, 20, 30, 40],
})
before = df.copy(deep=True)
default = df.groupby("region")["amount"].sum()
keep_missing = df.groupby("region", dropna=False)["amount"].sum()
print("原始合计:", df["amount"].sum())
print("默认分组:\n", default)
print("保留缺失键:\n", keep_missing)
pd.testing.assert_frame_equal(df, before)
```

这两次分组都没有修改原始 DataFrame。`dropna=False` 也不会填充缺失的金额；它只决定缺失分组键是否形成一组。若金额、聚合方式、键或数据类型不同，不能仅凭本例断言分组和一定等于原始合计。[](source:dropna)
