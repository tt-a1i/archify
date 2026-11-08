# Java declared direct project source routes

A developer investigating SLF4J `9783320b6c4411a0b120cad9e32cd9a981b1dac2`
previously stopped at `LoggerFactoryFriend.reset()` in Simple's initialization
setup/teardown. Java4 intentionally withheld inherited-context cross-build targets
after an observed wrong reload4j → compatibility-module target in #1272.
Java5 now follows these two calls to API main source `LoggerFactoryFriend.java:43:5`
using declared jar + test-jar routes and the captured API test ancestor.
Runtime loading, full classpath/argument applicability and complete callers remain unproved.

## Freeze and comparison

- Parent baseline: #1272 `b5b14e8a9666a4a92e8a71d844f788bb28041c56`.
- Source/POM answers: `29f24d845`, [source-first.json](source-first.json).
  Baseline `ff8ef20bacc1fb0db1f7be8366a100675fbc1970` preceded rule implementation.
- XML parser comparison: `4e63145b8`, [xml-parser-probe.json](xml-parser-probe.json).
  Actual POMs plus plain/prefixed/malformed XML; tiny probe timings are not a benchmark.
- Initial rule froze at `7f17c3857` before candidate inspection of reserved cases.
  Post-result implementation review added unresolved scope/type/classifier rejection at
  `bc26eaddf`; it did not tune on reserved outcomes. All real replays and ZIPs were rerun.
- Two Simple calls are prior known misses, not blind samples. Two bridge MDC calls
  were reserved only from initial dependency-rule tuning; both already resolved.
  [Baseline replay](evidence/baseline-replay.json): 2 correct / 0 wrong / 2 missed.
  [Candidate](evidence/source.json): 4 correct / 0 wrong / 0 missed.
  One source-known external reload4j counterexample remains unknown in both.
- [Full target audit](evidence/audit.json): exactly 2 new targets, both independently
  javac-agreed; 231 old targets unchanged. All 4,856 call ranges, 1,608 functions,
  260 source files/imports and the existing jclcontent.java parse failure are retained.
  Build evidence attaches to 62 calls, including 60 existing targets; those are not
  62 new accuracy gains. Used metadata: 16 POMs / 46,914 UTF-8 bytes.

## Bounded semantics and cost

Java5 / adapter11 reads captured local parents, including named `parent-pom.xml`,
literal GAVs, inherited default properties and dependency management. A unique
captured coordinate and shared literal reactor plus a direct jar/test-jar declaration
are required for new inherited-context cross-root candidates. Main/test roles and
scope/type/version are distinct. Reactor co-location grants nothing.

`languageScope` records metadata text/hashes, modeled projects and unknown reasons.
`buildEvidence` points to the project/parent/reactor POM declarations. Both saved
and paired readers require fresh inputs. Relevant conditional properties (including
inherited and indirect property references), module/dependency profiles, unavailable
parents, imported BOMs, duplicate coordinates, Gradle and custom source layouts
cannot grant new routes. This is not a Maven effective model, transitive artifact
resolver, module-specific type index or runtime classpath. Old no-parent/global
source candidates keep their existing contract. No supported historical path is retired.

The shared snapshot captures configured XML/POMs and build markers once, with
excludes preserved; only used POM text is emitted as metadata, not Java source.
This adds metadata capture cost; individual CLI times are in the receipts and do
not establish a speedup or controlled performance comparison. XML uses pinned
`@xmldom/xmldom@0.9.12` (440,251 published unpacked bytes in the recorded probe).
Normal analysis needs Node and npm parser dependencies, no JDK/Maven/Gradle.
No project build, plugin, extension, annotation processor or upstream code is executed.

## Real upstream migration (supplemental after rule design)

[Source-first pair freeze](upstream-pair-source.json), `f2ab5a605`, precedes this
pair's analyzer runs: `99e356974859a4cac2f5e533de2d8232d9d5dbe6` →
`1c13755b2520e511bc41b5c6fdc8bd6c58e529c0`. The upstream commit introduces API
`LoggerFactoryFriend.reset:19:5` and removes module-local test helpers.
The base entry is absent, so this is an **added-definition migration**, not a
changed-body or two-sided ready pair. [Baseline](evidence/pair-baseline.json)
finds 2 head references; [candidate](evidence/pair-source.json) finds 4, adding
source-frozen Simple calls at56/61. Two Nop references are post-output preservation
observations, not new designed accuracy samples. Both versions retain **partial /
exit1**: base entry absent, POM settings differ, and unrelated parse failures remain.
97 changed source files exceed the 40-item file list; this does not bound all impact.
Pinned upstream archive hashes/costs are [recorded](evidence/upstream-archives.json).
Historical Git traversal hit an unavailable promisor object; pinned codeload archives
were used and source/POM hashes checked, without rewriting the sample repository.

