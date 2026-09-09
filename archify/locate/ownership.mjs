import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { LocateError, locateFail } from './error.mjs';
import { expandBraces, matchesGlob, subsumes } from './glob.mjs';

export const OWNERSHIP_PRESET_NAMES = Object.freeze(['docs', 'tests', 'ci', 'lockfiles', 'generated']);

/**
 * Conservative, language-agnostic noise globs. Locked to locatorVersion 2.
 *
 * `ci` uses root-only `*.yml` / `*.yaml` (single-segment globs). `**\/*.yml`
 * would swallow config/, charts/, and nested workflow trees; `.github/**`
 * already covers GitHub Actions, and `.gitlab-ci.yml` / `.circleci/**` are
 * named explicitly.
 */
export const OWNERSHIP_PRESETS = Object.freeze({
  docs: Object.freeze(['**/*.md', 'docs/**', '**/LICENSE*', '**/NOTICE*']),
  tests: Object.freeze([
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/*_test.go',
    '**/test_*.py',
    '**/testdata/**',
    '**/fixtures/**',
  ]),
  ci: Object.freeze([
    '.github/**',
    '.gitlab-ci.yml',
    '.circleci/**',
    '**/Dockerfile*',
    '*.yml',
    '*.yaml',
  ]),
  lockfiles: Object.freeze([
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/yarn.lock',
    '**/go.sum',
    '**/Cargo.lock',
    '**/poetry.lock',
    '**/uv.lock',
    '**/requirements*.txt',
  ]),
  generated: Object.freeze([
    '**/*.min.js',
    '**/*.map',
    '**/dist/**',
    '**/build/**',
    '**/__generated__/**',
    '**/*.snap',
    '**/*.png',
    '**/*.gif',
    '**/*.webp',
    '**/*.zip',
  ]),
});

export function declaredPresets(ownership) {
  const named = new Set(Array.isArray(ownership?.presets) ? ownership.presets : []);
  return OWNERSHIP_PRESET_NAMES.filter((name) => named.has(name));
}

export function mergePresets(parentPresets, childPresets) {
  const named = new Set([...(parentPresets || []), ...(childPresets || [])]);
  return OWNERSHIP_PRESET_NAMES.filter((name) => named.has(name));
}

export function presetMatchedGlob(name) {
  return `preset:${name}`;
}

export function pathMatchesPreset(filePath, name) {
  const globs = OWNERSHIP_PRESETS[name];
  if (!globs) return false;
  return globs.some((glob) => matchesGlob(glob, filePath));
}

export function matchDeclaredPreset(filePath, ownership) {
  for (const name of declaredPresets(ownership)) {
    if (pathMatchesPreset(filePath, name)) {
      return { state: 'excluded', matchedGlob: presetMatchedGlob(name) };
    }
  }
  return null;
}

export function undeclaredPresetSuggestions(files, ownership) {
  const declared = new Set(declaredPresets(ownership));
  const uncovered = (files || []).filter((file) => file.state === 'uncovered');
  const suggestions = [];
  for (const name of OWNERSHIP_PRESET_NAMES) {
    if (declared.has(name)) continue;
    let count = 0;
    for (const file of uncovered) {
      if (pathMatchesPreset(file.path, name)) count += 1;
    }
    if (count > 0) {
      suggestions.push(`declare presets: ["${name}"] to exclude ${count} uncovered paths`);
    }
  }
  return suggestions;
}

export function defaultOwnershipPath(mapPath) {
  const resolved = path.resolve(mapPath);
  return resolved.toLowerCase().endsWith('.json')
    ? `${resolved.slice(0, -5)}.ownership.json`
    : `${resolved}.ownership.json`;
}

function posixJoin(dir, rel) {
  return path.resolve(dir, rel.split('/').join(path.sep));
}

function sameResolvedPath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return a === b;
  }
}

