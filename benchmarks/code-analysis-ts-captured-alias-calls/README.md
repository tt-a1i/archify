# Captured configured-alias call investigation

This Draft layer builds on JS default-reference #1260 at `80875e5e75d3a9e1a91a50a51a56a0315550a19f`, retaining the original source-freeze commit `7a824d69fc947fae7bbb948d0c56636f2e5f6172` and #1252/team history. A local baseline composition preserves both parents; it is not a GitHub PR merge. No approval, formal merge, release or live installation.

## One more evidenced source step

Redux `c9e06506f88926e252daf5275495eba0c04bf8e3`: before, `test/utils/isPlainObject.spec.ts:9–14` had a correctly resolved static import edge for `@internal/utils/isPlainObject`, but each call had `no-local-function-binding`. After, all six calls navigate to the ordinary default function `src/utils/isPlainObject.ts:5:1`. Its external `vm.runInNewContext` control remains unknown.

The source answer and configuration hashes preceded this question's first capture. Redux was reused in earlier research; this is not blind. The additional source-review slice `test/combineReducers.spec.ts:17` was reserved before this implementation: `redux` resolves to `src/index.ts`, but reaching `src/combineReducers.ts:123` requires another imported export hop. It remains a **known-source miss**, not an accuracy win counted as a reasonable unknown. No rule tuning from that slice.

| Fixed observations | Correct | Wrong | Missed known targets | Reasonable unknowns |
| --- | ---: | ---: | ---: | ---: |
| JS v3 baseline | 0 | 0 | 7 | 1 |
| Candidate source / extracted ZIP | 6 | 0 | 1 | 1 |

These are eight selected observations, not whole-project accuracy. An independent post-design TypeScript 5.9.3 signature audit agrees with **all 11 newly targeted calls**, zero disagreed/unavailable. It uses the real compiler options with all 201 captured files as explicit roots; the configured project includes only src. **637 diagnostics** for unavailable dependencies/types/globals and other type checks mean this is not successful compilation or runtime alias-loading evidence. The earlier six-site attribution used fewer explicit test roots and had 15 diagnostics; these counts describe different programs, not a regression measurement.

All 30,241 collected call ranges, 3,583 prior bound records, functions and imports are preserved. The supplemental five new sites were reviewed after implementation; they are not part of the original six-site score. Authored paired captures recover the changed helper's foreign caller on both sides with valid navigation; that paired test is synthetic, not a new real upstream version pair.

## Contract and scope

`js-ts-lexical-v4`, TypeScript adapter revision 21, reuses already captured resolved static import targets. It does not guess an alias from its text or load more sources into the noResolve program. Same explicit-export/function restrictions and default-reference write/eval checks as v3 remain. External/node_modules, outside-root, missing/excluded, declaration-only, malformed, type-only, factory and re-export targets cannot supply a new target. Compiler binding identity preserves lexical shadows. Both JS and TS configured aliases are covered by authored controls.

Historical v1/v2/v3 captures keep their original reader/coverage meaning. Freshness validation separately checks the imported target. Source navigation is not runtime callable identity, dispatch, successful builds, complete impact or current re-resolution after unrelated configuration edits.

Redux root `tsconfig.json` selects baseUrl `./`, paths `@internal/* → src/*` and `redux → src/index.ts`. Vitest independently declares the internal alias; its config is read as evidence, never executed. Archify's source profile includes 201 JS/TS files, including tests outside tsconfig include; zero parse errors. Dependency lookup uses captured file inventory and recorded configuration inputs. No new dependency, language server, runtime project execution or extra toolchain. Existing module dependencies are installed with `npm ci`; source/ZIP replay used Node 26.12.0 on macOS arm64. No local Windows execution claim.

## Reproduce

Checkout the pinned Redux revision and install this branch's module dependencies with `npm --prefix archify/modules/code-analysis ci --ignore-scripts`.

```sh
python3 benchmarks/code-analysis-ts-captured-alias-calls/run.py \
  --cli archify/bin/archify.mjs --sample /path/to/redux --out /path/to/output
```

For the recorded JS v3 baseline, run the same script with its CLI and `--expect baseline`. For package parity, extract this branch's `archify.zip`, install that extracted module's dependencies, then point `--cli` at its `archify/bin/archify.mjs`. Both normal checks and saved questions exit 0; the check explicitly uses `--fail-on never`, not a claim of zero findings. The raw facts are byte-identical; saved questions agree after only install/output paths are normalized.

```sh
node benchmarks/code-analysis-ts-captured-alias-calls/audit.mjs \
  archify/modules/code-analysis /path/to/redux \
  /baseline/capture/raw-facts.json /candidate/capture/raw-facts.json /audit.json
```

The audit checks live bytes against captured sources before using a full-resolution standard-host compiler program. It executes no upstream module/build/config. This program intentionally differs from the product's noResolve/noLib capture.

## Validation and review

- Controls committed before implementation: two positive/paired failures reproduced, negative boundary test passed. Source review supplies expectations independently of the resolver implementation.
- Focused 58/58; packaged imported/question/paired selection 45/45. The final added JS fixture was rerun in its owning suite.
- Full module run: 351 passes, one inherited installed-configuration assertion failure, zero skips; subsequent historical-v3/JS controls passed separately. Earlier exact #1252 reproduces that same installed-config failure; local cause remains unestablished. Remote final-head CI is recorded separately after publication.
- Canonical Node 22.23.3/bundled zlib 1.3.1-e00f703: two final ZIP builds identical; all 156 tracked module files match. This is this dependent branch's package, not a cumulative Go/Rust/Java release.
- Scoped test-value review: preserve correct jumps, exclusions, shadows, historical readers and changed-definition known references; no private-function/source-string assertions. Focused simplify-codebase survey: capture → existing import target → same export resolver → schema/questions/paired readers. No new runtime lookup layer/cache/dependency. Separate benchmark audits preserve distinct configured-TS and fallback-JS experimental profiles; no production abstraction or compatibility cut justified.

See `evidence/` for commands/exits, original source manifests, complete 11-site audit, package parity and logs. No diagram-generation changes, so no diagram-generation benchmark or visual-quality claim.
