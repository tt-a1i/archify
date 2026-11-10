import path from 'node:path';
import { projectScope } from './projects.mjs';
import { listFiles } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { parseSources, PARSER, isJavaSource } from './parse.mjs';
import { resolveImports, describeUnit } from './imports.mjs';
import { collectFunctionsAndCalls, resolveQualifiedCalls, CALL_MODEL } from './calls.mjs';

export const id = 'java';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 11;
export const detect = (root, config) => listFiles(root, config).some(isJavaSource);
export const countSources = (root, config) => listFiles(root, config).filter(isJavaSource).length;

export function extract(root, config, { onCapture } = {}) {
  const { files, units, packageMarkers, parse_errors, metadataContents } = parseSources(root, config, unit => ({
    ...describeUnit(unit), ...collectFunctionsAndCalls(unit),
  }));
  const { imports, unresolved, resolveType, qualifierAncestry } = resolveImports(units);
  const projects = projectScope(metadataContents,packageMarkers);
  resolveQualifiedCalls(units, resolveType, qualifierAncestry, projects.evidence);
  const languageScope = projects.scope;
  onCapture?.({ coverage:'source-only',model:CALL_MODEL,options:{build:languageScope.build},
    reads:languageScope.metadata.map(input => [path.join(root,input.file),input.sourceText]) });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: PARSER, adapterRevision: REVISION },
    files, packageMarkers, imports, symbols: [], languageScope,
    functions: units.flatMap(unit => unit.functions), calls: units.flatMap(unit => unit.calls),
    ...(parse_errors.length ? { parse_errors } : {}),
    unresolved,
  };
}
