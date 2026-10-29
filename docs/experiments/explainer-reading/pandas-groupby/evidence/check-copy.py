import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
import pandas as pd

code_path, probe_path = map(Path, sys.argv[1:3])
capture = io.StringIO()
with contextlib.redirect_stdout(capture):
    state = runpy.run_path(str(code_path))
expected = json.loads(probe_path.read_text())['main']
pd.testing.assert_frame_equal(state['df'], state['before'])
def records(series):
    return [{'key': None if pd.isna(key) else key, 'value': int(value)} for key, value in series.items()]
assert state['df'].to_dict(orient='records') == expected['input']
assert records(state['default']) == expected['default']['groups']
assert records(state['keep_missing']) == expected['includeMissingKey']['groups']
result = {'copiedProgram': str(code_path), 'pandas': pd.__version__, 'inputMatchesProbe': True, 'inputUnchanged': True, 'defaultGroupsMatchProbe': True, 'includeMissingGroupsMatchProbe': True, 'rawTotal': int(state['df'].amount.sum()), 'defaultTotal': int(state['default'].sum()), 'includeMissingTotal': int(state['keep_missing'].sum()), 'stdout': capture.getvalue(), 'clipboardScope': 'The real Copy control wrote these bytes through an instrumented clipboard API; OS clipboard permissions are not tested.'}
print(json.dumps(result, ensure_ascii=False, indent=2))
