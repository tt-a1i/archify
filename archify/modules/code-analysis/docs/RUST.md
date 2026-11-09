# Rust source investigation

Select the experimental Rust adapter through the normal CLI:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/workspace --language rust --fail-on never --out /tmp/rust-analysis --json
node archify/bin/archify.mjs code-analysis task /tmp/rust-analysis --root /path/to/workspace --entry src/lib.rs --function caller --question 'Where is this function defined?' --format json --out /tmp/rust-question.json --json
node archify/bin/archify.mjs code-analysis task --root /path/to/after --base-root /path/to/before --entry src/lib.rs --question 'Which captured direct references reach changed definitions?' --format json --out /tmp/rust-change.json --json
```

This is source orientation. Exact function ranges, immutable captured text and hashes, definition jumps and captured direct references reuse the shared investigation output. They do not establish compilation, runtime reachability or complete change impact. Saved questions require matching Rust facts; paired questions capture both versions afresh. Configuration/metadata differences can make a paired result partial (exit 1) even when individual known references navigate correctly.

## Tooling and cost

Cargo/rustc 1.71+ are required; only 1.89.0 has been exercised locally. ARCHIFY_CARGO and ARCHIFY_RUSTC select installed executables. A missing tool returns structured extract/rust-unavailable with installation guidance, exit 2. The ZIP bundles source and a locked helper, not a platform binary. Its first use compiles Archify's helper and may download its locked MIT/Apache parser dependencies (syn 2.0.119, proc-macro2 1.0.107, quote 1.0.47, serde_json 1.0.154). No rust-analyzer is needed. Set rust.offline=true only after these dependencies are cached. Toolchain installation is separate; no missing-tool installation happens automatically.

Project manifests and empty source-inventory stubs are captured into a temporary directory for cargo metadata --offline --locked --no-deps. Project source, .cargo config, rust-toolchain files, build scripts and macros are never executed. The syn helper parses the captured source bytes and uses a temporary compiler cache outside the installation. No project dependency source is downloaded or inspected. Absolute/path dependencies outside the captured root are unknown; manifest configurations which require them may fail with extract/rust-metadata-failed instead of inventing a workspace.

## Scope and settings

```json
{"rust":{"tests":false,"defaultFeatures":true,"features":{"my-package":["chosen-feature"]},"cfg":["custom_known_flag"],"target":"aarch64-apple-darwin","offline":true}}
```

Pass this JSON via --config. Defaults analyze local workspace lib/bin targets, package default features and local path dependency feature forwarding. This is a declared source profile, not Cargo's complete resolve/build graph or target-specific dependency activation. Test targets and cfg(test) are excluded unless tests=true; examples, benches, proc-macro crates and build scripts remain excluded. The host is used unless target is specified; target cfg is queried from rustc without a project build. Unknown custom/build-script cfg and opaque attributes retain uncertainty rather than choosing a branch.

The coverage.languageScope and raw-facts languageScope report actual selected files/crates, excluded files/targets/regions, missing modules, parse failures, conditional definitions, opaque macros, tool versions, cfg and captured Cargo metadata. A successful --fail-on never check exits 0 regardless of finding gates; inspect coverage and parse_errors independently. Parse failures remain visible, and do not count as complete coverage.

## Targets and boundaries

Crate-local crate/self/super paths, explicit paths, module use/use-as, grouped imports, unambiguous globs and local workspace library paths can identify free functions. Actual Cargo library names and renamed dependencies define the boundary. Module lookup observes editions, module file/path attributes, lexical shadowing and conditional imports. Unsupported or ambiguous paths stay unresolved. Cross-crate source bindings do not prove visibility or type correctness.

The original v1 model leaves methods, trait dispatch, function values, associated functions, local item functions as targets, generated/expanded macros, external crates, and full type inference unknown. Later bounded inherent-function revisions are described below. v5 additionally records local trait declarations and impl edges, but trait-only call targets remain declaration anchors rather than runtime dispatch. v6 additionally inventories trait default method bodies once per source declaration. v7 replaces the unevidenced one-parameter wrapper accessor assumption with captured inherent return types and AsRef/Borrow/Deref implementation targets, and substitutes generic struct fields by declaration position. v8 resolves accessor traits from their captured local declaration (including aliases and defaulted generic parameters), reads impl where-clause bounds, applies default type parameters to field receivers, follows standard Box/Arc/Rc accessor payloads, and binds tuple-variant match payloads. v9 traverses the argument expression of a local `macro_rules!` invocation when that macro is defined exactly once across the selected crates, is textually visible at the callsite without an import or glob that could bind the same name, every rule matches a single `$x:expr`, and every expansion uses `$x` exactly once outside repetition and nested macro arguments; the resulting call records carry `macroEvidence`. v10 resolves the macro binding actually visible at the callsite, including a preceding block-local definition that shadows the module binding and the outer binding restored after that block, and requires every active expansion path to keep the argument use under the selected cfg; a use removed by cfg, nested in another macro or not provable in the active profile stays unknown. v11 binds `self` in a trait default body to the enclosing trait declaration when the called method exists there, and expands one zero-argument local macro used as the whole body of an impl so generated forwarding methods are inventoried with the impl self type and generics; calls through `*self`/`**self` keep the captured trait bound, generated callers are labeled `macro-generated-method`, and the concrete runtime implementation remains undetermined. Syntactic function/method bodies and default bodies form the call inventory; all other macros have opaque records. Type/field definitions are not navigable entities yet. Structural cycles report source coupling; they do not imply runtime import order or partial initialization.

See the pinned real-project replay and source/ZIP evidence in benchmarks/code-analysis-go-rust/RUST.md. These finite cases are not whole-repository accuracy measurements.

## Current call model and trait impl candidates

Current captures use rust-source-direct-v13 / adapter13. Historical v1 collects
free functions; v2 additionally admits unique monomorphic inherent function
paths; v3 additionally admits bare generic-struct paths to unique concrete type
specializations. Historical facts keep their original scope without rebinding.

v4 adds receiver-free inherent source candidates on structs/enums whose generic
parameters are only unbounded lifetimes. Impl parameters must be unbounded, have
no where clause, and map one-to-one to named lifetime arguments of the owner.
Bare nominal/module/import-alias paths reuse existing crate identity and source
locations. Duplicate/conditional/unsupported sibling declarations block selection;
variant names still prevent selecting a same-named inherent function. New calls
use rust-lifetime-inherent-source-candidate.

v5 records captured local trait declarations, their methods, and impl-method
edges. An explicit `<Type as Trait>::method(...)` path resolves to the unique
captured impl for that nominal type and trait (`rust-trait-impl`). Method calls
resolve to a unique impl when the receiver is a parameter, local `let`, literal
struct path or constructor path whose captured nominal type is unambiguous; an
inherent declaration with the same name blocks that selection. Calls through a
declared `T: Trait` bound, `dyn Trait`, `Trait::method` or generic path target
the trait method declaration only (`rust-trait-method-candidate`); they prove
trait use, not the runtime implementation. Change questions list these as
`traitCandidates` with `runtimeTarget: not-determined`, separately from direct
references. When the selected definition is a trait method's default body, its
trait-dispatch callsites in the declaring file are listed under direct
references: the body is registered at its `fn` keyword while calls target the
method name, so both source anchors are consulted for the same declaration.
Module paths are crate-local, so a same-named trait in another workspace member
is excluded rather than merged by qualname.

v11 binds a bare `self` method call in a trait default body to the method on
the enclosing trait declaration (`rust-trait-method-candidate`). A method that
the trait does not declare stays unresolved; a call on a concrete type that
overrides the method still resolves to that override, not to the default body.
It also expands a zero-argument local `macro_rules!` when the invocation is the
entire body of an impl. Generated methods inherit the impl self type, generic
bounds and where-clause, and calls through `*self`/`**self` keep the receiver's
captured trait bound, including `&mut T` and `Box<T>`. These calls are
candidates anchored at the trait declaration, their direct caller is reported
as `macro-generated-method`, and one physical source position represents all
invocations. A non-empty matcher, an imported or ambiguous definition, an
invocation mixed with other impl items, or a deref of a non-`self` generic
receiver stays unknown.

v12 propagates the macro invocation's attributes into generated method state,
combined with the outer impl, generated method and body cfg, including nested
`cfg_attr`. Removed methods/calls are omitted, while unknown conditions cannot
establish a target or accessor return type; unknown accessors remain ambiguity
blockers rather than disappearing from the candidate set. Unknown generated
trait implementations likewise block uniqueness for method and qualified calls.
Each physical template call is still inventoried once, with `macroTemplate`
provenance retained across its contributing expansions:

```json
{
  "definition": {"file": "src/lib.rs", "name": "forward", "line": 3, "column": 14},
  "expansions": [
    {"file": "src/lib.rs", "line": 12, "column": 5, "implLine": 11, "implColumn": 1, "selfType": "& T", "trait": "Gate"}
  ]
}
```

`definition` points at the macro name. Each expansion's `file`/`line`/`column`
points at the invocation path; `implLine`/`implColumn` points at the outer `impl`
token in that file. Coordinates are one-based UTF-16 source points. `selfType`
is the printable original impl self type, including references and generic
arguments; optional `trait` is the printable trait path (absent for inherent
impls). There is at least one expansion, deduplicated by source origin.

`directCaller.kind` remains `macro-generated-method`, but its qualname now
identifies the template, such as `mod::forward!::method`, not a unique impl.
A nested named function remains `local-function` with a template-qualified
parent. If the same file is loaded under different module identities and callers
disagree, `directCaller` is omitted without discarding an agreed target; the macro
and physical expansion anchors remain. If expansions disagree on the target, the top-level call is
`unresolved` with reason `rust-context-dependent` and no `target`; the same
`macroTemplate` provenance remains available. No per-expansion targets or
runtime implementation identities are supplied. Saved question records retain
this object unchanged; target navigation also checks captured definition and
expansion-file freshness. Historical v11 captures remain accepted under their
original contract and are not retroactively assigned v12 provenance.

v13 binds closure input types from a captured local free-function signature:
a bare `fn(...)` parameter, an `impl Fn/FnMut/FnOnce(...)` parameter, or a
generic parameter with exactly one such bound. Call-argument shapes substitute
the callee's generics (for example `&BiLock<T>` against `&BiLock<R>`); the
closure inputs then receive the declared reference-stripped types. Every call
inside a closure carries an innermost `closure` anchor at the opening `|` while
`directCaller` remains the enclosing named function or method. Unbound or
conflicting callee generics, competing callable bounds, arity mismatches and
method-callee helpers bind nothing, so unresolved closure calls keep no target.
A destructured closure input does not give its sub-bindings the aggregate type.
Closures passed through method calls, iterator adapters or external APIs remain
outside this bounded rule.

v6 inventories a trait method's default body once per source declaration, not
once per implementing type. A declaration without a body adds no call. Calls in
the body carry `defaultMethod` context (file, name, qualname, line, column and
trait) and use the existing receiver typing: a local value with a captured
nominal type can resolve to a unique trait impl, while calls that depend on the
concrete `Self` or unresolved types remain unresolved. Multiple
implementations of the trait do not duplicate the body's calls.

Method receivers also resolve through `self.<field>` when the owning impl's
self type and the struct field declaration are captured. A generic field is
substituted by its position in the struct declaration, so
`impl<A: Right, B: Left> Pair<B, A>` maps `first: X` to `B` and
`second: Y` to `A`; an impl for a different instantiation
(`impl<T: Gate> Holder<u8>`) stays unresolved, and a field declared with a
unique nominal type selects its unique impl.

`self.as_ref()`, `self.deref()` and `self.borrow()` unwrap only with captured
source evidence: an inherent method on the receiver's type whose return type is
captured, or a captured `AsRef`/`Borrow`/`Deref` implementation target. An
inherent accessor shadows the wrapping trait, and a wrapper without such
evidence stays unresolved instead of being assumed to expose its generic
parameter. Renamed generics between impl and struct (for example
`impl<S> Subscriber for Layered<L, S>` where the field is declared `inner: I`),
pattern bindings, loop variables, macro-produced receivers outside the
zero-argument impl-body pattern and other accessor chains remain unresolved.

Unsupported applicability remains explicit: external or macro-generated traits,
supertrait/blanket impls, type aliases/Self, generic argument substitution,
receiver types from renamed generic fields, pattern bindings, loop variables,
nested chains or reassigned locals, and calls that require the concrete `Self`
inside a default body. Concrete types implementing several traits
with the same method stay unresolved rather than selecting one. Repeated
trait-method qualnames (same type, same method name in different traits) remain
duplicate slots in paired questions, while their head-only traitCandidates stay
inspectable. Source navigation does not infer lifetimes, borrow-check, compile,
execute or establish complete impact. Native function sourceRange starts at
pub/fn, while definition.sourceRange also includes owned attributes/doc comments;
target locations use the former. Saved and paired questions retain existing
freshness and source-profile checks. Normal toolchain requirements are unchanged.
