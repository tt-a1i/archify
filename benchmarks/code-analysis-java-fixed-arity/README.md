# Java unique fixed-arity static source candidates

Follow-up to Go SDK Draft #1266 atf8470917f7f80e279555025bee25af81f544c8f1, preserving all original team/language commits and PR ownership. Java3 selects a unique static declaration among different fixed arities. It does not implement argument typing or complete Java overload resolution.

## One investigation step gained

In fixed Commons Lang, `exception/ExceptionUtils.java:287 StringUtils.defaultString(th.getMessage())` previously stopped at ambiguous-binding because StringUtils declares one- and two-argument methods. Now the one-argument call reaches StringUtils.java:1553. The inner Throwable.getMessage dispatch stays unproved. In fixed SLF4J, MessageFormatter.java:124 arrayFormat(messagePattern,new Object[]{arg}) now reaches the same file's two-argument declaration at154, rather than treating its three-argument sibling as a blocker.

This is source navigation under the existing owner/type/value/static-import guards. Same-arity alternatives, any variable-arity sibling, inherited callers/owners, value shadowing, wildcard static imports and argument applicability remain unknown or unsupported. A shared selector reuses existing method descriptors for bare and explicit class paths; no second parser/type resolver is added. Different-arity candidate selection is not runtime execution, class loading or proof of compilation.

## Frozen source answers and honest misses

Initial source answers froze atfd116050e and javac controls atb1bf9ce14 before the rule. Commons Lang pin c8774fa74adbbbcd4e5f915ab6bc3aa10d877419 and SLF4J pin9783320b6c4411a0b120cad9e32cd9a981b1dac2 were exposed in earlier studies, not blind repositories. The first five frozen test-call misses have separate pre-arity blockers: StringUtilsTest inherits AbstractLangTest; MessageFormatterTest has a static Assert.* import. Those guards were retained, so **all five remain known-source misses**, not reasonable-unknown wins.

Two supplemental production cases were source-inspected after that baseline exposed the independent guards and before any rule change. Both have eligible ordinary owners and ambiguous-binding from different fixed arities. The source correction atStringUtils1583 records the owned Deprecated annotation; its method header is1584. Both locations and the correction remain explicit.

| Selected source unit | Parent Java2 | Candidate Java3 |
| --- | --- | --- |
| Two supplemental production calls | 0 correct / 2 missed | 2 correct / 0 missed |
| Five original guarded test calls | 5 known-source misses | 5 known-source misses |
| LoggerFactory.getLogger arity1 control | unknown | unknown |

The LoggerFactory String/Class overloads share arity1; no target is chosen by argument count. Authored javac controls separately demonstrate same-arity argument typing and fixed/varargs applicability. They do not establish complete project or runtime correctness.

## Broader introduced-target audit

The candidate adds254 Commons targets (227bare,27qualified) and38 SLF4J targets (6bare,32qualified). Independent javac parse/analyze attribution on246 Commons main and45 SLF4J API main files reports zero compiler errors and agrees with **289 newly emitted target locations**, zero disagreements. The remaining3 records lie outside those compiler source graphs and receive separate source-only review: Commons test Objects.requireNonNull and two slf4j-simple Util.report calls. They are not compiler-attributed successes. Exact call extents, targets, diagnostics and the source-only review are retained.

All69,682 call ranges,10,641 functions, import inventories and old target positions are preserved. No previously resolved target was redirected. This inventory is exposed/post-design verification, not a blind corpus, a whole-project precision/recall denominator or a complete caller set. Initial and supplemental units overlap the broader audit and cannot be summed as independent samples.

## Normal source/ZIP reproduction

```sh
python3 benchmarks/code-analysis-java-fixed-arity/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/source
```

Use the extracted CLI for ZIP; use #1266's CLI with --expect baseline for Java2. Both source and ZIP score2correct/0wrong/5missed in the selected units. Checks and saved questions exit0 under explicit --fail-on never, which does not mean no findings. Two raw captures are byte-identical and two questions agree after normalizing only installation/output paths. An actual historical Java2 capture remains available in both distributions, with unchanged scope semantics. Java1 compatibility remains in the focused tests.

Two canonical Node22.23.3 / bundled zlib1.3.1-e00f703 builds agree; all168 tracked module files match. See evidence/parity.json for the ZIP digest. Product parsing uses the existing java-parser3.0.1; no new dependency, JDK or language server is required. Existing retained Temurin17.0.21 is only used for independent compiler controls/attribution. No upstream code/tests/annotation processor executes. SLF4J's existing parse failure atslf4j-migrator/jcl/jclcontent.java is preserved and reported, rather than presenting260 captured files as entirely parsed coverage.

For the optional compiler audit, use the existing AllStaticCalls.java helper from ../code-analysis-java-cross-file-static-calls with a JDK17, --release17 and -proc:none. Capture commons.tsv/commons.log and slf4j.tsv/slf4j.log from the exact main-source roots, then:

```sh
python3 benchmarks/code-analysis-java-fixed-arity/audit.py \
  --baseline /runs/baseline --candidate /runs/source --oracles /runs/oracles --out /runs/audit.json
```

The grader checks successful compiler diagnostics before comparing new targets; out-of-scope records remain separate. Source/ZIP replay does not depend on this optional toolchain.

## Separate validation states

- Local runtimeecbadd5cb: focused Java13/13; complete module386/386, zero skips; core19/19 and release identity pass.
- Extracted package: Java/question/change41/41, zero skips; normal CLI target navigation, source/ZIP and historical Java2 parity pass.
- A changed-overload fixture verifies that changing the one-argument declaration retrieves its own one known reference per side and excludes the two-argument sibling's reference. It is a controlled regression, not a real upstream body-change claim.
- Remote final-head CI is tracked on the English Draft; local/package passes do not establish remote/Windows success.
- Integration remains Draft, not Labs/approved/merged/released/installed.

Scoped test-value review updated obsolete different-arity rejection expectations while retaining legal same-arity/varargs/visibility/namespace negatives. The extractor revision fixture changes only Java7→8. Scoped simplification reuses one descriptor/selector path for both call forms while retaining visibility and caller-scope protections; no compatibility contract was removed. Diagram generation is unchanged, so renderer-generation comparisons are not applicable.

Next: investigate inherited/static-wildcard source questions without guessing value identity, and continue the other languages' real-source coverage and unknown-boundary work. This bounded Java step does not complete the persistent six-language objective.
