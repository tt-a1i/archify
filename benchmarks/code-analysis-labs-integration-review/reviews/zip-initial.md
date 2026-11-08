> Archived independent review narrative. Source anchors are pinned below; selected machine receipts are in [evidence](../evidence). Other original relative artifact links name retained local work records and may not be published. For current disposition read [the review summary](../README.md).

# Independent ZIP spot check: PR #1279

## Disposition

**No blocking reproduced defect in the selected cases.** The packaged CLI found all eight source-known targets and kept both selected unknown controls unresolved. This is a narrow source-first sample, not a production accuracy estimate, a base-to-head improvement measurement, or a full review of the 632-file stack.

**Required evidence or human decision:** the user reports unchecked personal review confirmations. This technical inspection is expressly authorized but does not constitute that confirmation. The coordinator should check the PR body and author replies and obtain the applicable contributor confirmation, scope agreement, and other evidence required by REVIEWING.md before deciding readiness. I did not independently establish those gates or final required CI and branch protection.

**Nonblocking limitations:** these are two small projects, one host/build profile each, and selected direct calls only. Test-enabled configurations, cross-platform selection, feature combinations, external dependencies, macros, other languages, broader callers, full integration, and generation comparison remain unexamined. Because no Labs baseline was run, “added correct targets” cannot be measured; the counts below are candidate observations. Go type checking reported partial source bindings despite zero typing errors. Rust calls to inherent methods are source candidates, not proof of runtime dispatch. The retained tool caches were warm; these timings are not cold first-user setup costs.

## Frozen source and observations

The [frozen manifest](frozen-manifest.json) was written before running any packaged CLI (SHA-256 `1d1e65eed37a9579467ce8384aa75362e984e8161a546349517a4afeb3b5d149`). It records fixed revisions, source hashes, module/crate identities, source call points and expected definitions. The code-analysis benchmark manifests and READMEs were checked for prior project exposure; neither selected repository appeared in those manifests/READMEs. This does not prove absence from every historical development activity. Full per-case evidence is in [observations.json](observations.json), and the full source samples are retained alongside it.

| Project / scope | Correct target | Wrong | Missed known | Omitted calls | Reasonable unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| google/uuid v1.6.0, `0f11ee6918f41a04c201eceeadf612a377bc7fbc`; Go darwin/arm64, no tags, cgo/tests disabled | 4 | 0 | 0 | 0 | 1 |
| BurntSushi/walkdir 2.5.0, `4f26be4d450910916ea11533b2efc52b9a6483bc`; Cargo workspace, default features, unix/aarch64-apple-darwin, tests disabled | 4 | 0 | 0 | 0 | 1 |

Notable positive cross-file examples: uuid `node.go:40` → `node_net.go:19` (`getHardwareInterface`), and walkdir `src/lib.rs:690` → `src/util.rs:5` (`util::device_num`). The user-facing question receipts report valid current target navigation; the other selected target locations are in the observations and corresponding question receipts. `hash.Hash.Write` and `start.clone()` remained unresolved, appropriate for the selected interface/standard-library controls. The five Go questions and three qualified Rust questions had zero omitted records; the Rust `next` question included 28 of 28 calls. An initial unqualified `next` request returned exit 2 because three functions share the name; `::IntoIter::next` succeeded, as the diagnostic advised. This is a selection ambiguity, not a defect.

## Local evidence and reproduction

[commands.json](commands.json) records exact command arguments, exit codes, output paths and durations; stdout/stderr and raw-facts/findings are retained. `run.py` repeats the initial invocations; `walkdir-qualified-next` and `walkdir-push` commands are recorded separately in commands.json. The manifest and observations are the expected-versus-observed receipt. All `check` runs exited 0 with `--fail-on never`, which is not a claim that all project behavior is correct. Both reports list no parse errors. Go selected 15 files and excluded six test/platform files; Rust selected five files, excluded three test files, marked non-host cfg regions and opaque macro expansions, and reported no missing modules. See each `*-analysis/raw-facts.json` and `findings.json` for complete coverage and exclusions.

The checks used Node 22.23.3, npm 10.9.9, Go 1.27.2, rustc/cargo 1.89.0, Python 3.15.0; full versions are in [environment.txt](environment.txt). In the isolated extraction, `npm ci --ignore-scripts --no-audit --no-fund` exited 0 in 0.44 s; Go and Rust check runs took 1.617 s and 1.012 s respectively with existing caches. Rust offline metadata and Archify's helper were used under the declared profile; no upstream project code, tests, build scripts, or proc macros were intentionally executed. These are warm local observations, not a measurement of a fresh machine's helper compilation or dependency download cost.

## Archive, inherited CI, and actual PR state

The local candidate checkout was `996e073ded7b99cbe885fbc4afab5d125412f6c1`; its tracked `archify.zip` SHA-256 was `bb2f38587109acd1b73e97d58ce987b8db56af0c9ad58988665340e668286e4b`. The CLI was invoked only from that extracted ZIP. All 170 tracked `archify/modules/code-analysis` files matched corresponding candidate checkout bytes; the packaged `bin/archify.mjs` also matched. [module-correspondence.json](module-correspondence.json) preserves the hashes. This checks packaged module correspondence, not every ZIP entry.

The user supplied that final CI run `42442200073` succeeded at `996e073ded7b99cbe885fbc4afab5d125412f6c1`; that is inherited evidence, not a locally rerun or independently verified CI result. The user supplied Labs `bf0a29e7664f52973d06a8e6a608df2db1ecbd39` as freshly fetched ancestor; this spot check did not independently repeat that ancestry assertion or compare against Labs.

A read-only `gh pr view 1279 --repo tt-a1i/archify --json state,isDraft,mergedAt,headRefOid,baseRefName,url` exited 0 and reported OPEN, Draft, `mergedAt: null`, head `996e073ded7b99cbe885fbc4afab5d125412f6c1`, base `codex/java-declared-project-deps-20261108` ([receipt](pr-state.json)). No merge, approval, publication, or live installation was performed.
