# Fresh-ZIP replay

Archive: `archify.zip` at the repository root, SHA256
`fa78fa4cb8e68ea372dde9fe1de045501476062b796866e813d075bfcb5da92a`,
405 files. Built from commit `8aa4aafe6` with `scripts/build-zip.sh` under
official Node `v22.23.4`, bundled zlib `1.3.1-e00f703` (Linux `node:22`
container). Unpacked into a fresh directory, `npm ci` installed the locked Code
Analysis dependencies, and the ZIP's own CLI (`archify/bin/archify.mjs`) ran the
queries below. Replay runtime Node reported `v22.23.3` on the host; the extractor
identity inside both receipts is `rust-syn@2.0.119`, adapter revision 9,
`rust-source-direct-v9`.

| Replay | Result |
| --- | --- |
| AsRef fixture (`rust-local-asref` base→head) | `Other::enabled` at `src/lib.rs:11`; 2 references at `32:9` (`Wrap::check`) and `37:5` (`run`), both `rust-inherent-source-candidate` → line 11; no `First::enabled` target |
| `clap` case B base→head | `parse_short_arg` at `parser.rs:831`; 1 reference at `185:44`, `macroEvidence` `ok` at `macros.rs:554:14`; `is_new_arg` at `635`; 1 direct reference at `331:29` with no macro evidence |

The AsRef replay reproduces the stage-2 acceptance result with the packaged v9
extractor: changing the definition reached by `as_ref()` returns both call sites
and no false `First` target. The case-B replay shows the same coordinates and
macro evidence as `../real-changes/case-b.json`, so the packaged artifact agrees
with the source-tree run.

Query JSON, stderr and the exact commands are stored beside this file. The ZIP
is committed at the repository root as required by the `zip-freshness` check;
the unpacked tree is not. Rebuild with `scripts/build-zip.sh` under the
canonical Node 22 toolchain to reproduce the bytes.
