# Baseline vs candidate

- baseline: `/private/tmp/archify-macro-20261109/benchmarks/code-analysis-rust-macro-calls-20261109/evidence/final-v9`
- candidate: `/private/tmp/archify-macro-20261109/benchmarks/code-analysis-rust-macro-calls-20261109/evidence/final-v10`
- cases: 20
- new change groups: 13

| Case | Scope | Lang | Expected | Baseline found/wrong/missed/extras | Candidate found/wrong/missed/extras | Baseline displayed d/c/u | Candidate displayed d/c/u |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| base64-inner-decode | regression | rust | 4 | 4/0/0/1 | 4/0/0/1 | 0/4/0 | 0/4/0 |
| bytes-truncate-zero | reserved-rust | rust | 1 | 1/0/0/0 | 1/0/0/0 | 1/0/0 | 1/0/0 |
| bytes-try-get-int | new | rust | 2 | 0/0/2/0 | 0/0/2/0 | 0/0/0 | 0/0/0 |
| certmagic-interface-load | reserved-go | go | 13 | 13/0/0/0 | 13/0/0/0 | 0/13/0 | 0/13/0 |
| certmagic-interface | new | go | 5 | 5/0/0/0 | 5/0/0/0 | 0/5/0 | 0/5/0 |
| certmagic-load | new | go | 20 | 20/0/0/0 | 20/0/0/0 | 2/18/0 | 2/18/0 |
| certmagic-store | new | go | 12 | 12/0/0/0 | 12/0/0/0 | 3/9/0 | 3/9/0 |
| clap-any-value-parser | new | rust | 1 | 0/0/1/0 | 0/0/1/0 | 0/0/0 | 0/0/0 |
| clap-typed-value-parser | reserved-rust | rust | 1 | 1/0/0/0 | 1/0/0/0 | 0/1/0 | 0/1/0 |
| cli-wrap-line | new | go | 4 | 4/0/0/0 | 4/0/0/0 | 4/0/0 | 4/0/0 |
| cobra-get-completions | new | go | 1 | 1/0/0/0 | 1/0/0/0 | 1/0/0 | 1/0/0 |
| echo-remove-custom-method | reserved-go | go | 1 | 1/0/0/0 | 1/0/0/0 | 1/0/0 | 1/0/0 |
| gin-close | new | go | 2 | 2/0/0/0 | 2/0/0/0 | 0/0/2 | 0/0/2 |
| gin-hijack | new | go | 3 | 3/0/0/0 | 3/0/0/0 | 0/0/3 | 0/0/3 |
| http-insert-occupied-mult | regression | rust | 1 | 1/0/0/0 | 1/0/0/0 | 1/0/0 | 1/0/0 |
| raft-stage-commit-index | new | go | 1 | 1/0/0/0 | 1/0/0/0 | 0/1/0 | 0/1/0 |
| ripgrep-file-name | new | rust | 2 | 2/0/0/0 | 2/0/0/0 | 2/0/0 | 2/0/0 |
| ripgrep-parent-key | new | rust | 1 | 1/0/0/0 | 1/0/0/0 | 1/0/0 | 1/0/0 |
| tracing-layer-event-enabled | new | rust | 6 | 3/0/3/1 | 3/0/3/1 | 0/3/0 | 0/3/0 |
| tracing-subscriber-event-enabled | new | rust | 5 | 4/0/1/0 | 4/0/1/0 | 0/4/0 | 0/4/0 |

## Scopes

- new: baseline 58 found, 0 wrong, 7 missed, 1 extras; candidate 58 found, 0 wrong, 7 missed, 1 extras
- regression: baseline 5 found, 0 wrong, 0 missed, 1 extras; candidate 5 found, 0 wrong, 0 missed, 1 extras
- reserved-go: baseline 14 found, 0 wrong, 0 missed, 0 extras; candidate 14 found, 0 wrong, 0 missed, 0 extras
- reserved-rust: baseline 2 found, 0 wrong, 0 missed, 0 extras; candidate 2 found, 0 wrong, 0 missed, 0 extras

## New change groups

- `002df10b->d5c8ad32`: bytes-truncate-zero
- `16c9db14->1a2275d5`: certmagic-load, certmagic-store
- `1752fb78->6892bc2b`: ripgrep-parent-key
- `2d114193->9a56fcd4`: certmagic-interface-load, certmagic-interface
- `4c2362d3->7155f640`: ripgrep-file-name
- `4f7bea5d->29682401`: echo-remove-custom-method
- `8d0468f7->d75fcd4c`: gin-close, gin-hijack
- `b55ebc9f->67202405`: clap-any-value-parser, clap-typed-value-parser
- `d3c91249->a2e87783`: raft-stage-commit-index
- `d3eb109e->f42e7e6d`: tracing-layer-event-enabled, tracing-subscriber-event-enabled
- `d5c8ad32->7930d93d`: bytes-try-get-int
- `d854bb40->ca8f45a9`: cli-wrap-line
- `f2878bab->746ef071`: cobra-get-completions
