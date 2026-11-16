# Rust call evidence against pinned rust-analyzer tests

This ledger compares the Rust outputs Archify already provides with
[rust-analyzer at `e5e7830640558e323e89c831488a3172b58dc66d`](https://github.com/rust-lang/rust-analyzer/tree/e5e7830640558e323e89c831488a3172b58dc66d).
The reference is the upstream fixture and expected destination, not a claim
that Archify implements the rust-analyzer LSP. The comparison normalizes each
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
rust-analyzer editor destination alone is insufficient.
