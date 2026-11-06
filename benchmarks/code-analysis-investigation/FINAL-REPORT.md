# Bounded investigation acceptance evidence

This report records a local evaluation of product commit `749ab83912adbf9617da2926be696f9b45ea90dc` and its committed `archify.zip`, SHA-256 `2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c`. It is a finite, purposive evaluation, not a project-wide accuracy estimate, runtime impact analysis, CI result, or public-fetch verification.

## Corpus and chronology

Seven public projects span JavaScript/TypeScript, Python and Java: Redux, Commander, pluggy, HTTPX, SLF4J, Guava and pandas. Five have pinned parent/head changes (the first five), and Guava and pandas each have one pinned snapshot: 12 snapshots in total. The [manifest](eval-design/manifest.json) records revisions and source hashes. The original questions and independent source answers preceded the corresponding analyzer runs; the Guava source-first provenance was recorded in the manifest but its timestamp was not independently established in the audit. The [original question reading guide](SOURCE-QUESTIONS.md) condenses those questions and source answers with pinned public source links. It was written after the studies and is not a new prospective freeze. The original documents are not bundled in full; provenance hashes do not make private documents publicly inspectable.

The later atomic location, call and change units were enumerated after earlier analyzer exposure, then frozen before this evaluation. This is not blind. Supplemental definition spans and outgoing import expectations also postdate previous studies. Independent source reading and original runtime probes provide context; neither is credited as analyzer recovery. No target project was executed in the final matrix. Static evidence does not establish dynamic dispatch or complete change impact.

## Before and after on the same frozen units

Labs baseline `bf0a29e7664f52973d06a8e6a608df2db1ecbd39` and combined predecessor `7fa882747cda2fc150c120b62a039c6d783d1ccf` were source-only; final columns describe both source and archive outputs. Entries are correct / wrong / omitted / explicit unknown. A capability-level unavailable notice is not an emitted unknown for each call.

| Selected units | Labs | Combined | Final 749ab |
| --- | --- | --- | --- |
| Function locations, 8 | 7 / 0 / 1 / 0 | 8 / 0 / 0 / 0 | 8 / 0 / 0 / 0 |
| Import sites, 7 | 7 / 0 / 0 / 0 | 7 / 0 / 0 / 0 | 7 / 0 / 0 / 0 |
| Python calls, 52 | 0 / 0 / 52 / 0 | 0 / 0 / 52 / 0 | 4 / 0 / 0 / 48 |
| Commander dynamic/member calls, 2 | 0 / 0 / 2 / 0 | 0 / 0 / 0 / 2 | 0 / 0 / 0 / 2 |
| Changed definitions, 8 | 0 / 0 / 8 / 0 | 3 / 0 / 5 / 0 | 8 / 0 / 0 / 0 |
| Paired outgoing imports, 4 | not scored | not scored | 4 / 0 / 0 / 0 |

The 52 Python sites include four independently expected targets and 48 selected unsupported boundaries; target coverage is 4/52, not 52/52. Explicit unknown is honest boundary reporting, not a recovered target. Actual import aliases and decorated enclosing functions were not covered by this selected set. Import-site identity does not establish external target resolution. [Baseline rows](evidence/baseline-units.json) and [final historical rows](evidence/final-historical-units.json) retain expected and observed values, omissions and notices. The historical grader labels two Java availability assertions `wrong-target` because the old contract expected unavailable; those two labels are preserved exactly and are not evidence of incorrect call targets. The separately versioned [availability regrade](evidence/final-availability-v2-units.json) labels both `contract-expanded`; it checks availability, not target accuracy.

The independent [Java call study](../code-analysis-java-calls/README.md) covers 86 invocation sites in eight selected methods. Final source and archive each found 86 sites, no extras, bound and navigated all 26 known targets, and reported 60 unresolved. Known target coverage is 26/86; the 60 oracle-unknown sites do not establish whether a target exists or would be right. Twenty-one targets were compiler-attributed on SLF4J; five Guava targets were source-derived in a parse-only run. The supplemental full declaration ranges were generated after the original capture. This selected Java sample is separate from the availability regrade.

The selected [incoming-reference crosswalk](evidence/incoming-reference-crosswalk.json) checks three paired SLF4J references against existing Java86 oracle units: `bind` at base line 168 and head line 175, and `loadExplicitlySpecified` at head line 183. Both modes have 3 expected / 3 correct / 0 wrong / 0 omitted / 0 extra selected references, with exact spans and valid navigation. This is a post-exposure regrade of already captured records, not a new oracle or a complete repository reference inventory. It is separate from the eight definition units.

## Scope, failures and packaging

