// The jscpd runner moved to evaluate/rules/redundancy/jscpd.mjs: it is part of
// evaluation, and evaluate/ must not import lib/ (lib builds on evaluate).
// Kept for existing callers, through evaluate's entry file.
export { analyzeDuplicates, duplicateOptions, DUPLICATE_RULE, JSCPD_VERSION } from '../evaluate/index.mjs';
