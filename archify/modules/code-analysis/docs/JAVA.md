# Java source analysis

From the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis check /path/to/java-repo --language java --out out/java
```

The diagram workflow accepts the same `--language java`. A run analyzes one
language. When the scan also finds JS/TS or Python sources, Java is left out
automatically unless the root holds `pom.xml`, `build.gradle(.kts)` or
`settings.gradle(.kts)`; such a Java project, like any root matching both
JS/TS and Python, requires an explicit choice. A root without one (for example
`backend/pom.xml` beside `frontend/package.json`) is analyzed as JS/TS or
Python. The run reports omitted other-language files. `build/` directories and
Java sources under
`target/` are excluded by default; JS/TS and Python files under `target/` are
still analyzed as before. `src/test/` files are extracted as tests and excluded
from the dependency graph by the existing role policy.

Upgrade note: a JS/TS or Python tree that also holds `.java` files (for
example a React Native `android/` folder) and has no root Maven/Gradle build
file is still analyzed in its earlier language without `--language`; its
coverage now lists the Java files it left out. The default configuration
changed, so the first comparison after upgrading reports `config-changed` and
is not directly comparable.

The adapter reads captured UTF-8 source, accepts a UTF-8 BOM, and retains the
decoded text and source locations. Broken or unsupported files remain in
`files` and `parse_errors` and contribute no dependencies or function metrics.
The adapter does not run Java code, Maven/Gradle builds, annotation processors
or an LLM, and does not require a JDK.

## Dependencies

Declarations, rather than directory layout, map canonical type names to files.
A dependency is recorded only when the analyzed source index identifies one
unambiguous declaration in one file. Dependencies within a file do not produce
file edges.

Recorded reference forms:

- Import declarations: single-type imports, and static imports whose owner
  declares the member. Static members are static fields and methods, enum
  constants, interface constants, and member types that are explicitly static
  or implicitly static (member enums, records and interfaces, and every member
  type of an interface).
- Type positions: field, parameter, local, return and type-argument types,
  `extends`/`implements`/`permits`, `throws`, `catch`, casts, `instanceof`,
  array types and annotations.
- Instance creation `new T(…)` (including the type of an anonymous class),
  constructor references `T::new` and `T[]::new`, and class literals `T.class`.

Resolution follows lexical type scope, declarations in the file, single-type
imports and same-package types. Fully qualified names use the source index; a
qualified name never starts at a subpackage of the current package, and one
whose first segment names a type an on-demand import declares stays
unresolved (inherited members of on-demand imported types are not checked).
The guards below leave uncertain bindings unresolved.

Remaining unresolved, by design:

- Duplicate declarations (for example main and test source sets), and member
  types whose enclosing type is declared more than once, on every lookup path
  including static imports.
- Conflicting imports, type-parameter shadowing, names shadowed by a local
  type anywhere in the file, and simple names introduced by a single static
  import (the import itself is still recorded). Types declared in any block (methods, interface
  methods, constructors, initializers, lambdas, switch-rule blocks) are local
  and are not indexed.
- References inside the body of a type whose supertypes do not all resolve,
  transitively, to one analyzed declaration or a listed JDK type each
  (external, duplicate or cyclic supertypes), since an inherited member type
  could bind the name. This includes same-package references, which need no
  import: in a typical Spring or JPA model whose base class extends a
  framework type, `Owner`'s use of `Pet` in the same package is not recorded.
  A missing edge there is not evidence of absent coupling.
  When every supertype is analyzed, a name matching an inherited member type
  stays unresolved and counts as `unknown`, even over an external import of
  the same name; so does a member type declared by an analyzed ancestor when
  another ancestor is external. Enum bodies leave `EnumDesc` (a member type of
  `java.lang.Enum`) unresolved. A type's own members are not in scope in its
  extends/implements clauses, so declaration headers are outside this body
  guard; a record's component list does see its members. The other scope
  guards still apply.

  The listed JDK types are `Comparable`, `Cloneable`, `AutoCloseable`,
  `Iterable`, `Runnable`, `Throwable`, `Exception`, `RuntimeException`,
  `Error`, `IllegalArgumentException`, `IllegalStateException` and
  `UnsupportedOperationException` in `java.lang`; `Serializable`,
  `Closeable` and `IOException` in `java.io`; `Iterator`, `Collection`,
  `List`, `Set`, `Map` and `EventListener` in `java.util`; and
  `java.util.concurrent.Callable`. Of these only `Map` contributes a member
  type (`Entry`), which stays unresolved in such bodies. The list was generated
  from JDK 17 and these types have had the same member types since Java 8. A
  supertype counts as one of them only when it is named by a single-type
  import (`import java.io.Serializable;`), which outranks same-package and
  on-demand types, or fully qualified (`java.io.Serializable`), and no member
  type in scope or type parameter binds the name first. An implicit
  `java.lang` name (`extends RuntimeException`) or one reached through an
  on-demand import keeps the guard: a same-package source that is not
  analyzed, such as an excluded generated file or one with a parse error,
  could declare a type of that name.
- References inside local and anonymous class bodies, whose member and
  inherited scopes are not modeled. Their methods still receive complexity
  metrics.
- On-demand (`*`) imports, which are never expanded to every file in a
  package, and names that need wildcard or classpath lookup.
- Qualified creation `outer.new Inner()` (relative to the outer instance's
  type), other method references `X::m`, and static calls or field accesses
  such as `X.m()` and `X.F`, whose qualifier may be an expression.
- Reflective loading such as `Class.forName("…")` or `ServiceLoader`, which is
  not modeled and therefore not counted as `opaque`.

This is a conservative source dependency graph, not complete Java type or
method-call resolution.

The unresolved counters keep the shared meaning described in the
[technical guide](TECH-GUIDE.md#5-the-four-kinds-of-unresolved-why-they-are-counted-separately):
`external` is outside the analyzed sources and `unknown` is an internal
resolution gap. Every import declaration is recorded; an unresolved one is
`external` when no analyzed file declares its package (JDK, third party) and
`unknown` otherwise (for example build-generated types in a project package).
A type reference is recorded only while it may denote an analyzed type: it
matches an analyzed type name or lies in an analyzed package. Type parameters,
local type names, names bound to an external import (represented by that
import) and names no analyzed file declares (`String`, `Override`) produce no
record, as uses of external modules produce none in the JS/TS adapter. An
unresolved recorded reference counts as `unknown`; for Java this mostly
measures the conservative rules above. `imports[].kind = "static"` means a statically recorded dependency
in the shared contract; it does not specifically mean Java's `import static`
keyword. Edge weights count dependency records, including recorded imports
and type references, rather than import declarations alone.

File cycles and module cycles are informational structural findings. Their
messages, task exports and UI do not infer Python-style partial initialization
or claim a Java runtime failure.

Java has no package marker files, so its default modules are build units:
each directory holding `pom.xml`, `build.gradle` or `build.gradle.kts` owns
the sources below it, at any depth (`grouping.java: "build-modules"`); files
outside every build module keep directory-depth grouping. A tree where at most
one build module owns analyzed (non-test, non-generated) sources would be one
module with nothing to compare, so it is split by package
(`grouping.java: "packages"`): within each conventional source root
`src/<set>/java`, at the first directory below the one shared by that root's
files, typically the first package level below `src/main/java/<common prefix>`.
Files directly in a source root, such as `module-info.java`, form that root's
own module. Other files keep directory depth; a tree without such roots splits
below the directory all its files share.

Explicit `modules.groups` still win, and the files they claim do not shape the
split. Setting `modules.depth` or `modules.packageBoundaries: false` restores
directory-depth grouping. JPMS modules are not read.

This grouping is inferred from build-file locations and source directories;
Maven and Gradle models (declared modules, source sets, dependencies) are not
evaluated. Adding a second build module, moving sources or changing a shared
directory prefix can change the modules, and with them module edges, module
cycles and hubs, without any dependency change. Compare module-level findings
across runs only under the same grouping: for longitudinal comparison, pin
the modules with `modules.groups`, for example
`{ "modules": { "groups": { "core": ["core/src/main/java/**"], "web": ["web/src/main/java/**"] } } }`.
A module cycle that disappears after a grouping change has not been fixed.

## Complexity

Methods, interface methods with bodies, constructors and record compact
constructors emit the existing `functions` contract. Abstract/native methods
without bodies are skipped. Qualified names follow the shared `Class.method`
and `outer.<locals>.inner` form, with parameter types added, such as
`Service.save(String,int...)`: Java overloads each have a body, and a source-order
`#2` suffix would rename later overloads whenever one is added above them.
Local and anonymous class methods, including enum constant bodies, are measured
separately. Lambdas contribute to their containing method. Code outside any
method is measured on its own, as module-level callbacks are in the JS/TS
adapter: static and instance initializer blocks as `Class.<static initializer>`
and `Class.<instance initializer>` (`#2` for further blocks of the same kind),
and a field whose initializer contains a lambda under the field's name, such as
`Registry.COMPARATOR`. Other field initializers are not measured.

