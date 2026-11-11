import { analyzedFiles, confidence, enabled, roleEvidence } from './helpers.mjs';
export const code = 'organization/mixed-roles';
export const dimension = 'organization';
export const severity = 'warning';
export const version = 1;
export const enabledRule = (config, facts) => enabled(config, 'mixedRoles', facts);
export { enabledRule as enabled };
export function run({ graph, facts }) {
  return analyzedFiles(graph, facts).map((file) => ({ file, evidence: roleEvidence(file), roles: new Set(roleEvidence(file).map((entry) => entry.role)) })).filter(({ roles }) => roles.has('entry') && roles.has('io') && (roles.has('view') || roles.has('model'))).map(({ file, roles, evidence }) => ({
    code, dimension, severity, confidence, message: `${file.path} matches entry/IO and ${roles.has('view') ? 'view' : 'model'} role patterns.`,
    subject: { file: file.path }, evidence: { threshold: null, roles: [...roles].sort(), triggers: evidence },
    supportedFixes: ['separate the entry/IO boundary from view or domain logic when the responsibilities change independently'],
  }));
}
