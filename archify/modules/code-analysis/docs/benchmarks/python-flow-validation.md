# Revision-12 validation

Recorded 2026-11-17 on official Node 22.23.2, macOS. Branch
`codex/python-pyright-source`; parent `3b7f5bd57181c2a343976a692a81f3b45635d779`.
The final analyzer SHA256 is
`19a7eeb28dd05c9c8f93b1c028e9141ca784cdf423e9f278c845bd76a5226697`.
All measurements use the working candidate before its commit; the digest pins
the implementation independently of later documentation/archive commits.

| Evidence | Result and scope |
| --- | --- |
| Bundle/type/provenance check | `npm run check:python` passed; vendored Pyright files and MIT license unchanged |
| Full Code Analysis module | 653 tests: 637 passed, 16 real-jscpd checks skipped without the explicit tool setting |
| Native jscpd 5.4.3 supplement | 26 tests executed with no skips; 25 passed on the first run. An existing 100-ms timeout probe failed to create its startup marker under concurrent load, then passed alone (1/1). All 16 originally omitted native checks passed on the first supplement |
| Python/history/question/revision selection | 48/48 passed after cache removal; final Python source suite 15/15 passed after protocol-import hardening and historical-reader assertions |
| Fixed HTTPX comparison | 358/358 selected targets agree with reference; 265/265 baseline targets retained; frozen oracle 29/29; all independent call/function spans match |
| Click regression | 514/514 targets agree with reference, 447/447 retained; oracle 19/19; function/import/symbol facts and call inventory unchanged |
| Flask independent holdout | 154/154 selected targets agree with reference; frozen oracle 16/24, eight unresolved and zero wrong. The oracle comparison correctly exits 1 for these documented gaps |
| Original-failure reproduction | Three new positive regression groups fail with the original revision-11 analyzer and pass with revision 12 |
| Ablation | Recursive field seeding retained after one lost HTTPX target; redundant local-flow cache removed after equivalent facts/targets |
| Canonical archive and extracted package | Pending local package verification |

The full module run preceded the final cache deletion and conservative protocol
guards. The unaffected broad results are reused; the final affected Python
selection and all three fixed-project comparisons were rerun. The native
supplement's first failure is recorded rather than relabeled as a clean run.

Root renderer/browser/WebM behavior is unchanged. Earlier revision-11 root core,
generated-output and package results are recorded in [the original validation](python-validation.md);
they are not a claim of final-head remote CI or Windows verification. The PR
remains a draft pending maintainer scope/target confirmation and personal human
review. No live Archify installation was changed.

See [HTTPX repair and Flask holdout](python-httpx-flask-validation.md) for corpus
hashes, dependency pins, separate sampling strata, source/runtime distinctions,
remaining limits and commands that consume the frozen references without
launching Pyright.
