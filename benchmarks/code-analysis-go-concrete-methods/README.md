# Concrete Go method source investigation

This dependent Draft layer extends cumulative #1263 `68f54478ae16d824e43198ac94d6e05746510edf`, retaining the original Go/Rust/Java/JS/TS/Python/team histories. Runtime method binding is `55414edf6`; subsequent product edits describe scope limits, not a second resolver rule. Final package/source head is recorded in evidence/parity.json. No approval, formal PR merge, release or live installation.

## One more evidenced step

Before, `cobra/doc/util.go:26 cmd.HasParent()` stopped at method dispatch despite an explicit *cobra.Command parameter. After, it reaches `command.go:1393 HasParent`, whose qualified definition is *Command.HasParent. Chi `mux_test.go:105 m.Get` likewise reaches `mux.go:161`. The external io.Writer and project Routes interface controls do not choose arbitrary concrete implementations.

A real supplemental Chi change replaces *Mux.Match's body with a call to new Find: `mux.go:365`, fixed `67be7d9cafdaeb4e04e887ff78d09e030ee43b00 → 71307f9b7e4e9527638bc951c42b782cd1560331`. Baseline finds0knownreferences on each side; candidate source/ZIP recover the2source-verified concrete callers before and4after with valid navigation. go.mod changesGo1.14→1.20, so the paired result remains **partial/exit1**. Callback Router interface bindings stay distinct from outer *Mux bindings.

The reserved gRPC slice `98a0092952dd4d8443229c3a335ec592d9c40c9b` was source-inspected after initial code, before its first candidate method capture, without rule tuning. `internal/resolver/config_selector.go:142 state.Attributes.Value` has explicit *attributes.Attributes receiver from resolver.State and now reaches `attributes/attributes.go:66`. The stored value's ConfigSelector type assertion does not establish a runtime ConfigSelector implementation. The original v1 free-function benchmark treated this as a scoped unknown; here its source-known method body is correctly counted as a baseline miss and candidate positive.

| Three selected direct targets + two interface controls | Correct | Wrong | Known misses | Reasonable unknowns |
| --- | ---: | ---: | ---: | ---: |
| Preserved Go v1 baseline | 0 | 0 | 3 | 2 |
| Candidate source / extracted ZIP | 3 | 0 | 0 | 2 |

Cobrae392f3204db0445f1f4ad47448b04d8c8ad04c2a and Chi were reused from the free-function study, not blind. Original answers e71e19376 precede this question's deliberate baseline capture; controls and paired source answers precede the rule. Chi later became an exposed pair study. Do not add these overlapping samples as independent general accuracy/adoption evidence.

## Compiler attribution and visible misses

Independent full configured type attribution uses Go1.27.2 and **golang.org/x/tools v0.52.0**, tests enabled, cgo disabled, readonly module graph. It verifies captured bytes before loading packages and executes no project source/tests/config. Production/internal/external-test variants are separated like the product. Three project graphs report **zero diagnostics**. This is type attribution, not a successful linked build or execution.

All **9,281 newly emitted targets agree**,0disagree,0unavailable,0missingcall. The broader denominator is compiler-selected methods with unique body-bearing declarations in captured project source (not interfaces, external bodies or arbitrary function values):

| Project | Compiler-known bodies at call sites | Baseline correct / missed | Candidate correct / wrong / missed |
| --- | ---: | --- | --- |
| Cobra | 789 | 0 /789 | 789 /0 /0 |
| Chi | 459 | 0 /459 | 456 /0 /3 |
| grpc-go | 8,070 | 0 /8,070 | 8,036 /0 /34 |

The **37 source-known misses remain misses**, not reasonable-unknown wins. For example, Chi `mux.go:82 rctx.Reset` follows `sync.Pool.Get().(*Context)`; missing standard-library type information interrupts the product's partial checker. Cases at mux.go309/312 similarly follow a handler type assertion. The complete location/source-line list is in known-misses-*.json. No general all-call precision/recall or complete impact claim.

Complete9281rows are retained as compact compiler-*.jsonl, with hashes/counts and source digests in evidence/compiler-audit.json. The baseline/candidate preserve all **64,930 call ranges,15,174 prior bound records**, functions and imports. Runtime still intentionally uses incomplete captured source typing; the audit's complete dependency graph is not a shipped requirement.

## Language contract

