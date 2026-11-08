# Static calls in Java classes with captured parents

Dependent follow-up above Draft #1271, retaining all original team/language commits and PR ownership. Java call model v4 / adapter10 is an experimental Draft candidate, not Labs integration, approval, merge, release or installation.

## A real investigation step

In Commons Lang c8774fa74adbbbcd4e5f915ab6bc3aa10d877419, investigation stopped at StringUtilsTest.java:622:26: StringUtils.defaultString(null) was unknown because its caller class extends AbstractLangTest. The candidate reads that captured parent context, excludes a value/member-type blocker named StringUtils, and navigates to src/main/java/org/apache/commons/lang3/StringUtils.java:1553:5. The two-argument call at629 reaches the annotated declaration1583 (header1584); two reserved isEmpty calls at StringUtilsEmptyBlankTest.java:122/125 reach3604:5.

Source answersd4601c493 and baseline10bcf7ac4 preceded implementation. Independent compiler controls0f6ba5d05 preceded initial rulec630a529d. Both reserved candidate comparisons followed that rule freeze. All4selected calls move from0correct/0wrong/4missed to4correct/0wrong/0missed. This reused Commons corpus is not a blind repository. The two original defaultString misses were already exposed in #1267; the two isEmpty sites were reserved from initial tuning.

The direct call can now reach its static source implementation. Argument applicability, runtime initialization/dispatch, complete callers and a full Maven/Gradle build remain separate questions. A controlled changed-body public CLI investigation finds1known inherited-context caller per side; this uses owned controls, not a new real upstream before/after pair.

## Source context and freshness

Reuse the existing Java type/member inheritance graph. The same member traversal also inventories instance and static field names; cached ancestry supplies qualifierAncestry source points. Only closed captured chains of ordinary top-level classes prove the absence of a qualifier field. Member types keep the existing type namespace guards. Inaccessible ancestor fields can conservatively block a call; field access/applicability is not fully modeled. Generic ordinary ancestors can supply field-name evidence without inferring type arguments; the post-design audit includes AbstractExceptionContextTest<T> in this limited sense.

External, incomplete, cyclic or ambiguous ancestry stays unknown. The type-only JDK allowlist does not inventory value fields. Bare inherited calls, inherited target owners, interfaces, nested/lambda callers, same-arity/varargs competition and runtime class loading are not newly supported. Existing bare/no-parent source contracts remain. Historical v1–v3 captures are not rebound.

Changing an ancestor can change the qualifier while caller/target text stays unchanged. Saved-question navigation therefore checks every qualifierAncestry file. A reproduced intermediate implementation still returned valid after a parent gained an Api field; the final rule reports qualifier-ancestry-changed, location null. Schema checks reject invalid/duplicate ancestry points and ancestry evidence under older call models.

## Wrong module discovered during replay

The post-design SLF4J replay exposed an incorrect initial target: Reload4jMultithreadedInitializationTest.java:66 navigated LogManager.getRootLogger to the sibling log4j-over-slf4j compatibility implementation. The caller module's actual POM declares external ch.qos.reload4j1.2.22, not that sibling. workspace-boundary-source.json freezes this source/POM answer before corrective commit97cb39e0f ->0ba2bb677. No product was installed/published from the initial candidate.

The final inherited-context proof requires target and ancestor evidence within the same captured Maven/Gradle marker root. Cross-root calls report java-inherited-build-scope. This is a boundary guard, not a dependency/classpath resolver. Two NoBinding calls within slf4j-api now reach LoggerFactoryFriend.reset:43. Two legitimate SimpleLogger ->Api calls are still **known misses**, and the external reload4j target stays unknown. The five supplemental observations become2correct/0wrong/2missed/1external-unknown, compared with the initial prototype4correct/1wrong. They are post-design evidence, not held-out accuracy observations. The boundary correction did not change the four Commons source answers.

Existing non-inherited source-global candidates retain their earlier contract; their classpath is not proved by this change. In SLF4J,60existing cross-build candidates remain, with no old reload4j->compatibility target found in that set. Future classpath work must preserve known legitimate edges while investigating collisions, rather than treating all sibling sources as one compilation unit.

## Independent attribution and coverage

All64826Commons call ranges,9033functions,489captured source files/imports and993old targets remain unchanged. There are4748new targets in92caller files,0removed/changed old targets,0parse errors. A separate javac17.0.21 parse/analyze of all489files with pinned test dependencies reports0errors and agrees on all4748new source declarations:0different/0unavailable. The selected4are included, not extra observations.

SLF4J keeps4856call ranges,1608functions,260captured files/imports and all prior targets. Its2new same-api-root targets independently agree with javac. The chosen compiler graph contains64api source files: the initial65-file graph reports2real upstream errors in LoggerFactoryTest.TestingProvider (getRequesteApiVersion versus required getRequestedApiVersion). That unrelated test is explicitly excluded only from the optional compiler graph; upstream sources and analyzer capture remain untouched. The separate captured jclcontent.java parse error also remains. This is not a clean full-SLF4J build claim.