[File coverage](evidence/final-coverage.json) records tracked files, scoped roots, extension matches, captures, role exclusions and parse errors for all 12 snapshots. Redux covers `src/`, Guava `guava/src/`, and the other scopes are repository roots. Each matching tracked language file was captured except one excluded declaration file in each Commander snapshot. Captured does not mean rule-analyzed: pandas captured 1,510, analyzed 384 and role-excluded 1,126. SLF4J captured 259/260 files, analyzed 153 on each side, and role-excluded 106/107; each side had one parse error. Files outside these roots and non-language files are outside this coverage statement.

SLF4J paired analysis exits 1 with an incomplete partial result in both modes: `slf4j-migrator/jcl/jclcontent.java` has top-level assignments rejected at line 19, column 1. Selected definitions remain available. Redux, Commander, HTTPX and pluggy paired runs exit 0 and are ready. The frozen gate checks this exact partial condition rather than treating it as full success.

The final matrix checked clean source and all 12 pinned revisions plus 20 selected source hashes before and after. All 27 source/archive command exits and receipt statuses matched; 12 raw-facts files matched byte-for-byte, and ten saved-question and five paired outputs matched after normalizing only workflow and raw-facts paths. The archive contained 390 files, 389 byte-identical to source; `archify/package.json` differs only by the standard removal of scripts and devDependencies. The separate Java replay matched its report and three raw-facts files byte-for-byte and eight questions after the same narrow path normalization. Dependency bytes were not authenticated by this comparison; archive dependencies used `npm ci --ignore-scripts` and npm reported eight advisory findings, not investigated here.

The full Code Analysis suite passed 338 tests with zero failures or skips at `216a7227cddfc3d7da3b852628ed95b5a8928b14`. Product source was unchanged through 749ab; this is reused local evidence, not a fresh full-suite run at 749ab or CI evidence. A bounded composition review found no actionable P1/P2 integration defect, but was not final human acceptance.

## Research and remaining capability gaps

The [upstream study](../code-analysis-java-calls/RESEARCH.md) compared compiler attribution, JavaParser symbol solving, SCIP occurrences and Tree-sitter navigation. Only javac was executed as an independent comparator; the other tools were documentation research. The implementation retains the existing parser and adds bounded lexical evidence without a JDK runtime dependency. Java candidates exclude qualified/member calls, overloads, inherited ownership, reflection, constructors and method references; they do not establish argument-type applicability or runtime dispatch. Python dynamic aliases, callbacks and member dispatch remain unsupported. Paired definitions do not infer renames, moves or transitive impact. A future compiler-backed or symbol-index backend needs its own fixed benchmark before adoption.

## Reproduce

The [replay README](README.md) describes prerequisites, input provenance and output comparison. With Node 22.23.2, Python 3.13 and Git, from this directory run the following after the exact product commit becomes fetchable from the configured remote:

```sh
python3.13 replay.py --work /path/to/new-replay --product-sha 749ab83912adbf9617da2926be696f9b45ea90dc --archive-sha256 2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c --require-paired-contract
```

The Java benchmark README gives pinned upstream checkout commands. For the final committed source and extracted archive, use fresh result directories and explicit executable paths:

```sh
unzip -q "$SOURCE/archify.zip" -d "$EXTRACTED"
npm ci --ignore-scripts --prefix "$EXTRACTED/archify/modules/code-analysis"
python3 "$SOURCE/benchmarks/code-analysis-java-calls/run.py" --self-check
python3 "$SOURCE/benchmarks/code-analysis-java-calls/run.py" --cli "$SOURCE/archify/bin/archify.mjs" --name source --product-sha 749ab83912adbf9617da2926be696f9b45ea90dc --node "$NODE" --java "$JAVA" --slf4j-base "$SLF4J_BASE" --slf4j-head "$SLF4J_HEAD" --guava "$GUAVA" --output "$SOURCE_RESULTS"
python3 "$SOURCE/benchmarks/code-analysis-java-calls/run.py" --cli "$EXTRACTED/archify/bin/archify.mjs" --name archive --product-sha 749ab83912adbf9617da2926be696f9b45ea90dc --archive "$SOURCE/archify.zip" --archive-sha 2a23e82cc0dce7d10c16955fff6f4bce5d3dc653d0dd40e83f03692ebef3ee0c --node "$NODE" --java "$JAVA" --slf4j-base "$SLF4J_BASE" --slf4j-head "$SLF4J_HEAD" --guava "$GUAVA" --output "$ARCHIVE_RESULTS"
```

The archive-mode product SHA is a provenance label; independently verify the archive against the source commit. [Evidence provenance](evidence/provenance.json) retains original and sanitized artifact digests. The original raw captures and original question-level documents remain private and are not reproduced by these summaries.