`go-source-direct-v2`, adapter2, records go/types.Info.Selections and binds body-bearing captured method objects for concrete receivers. This includes promotion, method expressions, type aliases and generic instances when the compiler supplies the method identity. Receiver identities/Named.Origin prevent duplicate declarations from becoming an arbitrary first target without conflating same-named methods on different types. Interface/type-parameter dispatch, function fields/variables, absent bodies, uncaptured/excluded sources and ambiguous receivers remain unresolved. An invalid receiver declaration with the same method name can conservatively block otherwise valid targets.

Storedv1 captures retain their free-function coverage and do not acquire method support from a numeric revision. Shared schema/semantic/saved-question/paired readers acceptv2 explicitly; a v1 capture containing go-direct-method targets is rejected. Raw target.name stays the plain method name; function/paired definition.qualname holds receiver-qualified identity. The pre-implementation method-name-note.json corrects the source manifest's qualified label field without changing source coordinates or product naming.

Actual profile remains one captured root module, Darwin/arm64, cgo off, no custom tags, tests included; metadata/exclusions/typing diagnostics are in each report. Root go.mod language/toolchain directives are captured but not enforced by the incomplete checker. No go.work/replace/vendor/nested-module assembly, external dependency loading or generated compiler execution. Checked-in selected source is read as source. No runtime callable identity, nil safety, argument applicability or full compilation guarantee.

The Chi TestMuxBasic question deliberately retains **102total/40included/62omitted** calls, so the selected Get105 is outside its presented records despite correct raw facts. The CLI does not silently increase its limit. Separate shorter TestMuxMatch_HasBasePath and Cobra/gRPC questions have valid target navigation; changed Match investigation has valid incoming references. This output bound remains a visible investigation limitation.

## Reproduce

```sh
python3 benchmarks/code-analysis-go-concrete-methods/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/source
```

Use the preserved #1263 CLI with `--expect baseline`; use an extracted candidate ZIP entrypoint for package replay. Source/ZIP **three raw-facts captures are byte-identical and five saved/paired questions agree after only install/output path normalization**. Each distribution has3normalchecks,4savedquestions exit0 and1pairedquery partial/exit1. Checks explicitly use --fail-on never; findings still exist. Source hashes/revision assertions run before capture.

Original free-function/alias/Cobra-change regressions also pass source/ZIP:9previous positive observations preserved; one formerly scoped unknown becomes the validated Attributes.Value target, so current-model replay reports10correct/4unknown/0wrong/0missed with7GenMan references/side. This is model-aware regression evidence, not an additional independent score to add to the method study.

Optional independent full compiler audit:

```sh
cd benchmarks/code-analysis-go-concrete-methods/audit
go run . -root /fixed/cobra -baseline /runs/baseline/cobra/raw-facts.json \
  -candidate /runs/source/cobra/raw-facts.json -out /runs/compiler.json
```

Audit-only Go1.26+ is required by pinned x/tools0.52; Go1.27.2 was installed, no new toolchain installed. Product remains Go1.18+ with compiler: Named.Origin is in the official Go1.18 API manifest. Standard-library-only product helper adds no npm/Go dependency or language-server process; absent Go produces CLIexit2/extract/go-unavailable with install/ARCHIFY_GO guidance. The optional audit downloads pinned module dependencies as needed; observed x/tools source cache12MiB, fresh-cache download/build cost not controlled/measured. Audit wall times depend on warmed cache/concurrency, not a performance benchmark. go.mod/go.sum retain exact versions; audited repositories stayed Git-clean.

## Validation states

- Source full module376/376pass,0skip at3429fef63; later runtime edits only clarify limitations. Final affected package Go/question/paired selection37/37. Pre-implementation controls2expectedpositive/pairedfailures and1negativepass; post-candidate embedded-interface control passes. Authored compiler selections precede implementation and verify independent declaration lines/kinds.
- Two final canonicalNode22.23.3/bundledzlib1.3.1-e00f703builds identical,168trackedmodulefilesmatch. ZIPsha256 `3b4a72acbd534a494c09cc031a4b1b6d4a2dcd194b21658109e822b08bcfae3e`. Local runtimeNode26.12/macOSarm64; no local Windows execution claim.
- Remote final-head CI is recorded in the owning English Draft/Wiki after publication. Parent#1263's passing run is not a final-head result for this layer.
- Not Labs/approved/merged/released/installed. Next continue the37known misses and Rust semantic depth with new source-first questions; do not expand into runtime interface dispatch by matching names.

Scoped test-value review protects exact source jumps, ambiguous/opaque targets, historical readers and changed-method callers. Focused simplify-codebase survey retained one existing checker/capture pipeline plus a per-package receiver index; no second resolver/cache graph or compatibility retirement. No diagram-generation changes or visual-quality claim.
