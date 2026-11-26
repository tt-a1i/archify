import path from 'node:path';
import { projectScope } from './projects.mjs';
import { listFiles } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { parseSources, PARSER, isKotlinSource } from './parse.mjs';
import { describeUnit } from './describe.mjs';
import { resolveImports } from './imports.mjs';
import { measureFunctions } from './functions.mjs';
import { collectCalls, CALL_MODEL } from './calls.mjs';

export const id = 'kotlin';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 1;
export const detect = (root, config) => listFiles(root, config).some(isKotlinSource);
export const countSources = (root, config) => listFiles(root, config).filter(isKotlinSource).length;

export function extract(root, config, { onCapture } = {}) {
  const described = [];
  const { files, units, packageMarkers, parse_errors, metadataContents } = parseSources(root, config, unit => {
    const description = describeUnit(unit);
    described.push({ ...description, declarations: unit.declarations, imports: unit.imports });
    return { ...unit, description };
  });
  const projects = projectScope(metadataContents, packageMarkers);
  const resolveUnits = described.map(d => ({
    file: d.file, packageName: d.packageName, imports: d.imports, types: d.types,
    references: d.references, shadowed: d.shadowed, shadowedScopes: d.shadowedScopes, topLevel: d.topLevel,
  }));
  const { imports, unresolved, resolveType } = resolveImports(resolveUnits, projects.sourceSetVisible);
  const functions = units.flatMap(unit => measureFunctions(unit));
  const calls = units.flatMap((unit, i) => collectCalls({ file: unit.file, declarations: unit.declarations, imports: unit.imports }, described[i]));
  const languageScope = projects.scope;
  onCapture?.({
    coverage: 'source-only', model: CALL_MODEL, options: { build: languageScope.build },
    reads: [],
  });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: PARSER, adapterRevision: REVISION },
    files, packageMarkers, imports, symbols: [], languageScope,
    functions, calls,
    ...(parse_errors.length ? { parse_errors } : {}),
    unresolved,
  };
}
