import path from 'node:path';
export const code = 'organization/generic-name';
export const dimension = 'organization';
export const severity = 'warning';
export const version = 1;
export const confidence = 0.7;
export const enabled = (config, facts) => config?.rules?.organization?.genericName?.enabled === true && Boolean(facts?.files?.length);
export function run({ graph, facts }) {
  const excluded = new Set(graph?.excluded?.roles || []);
  return (facts?.files || []).filter((file) => !excluded.has(file.role) && /^(?:util|utils|helper|helpers|misc|common)(?:\.[^.]+)?$/i.test(path.posix.basename(file.path))).map((file) => ({
    code, dimension, severity, confidence, message: `${file.path} matches a generic basename. Check whether a more specific name would help readers.`,
    subject: { file: file.path }, evidence: { threshold: null, path: file.path, bytes: Buffer.byteLength(file.sourceText || '') },
    supportedFixes: ['rename the file to describe its responsibility', 'keep a generic name only when the file has a documented, intentionally broad contract'],
  }));
}
