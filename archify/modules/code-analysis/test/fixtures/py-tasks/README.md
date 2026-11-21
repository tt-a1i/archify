Fixture for AI task generation (lib/task.mjs). Small, synthetic Python code that
produces one finding of each kind the first task batch covers:

- complexity/function: `app/engine.py` `route`
- coupling/import-cycle: `app/a.py` ↔ `app/b.py`
- coupling/cycle: modules `domain` ↔ `ui`
- architecture/boundary: `domain` → `ui`, with `analysis.config.json`

Regenerate the task fixtures in `../tasks/` with `node test/task-fixtures.mjs`.
