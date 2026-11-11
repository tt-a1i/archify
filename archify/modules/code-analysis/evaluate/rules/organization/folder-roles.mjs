import path from 'node:path';
import { analyzedFiles, confidence, enabled, roleEvidence } from './helpers.mjs';
export const code = 'organization/folder-roles';
export const dimension = 'organization';
export const severity = 'warning';
export const version = 1;
export const enabledRule = (config, facts) => enabled(config, 'folderRoles', facts);
export { enabledRule as enabled };
export function run({ graph, facts }) {
  const folders = new Map();
  for (const file of analyzedFiles(graph, facts)) {
    const folder = path.posix.dirname(file.path);
    const evidence = roleEvidence(file);
    const roles = new Set(evidence.map((entry) => entry.role));
    if (!folders.has(folder)) folders.set(folder, new Map());
    for (const role of roles) { if (!folders.get(folder).has(role)) folders.get(folder).set(role, []); folders.get(folder).get(role).push({ file: file.path, triggers: evidence.filter((entry) => entry.role === role) }); }
  }
  return [...folders].filter(([, roles]) => roles.size >= 3).map(([folder, roles]) => ({
    code, dimension, severity, confidence, message: `${folder} contains files matching ${roles.size} role patterns.`,
    subject: { directory: folder }, evidence: { threshold: null, roles: Object.fromEntries([...roles].sort().map(([role, files]) => [role, files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)])) },
    supportedFixes: ['review whether the directory boundary matches ownership and change patterns', 'keep mixed responsibilities together when the project convention makes the boundary intentional'],
  }));
}
