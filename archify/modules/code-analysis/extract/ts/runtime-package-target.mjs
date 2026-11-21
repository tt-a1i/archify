// Bounded correction for TS5's conditional-null package-map ambiguity.
// Select a target from captured metadata; never search for/load the target here.
import path from 'node:path';
import ts from 'typescript';

const NO_MATCH = { status: 'no-match' };
const BLOCKED = { status: 'blocked' };
const INVALID = { status: 'invalid-target' };
const UNSUPPORTED = { status: 'unsupported' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundary = value => value === null || (Array.isArray(value) && !value.length)
  || (value !== null && typeof value === 'object' && Object.values(value).some(boundary));

export function runtimePackageTarget(record, file, root, options, inputs, resolutionMode) {
  if (record.typeOnly || !/\.[cm]?js$/.test(file)
    || ![ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext].includes(options.moduleResolution)) return null;
  const internal = record.specifier.startsWith('#');
  if (!internal && (record.specifier.startsWith('.') || record.specifier.startsWith('/') || record.specifier.includes(':'))) return null;
  if (internal ? options.resolvePackageJsonImports === false : options.resolvePackageJsonExports === false) return null;
  // A nearer package (even one without these maps) ends the package scope.
  let dir = path.dirname(file), manifest;
  while (true) {
    const relative = path.relative(root, dir);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const packageFile = path.join(dir, 'package.json');
    if (inputs.fileExists(packageFile)) {
      try { manifest = JSON.parse(inputs.readFile(packageFile)); } catch { return null; }
      break;
    }
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
  if (!object(manifest)) return null;
  let map, key, target;
  if (internal) {
    map = manifest.imports; key = record.specifier;
    if (!object(map)) return null;
  } else {
    const name = manifest.name;
    if (typeof name !== 'string' || (record.specifier !== name && !record.specifier.startsWith(`${name}/`))
      || !Object.hasOwn(manifest, 'exports')) return null;
    key = record.specifier === name ? '.' : `.${record.specifier.slice(name.length)}`;
    map = manifest.exports;
    if (!object(map) || !Object.keys(map).some(k => k.startsWith('.'))) {
      if (key !== '.') return null;
      target = map;
      map = null;
    }
  }
  if (map) {
    if (!Object.hasOwn(map, key)) {
      // Pattern selection is outside this helper. Do not guess a runtime file
      // when a matching pattern can encounter the same null boundary.
      return Object.entries(map).some(([pattern, value]) => pattern.includes('*')
        && key.startsWith(pattern.slice(0, pattern.indexOf('*')))
        && key.endsWith(pattern.slice(pattern.lastIndexOf('*') + 1)) && boundary(value)) ? UNSUPPORTED : null;
    }
    target = map[key];
  }
  if (!boundary(target)) return null; // Unrelated keys stay on the existing TS path.
  if (key.includes('*') || (internal && (key === '#' || key.startsWith('#/')))
    || (!internal && map && Object.keys(map).some(k => !k.startsWith('.')))) return UNSUPPORTED;
  const mode = record.kind === 'require' ? 'require' : record.kind === 'dynamic' ? 'import'
    : resolutionMode === ts.ModuleKind.ESNext ? 'import' : resolutionMode === ts.ModuleKind.CommonJS ? 'require' : null;
  if (!mode) return UNSUPPORTED;
  return select(target, new Set(['node', mode, ...(options.customConditions || [])]), dir, internal);
}

function select(target, conditions, dir, internal) {
  if (target === null) return BLOCKED;
  if (Array.isArray(target)) {
    if (!target.length) return BLOCKED;
    let last = NO_MATCH;
    for (const value of target) {
      const result = select(value, conditions, dir, internal);
      if (result.status === 'no-match') continue;
      if (result.status === 'blocked' || result.status === 'invalid-target') { last = result; continue; }
      // A selected missing/excluded file, or unsupported valid target form,
      // must not cause selection of a different array alternative.
      return result;
    }
    return last;
  }
  if (object(target)) {
    const keys = Object.keys(target);
    if (keys.some(k => /^(0|[1-9]\d*)$/.test(k) && Number(k) < 0xffffffff)) return UNSUPPORTED;
    for (const key of keys) {
      // Node runtime feature conditions exceed this explicitly limited policy.
      if (key === 'node-addons' || key === 'module-sync') return UNSUPPORTED;
      if (key === 'default' || conditions.has(key)) {
        const result = select(target[key], conditions, dir, internal);
        if (result.status !== 'no-match') return result;
      }
    }
    return NO_MATCH;
  }
  if (typeof target !== 'string') return INVALID;
  if (!target.startsWith('./')) {
    // Bare internal redirects may be valid package targets, unlike exports.
    return !internal || target.startsWith('../') || target.startsWith('/')
      || /^[a-z][a-z\d+.-]*:/i.test(target) ? INVALID : UNSUPPORTED;
  }
  // URL escapes/fragments, legacy separators and non-JS endpoints are valid
  // forms this source-file selector does not model; arrays must stop here.
  if (/[\\%?#*]/.test(target)) return UNSUPPORTED;
  const parts = target.slice(2).split('/');
  if (parts.some(p => ['.', '..', 'node_modules'].includes(p.toLowerCase()))) return INVALID;
  if (parts.some(p => !p) || !/\.[cm]?js$/.test(target)) return UNSUPPORTED;
  return { status: 'selected', file: path.resolve(dir, target) };
}
