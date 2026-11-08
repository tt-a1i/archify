# Python one explicit function reexport — Draft candidate

Independent follow-up to Draft #1252 at93378351dc97768fd7e0882a50f32ecc7a34e2a6. This branch retains its team and Python contribution history. It is not part of the separately published seven-layer stack, intended for an independent English Draft above #1252, not in Labs/merged/released/installed.

## One investigation step gained

Jinja's tests/test_api.py:100 imports is_undefined from jinja2. Previously the question had the call location but stopped without a target. The candidate follows the explicit export at src/jinja2/__init__.py:32 to src/jinja2/utils.py:104. The nested expr2() call is still unknown: compile_expression supplies a runtime-generated callable. A changed-definition fixture separately retrieves the known caller through an API module; it does not establish a real upstream changed-body experiment.

## Source answers before the rule

Source answers froze at7a906c06b, before baseline checks or resolver edits. Baseline observations froze atccb93f3a3. Implementation73f2a22bd preceded the reserved Flask candidate replay. Exact calls, exports, definitions, pins and hashes are in source-first.json.

- Jinja3.1.6:15206881c006c79667fe5154fe80c01c65410679. Previously exposed in the local-import study. Two design questions: is_undefined and make_logging_undefined through jinja2's explicit API exports.
- Flask3.1.2:2c1b30d0503cfb064f1cb252e6614a06915a362a. New in this tracked study; inspected to establish answers. The two JavaScript-example render_template/jsonify questions were reserved from initial rule tuning. This is not a blind repository claim.

Normal source CLI and saved questions: parent0correct/0wrong/4missed; candidate4correct/0wrong/0missed. Two source counterexamples stay unknown: generated expr2 and Flask request.form.get through a LocalProxy. All four target navigations are valid in the selected questions.

Across the two captures, all10,075 call extents,3,004 functions, imports and prior target positions remain unchanged. There are35 introduced targets (Jinja2,Flask33), including the selected four; introduced-targets.json is an inventory. A separate post-design source-chain review checks all35 against explicit import/export/definition anchors, with source text and hashes in source-chain-audit.json; a wrong-line control is rejected. This is source-only agreement, not compiler attribution or runtime/complete-namespace proof. The additional31 are post-design discoveries and are not added to the frozen score. No whole-project accuracy, complete reference set, successful upstream compilation or runtime behavior is claimed.

## Bounded language contract

python-lexical-v2, adapter revision10, reuses the existing binding-event scanner and captured import resolver. One unique unconditional explicit from-import reexport may reach a unique ordinary undecorated function in another captured file, including aliases. Longer chains, cycles back to the caller, conditional/rebound/repeated/wildcard exports, decorated definitions, classes, attribute/member dispatch and runtime module initialization remain outside this contract. Historical v1 remains direct-only. Semantic validation requires the target definition and one or two recorded static import edges; question freshness does not rerun binding after other files change.

No new dependency, language server, project import, annotation execution or upstream test execution is required. The existing Python AST interpreter is the product toolchain: Python3.15.0 was used, with Node26.12.0 on darwin-arm64; no new toolchain was installed. The product launcher requires Python3.8+, but sample syntax/conditional AST features still depend on the selected interpreter. The development source-audit script requires Python3.9+ for string helpers. Missing interpreters produce extract/python-unavailable with Python3.8+/BAUIFY_PYTHON guidance. No runtime import/compiler oracle is claimed.

## Reproduce

```sh
python3 benchmarks/code-analysis-python-reexports/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/source
```

Use #1252's CLI with --expect baseline. The runner requires fresh output, checks fixed revisions/source hashes before and after, preserves command output/exits, and validates saved-question navigation. Checks deliberately use --fail-on never and exit0; that does not mean no findings. No analyzed project executes.

## Separate validation states

- Local Python + paired questions38/38, zero skips; regenerated task contract examples18/18.
- Full module346 tests:345pass,1fail,0skips. The installed-configuration TypeScript snapshot test fails identically at the untouched #1252 baseline; its cause is not fixed or waived here. Initial run also rejected stale task fixtures after revision9→10; regeneration removed that second failure. Only Python's revision/digest changed in the extractor fixture.
- A new one-hop source-navigation regression fails against the parent with unresolved instead of imported-function. Existing longer-chain/conditional/rebound/decorated/namespace negatives remain.
- Source and extracted-ZIP CLI both score4correct/0wrong/0missed/2unknown. Both raw captures are byte-identical; four saved questions agree after only install/output path normalization. An actual saved historical v1 question is available in both distributions with its original direct-only scope.
- Extracted package: Python/paired-question38/38, zero skips. Root core19/19 and release identity passed. Two canonical Node22.23.3/zlib1.3.1-e00f703 builds agree; all156 tracked module files match extraction. ZIP SHA256682426acae22167af0777dbca764e6088644e93797b0bc210ae6f33676c1e8b7. See parity.json.
- Remote CI and formal publication are tracked separately on the Draft; local/package results do not establish remote or Windows success.
- Scoped test-value review adds one API navigation boundary and one changed-definition caller outcome. The scoped simplification survey reuses the existing scanner/resolver and one canonical static import adjacency map; no general export graph or arbitrary traversal is added.

Next: record actual final-head CI separately and continue real-source wrong-target/missing-target questions. The known baseline TypeScript snapshot failure is not waived by local Python/package passes. The cumulative Go/Rust/Java candidate stays unchanged; this local Python step does not complete the persistent objective.
