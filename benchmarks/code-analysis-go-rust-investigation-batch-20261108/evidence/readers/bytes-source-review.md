# Frozen answer key — `Bytes::truncate` zero-length shared-reference release

Source: tokio-rs/bytes, base `002df10` → head `d5c8ad3` ("Release shared reference on zero truncate (#842)"). Coordinates are head tree, 1-based, counted from `git show d5c8ad3` and the head files only.

## 1. Changed definition

- File: `/tmp/archify-batch-20261108/samples/bytes-truncate-zero-head/src/bytes.rs`
- Line 569: `    pub fn truncate(&mut self, len: usize) {`
  - `fn` keyword at **569:9**; name `truncate` at **569:12**.
- Qualname: **`bytes::Bytes::truncate`** (defined in private `mod bytes`, re-exported at root; `src/lib.rs:82` `mod bytes;`, `:86` `pub use crate::bytes::Bytes;`).
- Evidence of change (only `src/bytes.rs` touched, 4 lines, +3/-1):
```
-        if len < self.len {
+        if len == 0 {
+            drop(mem::replace(self, Bytes::new_empty_with_ptr(self.ptr)));
+        } else if len < self.len {
```
  New body: 570 `if len == 0 {`, 571 `drop(mem::replace(self, Bytes::new_empty_with_ptr(self.ptr)));`, 572 `} else if len < self.len {`. Base had the `if len < self.len` on line 570.

## 2. Calls that reach this method

Column = first character of the call/receiver expression; method-name column given for disambiguation. All are single-line calls (no end line/col).

Production (crate `src/`, method call on `Self`):
| file | line:col (expr) | `truncate` token | caller | kind | target |
|---|---|---|---|---|---|
| `src/bytes.rs` | 599:9 | 599:14 | `Bytes::clear` (`pub fn clear`, 598:9), `self.truncate(0);` | inherent method | determined (`Self` = `Bytes`) |

Tests (crate `tests/`; captured only if the default source profile includes test targets — not verifiable without the tool, so labelled, not asserted):
| file | line:col (expr) | `truncate` token | direct caller | kind | target |
|---|---|---|---|---|---|
| `tests/test_bytes.rs` | 334:5 | 334:11 `hello.truncate(15)` | `truncate` (331:4), `#[test]` | test fn | determined (`let mut hello = Bytes::from(s)`, 333) |
| `tests/test_bytes.rs` | 336:5 | 336:11 `hello.truncate(10)` | `truncate` | test fn | determined |
| `tests/test_bytes.rs` | 338:5 | 338:11 `hello.truncate(5)` | `truncate` | test fn | determined |
| `tests/test_bytes.rs` | 349:5 | 349:15 `truncated.truncate(0)` | `truncate_to_zero_releases_shared_reference` (343:4), `#[test]` | test fn | determined (`bytes.freeze()` → `Bytes`, 346) — the regression test for the change |
| `tests/test_bytes.rs` | 361:5 | 361:14 `nonempty.truncate(1)` | same test fn | test fn | determined (`Bytes`, 358) |
| `tests/test_bytes_vec_alloc.rs` | 98:5 | 98:11 `bytes.truncate(2)` | `test_bytes_truncate` (96:4), `#[test]` | test fn | determined (`Bytes::from(vec![...])`, 97) |
| `tests/test_bytes_vec_alloc.rs` | 105:5 | 105:11 `bytes.truncate(2)` | `test_bytes_truncate_and_advance` (103:4), `#[test]` | test fn | determined (`Bytes`, 104) |

No calls in `benches/`. Doc-comment examples (`src/bytes.rs:565` `buf.truncate(5)`, `src/bytes_mut.rs:452`) are comments, not AST calls; they compile as separate doctest crates.

## 3. Look-alikes that do not reach it

- `tests/test_bytes.rs:423:7` and `:435:7` — `b.truncate(7)` in `freeze_after_truncate`/`freeze_after_truncate_arc`; `b` is `BytesMut`, so this is `BytesMut::truncate` (`src/bytes_mut.rs:455`) → `set_len`, not the changed method.
- `src/bytes_mut.rs:504:18` — `self.truncate(new_len)` inside `BytesMut::resize`; same `BytesMut::truncate`, unrelated.
- `BytesMut::clear` (473–476) uses `set_len(0)` directly and never calls `Bytes::truncate`.
- `#[must_use]` doc strings mentioning "consider Bytes::truncate" (`src/bytes.rs:471`, `src/bytes_mut.rs:332`) are text only.

## 4. Unknowns

- Profile coverage of `tests/` is assumed, not verified: if the default source profile is `src/**` only, the production call set is exactly `src/bytes.rs:599`.
- No dynamic dispatch occurs (inherent `Bytes` method, no trait objects), so no runtime-dispatch gap; but calls from downstream crates, benches outside the repo, or doctests are out of scope.
- `clear()` is reachable from external code, so an exe-level caller graph above `Bytes::clear` cannot be enumerated from this repository.
