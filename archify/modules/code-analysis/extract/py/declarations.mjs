// Explicit, read-only dependency declarations. Never discover a host interpreter
// or execute/import a package. Dependency bodies are not project facts/targets.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { snapshotFiles } from '../shared/files.mjs';
import { fail } from '../shared/diagnostics.mjs';
import { analyzeFile } from './analyze.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function captureDeclarations(root, configured = {}, targetVersion, projectFiles) {
  const invalid = reason => fail('extract/python-declarations', reason, { subject: { setting: 'python.declarations' },
    supportedFixes: ['map a Python module name to an existing package directory or .py/.pyi declaration file, relative to the analyzed root or absolute'] });
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) invalid('python.declarations must be an object of explicit module-to-path mappings.');
  const packages = Object.keys(configured).sort();
  for (const name of packages) {
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name) || typeof configured[name] !== 'string' || !configured[name]) invalid('Each declaration mapping needs a module name and a nonempty path.');
    if (packages.some(other => other !== name && name.startsWith(`${other}.`))) invalid('Declaration package names must not overlap.');
  }
  const analyses = [], declarations = [], modules = new Map(), origins = new Map();
  for (const module of packages) {
    const location = path.resolve(root, configured[module]);
    let stat;
    try { stat = fs.statSync(location); } catch { invalid(`Declaration path does not exist for ${module}.`); }
    const directory = stat.isDirectory();
    if (!directory && (!stat.isFile() || !/\.pyi?$/.test(location))) invalid(`Declaration path must be a package directory or Python declaration file for ${module}.`);
    const sourceRoot = fs.realpathSync(directory ? location : path.dirname(location));
    const snapshot = snapshotFiles(sourceRoot, {
      include: ['**/*.py', '**/*.pyi'],
      exclude: directory ? ['**/__pycache__/**'] : ['*/'],
    }, name => directory || name === path.basename(location));
    if (!snapshot.size) invalid(`No Python declarations were captured for ${module}.`);
    const inputs = [];
    for (const [file, bytes] of snapshot) {
      const relative = path.relative(root, path.join(sourceRoot, file)).split(path.sep).join('/');
      if (projectFiles.has(relative)) invalid(`Declaration input for ${module} is also a captured project file. Exclude it from project analysis or supply a separate declaration path.`);
      const key = `\0${module}/${file}`;
      const analysis = analyzeFile(key, bytes, targetVersion, true);
      analyses.push(analysis);
      inputs.push({ file, sha256: digest(bytes), ...(analysis.record.error ? { parseError: true } : {}) });
      const packageFile = /(?:^|\/)__init__\.pyi?$/.test(file);
      const suffix = directory ? file.replace(/(?:^|\/)__init__\.pyi?$|\.pyi?$/g, '').replaceAll('/', '.') : '';
      const name = suffix ? `${module}.${suffix}` : module;
      const candidates = modules.get(name) || [];
      candidates.push({ file: key, packageFile, stem: file.replace(/\.pyi?$/, ''), stub: file.endsWith('.pyi') });
      modules.set(name, candidates);
      origins.set(key, { module: name, packageFile });
    }
    declarations.push({ module, files: inputs });
  }
  const uniqueModule = name => {
    const all = modules.get(name) || [];
    const preferred = all.filter(candidate => candidate.stub || !all.some(other => other.stub && other.stem === candidate.stem));
    if (preferred.length !== 1) return;
    const parts = name.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parents = modules.get(parts.slice(0, i).join('.')) || [];
      if (parents.some(parent => !parent.packageFile)) return;
    }
    return preferred[0];
  };
  const locate = (from, module, level, name) => {
    if (level) {
      const origin = origins.get(from); if (!origin) return;
      const parts = origin.module.split('.');
      const trim = level - (origin.packageFile ? 1 : 0);
      if (trim >= parts.length) return;
      module = [...parts.slice(0, parts.length - trim), ...module.split('.').filter(Boolean)].join('.');
    }
    const submodule = name && uniqueModule(`${module}.${name}`);
    if (submodule) return { file: submodule.file, module: true };
    const target = uniqueModule(module);
    return target && { file: target.file, module: !name };
  };
  return { analyses, origins, locate, scope: { language: 'py', declarations, limitations: [
    'Dependency declarations are explicit captured type inputs, not project files or executable imports. Only project source declarations become call targets.',
    'Captured signatures support bounded generic propagation; dependency execution, full overload applicability and current external-file re-resolution are not established.',
  ] } };
}
