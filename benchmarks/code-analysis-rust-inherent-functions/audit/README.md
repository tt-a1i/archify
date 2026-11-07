# Independent rust-analyzer navigation audit

This optional research tool audits published Rust candidate `20ce8f32ad9002c408abeb11a6fedec539aba004` (runtime `1a1f6677e`). It is not a shipped backend or a new product dependency. Original contributors, PR ownership and source/package contents are unchanged.

## What the audit establishes

| Recorded profile | Newly emitted source-target observations | RA agrees | Different / unavailable |
| --- | --- | --- | --- |
| regex | 1,205 | 1,205 | 0 / 0 |
| serde_json default | 22 | 22 | 0 / 0 |
| serde_json arbitrary_precision | 23 | 23 | 0 / 0 |

These 1,250 observations cover 1,230 distinct physical sites and include the earlier finite source cases. Do not add the overlapping counts as independent samples. `rows.jsonl` records each exact invocation, LSP query point, expected captured function range/digest and returned declaration location. Agreement requires the same file/declaration line/name and a selected identifier inside the captured expected function range. This is independent language-server definition agreement under the recorded setup, not project compilation, runtime dispatch, whole-project precision or recall.

The two source-known `Map::new()` misses (`map.rs:526/535 → 41`) are independently located by RA under both serde profiles: four observations, two physical sites. They remain unresolved in the product, so they stay **known misses**. No generic rule was tuned to these results.

A separate negative control deliberately substitutes bytes::Regex::new as the expected target for string::Regex::new. The query still reaches string, and the grader reports one different target. That is a rejected authored control, not a product wrong target. Its separate report proves that agreement is not an unconditional success path.

## Fixed sources, dependency graph and execution boundary

The exact source commits are regex `9870c06e6c772daaad7ab612faab29130753e41c` and serde_json `4d4f53c3b7de3259b6a8a15ef4d5f4edb47af32f`. The originals have no Cargo.lock. `prepare.py` archives those commits into new audit copies and adds the separately generated, checked-in audit locks. Their hashes are pinned in inputs.json. These locks fix this audit graph; they are not upstream release locks or changes to the original samples.

The initial offline setup failed because automod was not cached. Lock generation and dependency fetch were therefore explicit online preparation steps. Existing registry/git caches are reused without copying credentials or Cargo configuration. Metadata in the audit is locked/offline. The recorded target is aarch64-apple-darwin. Python 3.12+ (tarfile data filter) and the exact rust-analyzer 1.89.0 component are required; rust-src was already installed. Cross-host replay has not been verified. Input call/function/source digests reject changed capture scopes rather than silently comparing a different inventory.

Effective settings are asserted from RA's analyzer status: checkOnSave=false, cargo.buildScripts.enable=false, procMacro.enable=false. A Cargo guard permits only metadata/version/location queries. It enforces locked/offline metadata and logs requested versus executed arguments; build/check/test and Cargo rustc/config probes are rejected. RA falls back to direct rustc cfg/target queries. RA 1.89 prefers CARGO_HOME/bin/cargo ahead of CARGO/PATH, so preparation guards both entrypoints. An initial unguarded setup probe is excluded from the published results.

Standard-library metadata could not fetch cc1.2.0 offline and retried with no-deps. This limitation is retained in each profile's stderr log. The source workspace loaded, effective safety settings were verified and all audited target queries returned locations. This fallback does not establish a fully compiled standard-library/dependency environment.

## Reproduce

First produce the source facts with the parent benchmark run.py at the recorded candidate/target, using its pinned samples. Then:

```sh
python3 benchmarks/code-analysis-rust-inherent-functions/audit/prepare.py \
  --samples-root /fixed/samples --workspaces-root /audit/workspaces --out /audit/results
cargo fetch --locked --target aarch64-apple-darwin --manifest-path /audit/workspaces/regex/Cargo.toml
cargo fetch --locked --target aarch64-apple-darwin --manifest-path /audit/workspaces/serde-json/Cargo.toml
python3 benchmarks/code-analysis-rust-inherent-functions/audit/audit.py \
  --profile regex --workspaces-root /audit/workspaces --facts-root /runs/source --out /audit/results
```

Repeat the last command for `serde-default` and `serde-arbitrary`. Run regex again with `--negative-control` to exercise the wrong-target guard. Preparation refuses occupied source destinations; use the exact prepared --out for the driver. The LSP requests are read-only. The server is shut down in finally, including failures. Normal mismatches/unavailable targets produce a nonzero exit with their report retained; the deliberate negative control succeeds only when the wrong expectation is rejected.

The facts and questions remain reproducible by the normal source and extracted-ZIP CLI. This additional audit does not replace their original parity checks. No shipped file or ZIP byte changes in this evidence follow-up.

## Cost and validation

The optional installed RA executable is 35,248,592 bytes. `evidence/summary.json` records the downloaded crate archive names/versions and cached compressed bytes observed during setup, separate from the product helper cache. Fresh-cache/download/install time was not controlled. Replay times are startup plus selected definition requests, not a speedup comparison against the product's full analysis output.

The published driver replay audits all three inventories, verifies effective disabled execution settings, uses exact copied source/lock identities and rejects the deliberately wrong nominal target. Prior runtime validation remains applicable: local module 380/380, package selection 42/42, raw/question/v1 parity and CI run42410170694 at the unchanged runtime candidate. Remote checks for this evidence-only head are tracked separately on Draft #1265.

The practical next step remains source-guided: investigate generic-owner/type-alias and Go incomplete-external-type gaps without turning trait/specialization ambiguity into guessed targets.
