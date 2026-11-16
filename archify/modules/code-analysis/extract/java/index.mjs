import path from 'node:path';
import { projectScope } from './projects.mjs';
import { listFiles } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { parseSources, PARSER, isJavaSource } from './parse.mjs';
import { resolveImports, describeUnit } from './imports.mjs';
import { collectFunctionsAndCalls, resolveQualifiedCalls, CALL_MODEL } from './calls.mjs';
import { enrichCallsWithJdk } from './semantic.mjs';
import { fail } from '../shared/diagnostics.mjs';

export const id = 'java';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 13;
export const detect = (root, config) => listFiles(root, config).some(isJavaSource);
export const countSources = (root, config) => listFiles(root, config).filter(isJavaSource).length;

export function extract(root, config, { onCapture } = {}) {
  if (config.java !== undefined && (config.java === null || typeof config.java !== 'object' || Array.isArray(config.java)
    || Object.keys(config.java).some(key => !['semantic', 'release'].includes(key))
    || (config.java.semantic !== undefined && typeof config.java.semantic !== 'boolean')
    || (config.java.release !== undefined && (!Number.isInteger(config.java.release) || config.java.release < 7 || config.java.release > 99)))) {
    fail('extract/java-config-invalid', 'Java scope accepts java.semantic as a boolean and java.release as an integer from 7 to 99.', {
      subject: { option: 'config.java' }, supportedFixes: ['set an explicit supported Java release or remove the java setting'],
    });
  }
  if (config.java?.release !== undefined && config.java?.semantic !== true) fail('extract/java-config-invalid', 'java.release requires java.semantic: true.', {
    subject: { option: 'config.java.release' }, supportedFixes: ['enable java.semantic or remove java.release'],
  });
  const { files, units, packageMarkers, parse_errors, metadataContents } = parseSources(root, config, unit => ({
    ...describeUnit(unit), ...collectFunctionsAndCalls(unit),
  }));
  const projects = projectScope(metadataContents,packageMarkers);
  const { imports, unresolved, resolveType, qualifierAncestry } = resolveImports(units,projects.sourceSetVisible);
  resolveQualifiedCalls(units, resolveType, qualifierAncestry, projects.evidence);
  const semantic = config.java?.semantic ? enrichCallsWithJdk(units, projects, files, config.java.release ?? null) : null;
  const callModel = semantic ? 'java-static-lexical-v6' : CALL_MODEL;
  const languageScope = projects.scope;
  if (semantic) languageScope.semantic = semantic;
  onCapture?.({ coverage:'source-only',model:callModel,options:{build:languageScope.build,...(semantic ? { semantic } : {})},
    reads:languageScope.metadata.map(input => [path.join(root,input.file),input.sourceText]) });
  return {
    schema_version: 1, callModel,
    repository: { ...describeRepository(root), language: id, adapter: PARSER, adapterRevision: REVISION },
    files, packageMarkers, imports, symbols: [], languageScope,
    functions: units.flatMap(unit => unit.functions), calls: units.flatMap(unit => unit.calls),
    ...(semantic ? { methodDeclarations: units.flatMap(unit => unit.methodDeclarations) } : {}),
    ...(parse_errors.length ? { parse_errors } : {}),
    unresolved,
  };
}