function mapIds(map) {
  if (Array.isArray(map?.components)) return map.components.map((component) => component.id);
  if (Array.isArray(map?.nodes)) return map.nodes.map((node) => node.id);
  if (Array.isArray(map?.participants)) return map.participants.map((node) => node.id);
  if (Array.isArray(map?.states)) return map.states.map((node) => node.id);
  return [];
}

function mapLabel(map, id) {
  const collections = [map?.components, map?.nodes, map?.participants, map?.states];
  for (const collection of collections) {
    const found = collection?.find((item) => item.id === id);
    if (found?.label) return found.label;
  }
  return id;
}

function assertPresetGlobs() {
  for (const name of OWNERSHIP_PRESET_NAMES) {
    for (const glob of OWNERSHIP_PRESETS[name]) {
      expandBraces(glob);
      matchesGlob(glob, '__archify_glob_probe__');
    }
  }
}

export function assertGlobs(ownership) {
  assertPresetGlobs();
  const globs = [
    ...(ownership.excluded || []),
    ...ownership.components.flatMap((component) => component.globs || []),
  ];
  for (const glob of globs) {
    expandBraces(glob);
    matchesGlob(glob, '__archify_glob_probe__');
  }
}

function readJson(filePath, missingCode, invalidCode, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch (error) {
    locateFail(missingCode, `Could not read ${label}: ${error.message}`, {
      evidence: { path: filePath, reason: error.message },
      supportedFixes: [`create a valid ${label} at the expected path`],
    });
  }
  try {
    return { raw, data: JSON.parse(raw.toString('utf8')) };
  } catch (error) {
    locateFail(invalidCode, `Could not parse ${label}: ${error.message}`, {
      evidence: { path: filePath, reason: error.message },
      supportedFixes: [`repair JSON syntax in ${label}`],
    });
  }
}

function validateOwnershipShape(data, ownershipPath) {
  try {
    validateSchema('ownership', data);
  } catch (error) {
    locateFail('locate/ownership-invalid', error.message, {
      evidence: { path: ownershipPath, reason: error.message },
      supportedFixes: ['repair the ownership sidecar so it matches ownership.schema.json'],
    });
  }
}

function checkComponentAlignment(ownership, map, ownershipPath) {
  const seen = new Set();
  const sidecarIds = [];
  for (const component of ownership.components) {
    if (seen.has(component.id)) {
      locateFail('locate/ownership-duplicate-component', `Ownership sidecar repeats component id "${component.id}".`, {
        subject: { componentId: component.id },
        evidence: { path: ownershipPath },
        supportedFixes: ['keep exactly one sidecar entry per component id'],
      });
    }
    seen.add(component.id);
    sidecarIds.push(component.id);
  }
  const ids = mapIds(map);
  const idSet = new Set(ids);
  for (const id of sidecarIds) {
    if (!idSet.has(id)) {
      locateFail('locate/ownership-unknown-component', `Ownership sidecar names "${id}", which is not in the map.`, {
        subject: { componentId: id },
        evidence: { path: ownershipPath },
        supportedFixes: ['remove the unknown id or add that component to the map'],
      });
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) {
      locateFail('locate/ownership-component-unmapped', `Map component "${id}" has no ownership sidecar entry.`, {
        subject: { componentId: id },
        evidence: { path: ownershipPath },
        supportedFixes: ['add a sidecar entry for every map component id (empty globs are allowed)'],
      });
    }
  }
}

function loadSidecarFile(ownershipPath) {
  const { raw, data } = readJson(ownershipPath, 'locate/ownership-missing', 'locate/ownership-invalid', 'ownership sidecar');
  validateOwnershipShape(data, ownershipPath);
  try {
    assertGlobs(data);
  } catch (error) {
    if (error instanceof LocateError && error.code === 'locate/ownership-glob-invalid') throw error;
    throw error;
  }
  return { raw, data };
}

