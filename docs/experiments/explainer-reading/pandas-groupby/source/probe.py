import hashlib
import json
import platform
from pathlib import Path
import pandas as pd

def records(series):
    return [{"key": None if pd.isna(key) else key, "value": int(value)} for key, value in series.items()]

df = pd.DataFrame({"region": pd.Series(["North", None, "South", "North"], dtype=object), "amount": [10, 20, 30, 40]})
before = df.copy(deep=True)
default = df.groupby("region")["amount"].sum()
included = df.groupby("region", dropna=False)["amount"].sum()
pd.testing.assert_frame_equal(df, before)
assert default.to_dict() == {"North": 50, "South": 30}
assert int(default.sum()) == 80 and int(included.sum()) == 100
assert int(df.loc[df.region.isna(), "amount"].sum()) == 20
assert int(df.groupby("region").size().sum()) == 3
assert int(df.groupby("region", dropna=False).size().sum()) == 4

complete = df.copy(deep=True)
complete.loc[complete.region.isna(), "region"] = "South"
assert int(complete.groupby("region")["amount"].sum().sum()) == 100

boundary = pd.DataFrame({"region": pd.Series(["North", "North", None], dtype=object), "amount": pd.Series([10, None, 20], dtype="Int64")})
boundary_before = boundary.copy(deep=True)
boundary_groups = boundary.groupby("region", dropna=False)
assert int(boundary.amount.isna().sum()) == 1
assert boundary_groups.size().tolist() == [2, 1]
assert boundary_groups["amount"].count().tolist() == [1, 1]
pd.testing.assert_frame_equal(boundary, boundary_before)

frame_source = Path(pd.__file__).parent / "core/frame.py"
result = {
    "environment": {"python": platform.python_version(), "pandas": pd.__version__, "pandasGitVersion": getattr(pd, "__git_version__", None), "frameSha256": hashlib.sha256(frame_source.read_bytes()).hexdigest()},
    "scope": "Synthetic unitless positive amounts, one object-dtype grouping key. Missing amounts appear only in the separate boundary fixture.",
    "main": {"input": df.to_dict(orient="records"), "inputText": df.to_string(index=False), "inputUnchanged": True, "rawTotal": int(df.amount.sum()), "default": {"groups": records(default), "text": default.to_string(), "total": int(default.sum()), "includedRows": int(df.groupby("region").size().sum())}, "includeMissingKey": {"groups": records(included), "text": included.to_string(), "total": int(included.sum()), "includedRows": int(df.groupby("region", dropna=False).size().sum())}, "excluded": df.loc[df.region.isna()].to_dict(orient="records")},
    "completeKeyControl": {"input": complete.to_dict(orient="records"), "defaultTotal": int(complete.groupby("region")["amount"].sum().sum())},
    "missingValueBoundary": {"rows": [{"region": row.region, "amount": None if pd.isna(row.amount) else int(row.amount)} for row in boundary.itertuples()], "inputUnchanged": True, "missingAmountCount": int(boundary.amount.isna().sum()), "size": records(boundary_groups.size()), "count": records(boundary_groups["amount"].count())}
}
print(json.dumps(result, ensure_ascii=False, indent=2))
