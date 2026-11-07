# Java explicit class static investigation

Source-first question: at SLF4J 9783320b6c4411a0b120cad9e32cd9a981b1dac2, LoggerFactory.java:454 explicitly calls imported public static Util.getCallingClass, defined in helpers/Util.java:98. Can a developer navigate across that file boundary and recover this known caller? Source hashes, original freeze and a separately disclosed negative-control line transcription correction are retained.

Independent Temurin 17.0.21+9 JavacTask attribution (--release 8 -proc:none) succeeds for 45 API sources with zero compiler errors. It identifies org.slf4j.helpers.Util#getCallingClass(). The interface call iLoggerFactory.getLogger at line427 only identifies ILoggerFactory#getLogger(String), not its runtime implementation. Project methods are not executed. See compiler-attribution.json and the existing code-analysis-java-calls/CallOracle.java helper.

Before any implementation, normal source CLI at preserved team parent 93378351d selects 66 Java files, has no parse errors, and leaves both calls unresolved/unsupported-callee. The static source target is a missed deterministic reference; interface dispatch remains reasonably unknown. This case is source-inspected and a previously used project, not a blind holdout. That retained baseline predates the candidate validation below.

The implemented candidate remains independent of Go/Rust implementation layers and preserves the original team ancestry. Wrong-target compiler controls and a reserved review slice are disclosed below.

## Candidate result

Runtime `5f0b6414f3121733fe69c17528ac4b5502ea649a` adds `java-static-lexical-v2`, retaining v1 reader support. The CLI now follows SLF4J LoggerFactory.java:454 → helpers/Util.java:98, then the existing same-class static path to getSecurityManager. Its interface/provider call at LoggerFactory.java:427 stays unknown. The same-package Commons Lang ClassUtils.java:733/995 → StringUtils.java:3604 paths also navigate correctly. No project code, build or annotation processor is executed by the product; no new runtime dependency or JDK requirement is added.

| Frozen selected cases | Correct | Wrong | Missed expected targets | Reasonable interface unknown |
| --- | ---: | ---: | ---: | ---: |
| Parent normal source CLI | 0 | 0 | 3 | 1 |
| Candidate source | 3 | 0 | 0 | 1 |
| Candidate extracted ZIP | 3 | 0 | 0 | 1 |

This is finite source inspection, not whole-repository accuracy or observed developer productivity. SLF4J was previously used in Java research. Commons Lang 3.14.0 (`c8774fa74adbbbcd4e5f915ab6bc3aa10d877419`) was reserved after the first implementation was written, source-inspected before its first execution, and not used to tune the initial rule. It is not a blind holdout. The original negative-control line transcription correction is disclosed in source-correction.json.

## Supplemental compiler audit and remaining misses

`AllStaticCalls.java` independently attributes all main sources with Temurin 17.0.21+9, --release 17 -proc:none: SLF4J 45 files / zero compiler errors; Commons Lang 246 / zero errors. It records exact UTF-16 call/definition offsets. This post-design audit checks all newly emitted qualified targets in those graphs, not only the three selected cases: **7 SLF4J + 105 Commons targets agree, zero disagree**. Three further SLF4J test-source targets were inspected in source, outside the compiler graph/JUnit classpath; they are not counted as compiler-agreed.

The wider compiler-known project-static-call denominator makes remaining deterministic gaps visible:

| Main source graph | Parent correct / missed | Candidate correct / missed | Wrong | Omitted callsites |
| --- | ---: | ---: | ---: | ---: |
| SLF4J, 115 compiler-known static sites | 45 / 70 | 52 / 63 | 0 | 0 |
| Commons Lang, 2,442 compiler-known static sites | 558 / 1,884 | 663 / 1,779 | 0 | 0 |

These counts cover successfully attributed static references to project source, not all invocations, external methods or runtime dispatch. Known compiler targets left unresolved count as **misses**, not successful unknowns. Overloads, inherited owners and other bounded-model exclusions leave many such references unsupported. The audit is additional evidence, not a pre-development freeze. Full static compiler inventories, compiler diagnostics, bounded summaries and an executable grader are retained; raw unbounded local reports remain outside the repository.

Across both complete captures, all 1,492/8,397 call ranges and all 52/558 previously bound call records remain unchanged. Functions and import facts are identical. Native method-call evidence is separate from the dependency graph: this change does not add qualified-call-only type dependency edges. Investigate those missing edges separately rather than inferring a complete impact graph from successful calls.

## Scope and wrong-navigation controls

