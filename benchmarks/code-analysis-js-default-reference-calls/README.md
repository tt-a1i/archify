# JavaScript stable default function references

The normal CLI now follows Prettier's imported default function reference into its ordinary function definition. Runtime source `e6778b531fbc2d4019edcceedaacd31f5451f850`, based on preserved team parent #1252 (`93378351dc97768fd7e0882a50f32ecc7a34e2a6`). Draft validation, not Labs integration, approval, merge, release or live installation. Original team commits/authors/PR ownership are retained.

## One more evidenced step

Before: in Prettier 3.4.2, main/comments/print.js:126 and attach.js:139 have resolved import edges but no direct function targets. After: both navigate to utils/is-non-empty-array.js:5, where an ordinary function is exposed by export default isNonEmptyArray at line9. Array.isArray inside that body is an external built-in, not a captured implementation. The caller-supplied filter(comment) remains unknown.

The producer emits js-ts-lexical-v3, adapter revision20. It follows same-module default identifier expressions and local default export specifiers into ordinary function declarations with one implementation body, rejecting observed writes or direct eval. It does not guess through factories, variable/const-initializer references, arbitrary expressions or re-export chains. Current readers preserve historical v1/v2 coverage rather than relabeling old facts.

## Fixed source-first and reserved cases

[Original source answers](source-first.json) and Node controls were committed before implementation. Prettier3.4.2 is fixed at cca946176c3ec04ae46bf7bcb08c5bba8c041682. The analyzer root is src, not the entire repository.

| Original selected observations | Correct | Wrong | Missed known targets | Reasonable unknowns |
| --- | ---: | ---: | ---: | ---: |
| Parent normal CLI |0|0|2|2|
| Candidate source |2|0|0|2|
| Extracted ZIP |2|0|0|2|

The unknowns are Prettier's caller-supplied filter and Chalk's factory-generated default callable. Chalk v5.3.0 (72c742d4716b1f94bb24bbda86d96fbb247ca646) was a reserved negative review slice: source inspected after initial code was written but before its first analyzer run, not blind. test/chalk.js:12 imports chalk from source/index.js, which creates it via createChalk at204 then exports it at225. That is not a direct ordinary function declaration. No rule tuning was needed from Chalk. Its fifteen selected files parse without errors.

These finite selected cases do not establish whole-repository accuracy or measured developer productivity. Additional callers are not silently added to the original score.

## Real changed-definition investigation

Supplemental, post-design fixed pair: Prettier3.3.3 (52829385bcc4d785e58ae2602c0b098a643523c9) →3.4.2. [Source answers and hashes](version-pair.json) were recorded before base/paired analyzer capture, after the first head implementation run. This is not the original freeze or a blind holdout.

The changed loadExternalConfig function adds actual required.__esModule/default-return handling; it is not merely a formatting/comment change. Source paths:

- Before-version source: config/prettier-config/load-config.js:40 → load-external-config.js:9.
- After-version source: load-config.js:39 → load-external-config.js:10.

The parent finds zero captured references to the changed definition. The candidate finds the single independently source-verified direct caller on each side, both with valid navigation; the extracted ZIP agrees. Both paired questions remain **partial / exit1** because package/config resolution inputs differ between upstream versions. This is captured direct-reference evidence, not equivalent builds, runtime callers or complete impact. External config loading and caller-selected loaders remain unknown.

The first replay incorrectly reused head caller line39 for the base. The original per-side source evidence already recorded base40/head39; the final executable replay derives each coordinate from that evidence. [Correction](version-pair-grader-note.json) is retained. No analyzer change was needed for that grader error.

## Wider source-signature audit

A supplemental TypeScript5.9.3 full-resolution/checkJs program confirms all **418 newly emitted Prettier source targets** against its function-declaration signatures, zero disagree/unavailable. This differs from the product's captured noResolve/noLib source program. It reports **236 diagnostics** (including missing dependencies, JSDoc/type errors); it is not successful project compilation, runtime identity proof or a claim of upstream project defects. Its actual options, diagnostic counts/examples and all418 records are retained in [signature-audit.json](evidence/signature-audit.json). Source bytes are checked before auditing; upstream code/configuration is not executed.

Across the full captures, all6,926 Prettier and539 Chalk call ranges are preserved, as are all1,103/44 previously bound records. Functions and imports are byte-equivalent as JSON values. Chalk adds no new target; Prettier adds418. This audit addresses emitted additions and preservation, not complete recall: unresolved static candidates, dynamic calls, factories, re-exports, variable-held defaults, non-relative aliases and other unsupported cases remain gaps. The separately frozen Redux TypeScript alias question is not fixed by this PR.