evidence/compiler-summary.json and compact JSONL preserve every new attribution and exact ancestor points. A substituted, otherwise valid isEmpty target for defaultString is rejected:4747agree/1different/0unavailable, exit1. All captured source bytes are checked before/after attribution. Compiler agreement is source-definition evidence under the recorded source/classpath/JDK graph, not runtime execution, whole-project accuracy or total recall.

## Reproduce

~~~sh
python3 benchmarks/code-analysis-java-captured-superclass/run.py \
  --cli archify/bin/archify.mjs --sample /fixed/commons-lang \
  --out /runs/java-superclass-final-source
python3 benchmarks/code-analysis-java-fixed-arity/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples \
  --out /runs/java-superclass-bounded-arity-source
python3 benchmarks/code-analysis-java-captured-superclass/pair.py \
  --cli archify/bin/archify.mjs --work /runs \
  --out /runs/java-superclass-pair-source
~~~

Pin Commons and SLF4J to source-first/workspace-boundary-source revisions. Use #1271's CLI and --expect baseline with the new run.py for Java3; four misses are expected. Repeat with the unpacked ZIP CLI and -zip outputs. The older arity recipe now expects4correct/0wrong/3missed under v4: the original Commons2recover, three SLF4J static-wildcard calls remain missed, and the2production arity cases still resolve. These cohorts overlap.

~~~sh
python3 benchmarks/code-analysis-java-captured-superclass/compiler.py \
  --jdk-home /path/to/jdk17 --facts /runs/java-superclass-final-source/capture/raw-facts.json \
  --sample /fixed/commons-lang --deps /audit/deps --out /audit/commons --profile commons
python3 benchmarks/code-analysis-java-captured-superclass/audit.py \
  --baseline /runs/baseline/raw-facts.json \
  --candidate /runs/java-superclass-final-source/capture/raw-facts.json \
  --sample /fixed/commons-lang --compiler /audit/commons/compiler.tsv \
  --diagnostics /audit/commons/compiler.log --out /audit/commons-attribution.json
~~~

For SLF4J use compiler.py --profile slf4j-api, its full captured facts and repository root. audit.py additionally takes --compiler-prefix slf4j-api/ and --exclude-source slf4j-api/src/test/java/org/slf4j/LoggerFactoryTest.java. The declared64-file compiler graph and original two errors are in slf4j-compiler-scope.json. Running InheritedQualifierCalls directly on the API root without its optional source-list argument reproduces the65-file failure; never edit upstream source to make the oracle pass.

Normal analysis needs Node/java-parser, not a JDK, Maven or Gradle. The optional independent audit reused retained Temurin17.0.21; no SDK was installed. It downloads the pinned SHA256-checked audit JARs in audit-dependencies.json (Commons6386640bytes plus the separately recorded JUnit4/Hamcrest API dependencies). The initial Commons download took about0.975s in this environment; fresh JDK installation cost was not measured. Missing optional SDK exits1 with explicit guidance before downloading JARs; normal Java analysis remains usable. Compiler.py compiles/executes only the owned attribution tool, runs upstream parse/analyze -proc:none --release17, and never emits/executes upstream classes/tests/build scripts. The first direct compiler invocation passed an unexpanded classpath wildcard and reported missing JUnit; explicit JAR paths corrected that setup error. Reproducible helper outputs match the original compiler TSVs byte-for-byte.

## Separate validation states

- Final source module401/401, zero skips; final extracted calls/qualified/shared-question/paired48/48, zero skips. The initial pre-boundary prototype's400/47results do not replace these final checks.
- Source/ZIP new recipe both4correct/0wrong/0missed. Older arity recipe both4correct/0wrong/3missed; shared JS/TS Redux recipe both4correct/0wrong/0missed/1unknown. Source and ZIP owned-pair each1known caller/side, ready/exit0; no upstream version-pair claim.
- Five raw capture instances (four distinct payloads) byte-equal;9orientation payloads agree after only installation/output paths, including actual saved Java3 and shared JS forwarding. Fourteen normal CLI commands per distribution exit0. Repeats and overlapping cases are not extra samples.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 ZIP builds agree,168module files match source. ZIP SHA2567a59436f2535dcab4fbef25e744c2c95b7ea3bcaa52ee36258d578d63d178152. Node26.12.0 runs the tests/CLI. Dependencies installed only into isolated worktrees/unpacked ZIP, no live Skill installation.
- Remote final-head CI is tracked separately in the English Draft/Wiki. No approval, merge, release or live installation. Continue actual wrong targets, known misses and interrupted investigations across all six languages.

Scoped test-value review protects the real source step, inherited field/type collisions, stale parent evidence, module misnavigation and changed callers. Focused simplification reuses the existing hierarchy/member traversal instead of adding another resolver; no general inheritance/classpath engine is claimed. Diagram generation is unchanged, so renderer generation comparisons do not apply.
