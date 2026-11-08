import { listFiles, JAVA_BUILD_MARKERS } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { parseSources, PARSER, isJavaSource } from './parse.mjs';
import { resolveImports, describeUnit } from './imports.mjs';
import { collectFunctionsAndCalls, resolveQualifiedCalls, CALL_MODEL } from './calls.mjs';

export const id = 'java';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 10;
export const detect = (root, config) => listFiles(root, config).some(isJavaSource);
export const countSources = (root, config) => listFiles(root, config).filter(isJavaSource).length;

export function extract(root, config) {
  const { files, units, packageMarkers, parse_errors } = parseSources(root, config, unit => ({
    ...describeUnit(unit), ...collectFunctionsAndCalls(unit),
  }));
  const { imports, unresolved, resolveType, qualifierAncestry } = resolveImports(units);
  // Marker roots bound the new inherited-context proof, not a Maven/Gradle
  // classpath resolver. Co-located sibling projects can supply the same FQCN.
  const buildRoots = packageMarkers.filter(file => JAVA_BUILD_MARKERS.includes(file.slice(file.lastIndexOf('/') + 1)))
    .map(file => file.slice(0, file.lastIndexOf('/') + 1)).sort((a, b) => b.length - a.length);
  const buildRoot = file => buildRoots.find(prefix => file.startsWith(prefix)) || '';
  const sameBuildRoot = (caller, points) => points.every(point => buildRoot(point.file) === buildRoot(caller));
  resolveQualifiedCalls(units, resolveType, qualifierAncestry, sameBuildRoot);
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: PARSER, adapterRevision: REVISION },
    files, packageMarkers, imports, symbols: [],
    functions: units.flatMap(unit => unit.functions), calls: units.flatMap(unit => unit.calls),
    ...(parse_errors.length ? { parse_errors } : {}),
    unresolved,
  };
}