## Reproduce

Use fixed source checkouts, then:

```sh
python3 benchmarks/code-analysis-java-project-deps/run.py --cli archify/bin/archify.mjs --sample /path/to/fixed-slf4j --out /path/to/new-output
```

For the baseline use #1272's CLI and `--expect baseline`. `run.py` checks revision,
clean tracked files, source hashes, normal `check` and five function questions.
It explicitly selects `--fail-on never` (exit0). A default warning gate separately
returns1 for the existing ToStringHelper complexity warning; that is a finding
gate, not an extraction error. Repeat with an unpacked ZIP's `archify/bin/archify.mjs`.

`pair.py --cli <cli> --base-root <fixed-base> --head-root <fixed-head> --out <new>`
repeats the actual migration; `--expect baseline` selects the old expected scope.
`freshness.py --cli <cli> --capture <new-capture> --baseline <old-capture> --sample
<fixed-root> --out <new>` checks changed-POM exit1 and saved-Java4 exit0 in disposable
source copies. `verify.py` compares source/ZIP raw facts and paired evidence.
Recorded `$WORKSPACE` paths are placeholders for the local test workspace.

Optional independent source attribution:

```sh
python3 benchmarks/code-analysis-java-project-deps/compiler.py --jdk-home /path/to/jdk --facts /path/to/capture/raw-facts.json --sample /path/to/fixed-slf4j --deps /path/to/audit-jars --out /path/to/compiler-output
python3 benchmarks/code-analysis-java-project-deps/audit.py --baseline /path/to/old/raw-facts.json --candidate /path/to/new/raw-facts.json --sample /path/to/fixed-slf4j --compiler /path/to/compiler-output --out /path/to/audit.json
```

Retained Temurin17.0.21 was reused, with pinned JUnit4.13.1 / hamcrest-core1.3
(427,732 bytes; zero new downloads here). Fresh SDK installation cost was not measured.
Full 78-file API/Simple attribution encounters two real upstream errors in
LoggerFactoryTest.TestingProvider (`getRequesteApiVersion` versus required
`getRequestedApiVersion`); [original errors](evidence/compiler-full-errors.txt).
Only that unrelated test is omitted from the optional 77-file oracle, which has
zero errors and agrees on both new targets. Analyzer capture remains all260files.
The exact source list is in the audit receipt. javac parse/analyze uses `-proc:none`
and `--release17`, with no project emit or execution. Missing optional SDK returns
[explicit guidance / exit1 before downloads](evidence/missing-sdk.json).

## Validation and state

- Local module407/407, zero skips. Extracted affected tests46/46, zero skips.
- Node26 package/release/community checks58pass/0fail/7skip: six require canonical
  Node22/zlib and one is Windows-only. Initial missing root parse5 development
  dependency was fixed by locked `npm ci --ignore-scripts`; original failed log retained.
- Canonical Node22 final package/release checks54pass/0fail/2skip (the non-canonical
  rejection lane and Windows-only drive-path lane). CI platform results remain separate.
- [Source/ZIP parity](evidence/parity.json): 9 normal CLI commands per distribution;
  six frozen-query exits0, real migration1, changed-POM1, historical-Java4 task0.
  Full call/definition/source/import/POM payloads agree; distributions are not
  independent accuracy samples.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 builds match;
  ZIP SHA256 `2799913d91a133d9cace5699d4f64c3530d2ded2f67248a91395481b06d5798a`.
  All170code-analysis package files match source. ZIP is tracked with the candidate.
- Remote CI, Labs integration and formal merge are separate states. No approval,
  merge, release or live installation; Draft publication/CI receipt follows.

Scoped test-value review: six behavior tests protect direct source-set routing,
wrong sibling selection, conditional defaults, stale POMs/BOM decoding, and real
paired caller navigation. Tests assert public facts/navigation rather than private
DOM structure. Source-first real questions and independent javac catch shared
fixture assumptions. Focused simplification review traced capture → Java → saved /
paired readers: it reuses the existing metadata freshness and source-point machinery,
keeps one capture, and removes a redundant UTF-8 decode. A general Maven model or a
second freshness engine would add unsupported obligations and is not introduced.