The new path uses the existing Java type/package/import resolver and checks the expression namespace first. Explicit imported, same-package or fully qualified class names can reach unique public explicitly static fixed-arity body methods in public top-level ordinary classes without explicit supertypes. Callers remain ordinary top-level method scopes without explicit supertypes. Value names in the method/class, type parameters/local types, duplicate class owners, static value/wildcard imports, overloads, varargs, inherited contexts, lambdas and nested/anonymous owners can retain unknowns. Method-wide value blocking can conservatively exclude calls before a later local declaration or outside a pattern branch. Argument applicability and compilation are not checked by the product. Nonpublic targets, interface/instance dispatch, static-imported bare methods, constructors, method references and generated code remain unsupported.

Independent javac controls were committed before implementation. A supplemental static-imported field case revealed that a type-only resolver could wrongly treat an expression value as the imported class. The final value-import guard prevents this. Removing only that guard makes the regression fail; its source/attribution/ablation are retained. Initial development also corrected the CST location of class-public modifiers and a request-object spread ordering error before real-project grading. No failed attempt is presented as accepted validation.

The focused test-value review protects observable exact jumps, value/type collisions, stale target files, duplicate classes, overload/access boundaries and cross-file paired known references. Existing Java/shared tests cover the old model; no private resolver snapshot test was added. Focused complexity review traced capture → type lookup → schema → saved/paired questions. Native type lookup is reused; reduced metadata avoids retaining all CSTs. Existing bare-call extraction remains intact to avoid changing v1 behavior; no supported capability was removed.

## Verification layers

- **Local:** 347 pass / one inherited installed-configuration TS snapshot assertion / zero skipped. Exact parent reproduces that TS assertion (10 pass / one fail). The initial run also caught the intentionally stale Java revision fingerprint; regeneration changed only Java revision 6 → 7 and its digest. Targeted Java/question/change suites pass; ten old/new Java checks pass from the extracted package.
- **Normal source / ZIP CLI:** two checks and four saved questions per candidate distribution all exit 0. Two raw-facts files match byte-for-byte; four questions match after only installation/output/workflow path normalization. Authored paired regression recovers foreign callers of a changed definition; it is not a new real-version-pair study.
- **Package:** two canonical Node 22.23.3 / bundled zlib 1.3.1-e00f703 builds match. All 157 tracked module files match the extracted ZIP. SHA-256 `6c58592ae3c4f9d913c966f3af52eaa1ed338ebf6cf1a0b2222f7800a6275735`. Runtime Node 26.12.0/macOS arm64. No local Windows Java execution claim.
- **Remote CI:** tracked separately on the English Draft at its final head, not inferred from local/package results.
- **Integration:** independent branch based on preserved #1252; no Go/Rust source or original PR ownership changed. This package represents this Java branch, not an integrated Go/Rust release. No approval, merge, release or live installation.

## Reproduce

Use exact upstream checkouts named slf4j and commons-lang under one sample directory. Normal analyzer replay requires Node and existing module dependencies, not a JDK:

```sh
python3 benchmarks/code-analysis-java-cross-file-static-calls/run.py --cli archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/java-source
unzip archify.zip -d /tmp/java-package
python3 benchmarks/code-analysis-java-cross-file-static-calls/run.py --cli /tmp/java-package/archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/java-zip
```

For the independent attribution audit, use a JDK 17 and check both compiler exits/diagnostics before grading:

```sh
javac -d /tmp/java-oracle benchmarks/code-analysis-java-cross-file-static-calls/AllStaticCalls.java
java -cp /tmp/java-oracle AllStaticCalls /path/to/samples/slf4j/slf4j-api/src/main/java > /tmp/slf4j.tsv
java -cp /tmp/java-oracle AllStaticCalls /path/to/samples/commons-lang/src/main/java > /tmp/commons.tsv
python3 benchmarks/code-analysis-java-cross-file-static-calls/audit.py --slf4j-facts /tmp/java-source/slf4j/raw-facts.json --commons-facts /tmp/java-source/commons/raw-facts.json --slf4j-oracle /tmp/slf4j.tsv --commons-oracle /tmp/commons.tsv --out /tmp/java-audit.json
```

Compiler attribution does not execute the applications. The original control helper used release 8 for SLF4J; pattern-variable controls and supplemental whole-main-source audit use release 17. Product parsing still uses the existing java-parser 3.0.1. New v2 facts need a matching CLI/schema; current readers retain v1 coverage without upgrading historical facts to v2.
