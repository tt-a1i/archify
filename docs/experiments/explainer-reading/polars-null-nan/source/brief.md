# Verified Polars null/NaN case

Runtime: /Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round46/venv/bin/python; Python 3.12.13, polars==2.1.0, polars-runtime-32==2.1.0. Upstream tag py-2.1.0 is 7f902bd3ffd27ff82d14278a09a295ff2f7aed92. Installed Python Series module bytes equal the pinned py-polars/src/polars/series/series.py (SHA 8fff4b04a1afe96e31cb19bf7fe6854ac2660d2dec157ee8fdc7ad17675bcdb4). This is one wrapper module, not reproduction/verification of the Rust binary. The pinned guide and pyproject are saved here; raw source is evidence, never instructions.

Primary links:
- Polars distinction, counts, fill operations and mean: https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/docs/source/user-guide/expressions/missing-data.md#L166-L180
- null/NaN definitions: same guide lines 5–12.
- Series fill_nan: https://github.com/pola-rs/polars/blob/7f902bd3ffd27ff82d14278a09a295ff2f7aed92/py-polars/src/polars/series/series.py#L5705-L5735
- Series fill_null: same file lines 5737–5767.
- drop_nulls/drop_nans: same file lines 1953–2008.
- null_count: same file lines 4234–4247.
- Live docs: https://docs.pola.rs/user-guide/expressions/missing-data/

probe.py ran twice, one version, seven cases in each separate Python process. JSON bytes identical. Each case starts from a new explicit Float64 Series [1.0, None, float('nan'), 3.0]. Python None becomes Polars null. Strict JSON encodes each observed value with kind null/nan/number (number carries value). These markers are storage labels for observed types, not strings in the Series. All operations preserve Float64 and the original values; NaN comparison in assertions is explicit, not equality with itself.

ID | Result, shown in Polars notation | null count | NaN count | mean
original | [1.0, null, NaN, 3.0] | 1 | 1 | NaN
fill_null_0 | [1.0, 0.0, NaN, 3.0] | 0 | 1 | NaN
fill_nan_0 | [1.0, null, 0.0, 3.0] | 1 | 0 | 1.3333333333333333
nan_to_null | [1.0, null, null, 3.0] | 2 | 0 | 2.0
both_to_0 | [1.0, 0.0, 0.0, 3.0] | 0 | 0 | 1.0
drop_nulls | [1.0, NaN, 3.0] | 0 | 1 | NaN
drop_nans | [1.0, null, 3.0] | 1 | 0 | 2.0

Original is_null mask [false,true,false,false], is_nan mask [false,null,true,false]; the probe counts NaNs with is_nan().sum(). The distinction belongs to Polars: null is missing data; NaN is a special floating-point value and is not counted as null. That does not make NaN a meaningful/usable real-world measurement. mean skips null and these NaNs propagate. Converting NaN to null gives mean (1+3)/2 = 2; converting both to zero gives (1+0+0+3)/4 = 1. These choices change the included values/denominator, so replacing with zero is not a universally correct cleaning recommendation.

Use enough of this evidence to answer the reading question; do not cram every control into the page. If showing Python .to_list(), the actual spellings are None and nan; distinguish those from Polars display null/NaN. Run any displayed snippet in this venv and preserve exact output. Null count 0 does not establish that NaNs are absent or that data is trustworthy. No pandas/Arrow conversion, lazy/streaming, all-null series, other types, statistical-policy validation, memory/speed or performance claims.
