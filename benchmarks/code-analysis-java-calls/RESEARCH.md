# Analysis model choices

Source navigation and runtime dispatch are different claims. The Java experiment reuses Archify’s existing `java-parser@3.0.1` and records syntactic method invocations separately from the narrow static source targets it can identify. Unknown targets remain in the denominator.

| Upstream approach | Useful evidence | Cost and boundary | This study |
| --- | --- | --- | --- |
| [OpenJDK javac Trees](https://docs.oracle.com/en/java/javase/17/docs/api/jdk.compiler/com/sun/source/util/Trees.html) | Syntax ranges; attributed declarations after compiler analysis | Needs a JDK and sufficient classpath/source setup; static binding still does not establish execution | Temurin 17.0.21+9 executed: 86 syntax sites matched, 21 SLF4J targets compiler-attributed; Guava parse-only |
| [JavaParser / JavaSymbolSolver](https://github.com/javaparser/javaparser) | Java AST plus symbol solving across configured source roots and libraries | JVM dependency and project environment setup; overload resolution still has documented edge cases | Documentation reviewed; not run or added |
| [SCIP](https://github.com/scip-code/scip/blob/main/scip.proto) and [scip-typescript](https://github.com/sourcegraph/scip-typescript) | Symbol occurrences, definitions and references in a portable index | Indexer-specific configuration and dependency environments; an occurrence is not automatically a runtime call edge | Documentation reviewed; not run or added |
| [Tree-sitter code navigation](https://github.com/tree-sitter/tree-sitter/blob/master/docs/src/4-code-navigation.md) | Structural definition/reference tags | Syntactic matches alone cannot prove a uniquely bound target | Documentation reviewed; not run or added |

The independent compiler oracle was useful without introducing a JDK runtime requirement into Archify. A compiler-backed backend may offer broader future coverage, but this study does not establish its operational cost or comparative accuracy across the full corpus.

Java’s [overload rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.4.9) and [method-invocation lookup](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12) explain why name matching alone is insufficient. This model only offers same-class source candidates for bare calls to unique explicit static methods with matching fixed arity, excluding classes with explicit supertypes and nested/local/anonymous ownership. It does not type-check argument applicability. Qualified/member calls, overloads, reflection, constructors, and method references remain outside its target support.

Research date: 7 November 2026. The upstream descriptions above are documentation evidence; only javac was independently executed in this comparison. See README for exact source pins, source-first chronology, scoring corrections, and product results.