function checkParentChild(ownership, ownershipPath, mapPath) {
  const sidecarDir = path.dirname(path.resolve(ownershipPath));
  if (ownership.parent) {
    const parentMapPath = posixJoin(sidecarDir, ownership.parent.map);
    const parentOwnershipPath = defaultOwnershipPath(parentMapPath);
    if (!fs.existsSync(parentMapPath)) {
      locateFail('locate/ownership-parent-missing', `Ownership parent map is missing: ${parentMapPath}.`, {
        evidence: { path: parentMapPath },
        supportedFixes: ['create the parent map and sidecar the child.parent pointer names'],
      });
    }
    if (!fs.existsSync(parentOwnershipPath)) {
      locateFail('locate/ownership-parent-missing', `Ownership parent sidecar is missing: ${parentOwnershipPath}.`, {
        evidence: { path: parentOwnershipPath },
        supportedFixes: ['create the parent ownership sidecar next to the parent map'],
      });
    }
    const parent = loadSidecarFile(parentOwnershipPath).data;
    const parentComp = parent.components.find((component) => component.id === ownership.parent.component);
    const expectedChild = parentComp?.child_map
      ? posixJoin(path.dirname(parentOwnershipPath), parentComp.child_map)
      : null;
    if (!parentComp || !expectedChild || !sameResolvedPath(expectedChild, mapPath)) {
      locateFail('locate/ownership-parent-mismatch', 'Ownership parent/child_map pointers do not refer to each other.', {
        evidence: {
          childParent: ownership.parent,
          parentChildMap: parentComp?.child_map || null,
        },
        supportedFixes: ['make parent.component.child_map and child.parent a mutual pair'],
      });
    }
    for (const failure of validateChildOwnershipSubset(parent, ownership.parent.component, ownership)) {
      locateFail(failure.code, failure.message, {
        subject: { componentId: ownership.parent.component },
        evidence: { childGlob: failure.glob, parentGlobs: parentComp.globs || [] },
        supportedFixes: ['rewrite the child glob as a literal extension of a parent glob, or narrow the parent glob'],
      });
    }
  }

  for (const component of ownership.components) {
    if (!component.child_map) continue;
    const childMapPath = posixJoin(sidecarDir, component.child_map);
    const childOwnershipPath = defaultOwnershipPath(childMapPath);
    if (!fs.existsSync(childOwnershipPath)) continue;
    const child = loadSidecarFile(childOwnershipPath).data;
    const childParentMap = child.parent?.map
      ? posixJoin(path.dirname(childOwnershipPath), child.parent.map)
      : null;
    if (!child.parent || child.parent.component !== component.id || !childParentMap || !sameResolvedPath(childParentMap, mapPath)) {
      locateFail('locate/ownership-parent-mismatch', 'Ownership parent/child_map pointers do not refer to each other.', {
        evidence: { componentId: component.id, childParent: child.parent || null },
        supportedFixes: ['make parent.component.child_map and child.parent a mutual pair'],
      });
    }
    for (const failure of validateChildOwnershipSubset(ownership, component.id, child)) {
      locateFail(failure.code, failure.message, {
        subject: { componentId: component.id },
        evidence: { childGlob: failure.glob, parentGlobs: component.globs || [] },
        supportedFixes: ['rewrite the child glob as a literal extension of a parent glob, or narrow the parent glob'],
      });
    }
  }
}

export function loadOwnership({ ownershipPath, mapPath, map }) {
  const resolvedOwnership = path.resolve(ownershipPath);
  const resolvedMap = path.resolve(mapPath);
  const { raw, data } = loadSidecarFile(resolvedOwnership);
  const declaredMap = posixJoin(path.dirname(resolvedOwnership), data.map);
  if (!sameResolvedPath(declaredMap, resolvedMap)) {
    locateFail('locate/ownership-map-mismatch', 'Ownership sidecar map path does not resolve to --map.', {
      evidence: { declaredMap, map: resolvedMap, sidecarMap: data.map },
      supportedFixes: ['set ownership.map to a directory-relative path that resolves to the --map file'],
    });
  }
  checkComponentAlignment(data, map, resolvedOwnership);
  checkParentChild(data, resolvedOwnership, resolvedMap);
  return {
    ownership: data,
    raw,
    sha256: createHash('sha256').update(raw).digest('hex'),
    path: resolvedOwnership,
  };
}

