import json, sys
import numpy as np

def run(name, code):
    a = np.array([10, 20, 30, 40], dtype=np.int64)
    before = a.tolist()
    env = {'np': np, 'a': a}
    exec(code, env)
    b = env.get('b')
    return {'name': name, 'code': code, 'before': before, 'aAfter': a.tolist(), 'bAfter': b.tolist() if b is not None else None, 'sameArrayObject': b is a if b is not None else None, 'sharesMemory': bool(np.shares_memory(a, b)) if b is not None else None}

cases = [
    run('slice_view', 'b = a[1:3]\nb[0] = 99'),
    run('explicit_copy', 'b = a[1:3].copy()\nb[0] = 99'),
    run('integer_index_copy', 'b = a[[1, 2]]\nb[0] = 99'),
    run('direct_integer_assignment', 'a[[1, 2]] = [99, 88]'),
    run('chained_integer_assignment', 'a[[1, 2]][0] = 99'),
    run('same_object_alias', 'b = a\nb[0] = 99'),
]
assert [c['aAfter'] for c in cases] == [[10,99,30,40],[10,20,30,40],[10,20,30,40],[10,99,88,40],[10,20,30,40],[99,20,30,40]]
assert [c['sharesMemory'] for c in cases] == [True,False,False,None,None,True]
assert [c['sameArrayObject'] for c in cases] == [False,False,False,None,None,True]
print(json.dumps({'python':sys.version.split()[0], 'numpy':np.__version__, 'numpyGitRevision':np.version.git_revision, 'scope':'Fresh one-dimensional int64 arrays with fixed in-bounds, unique indices; no object dtype, reshape, repeated indices, performance or memory-size measurements.', 'cases':cases},indent=2))
