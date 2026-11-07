# Frozen JavaScript default-reference investigation

Prettier3.4.2 fixed cca946176c3ec04ae46bf7bcb08c5bba8c041682 main/comments/print.js:126 and attach.js:139 call isNonEmptyArray. The explicit relative .js imports reach utils/is-non-empty-array.js, where an ordinary function at line5 is exported by export default isNonEmptyArray at line9. Source answers/hashes were frozen before first analyzer execution; source search finds no reassignment.

Preserved parent93378351d captures351source files/zero parse errors and resolves both import edges, but leaves both direct calls unresolved/no-local-function-binding. The caller-supplied filter(comment) callback is an expected unknown. This is a production JavaScript path, distinct from the separately frozen TypeScript tsconfig-alias gap. No new default-reference support is implemented yet.

Next: confirm source/compiler/Node resolve-only identities without executing project code; freeze wrong-target write/shadow/ambiguous export controls and a reserved real review slice. Add stable ordinary-function export-reference navigation, preserve dynamic defaults/assignments as unknown, then source/ZIP replay and English Draft/Wiki.
