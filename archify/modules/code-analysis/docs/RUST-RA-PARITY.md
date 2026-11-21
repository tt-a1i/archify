# Rust call evidence against pinned rust-analyzer tests

This ledger compares the Rust outputs Archify already provides with
[rust-analyzer at `e5e7830640558e323e89c831488a3172b58dc66d`](https://github.com/rust-lang/rust-analyzer/tree/e5e7830640558e323e89c831488a3172b58dc66d).
The reference is the upstream fixture, expected destination or inferred type,
and the implementation that establishes it. The comparison normalizes each
case to its captured call target (file, name, definition line) and, for call
hierarchy cases, the direct caller. Archify additionally checks whether a
saved target can still navigate against captured source and current file
freshness. LSP cursor ranges and UI grouping are different output contracts.

Run the ported cases with:

```sh
node --test --test-name-pattern='Rust rust-analyzer' archify/modules/code-analysis/test/rust-calls.test.mjs
```

The fixtures below live in `test/rust-calls.test.mjs`. `$0` cursors and
underline comments are removed; otherwise the relevant source forms and
expected targets follow the pinned tests. A test name in this table is a
specific upstream test identity, not an estimate of overall Rust accuracy.
The directly ported fixtures cover 24 upstream test identities in 21 fixtures.
Five additional tests use reduced failure controls derived from the upstream
semantics; they are listed separately and are not five more passing LSP cases.
One adapted closure fixture checks its supported free-function subset and
retains the unsupported method-callback cases as explicit unknowns.

## Coverage of the existing Rust adapter

The initial 19-identity ledger sampled IDE definition, hierarchy and reference
tests. It did not establish the typing and resolution premises used by all the
existing adapter features. This table traces those features into the pinned
HIR tests as well. An upstream test used as a semantic reference is not claimed
as an executable port unless it appears in the fixture tables below.

| Existing Archify behavior | Pinned upstream tests to study | Local protection / remaining difference |
| --- | --- | --- |
| Free functions, module paths, aliases, edition namespaces and captured workspace crates | [nameres tests]: `use_as`, `edition_2015_imports`, `extern_crate_rename`, `values_dont_shadow_extern_crates`; [method tests]: `cross_crate_associated_method_call` | Existing crate-path, edition, dependency-alias and custom-library tests exercise captured Cargo identities. External dependencies remain uncaptured. |
| Cargo test/cfg/path selection | [nameres tests]: `cfg_test`, `cfg_not_test`; [module tests]: `cfg_in_module_file` | Existing cfg-profile, cfg_attr/path and unknown-generated-cfg tests, plus the trait-method cfg control. A method with unknown cfg cannot establish a target or accessor return. These are conservative controls rather than equality to a fully loaded Cargo project. |
| Monomorphic, concrete-specialization and lifetime-only inherent paths | [method tests]: `infer_associated_method_struct`, `infer_associated_method_with_modules`, `infer_associated_method_generics_without_args` | Existing inherent/specialization/lifetime tests check targets, competing impls and unsupported siblings. Archify does not reproduce general argument-based type inference. |
| Return values and subsequent method receivers | [method tests]: `infer_associated_method_with_modules`; [trait tests]: `infer_async`, `infer_desugar_async` | Return-type/module tests plus the async control below. A written async output is not the type of the call expression. |
| Unit values, local imports, glob imports and shadows | [glob tests]: `glob_shadowed_def`, `glob_shadowed_def_reversed`; [block tests]: `use_from_crate`, `nested_blocks`; [simple tests]: `should_be_shadowing_imports` | Local-import and block-glob controls, plus closure shadow/reassignment tests. Receiver lookup now reuses lexical path resolution instead of module spelling. |
| Concrete trait impls, generic/dyn trait anchors and inherent priority | [definition tests]: `goto_impl_of_trait_fn`; [method tests]: `infer_call_trait_method_on_generic_param_2`, `method_resolution_impl_before_trait`, `method_resolution_impl_ref_before_trait`, `method_resolution_trait_autoderef`, `dyn_trait_method_priority` | Ported targets plus existing trait-impl and competing-owner controls. Multiple owners remain unresolved even where full RA trait-scope/applicability analysis could choose one. |
| Default trait bodies, `self`, and direct callers | [trait tests]: `trait_default_method_self_bound_implements_trait`; [definition tests]: `goto_impl_of_trait_fn::method_call_defaulted` | Ported trait anchors plus existing default-body, override, local-function caller and changed-default-reference tests. Concrete runtime dispatch is not inferred. |
| Explicit field receivers, generic positions, where bounds and default type parameters | [trait tests]: `tuple_struct_fields`, `infer_default_trait_type_parameter`; [method tests]: `method_resolution_where_clause_1` | Existing field-position, swapped-generic, where-clause and defaulted-field tests. This validates bounded declared identities, not general impl applicability. |
| Captured `as_ref`/`borrow`/`deref` and smart-pointer payloads | [trait tests]: `deref_trait`, `infer_borrow`; [method tests]: `method_resolution_impl_before_trait` | Existing wrapping-implementation, alias, same-name accessor, inherent-priority and smart-pointer tests. General autoderef and blanket-impl inference remain outside the adapter. Async accessor outputs now stay unknown. |
| Contextual closure inputs from a captured local fn/Fn-family signature | [trait tests]: `closure_as_argument_inference_order`, `infer_fn_trait_arg`; [pattern tests]: `match_ergonomics_in_closure_params` | Existing fn/FnOnce, module-identity, generic-substitution and destructured-closure tests. Method/external callbacks stay unsupported. |
| Pattern bindings | [pattern tests]: `infer_adt_pattern` | The new let/parameter control rejects copying an aggregate's type onto a field binding. Archify still does not infer general destructured fields. |
| Preserving expression macros, textual scope and impl-body templates | [macro tests]: `plain_macros_are_legacy_textual_scoped`, `legacy_macro_use_before_def`; [hierarchy tests]: `test_call_hierarchy_in_macros_incoming` | Existing macro-scope/cfg/provenance/ambiguity tests cover Archify's two bounded expansion forms. The full upstream generated-function/identifier-matcher fixture is not a passing port. |
| Direct call edges, incoming references and changed definitions | [hierarchy tests] and [reference tests] below | Ported physical call edges and changed direct reference. General non-call references and the LSP hierarchy's trait/implementation grouping have different contracts. |
| Exact source navigation across crate contexts | [definition implementation], `goto_definition`; [hierarchy implementation], `CallLocations` | Exact-name/digest, stale-file, v14 and duplicate-trait-anchor controls. UTF-16 ranges, saved hashes and current-file freshness are Archify-specific evidence contracts. |

## What changed after reading the implementation

RA's [call hierarchy implementation][hierarchy implementation] gets a call's
callable/type or resolved method through `Semantics`; it does not infer a
receiver from the spelling of a constructor path. The adapter now keeps the
declared callee/module rule bounded to synchronous monomorphic returns.
`infer_desugar_async` distinguishes `impl Future<Output = T>` from `T`, so an
async free function, associated function or accessor cannot supply `T` as its
unawaited receiver type.

RA's [pattern inference] recursively checks each field using that field's
instantiated type. Archify reuses `whole_binding_names` for both hints and
shapes in let/parameter patterns: destructured names stay untyped rather than
receiving the aggregate type. A new shadow also clears an old local hint.

RA's [resolver] walks expression and block scopes before module scope.
Archify's hint and shape lookup now share the nearest-local-scope rule, and
unit-value shapes use the existing use/glob-aware path resolver. An inner
import cannot fall through to an outer same-name type; unrelated globs do not
erase an established local type.

RA's [definition implementation] uniquifies navigation targets. Multiple
captured trait records at one physical method anchor now navigate when every
record validates the same exact name span; a forged copy still rejects the
navigation. This handles one source file shared by a lib and binary without
changing their distinct crate contexts.

RA's name-resolution cfg tests select declarations before using them as name
evidence. The adapter now also retains each trait method's cfg state internally.
An unknown method remains an ambiguity blocker but cannot become a target or
provide an accessor return type. `Rust rust-analyzer cfg boundary` checks both
the unknown and explicitly selected profiles; it failed before this guard.

Before these corrections, four reduced controls failed on `b20a9355`: async
receivers, let/parameter field patterns, block glob receiver identity, and
duplicate trait anchors. The first three had compiler-accepted counterexamples;
`rustc --emit=mir` selected `FutureExt::run`, `C::run`, and `other::S::run`
where Archify reported `B::run` or the outer trait method. These are synthetic
reproductions, not production-incident claims. The checked-in controls are
named `Rust rust-analyzer async return boundary`, `pattern boundary`,
`block glob lookup` and `navigation deduplicates`.

The upstream repository is used read-only at the pinned revision. The tests
here execute Archify against independently recorded upstream expectations;
they do not execute the upstream Rust test harness or a runtime LSP server.

## Definition targets

Source: [pinned `goto_definition.rs`](https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/goto_definition.rs).

| Upstream test | Archify check |
| --- | --- |
| `goto_def_for_methods` | `foo.frobnicate()` → `Foo` inherent method body |
| `goto_def_for_ufcs_inherent_methods` | `Foo::frobnicate()` → `Foo` inherent method body |
| `goto_def_for_ufcs_trait_methods_through_traits` | `Foo::frobnicate()` → trait method declaration without a body; navigation valid |
| `goto_def_for_ufcs_trait_methods_through_self` | `Foo::frobnicate()` through one captured trait impl → trait declaration; navigation valid |
| `goto_impl_of_trait_fn::method_call` | `s.a()` → captured trait implementation body |
| `goto_impl_of_trait_fn::path_call` | `Stwuct::a(&s)` → captured trait implementation body |
| `goto_impl_of_trait_fn::method_call_defaulted` | `s.a()` → trait default method declaration |
| `goto_impl_of_trait_fn::method_call_on_generic` | `T: Twait`, `s.a()` → trait declaration only |

The following source fixtures come from [method tests] and [trait tests].
Upstream asserts the inferred result type; the unique declaration that supplies
that type is normalized to Archify's method target and checked for navigation.

| Upstream test | Archify check |
| --- | --- |
| `method_resolution_impl_before_trait` | `S.foo()` → inherent `i8` method, ahead of the `u128` trait impl |
| `method_resolution_impl_ref_before_trait` | `S.foo()` → inherent `&self` method, ahead of the competing reference trait impl |
| `method_resolution_trait_autoderef` | `(&S).foo()` → captured trait impl |
| `infer_call_trait_method_on_generic_param_2` | `T: Trait<U>`, `t.method()` → trait declaration without choosing a concrete `U` |
| `trait_default_method_self_bound_implements_trait` | `self.foo()` inside the trait default body → the trait's own declaration |

`closure_as_argument_inference_order` in [trait tests] has an adapted fixture
named `Rust rust-analyzer closure argument order`. A body is added to the
otherwise bodyless inherent `S::method`. Both free-function argument orders
resolve `s.method()` to that method; the method-callback half remains unresolved
under Archify's existing callback boundary. That half does not match RA's full
inference and is not counted as passing equality.

## Captured call edges

Source: [pinned `call_hierarchy.rs`](https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/call_hierarchy.rs).
Tests with the same source and call edges share one Archify fixture; their
upstream identities remain listed separately.

| Upstream test | Archify check |
| --- | --- |
| `test_call_hierarchy_on_ref` | `caller` → `callee` |
| `test_call_hierarchy_on_def` | `caller` → `callee` |
| `test_call_hierarchy_in_same_fn` | Two `caller` → `callee` callsites |
| `test_call_hierarchy_in_different_fn` | `caller1` and `caller2` each → `callee` |
| `test_call_hierarchy_in_tests_mod` | With `rust.tests=true`, ordinary and `#[test]` callers → `callee` |
| `test_call_hierarchy_in_different_files` | Imported call → definition in `foo/mod.rs` |
| `test_call_hierarchy_outgoing` | Two outgoing `caller` → `callee` callsites |
| `test_call_hierarchy_outgoing_in_different_files` | Outgoing call → definition in `foo/mod.rs` |
| `test_call_hierarchy_incoming_outgoing` | `caller1` → `caller2` → `caller3` |
| `test_call_hierarchy_issue_5103` | `main` → `a` → `b`; selecting either middle function retains the correct edges |

## Captured direct references

Source: [pinned `references.rs`](https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/references.rs).

| Upstream test | Archify check |
| --- | --- |
| `test_find_struct_function_refs_outside_module` | `foo::Foo::new()` in `main` reaches the captured method; a changed `new` lists that call as a valid known reference |

## Scope boundaries

The pinned files also exercise fields, types, aliases, operators, macro
definitions, `include!`, cursor-position selection, and UI filters. Archify's
Rust facts do not output those LSP features, so these tests have no matching
output to compare. Current Archify calls also leave nested block-local impls,
generic/argument-dependent trait overload selection, general macro expansion,
and semantically invalid impl recovery unresolved. Examples are
`goto_impl_of_trait_fn::method_call_inside_block`,
`goto_impl_of_trait_fn::where_clause_can_work`,
`path_call_multiple_trait_impl`, `query_impls_in_nearest_block`, and the
macro call-hierarchy cases. These are recorded boundaries, not passing parity
cases. The remaining `references.rs` cases search variables, types, imports
and other non-call references. Archify's change question reports only captured
direct call evidence to changed definitions.

The local regressions next to the ported tests additionally reject a wrong
constructor-looking return type, block-local unit struct shadowing, generic
specialization leakage, competing trait owners (including unknown cfg), forged
trait method digests, stale target files, and v14 navigation compatibility.
Those controls protect Archify's conservative source-evidence contract where a
rust-analyzer editor destination alone is insufficient. Passing these finite
cases does not establish whole-feature or whole-repository equivalence. The
semantic-reference rows above explicitly retain gaps in generic applicability,
blanket impls, general pattern inference and macro expansion.

[definition tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/goto_definition.rs
[definition implementation]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/goto_definition.rs#L175
[hierarchy tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/call_hierarchy.rs
[hierarchy implementation]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/call_hierarchy.rs#L96
[reference tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/ide/src/references.rs
[method tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-ide/src/tests/method_resolution.rs
[trait tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-ide/src/tests/traits.rs
[pattern tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-ide/src/tests/patterns.rs
[simple tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-ide/src/tests/simple.rs
[nameres tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/nameres/tests.rs
[module tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/nameres/tests/mod_resolution.rs
[glob tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/nameres/tests/globs.rs
[block tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/expr_store/tests/body/block.rs
[macro tests]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/nameres/tests/macros.rs
[pattern inference]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-ty/src/infer/pat.rs#L1200
[resolver]: https://github.com/rust-lang/rust-analyzer/blob/e5e7830640558e323e89c831488a3172b58dc66d/crates/hir-def/src/resolver.rs#L415
