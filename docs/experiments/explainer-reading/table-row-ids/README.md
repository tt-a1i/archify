# Repeated table labels retain separate row identities

Round 26 fixes a failure found in the independent [Rust first draft](../rust-default/author/first-draft.archify.md). Two `Some(7)` rows and two `None` rows describe different calls, but the parser generated the same ID for matching labels. Strict delivery failed. The author had to add IDs manually; that repair introduced another syntax error, retained in the [author record](../rust-default/README.md#independent-author-and-retained-failures).

Product commit: `4d182b54f5778ef707228922c5d04b3b981f26b3`. Base: `f9e0e56af411e78be4053297508b00d6dff7d8a2`. Refreshed `origin/dev`: `5ecbd1bfdbf83ea747072112493c940e707569cb`, an ancestor. [Source and regression commit](https://github.com/tt-a1i/archify/commit/4d182b54f5778ef707228922c5d04b3b981f26b3).

Repeated automatic row IDs now receive distinct, deterministic values. Labels, cells, order, the first automatic ID and explicit authored IDs remain intact. Explicit duplicate IDs still fail, including in JSON input. The change is local to Markdown tables and `@comparison`; renderer, writing checks and JSON schema are unchanged.

## Evidence

- The unchanged 2,494-byte first draft has SHA-256 `af7bc8a8cabcfba25c36e46a596148483a131bff309767fb1c8d3fa385779305`. [Base strict delivery](evidence/base-original.json) exits 1 with two duplicate-ID diagnostics. The [candidate](candidate.html) passes [strict delivery](evidence/candidate-finalize.json) and [current-path provenance checking](evidence/candidate-check.json).
- The new parser regression [fails on base](evidence/base-regression.log); the existing ID-stability test still passes. Candidate [parser/validation/renderer](evidence/focused-1.log) pass 50 tests, [CLI/panel replacement](evidence/cli-patch.log) pass 28, and [core](evidence/core.log) passes 19, all with zero failures or skips. [Generated checks](evidence/generated.log) pass.
- [Replay of all 28 saved main variants](evidence/replay.json) produces identical complete parser results on base and candidate. Rendering both with the same frozen resources yields byte-identical HTML for every pair. This is compatibility evidence, not fresh generation or renewed provenance acceptance. [Replay script](evidence/replay.mjs).
- [Browser checks](evidence/browser-check.json) find unique DOM IDs, preserve all five observation rows and navigate to the second generated `Some(7)` row. [Automatic phone](screenshots/automatic-390.png) and [manual-ID phone](screenshots/manual-390.png) screenshots are byte-identical. Desktop [automatic](screenshots/automatic-1440.png) and [manual](screenshots/manual-1440.png) screenshots differ at seven pixels on the browser scrollbar edge; page content is identical. [Pixel analysis](evidence/pixel-analysis.json). The parent visually inspected the desktop pair.

[The current-path comparison](evidence/path-comparison.json) records changed embedded relative source paths and their digest; the rest of the HTML is identical to the inspected temporary page. Initial whole-file and path-only equality assertions failed because they did not account for this provenance data. Both final paths also passed the browser row check.

The original phone table still needs horizontal scrolling: 432 px inside 358 px. Parser acceptance does not solve that content problem. The [two-column Rust explanation](../rust-default/candidate.html) remains the preferred reading candidate. No main index variant is added.

## Package and review scope

Two canonical Node 22.23.3 / zlib 1.3.1-e00f703 builds are byte-identical: 6,996,328 bytes, SHA-256 `5d639fc5c5691a4706e06c79890a4e65a7ec5488703fadf4308c2baa24ee0e7e`. The extracted parser matches source. Its CLI passes [strict original-input delivery](evidence/package-finalize.json), [new provenance checking](evidence/package-check.json), and [previous Rust artifact provenance](evidence/package-old-control.json). [Package identity and browser check](evidence/package-result.json). This is package execution, not a live installation.

Direct callers are preparation, declared-input discovery and delivered-source checking. Validation still owns uniqueness; rendering consumes the IDs. Preserving the first automatic ID protects existing links and source bindings. One temporary map per table is sufficient; no shared allocator is added.

Scoped test-value review: extend the existing ID test for explicit-ID stability and duplicate rejection; add a small regression for repeated labels, identical rows, intact cells and source locations in both table syntaxes. Expectations follow the observed failure and reference contract, without copying the hash algorithm or pinning new hashes. No concrete redundant layer or duplicate-state concern warrants a simplification refactor.

The [bounded ownership search](evidence/ownership-search.json) identified related PR #1142. At head `c48949649eb7a9482d6170dcb4e29c1b47a047b5`, its parser changes answer attribution but retains the base `addBlock` row-ID implementation. This is related file ownership, not an overlapping row-ID repair. The search is not exhaustive; no external message or patch reuse occurred.

Under the [benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is a narrow replay of an observed explainer authoring failure. It does not measure new-author repair time, general generation quality or human comprehension. Architecture/workflow generation and layout are outside the changed path. No full generation matrix, full repository/browser suite, Windows, final-head CI or human acceptance is claimed. Copied logs trim trailing whitespace; their diagnostics and original paths are retained. Archived scripts retain original paths; the candidate delivery/check above certify its current repository path.

From the repository root:

```sh
node archify/bin/archify.mjs finalize explainer \
  docs/experiments/explainer-reading/rust-default/author/first-draft.archify.md \
  /tmp/repeated-table-labels.html --writing strict --json
npm run test:focus -- test/explainer-parser.test.mjs \
  test/explainer-validation.test.mjs test/explainer-renderer.test.mjs
```

AI disclosure: Codex investigated, implemented, tested and documented the repair. The triggering draft came from the separate author recorded in round 25. Nothing was merged, released or installed; human review and integration remain separate.
