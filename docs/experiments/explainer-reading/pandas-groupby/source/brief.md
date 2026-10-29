# Verified source facts for the pandas grouping case

Primary sources at pandas v3.1.0 / c6f46769b808eb60218189d089dd67841b44f1b9:
- User guide: https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/doc/source/user_guide/groupby.rst#L211-L233
- groupby signature/default: https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/core/frame.py#L13566-L13575
- dropna description: https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/core/frame.py#L13647-L13650
- Upstream behavior test: https://github.com/pandas-dev/pandas/blob/c6f46769b808eb60218189d089dd67841b44f1b9/pandas/tests/groupby/test_groupby_dropna.py#L116-L130

The actual local probe (probe.py, probe-1.json, probe-2.json) uses one object-dtype region key and integer amount values. North=10, missing key=20, South=30, North=40. Raw total 100; default groups North=50, South=30, total 80 and three included rows. dropna=False adds a missing-key group of 20, total 100 and four included rows. Source DataFrame is unchanged. Printed input contains None; grouped output labels the missing-key group NaN. Explain that these labels denote the missing grouping key in this example, not a numeric zero or an amount of NaN. Numbers are synthetic, positive and unitless.

Control with all grouping keys present totals 100 under the default. Separate boundary fixture shows dropna=False does not fill a missing amount; it stays missing. This is not a general claim that every grouped sum must reconcile with raw totals under arbitrary keys, aggregations, missing numeric values or dtypes. Do not turn the separate boundary fixture into an unnecessary second main story. No data was deleted or imputed by the main groupby operations.
