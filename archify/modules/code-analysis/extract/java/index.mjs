import { listFiles } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { parseSources, PARSER, isJavaSource } from './parse.mjs';
import { resolveImports, describeUnit } from './imports.mjs';
import { measureFunctions } from './functions.mjs';

export const id = 'java';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 3;
export const detect = (root, config) => listFiles(root, config).some(isJavaSource);
export const countSources = (root, config) => listFiles(root, config).filter(isJavaSource).length;

export function extract(root, config) {
  const { files, units, packageMarkers, parse_errors } = parseSources(root, config, unit => ({
    ...describeUnit(unit), functions: measureFunctions(unit),
  }));
  const { imports, unresolved } = resolveImports(units);
  return {
    schema_version: 1,
    repository: { ...describeRepository(root), language: id, adapter: PARSER, adapterRevision: REVISION },
    files, packageMarkers, imports, symbols: [],
    functions: units.flatMap(unit => unit.functions), calls: [],
    ...(parse_errors.length ? { parse_errors } : {}),
    unresolved,
  };
}
