import { duplicateOptions, DUPLICATE_RULE } from '../../../lib/duplicates.mjs';

export const code = DUPLICATE_RULE;
export const dimension = 'redundancy';
export const severity = 'warning';
export const confidence = 1;
export const version = 1;

export function enabled(config) {
  return Boolean(duplicateOptions(config));
}

export function run({ duplicates }) {
  return (duplicates?.pairs || []).map(pair => ({
    code, dimension, severity, confidence,
    message: `${pair.tokens} tokens match in ${pair.locations.map(l => `${l.file}:${l.line}`).join(' and ')} (${pair.kind}). Review whether the repeated code should change together; a match does not prove a defect.`,
    subject: { files: [...new Set(pair.locations.map(l => l.file))].sort(), locations: pair.locations },
    evidence: { threshold: { minTokens: duplicates.analysis.settings.minTokens, minLines: duplicates.analysis.settings.minLines },
      engine: duplicates.analysis.engine, identifiers: duplicates.analysis.settings.identifiers,
      kind: pair.kind, tokens: pair.tokens, lines: pair.lines },
    supportedFixes: [
      'compare both source ranges and their callers before deciding whether the repetition is intentional',
      'if both copies implement the same contract, share that behavior with tests preserving the differences that matter',
      'retain intentional copies with an explained baseline acceptance instead of changing detection settings to hide them',
    ],
  }));
}
