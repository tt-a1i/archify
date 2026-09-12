import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { LocateError, locateFail } from './error.mjs';
import { expandBraces, matchesGlob, subsumes } from './glob.mjs';

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

export function assertGlobs(ownership) {
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
  };
}

export function classifyPath(filePath, ownership) {
  for (const glob of ownership.excluded || []) {
    if (matchesGlob(glob, filePath)) return { state: 'excluded', matchedGlob: glob };
  }
  const hits = [];
  for (const component of ownership.components) {
    for (const glob of component.globs || []) {
      if (matchesGlob(glob, filePath)) {
        hits.push({ id: component.id, glob });
        break;
      }
    }
  }
  if (hits.length === 0) return { state: 'uncovered' };
  if (hits.length === 1) return { state: 'touched', componentId: hits[0].id, matchedGlob: hits[0].glob };
  return {
    state: 'ambiguous',
    candidates: [...new Set(hits.map((hit) => hit.id))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  };
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
