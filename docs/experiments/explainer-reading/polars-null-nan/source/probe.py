import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import polars as pl
import polars.series.series as series_module


def encoded(value):
    if value is None:
        return {'kind': 'null'}
    if math.isnan(value):
        return {'kind': 'nan'}
    return {'kind': 'number', 'value': value}


def values(series):
    return [encoded(value) for value in series.to_list()]


cases = []
for name, operation, expected, nulls, nans, mean in [
    ('original', lambda s: s, [1.0, None, 'nan', 3.0], 1, 1, 'nan'),
    ('fill_null_0', lambda s: s.fill_null(0), [1.0, 0.0, 'nan', 3.0], 0, 1, 'nan'),
    ('fill_nan_0', lambda s: s.fill_nan(0), [1.0, None, 0.0, 3.0], 1, 0, 4 / 3),
    ('nan_to_null', lambda s: s.fill_nan(None), [1.0, None, None, 3.0], 2, 0, 2.0),
    ('both_to_0', lambda s: s.fill_nan(None).fill_null(0), [1.0, 0.0, 0.0, 3.0], 0, 0, 1.0),
    ('drop_nulls', lambda s: s.drop_nulls(), [1.0, 'nan', 3.0], 0, 1, 'nan'),
    ('drop_nans', lambda s: s.drop_nans(), [1.0, None, 3.0], 1, 0, 2.0),
]:
    original = pl.Series('value', [1.0, None, float('nan'), 3.0], dtype=pl.Float64)
    before = values(original)
    result = operation(original)
    expected_values = [encoded(float('nan') if x == 'nan' else x) for x in expected]
    assert values(result) == expected_values
    assert result.null_count() == nulls
    assert result.is_nan().sum() == nans
    assert encoded(result.mean()) == encoded(float('nan') if mean == 'nan' else mean)
    assert values(original) == before
    assert result.dtype == pl.Float64
    cases.append({'id': name, 'before': before, 'result': values(result),
                  'originalAfter': values(original), 'dtype': str(result.dtype),
                  'nullCount': result.null_count(), 'nanCount': result.is_nan().sum(),
                  'nullMask': result.is_null().to_list(), 'nanMask': result.is_nan().to_list(),
                  'mean': encoded(result.mean())})

print(json.dumps({'environment': {'python': platform.python_version(), 'polars': pl.__version__,
    'runtime': importlib.metadata.version('polars-runtime-32'), 'buildInfo': pl.build_info(),
    'installedSeriesSha256': hashlib.sha256(Path(series_module.__file__).read_bytes()).hexdigest()},
    'cases': cases,
    'encoding': 'Strict JSON: each value has kind null, nan or number. These tags preserve distinctions; they are not literal Polars string values.',
    'scope': 'Explicit eager Float64 Series from a Python list. Zero replacement is an experimental operation, not a general data-cleaning recommendation. No interoperability, lazy-streaming, statistical-policy or performance claim.'}, indent=2, allow_nan=False))
