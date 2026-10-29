# NumPy mutation: fixed source and behavior

NumPy2.5.4 tag v2.5.4 resolves to a3d0ef1df045b858e68115001fdabc930bb3b68c. Isolated Python3.12.13 wheel reports that same Git revision; this does not prove a reproducible binary build. Official docs/PyPI discovery was followed by pinned source and actual local runs.

- https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.copies.rst#L23-L40 explains shared data for a view and duplicated data for a copy.
- https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.copies.rst#L49-L98 distinguishes basic slice views, reading an advanced index into a copy, and direct indexed assignment in-place.
- https://github.com/numpy/numpy/blob/a3d0ef1df045b858e68115001fdabc930bb3b68c/doc/source/user/basics.indexing.rst#L781-L812 distinguishes indexing values from assignments; repeated-index arithmetic is outside this case.

Every probe case starts with a fresh np.array([10,20,30,40], dtype=np.int64). Cases (probe-1.json and probe-2.json are byte-identical):
1. b=a[1:3]; b[0]=99 -> a=[10,99,30,40], b=[99,30], shares_memory=True, b is a=False.
2. b=a[1:3].copy(); b[0]=99 -> a=[10,20,30,40], b=[99,30], shares_memory=False.
3. b=a[[1,2]]; b[0]=99 -> same arrays as2; shares_memory=False.
4. a[[1,2]]=[99,88] -> a=[10,99,88,40]; no b, no shares-memory result. Direct assignment writes to a, unlike first reading a result into b.
5. a[[1,2]][0]=99 -> a remains [10,20,30,40]. Assignment modifies the temporary advanced-index result; the probe does not retain that temporary.
6. b=a; b[0]=99 -> a=b=[99,20,30,40], shares_memory=True and b is a=True. Aliasing is not the same as a new view object.

The core reading question is why changing a selected portion sometimes changes the original. Keep the direct-assignment exception beside the advanced-index read claim. You need not display all six probes if the main explanation stays coherent; preserve scope. Use ordinary numeric one-dimensional arrays with fixed unique indices. No blanket object-dtype deep-copy claim, no reshape rule, repeated-index rule, memory/time measurement, or view/copy test based only on .base. np.shares_memory observations apply to these tiny arrays only.

Any program offered as runnable must import numpy and initialize its arrays. Each demonstration must start from fresh input, or clearly carry state. Use print(a.tolist()) to match the ordinary list outputs, not fictional stdout. Parent will run actual Copy bytes under this environment. Exact Python code has no browser editing; no installations in the page tutorial are needed. A concise table or explicit paired values can carry the mechanism; do not force a workflow diagram to imply execution/data-sharing facts it cannot express.
