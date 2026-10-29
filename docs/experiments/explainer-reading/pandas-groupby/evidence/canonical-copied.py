import pandas as pd

df = pd.DataFrame({
    "region": pd.Series(
        ["North", None, "South", "North"],
        dtype=object,
    ),
    "amount": [10, 20, 30, 40],
})
before = df.copy(deep=True)
default = (
    df.groupby("region")["amount"].sum()
)
keep_missing = df.groupby(
    "region", dropna=False
)["amount"].sum()
print("原始合计:", df["amount"].sum())
print("默认分组:\n", default)
print("保留缺失键:\n", keep_missing)
pd.testing.assert_frame_equal(df, before)