## Boundary, conditions and cost

New default-reference targets are same-source ordinary function declarations with one body. Parameter/type-only/namespace imports, caller shadows, excluded/declaration/parse-invalid files, ambiguous exports and external/re-export chains retain existing exclusions. Source write rejection covers assignment operators, destructuring, increments and loop targets by compiler symbol identity, including writes in closures. It is deliberately method-order/control-flow independent: a later or unexecuted write can conservatively suppress a valid default snapshot. Direct eval makes this reference model opaque. A property mutation does not replace the callable binding; TypeScript's JS expando receiver declarations are distinguished from another value declaration. Default const arrow/function-expression references remain unsupported even when a human can identify their body. Existing direct default function declaration behavior is unchanged.

The product uses the existing pinned TypeScript dependency and captured text only; no new npm package, language server or language toolchain is required. Authored Node controls execute tiny self-contained ESM fixtures, not upstream project code. They independently establish original/replacement values. Removing the write/opaque guard makes the regression fail. A supplemental property/other-lexical-binding control was added after the first implementation when compiler expando metadata caused an overly conservative rejection; the final code preserves that valid target.

Actual profile ([receipt](evidence/source-profiles.json)): Prettier/src (both versions)351 selected JS/TS/declaration files, Chalk root15; zero parse errors. No root tsconfig exists at those analyzer roots, so fallback allowJs/NodeNext/ESNext options apply; the ancestor Prettier tsconfig is intentionally not discovered. The resolver observes ../package.json for Prettier and package.json for Chalk, with hashes and missing metadata probes recorded. The captured compiler program uses noResolve/noLib/types[], not the upstream configured build. Source scope is not the project's test/build inclusion. Check/ordinary questions exit0 under existing gate semantics; parse/unknown completeness must be inspected separately.

Focused source review traced import capture → same-module export symbol → write/eval guard → function records → schema/questions/paired references. The existing captured import resolver is reused, not a second path matcher. Write analysis is cached only for each immutable source during one extraction; no ASTs/global caches persist. Historical models are retained. No supported capability was removed. No broad refactor or new runtime execution mechanism was introduced.

## Verification layers

- **Local:** module suite348pass/one inherited TS installed-configuration assertion/zero skipped. Exact parent reproduces that assertion (10pass/onefail). Fifty focused checks pass; packaged imported/question/change selection41pass. Five added behavior tests cover exact targets, binding writes/shadows, historical coverage and foreign known references after a definition change. TS revision fingerprint changed only19→20/digest.
- **Normal source/ZIP CLI:** two checks, two saved questions (exit0), one fresh real paired question (partial/exit1) per distribution. Two raw-facts files are byte-identical; three question outputs match after installation/output/workflow path normalization. [Source](evidence/source.json), [baseline](evidence/baseline.json), [ZIP](evidence/zip.json), [parity](evidence/parity.json).
- **Package:** two canonical Node22.23.3 / bundled zlib1.3.1-e00f703 builds match; all156 tracked module files match the extraction. ZIP SHA256 `c42bbe3ca39ebb48fe772aa41b144674ef2dc8e350daf965a874185308350488`. Runtime Node26.12.0/macOSarm64; no local Windows JS execution claim.
- **Remote CI:** reported separately on the final Draft head, not inferred from local/package evidence.
- **Integration:** independent candidate based on #1252; Java #1259 and Go/Rust #1256/#1258 remain separate. This package is this JS branch, not a combined all-language release. No approval/merge/release/live installation.

## Reproduce

Check out prettier/prettier-base/chalk at the exact commits above under one sample directory:

```sh
python3 benchmarks/code-analysis-js-default-reference-calls/run.py --cli archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/js-source
unzip archify.zip -d /tmp/js-package
python3 benchmarks/code-analysis-js-default-reference-calls/run.py --cli /tmp/js-package/archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/js-zip
node benchmarks/code-analysis-js-default-reference-calls/controls/run.mjs /tmp/js-node-controls.json
node benchmarks/code-analysis-js-default-reference-calls/audit.mjs archify/modules/code-analysis /path/to/samples/prettier/src /tmp/js-baseline/prettier/raw-facts.json /tmp/js-source/prettier/raw-facts.json /tmp/js-signature-audit.json
```

Generate the baseline with run.py --expect baseline and an isolated CLI at preserved parent93378351d. Existing module npm dependencies must be installed for source/ZIP/audit. The Node fixture replay writes only the requested output and preserves the frozen original oracle. Neither normal analyzer replay nor the signature audit executes Prettier or Chalk.
