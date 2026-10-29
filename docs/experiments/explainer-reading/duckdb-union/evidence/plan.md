# Round 38: DuckDB column alignment

New-project discovery: explain why two queries with the same column names in different orders can put values under the wrong heading with UNION ALL, and how UNION ALL BY NAME changes that. Distinguish column alignment from duplicate retention and missing-column NULLs. Use real DuckDB queries in an isolated ephemeral database, fixed string fields to expose silent misalignment, and ORDER BY for deterministic displayed rows.

Pin a current stable package and upstream source/test commit before authoring. Preserve raw probes twice. Independent Terra/medium author starts from a frozen Archify runtime and a source/probe brief only; capture earliest draft before any finalize, every attempt and trace. Budget: author 10 minutes / two finalize attempts; parent 15 minutes / two content revisions. No diagram requirement if tables/programs explain the question better.

Check statements against primary docs/source tests and actual query output. Inspect 390/1440 px light/dark, actual Copy content and runnable SQL, actual image export, final current-path provenance. Use fixed string columns and tiny synthetic records, not external files, extension loading, performance or migration claims. Content-only unless new evidence warrants a separate bounded runtime round. Submit branch evidence; continue overall goal.
