import path from 'node:path';
import { analyzedFiles, confidence, enabled } from './helpers.mjs';
export const code = 'organization/generic-name';
export const dimension = 'organization';
export const severity = 'warning';
export const version = 1;
export const enabledRule = (config, facts) => enabled(config, 'genericName', facts);
export { enabledRule as enabled };
export function run({ graph, facts }) {
  return analyzedFiles(graph, facts).filter((file) => /^(?:util|utils|helper|helpers|misc|common)(?:\.[^.]+)?$/i.test(path.posix.basename(file.path))).map((file) => ({
    code, dimension, severity, confidence, message: `${file.path} uses a generic name that does not describe its responsibility.`,
    subject: { file: file.path }, evidence: { threshold: null, path: file.path, bytes: Buffer.byteLength(file.sourceText || '') },
    supportedFixes: ['rename the file to describe its responsibility', 'keep a generic name only when the file has a documented, intentionally broad contract'],
  }));
}
