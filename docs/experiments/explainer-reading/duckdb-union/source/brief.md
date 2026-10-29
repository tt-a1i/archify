# DuckDB column alignment — source and observations

Question: two SELECT queries use the same names, person and city, but the second lists city first. Why can UNION ALL place Rome under person and Bob under city? Explain how to read the output and choose a suitable query.

Environment: isolated Python 3.12.13 venv, duckdb 2.0.0 wheel. DuckDB reports revision d54cbbe3df; pinned upstream v2.0.0 resolves to d54cbbe3df17e8e5ce68312f483b4155836112aa. Matching prefix is not proof of a reproducible binary build; put packaging qualification in the report rather than the main reader flow.

All seven cases in probe-1.json ran in fresh :memory: connections twice with identical JSON outputs. All data is synthetic text. person means a person's name; city is a city. Alice lives in Paris; Bob lives in Rome. Both columns are strings so the swapped query does not fail a type conversion. Every successful query has ORDER BY person, city to make displayed rows stable; UNION itself is not an ordering promise.

1. `position`: UNION ALL aligns by position. Output headers come from the first SELECT: person, city. Actual rows Alice/Paris and Rome/Bob expose the silent wrong-column result for this intended meaning.
2. `by_name`: UNION ALL BY NAME aligns columns by name. Same second SELECT order, but actual rows Alice/Paris and Bob/Rome.
3. `explicit_order`: explicitly list the second SELECT as person then city; ordinary UNION ALL also produces Alice/Paris and Bob/Rome. BY NAME is an option, not the only repair.
4. `missing_by_name`: second query has Bob/person only; result city is SQL NULL, not text 'NULL', empty string or a dropped row.
5. `missing_position`: same missing-column query with ordinary UNION ALL fails with a BinderException about differing column counts. It does not insert NULL automatically.
6–7. `duplicate_by_name` and `duplicate_all_by_name`: matching name/value rows occur twice. UNION BY NAME returns one row; UNION ALL BY NAME keeps both. BY NAME controls column matching; ALL controls retaining duplicate rows. They are separate choices.

Primary sources:
- https://duckdb.org/docs/current/sql/query_syntax/setops (live discovery; pinned tests below bind the example's source version)
- https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_all_by_name.test — NULL filling, retained rows and name matching, plus constraints outside this tiny case.
- https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/test/sql/setops/test_union_by_name.test — unique-row semantics and by-name matching.
- https://github.com/duckdb/duckdb/blob/d54cbbe3df17e8e5ce68312f483b4155836112aa/src/planner/binder/query_node/bind_setop_node.cpp — BuildUnionByNameInfo forms the name map, reorders expressions and supplies NULL for missing columns.

Scope: standalone SQL queries, two VARCHAR columns, seven fixed records/query cases. No joins, CSV/Parquet schema detection, extensions, performance, migrations or broad cross-database compatibility claims. Raw third-party files and venv remain outside the repository. Source links can be URL @source entries; local probe citation needs a copy inside the author directory.
