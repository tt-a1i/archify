# Rust lifetime navigation in the current six-language candidate

This composition preserves both original histories rather than replaying their
commits with new authorship:

```text
Java #1273: 196dd3569efba785d456a6dd0825ea6ebdf489bf ─┐
Rust #1277: 915d528e584a6343ab79284bd274ed11762cf9c9 ─┴─ 4e684e4911e8ad001b39d472976eb89925862235
```

The new layer belongs above #1273 in native stack #1262. The separately owned
#1277 remains an independent Draft above #1270. The shared Labs branch and
#1252 are unchanged. This is a reviewable candidate, not Labs integration.

The only textual merge conflicts were the shared call-coverage descriptions and
raw-facts schema. Preserve Rust4 alongside Java5 and JS/TS5, including Java
project metadata/ancestor freshness and JS/TS forwarding provenance. Rust's
extractor bytes match #1277; all other language extractors match #1273. The
binary conflict is resolved with a fresh canonical ZIP. No additional parser,
dependency or semantic rule is introduced by this composition.

## A developer can continue one step further

On regex `9870c06e6c772daaad7ab612faab29130753e41c`, the prior cumulative
candidate stops at `TranslatorI::new` in
`regex-syntax/src/hir/translate.rs:174:25`. The composed candidate navigates to
the lifetime-only owner's inherent definition in the same file at `685:5`.
The two frozen `HeapVisitor::new` sites in separate modules also retain their
distinct definitions. The three selected sites have no wrong or missed targets;
the two trait visitor controls remain unknown. This is source-candidate
navigation, not lifetime/argument applicability or borrow-checking proof.

The initial Go and Rust acceptance, real upstream changed-definition questions,
source freezes and oracle corrections remain in their original benchmark
directories and commits. No new semantic accuracy gain is attributed to this
composition. Corpora are exposed, not new blind samples. In particular, the
owned Rust changed-body pair is synthetic; the Java added-definition pair is a
real upstream migration that intentionally remains partial.

## Fixed samples and inherited source answers

| Concern | Fixed sources and original answers |
| --- | --- |
| Go direct functions, aliases, interfaces and concrete/SDK methods | [`../code-analysis-go-rust`](../code-analysis-go-rust) and [`../code-analysis-go-stdlib-types`](../code-analysis-go-stdlib-types); Cobra and chi, including original real before/after versions, module/build/test scope |
| Rust direct crate/workspace calls | [`../code-analysis-go-rust`](../code-analysis-go-rust); regex and serde-json, with original real before/after versions and cfg/feature scope |
| Rust inherent owners | [`../code-analysis-rust-lifetime-inherent`](../code-analysis-rust-lifetime-inherent), [`../code-analysis-rust-specialized-inherent`](../code-analysis-rust-specialized-inherent); regex `9870c06e6c772daaad7ab612faab29130753e41c`, serde-json `4d4f53c3b7de3259b6a8a15ef4d5f4edb47af32f` |
| Java arity, captured parents and declared project dependencies | [`../code-analysis-java-fixed-arity`](../code-analysis-java-fixed-arity), [`../code-analysis-java-captured-superclass`](../code-analysis-java-captured-superclass), [`../code-analysis-java-project-deps`](../code-analysis-java-project-deps); Commons Lang `c8774fa74adbbbcd4e5f915ab6bc3aa10d877419`, SLF4J `9783320b6c4411a0b120cad9e32cd9a981b1dac2`, plus frozen upstream migration `99e356974859a4cac2f5e533de2d8232d9d5dbe6` → `1c13755b2520e511bc41b5c6fdc8bd6c58e529c0` |
| JavaScript / TypeScript | [`../code-analysis-js-default-reference-calls`](../code-analysis-js-default-reference-calls), [`../code-analysis-ts-captured-alias-calls`](../code-analysis-ts-captured-alias-calls), [`../code-analysis-forwarded-exports`](../code-analysis-forwarded-exports); frozen Zustand/Redux and real Redux before/after versions |
| Python | [`../code-analysis-python-import-calls`](../code-analysis-python-import-calls), [`../code-analysis-python-reexports`](../code-analysis-python-reexports); Click `934813e4d421071a1b3db3973c02fe2721359a6e`, Jinja `15206881c006c79667fe5154fe80c01c65410679`, Flask `2c1b30d0503cfb064f1cb252e6614a06915a362a` |

Use each linked manifest/README to prepare its exact checkouts. The harnesses
verify revisions, tracked cleanliness and frozen source hashes before grading.
No analyzed project is executed. Previously recorded independent compiler/LSP
audits retain their original revision and profile attribution; this round
replays the public CLI against their source answers, not those compiler audits.

