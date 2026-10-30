# Source discovery

Initial pinned lookup of py-polars/polars/series/series.py returned HTTP 404. The pinned pyproject and directory listing identify the new src layout; the subsequent lookup uses py-polars/src/polars/series/series.py. No runtime/probe failure or version fallback. Installed polars and polars-runtime-32 are both 2.1.0; build_info reports version only.