Complexity starts at 1, then adds 1 for each `if`, loop, `catch`, conditional
expression, non-default switch label, pattern guard, `&&` and `||`. A label
containing several case constants counts once. Nesting counts if/loop/switch/
try/synchronized blocks; `else if` stays at the preceding if's depth, and
catch/finally blocks stay at their try's depth. Comments and strings do not add
branches. Existing thresholds and source-evidence views are reused.

## Parser choice and boundaries

The implementation pins `java-parser@3.0.1`, a synchronous JavaScript parser
producing a CST with token offsets and line/column locations.

Syntax probes cover Java 8-style generics/lambdas, records and compact
constructors, sealed types, text blocks, module descriptors and Java 21 switch
patterns/guards. These probes do not establish complete coverage of every Java
release or preview feature. Unsupported syntax is reported as a parse error.

One known misparse is corrected: `java-parser@3.0.1`
reads a member record whose body is also a valid block, such as
`record Value(int x) {}` or `record Value(int x) { static class Part {} }`, as
a method returning type `record`. No such method compiles, so the adapter
rewrites these nodes into record declarations and restores the nested types
as member types.

Java Unicode escapes are expanded before lexing, including inside comments.
This parser does not implement that preprocessing. Files containing a
`\uXXXX`-style sequence are therefore reported as unsupported, including
sequences inside strings and those preceded by another backslash, rather than
risking silently missing code. Other source
encodings, build-aware symbol resolution, generated/Lombok symbols, Spring
injection, inheritance/call graphs and class initialization analysis are outside
this adapter's scope.

Small hand-counted fixtures protect dependency and complexity correctness. Real
repository checks should fix a source revision, start with a submodule, then
expand to the full tree. Report parse failures and unresolved coverage alongside
runtime and memory; completion alone does not establish complete dependency
coverage.