export function validateChildOwnershipSubset(parentSidecar, parentComponentId, childSidecar, code = 'locate/ownership-not-subset') {
  const parentComp = (Array.isArray(parentSidecar?.components) ? parentSidecar.components : [])
    .find((component) => component.id === parentComponentId);
  const parentGlobs = parentComp?.globs || [];
  const childComponents = Array.isArray(childSidecar?.components) ? childSidecar.components : [];
  const childGlobs = [
    ...(Array.isArray(childSidecar?.excluded) ? childSidecar.excluded : []),
    ...childComponents.flatMap((component) => component.globs || []),
  ];
  const failures = [];
  const childPresets = Array.isArray(childSidecar?.presets) ? childSidecar.presets : [];
  if (childPresets.length) {
    const parentSet = new Set(Array.isArray(parentSidecar?.presets) ? parentSidecar.presets : []);
    for (const name of childPresets) {
      if (!parentSet.has(name)) {
        failures.push({
          code,
          message: `Child preset ${JSON.stringify(name)} is not a subset of the parent sidecar presets.`,
          glob: presetMatchedGlob(name),
        });
      }
    }
  }
  for (const glob of childGlobs) {
    const covered = parentGlobs.some((parentGlob) => {
      try {
        return parentGlob === glob || subsumes(parentGlob, glob);
      } catch {
        return false;
      }
    });
    if (!covered) {
      failures.push({
        code,
        message: `Child glob ${JSON.stringify(glob)} is not a syntactic subset of parent component "${parentComponentId}" globs.`,
        glob,
      });
    }
  }
  return failures;
}

export function inheritParentExcluded(parentSidecar, childSidecar) {
  if (!childSidecar) return childSidecar;
  return {
    ...childSidecar,
    excluded: [...(parentSidecar?.excluded || []), ...(childSidecar.excluded || [])],
    presets: mergePresets(parentSidecar?.presets, childSidecar?.presets),
  };
}

export function classifyPath(filePath, ownership) {
  // Explicit excluded still applies first so inheritParentExcluded keeps carving
  // generated/lockfile paths out of a child's broad directory glob.
  for (const glob of ownership.excluded || []) {
    if (matchesGlob(glob, filePath)) return { state: 'excluded', matchedGlob: glob };
  }
  const hits = [];
  for (const component of ownership.components || []) {
    for (const glob of component.globs || []) {
      if (matchesGlob(glob, filePath)) {
        hits.push({ id: component.id, glob });
        break;
      }
    }
  }
  if (hits.length === 1) return { state: 'touched', componentId: hits[0].id, matchedGlob: hits[0].glob };
  if (hits.length > 1) {
    return {
      state: 'ambiguous',
      candidates: [...new Set(hits.map((hit) => hit.id))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    };
  }
  // Ownership beats presets: an owned test file stays touched. Undeclared presets do nothing.
  const preset = matchDeclaredPreset(filePath, ownership);
  if (preset) return preset;
  return { state: 'uncovered' };
}

export function componentLabel(map, id) {
  return mapLabel(map, id);
}

export function loadChildOwnership(parentOwnershipPath, childMapRef) {
  const childMapPath = posixJoin(path.dirname(path.resolve(parentOwnershipPath)), childMapRef);
  const childOwnershipPath = defaultOwnershipPath(childMapPath);
  if (!fs.existsSync(childOwnershipPath)) return null;
  const { raw, data } = loadSidecarFile(childOwnershipPath);
  return {
    ownership: data,
    raw,
    sha256: createHash('sha256').update(raw).digest('hex'),
    path: childOwnershipPath,
    mapPath: childMapPath,
  };
}
