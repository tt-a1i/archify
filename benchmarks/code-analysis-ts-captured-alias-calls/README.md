# Frozen next captured-alias call investigation

Redux fixed c9e06506f88926e252daf5275495eba0c04bf8e3 test/utils/isPlainObject.spec.ts:9–14 calls the default function imported from @internal/utils/isPlainObject. tsconfig baseUrl/paths and Vitest test.alias both map it to src/utils/isPlainObject.ts:5. Source answers/hashes were frozen before this question's first analyzer run.

The preserved parent93378351d already records the resolved static import edge to that source file, but leaves all six direct calls unresolved/no-local-function-binding. The external vm.runInNewContext method stays unknown. All201captured JS/TS files parse; the normal check exits0 under --fail-on never.

Separate TypeScript5.9.3 program attribution, using the real compiler options plus the test as an explicit root, confirms six alias symbols reaching the same body-bearing FunctionDeclaration. It reports15diagnostics for missing external types/dependencies/globals; this is not successful configured compilation. tsconfig includes src only; Archify's declared source profile includes the test. The Vitest config was inspected, not executed; runtime module loading is not proved. Redux was used in earlier experiments, so this is not blind.

No new alias-call implementation yet. Next: freeze independent value-shadow/external/uncaptured-target controls and a reserved real review slice, then reuse captured resolved imports rather than guessing aliases from spelling. Preserve existing model compatibility and real JS as well as TS coverage.
