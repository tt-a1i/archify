import polars as pl

s = pl.Series("x", [1.0, None, float("nan"), 3.0], dtype=pl.Float64)
cases = {
    "fill_null": s.fill_null(0),
    "nan_to_null": s.fill_nan(None),
    "both_to_zero": s.fill_null(0).fill_nan(0),
}
for name, values in cases.items():
    print(name, values.to_list(), "mean:", values.mean())
