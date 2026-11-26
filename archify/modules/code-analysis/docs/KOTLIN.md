# Kotlin source analysis

From the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis check /path/to/kotlin-repo --language kotlin --out out/kotlin
```

The diagram workflow accepts the same `--language kotlin`. When the scan finds
Kotlin alongside another supported language, Kotlin is eligible for automatic
selection if the root holds `pom.xml`, `build.gradle(.kts)` or
`settings.gradle(.kts)` — the same project markers as Java. If the build
marker is only in a subdirectory, use `--language kotlin` explicitly. The run
reports omitted other-language files.

The adapter reads captured UTF-8 source with a tolerant Kotlin lexer and
recursive-descent parser written for Archify. It does not run the Kotlin
compiler, Gradle builds, annotation processors or an LLM, and it needs no
Kotlin or Java SDK. Broken or unsupported files stay in `files` and
`parse_errors` and contribute no dependencies or function metrics.

## What is parsed

Packages, imports (aliases and wildcards), classes, interfaces, objects,
companion objects, enum and annotation classes, typealiases, primary and
secondary constructors, init blocks, member and top-level functions and
properties, extension functions and properties, generic type parameters and
bounds, supertypes, expression bodies, string templates, raw strings and
nested block comments. Local declarations inside bodies are indexed so their
evidence is attributed under `<locals>` and never double-counted.

## Dependencies

Declarations, rather than directory layout, map canonical type names to
files. Resolution order for a type reference is lexical: type parameters and
local classifiers shadow and never denote analyzed types; nested classifiers
of enclosing classifiers are in scope (Kotlin never inherits nested
classifiers, so no supertype analysis is needed); explicit imports bind their
alias or last segment; same-package classifiers follow. Constructor
invocations are type references, not calls. Wildcard imports cannot be
expanded without a classpath: names they might supply stay external or
unknown rather than guessed. Member imports (`import pkg.Type.member` or a
top-level member) resolve through the owner type or the single file declaring
that member.

## Build scope

Gradle builds are executable Kotlin/Groovy DSL and are never evaluated. Only
conventional source-set visibility is modeled: `src/main/kotlin` and
`src/test/kotlin` form main and test source sets; main cannot bind
declarations found only in test, test can still see main. Build modules are
bounded by `build.gradle(.kts)`, `settings.gradle(.kts)` or `pom.xml` markers.
Dependencies, plugin-generated sources and build classpaths are honestly
unmodeled in v1, exactly the Java adapter's treatment of Gradle. Mixed
Kotlin/Java projects are analyzed one language at a time; cross-language
references resolve only inside the selected language.

## Complexity

Functions, constructors, init blocks, accessors and lambda-bearing property
initializers are measured on the same scale as the other adapters: base 1,
then `if`, loops, `catch`, `when` branch arrows (the `else` fallback does not
add a path), Elvis `?:` and `&&`/`||`. Records carry Kotlin PSI-flavored
definition kinds (`KtNamedFunction`, `KtSecondaryConstructor`,
`KtClassInitializer`, `KtProperty`) and exact source ranges with digests.

## Calls

`kotlin-static-lexical-v1` inventories lowercase/simple invocation sites in
measured bodies. A call binds as `kotlin-scope-function` only when all hold:
unqualified callee; the caller is top-level or inside exactly one ordinary
class/object without supertypes; exactly one same-scope captured function
declaration matches the simple name and the exact fixed arity; no candidate
has default values or `vararg`; no explicit import binds the same name; the
name is neither shadowed nor a classifier. Fixed-arity overload resolution is
exact in Kotlin when no defaults or varargs apply, so same-name different-arity
candidates can bind. Receiver-qualified, chained, generic and dynamic calls
stay unresolved with explicit reasons. This is a source candidate, never proof
of compilation, applicability or runtime dispatch.

## Limitations

The parser is tolerant, not compiler-backed. Type inference, delegated
properties' resolution semantics, operator conventions, `invoke` convention
calls, implicit `it` lambdas, receiver types of extensions and standard-library
default imports are outside the binding model. References inside scopes with
local classifiers are marked uncertain and never guessed.
