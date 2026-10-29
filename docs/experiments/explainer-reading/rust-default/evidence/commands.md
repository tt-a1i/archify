# Parent execution record

Installed compiler inspected with `rustc --version --verbose`; no toolchain or crate installation.

```sh
rustc --edition=2021 probe.rs -o probe
./probe > probe-1.jsonl
./probe > probe-2.jsonl
```

Commands ran in the external round directory using absolute paths. Compiler stdout/stderr are retained. Both probe runs completed successfully; nine ordered-event/result expectations and raw byte equality passed in probe-check.json. No duration or optimized-build comparison was performed.
