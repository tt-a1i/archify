// Dependency-free helpers every stage shares: structured failures, path
// validation, glob matching and exact source ranges. Stages import them from here; nothing in
// this folder may import a stage or a third-party package, so the entry points
// in bin/ can load it before the module's dependencies are installed.
export { DiagnosticError, fail, receipt } from './diagnostics.mjs';
export * from './glob.mjs';
export { isRepositoryRelativePath } from './repository-path.mjs';
export * from './source-range.mjs';
export { createRangeDigest, findRanges, rangeDigest, splitLines } from './line-ranges.mjs';
