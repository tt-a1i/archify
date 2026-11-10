# Six-language Labs integration candidate

The shared starting revision is `bf0a29e76`. The candidate preserves the product tree and canonical archive from `4390816b8`. Its 243 commits since Labs remain ancestors, including outlier27-cell's [threshold validation](https://github.com/tt-a1i/archify/pull/1222) and [coverage reporting](https://github.com/tt-a1i/archify/pull/1223). [#1283](https://github.com/tt-a1i/archify/pull/1283) is the earlier integration candidate. [#1289](https://github.com/tt-a1i/archify/pull/1289) joined the Go and Rust lines. [#1298](https://github.com/tt-a1i/archify/pull/1298) contains the last product revision in this candidate.

## Reproduce the integration smoke

Unzip the root `archify.zip` in a temporary directory and run `npm ci` inside the Code Analysis module of both copies. Use Node 22, Python 3, Go and Cargo with the extractor dependencies available. From the repository root run:

```sh
python3 benchmarks/code-analysis-labs-review/smoke.py archify/bin/archify.mjs /path/to/unpacked/archify/bin/archify.mjs
```

Each language has one changed definition and one direct source reference. On both revisions the script checks the definition line, call location, target line and valid navigation, then compares the complete source and package JSON responses. This smoke covers six ordinary query paths. An earlier Java probe with a class-qualified same-file call in the default package returned zero known references. The positive Java case uses an unqualified static call. Runtime dispatch, project-scale completeness and overall accuracy require separate evidence.

## Retained evidence

The [full benchmark tree at the original revision](https://github.com/tt-a1i/archify/tree/4390816b82ecf349033516d867e7e4caf8a54281/benchmarks) preserves the raw captures, answer keys, controls, scripts and reader reports. Restore that revision in a separate worktree to replay historical scripts with their original paths. The candidate checkout retains the benchmark referenced from the Rust adapter documentation. Historical evidence remains in Git history. The smaller review diff does not reduce the size of that history.

- [Six-language real-project source and package comparisons](https://github.com/tt-a1i/archify/tree/4390816b82ecf349033516d867e7e4caf8a54281/benchmarks/code-analysis-languages-combined)
- [Earlier integration review and scope audit](https://github.com/tt-a1i/archify/tree/4390816b82ecf349033516d867e7e4caf8a54281/benchmarks/code-analysis-labs-integration-review)
- [Go/Rust investigation batch](https://github.com/tt-a1i/archify/tree/4390816b82ecf349033516d867e7e4caf8a54281/benchmarks/code-analysis-go-rust-investigation-batch-20261108)
- [Rust forwarding, closure cases and v14 limitations](https://github.com/tt-a1i/archify/tree/4390816b82ecf349033516d867e7e4caf8a54281/benchmarks/code-analysis-rust-trait-forwarding-20261109)
- [Team Wiki language capability matrix](https://github.com/tt-a1i/archify/wiki/Code-Analysis-Language-Capabilities)