## Reproduce both distributions

Use a fresh output directory each time. Set `SAMPLES` to the checkout layout in
the linked recipes and `HISTORY` to a directory containing actual historical
captures produced by those original recipes. `run.py` lists the required
relative historical capture names explicitly; current captures are not
substitutes for old producer outputs. Prepare the two SLF4J migration checkouts
under `HISTORY/java-project-deps-upstream/` as named in `run.py`.

```sh
npm ci --ignore-scripts --prefix archify/modules/code-analysis
python3 benchmarks/code-analysis-investigation-unified/run.py \
  --cli archify/bin/archify.mjs --samples-root "$SAMPLES" \
  --out "$BASE_SOURCE" --product-sha 4e684e4911e8ad001b39d472976eb89925862235
python3 benchmarks/code-analysis-lifetime-combined/run.py \
  --cli archify/bin/archify.mjs --samples-root "$SAMPLES" \
  --history-root "$HISTORY" --out "$RECENT_SOURCE"

# Use official Node22 with bundled zlib1.3.1-e00f703 for both builds.
bash scripts/build-zip.sh "$ARCHIVE"
bash scripts/build-zip.sh "$REPEAT"
unzip "$ARCHIVE" -d "$UNPACK"

# Repeat both drivers with --cli "$UNPACK/archify/bin/archify.mjs"
# and fresh --out "$BASE_ZIP" / "$RECENT_ZIP" respectively.
python3 benchmarks/code-analysis-lifetime-combined/verify.py \
  --source-tree "$PWD" --package "$UNPACK/archify" \
  --base-source "$BASE_SOURCE" --base-zip "$BASE_ZIP" \
  --recent-source "$RECENT_SOURCE" --recent-zip "$RECENT_ZIP" \
  --archive "$ARCHIVE" --repeat "$REPEAT" \
  --runtime-revision 4e684e4911e8ad001b39d472976eb89925862235 --out "$PARITY"
```

The original nine-recipe run in this round used `--product-sha HEAD`; that is an
unchanged report label, not immutable provenance. The composition receipt pins
the actual merge and verifies its parents, unchanged module bytes and packaged
bytes. New reproductions should use the explicit revision shown above.

Normal CLI requirements are unchanged: Node plus the locked module dependencies,
Python for Python extraction, Go for Go extraction, and Cargo/rustc1.71+ with
locked helper dependencies for Rust. Optional rust-analyzer/JDK/compiler audits
and their costs are documented in the original concern-specific READMEs. Java
does not require Maven or a JDK. This round reused installed toolchains and
caches; fresh installation/download cost was not measured. Missing Rust tooling
is tested through the public CLI and must return structured
`extract/rust-unavailable` with exit2, not an empty successful capture.

## Evidence boundaries

The committed receipt records actual counts and exits, including nonzero
diagnostics. Comparisons normalize installation/output paths only; fixed upstream
source roots, all target positions, coverage, reasons and snapshot identities
remain compared. Generated owned-pair and changed-metadata roots live under
those output directories and have identical authored inputs.

Keep the original Java3 arity recipe's three known misses visible; newer
declared-project questions exercise the supported scope separately. The real
Java pair remains `partial`/exit1, changed saved POM metadata remains exit1 with
unavailable call evidence, and missing Rust tooling remains exit2. Actual saved
Rust1/2/3 and Java4 captures retain their original models without rebinding.
Recipe/profile denominators overlap and must not be summed into an accuracy
claim. Local module, extracted tests, package gates, final-head remote CI and
actual merge state are reported separately. Draft publication does not approve,
merge, release or install the candidate.


Accepted local evidence: **410/410 module**, **74/74 extracted shared** (both
zero skips), **63 package passes / 2 environment skips**. The parity receipt
compares **96 public CLI commands per distribution**, **32 raw captures**,
**63 investigation payloads** and **170 packaged module files**. The direct
#1273 baseline replay records 0correct/3missed/2unknown for the selected Rust
sites; the composed replay records 3correct/0missed/2unknown. The package SHA256
is `bb2f38587109acd1b73e97d58ce987b8db56af0c9ad58988665340e668286e4b`
(7,596,031 bytes), identical across two canonical builds.

The scoped PR improvement check reuses independent frozen source answers and
existing shared-schema/current/historical/paired/freshness tests. No additional
mirror tests were warranted. The focused simplification survey traced normal
and paired readers, schema checks and packaged dispatch. Historical model
branches have live saved-capture consumers and must remain; a broad language
registry/coverage refactor adds scope without resolving a composition defect.
The benchmark-only changes admit newer producer models while preserving the
source answers, and add the missing Redux paired-command receipt.
