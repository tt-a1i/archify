# Targeted static navigation feasibility (2026-09-21)

## Result

`benchmarks/semantic-repair-20260921/navigation/semantic-navigation.cjs` is a narrow, cold-process TypeScript Language Service probe. It resolves a source location through `getDefinitionAtPosition` and `getReferencesAtPosition`; its `--symbol` mode selects an actual TypeChecker symbol, de-aliases TypeScript alias symbols, and rejects same-name ambiguity rather than using a text search. Definitions retain exact AST declaration ranges and bounded source slices; references retain exact identifier spans and a one-line context snippet. Output is capped (default 40, configurable with `--limit`) and reports omitted items explicitly.

The required invocation uses the known Node 22 binary and an explicit, isolated package location:

```sh
/opt/homebrew/opt/node@22/bin/node \
  benchmarks/semantic-repair-20260921/navigation/semantic-navigation.cjs \
  --repo-root /private/tmp/archify-semantic-repair-20260921/ky \
  --scope source --symbol Ky.create --limit 3 --declaration-lines 40 --json

/opt/homebrew/opt/node@22/bin/node \
  benchmarks/semantic-repair-20260921/navigation/semantic-navigation.cjs \
  --repo-root /private/tmp/archify-semantic-repair-20260921/query \
  --scope packages/query-core/src --symbol QueryClient.fetchQuery --limit 3 --declaration-lines 40 --json
```

`--at path:line:column` is one-based. `--symbol` accepts `Qualified.Name` or `relative/path:Qualified.Name`; use the latter for same-name declarations. `--limit` bounds result rows and `--declaration-lines` separately bounds the source slice per declaration (default 40; range 1–200). Every definition retains its identifier span, AST-derived full declaration range, role (`implementation`, `overload-signature`, or `declaration`), and `fullEndLine`; a partial `source.text` says both `shownThroughLine` and `truncatedLines`. Thus a 40-line snippet never implies a full method/class body was inspected. No target code is run, and no target-repository packages are installed. Default scope is recursive TS/JS under the supplied directory; it excludes `node_modules`, `test`, `tests`, and `__tests__` segments. TypeScript may parse imports outside that initial file set for binding, but query targets and returned locations are restricted to eligible root files, with filtered declaration/reference counts in `scope.omittedByScope`. Project tsconfig/path aliases are not loaded; the prototype uses fixed NodeNext/ES2022 compiler options. That policy is repeated in every machine-readable result so an omitted caller is visible as a scope limit, not silently absent.

Both commands above were smoke-tested with exit `0`. In a fresh child process, the Ky query found `Ky.create` at `source/core/Ky.ts:179:9-179:15`, with its AST implementation range `179:2-358:3`; it returned three static locations and showed lines 179–218 of the 180-line declaration, explicitly omitting 140 lines. Its full CLI wall time was `418.5425 ms` (`entryUptimeMs 23.976875`, `programBuildMs 249.173042`, `queryMs 28.648208`). The Query query found `QueryClient.fetchQuery` at `packages/query-core/src/queryClient.ts:602:3-602:13`, with AST implementation range `602:3-631:4`; it returned three locations, explicitly reported one omitted reference, and its 30-line declaration was shown in full. Its full CLI wall time was `363.694541 ms` (`entryUptimeMs 24.223875`, `programBuildMs 214.11975`, `queryMs 21.511833`). The wall measurement includes spawning the Node 22 child and all CLI work; component timings are diagnostic subparts, so they must not be summed to produce a second total. These are single cold-process observations, not a performance comparison.

## Isolated setup receipt

On 2026-09-21, the package was installed only under `/private/tmp/archify-semantic-repair-20260921/tool-deps` with:

```sh
npm install --prefix /private/tmp/archify-semantic-repair-20260921/tool-deps \
  --ignore-scripts --no-audit --no-fund --package-lock=true typescript@5.9.3
```

The cold setup wall time was `12805.924084 ms`. The Node runtime used by the CLI is `/opt/homebrew/opt/node@22/bin/node` (`v22.23.2`). `package-lock.json` records TypeScript `5.9.3`, resolved to `https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz`, with integrity `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`. No global package/configuration was changed.

## Why this is semantic navigation

The TypeScript Compiler API constructs a `Program` from root names and compiler options, with `SourceFile` objects available to a checker; the Language Service exposes editor-grade definition and reference operations. The probe creates a fresh service and Program per CLI invocation and shows `entryUptimeMs` (process time until script entry), `programBuildMs`, and `queryMs`; it intentionally assumes no warmed persistent service/model cache. The test fixture verifies a barrel re-export and alias resolve to the original declaration while an unrelated same-name declaration is absent, rather than treating identifier text as a reference.

Official references: [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), [TypeScript Language Service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API), and the TypeScript project's [Language Service source](https://github.com/microsoft/TypeScript/blob/main/src/services/services.ts). The versioned package metadata above was read from the npm registry's TypeScript package publication.

## Limits

This is source-level static binding evidence. It does not prove dynamic `import()`, `eval`, reflection, dependency-injection/registration, runtime configuration, conditional loading, or a real execution path. It also cannot resolve a module that has no available types/source under the selected root. Compiler diagnostics are not presented as a green build claim: candidate repositories are deliberately not dependency-installed. Query a broader source directory only when its explicit scope policy is appropriate; this CLI does not claim complete-repository callers from a subdirectory.

## Pre-comparison audit

Independent review reproduced an import-resolution scope escape before any timed author ran. The frozen helper restricts symbol/location queries and returned declaration/reference locations to the eligible root-file set, reports filtered counts, and rejects scope symlink escape. The focused suite passed 6/6 after that repair. Final serial configuration smokes took 0.346s (Ky) and 0.350s (Query) for full child invocations; they confirm configuration, not authoring performance. The exact frozen helper hash and task copies are recorded in the experiment manifest.
