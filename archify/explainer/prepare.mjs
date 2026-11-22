import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseExplainer } from './parse.mjs';
import { validateExplainer } from './validate.mjs';
import { resolveExplainerSources } from './sources.mjs';
import { parseInline } from './inline.mjs';
import { prepareExplainerDiagrams, validateExplainerDiagramTarget } from './diagrams.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const identity = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) });
const digest = bundle => identity(JSON.stringify({ ...bundle, digest: undefined })).sha256;
function fail(code, message, input, reason, example = 'Retry from the unchanged original draft and local resources.') {
  throwDiagnosticError(message, [{ code: `explainer/${code}`, severity: 'error', message,
    subject: { input, line: 1, component: 'document' }, evidence: { reason, example }, supportedFixes: [example] }]);
}
export function parseValidatedExplainer(sourceText, options = {}) {
  if (Buffer.byteLength(sourceText) > MAX_SOURCE_BYTES) fail('source-limit', 'Explainer draft exceeds the 16 MiB source budget.', options.inputPath, 'source-byte-limit', 'Reduce the draft below 16 MiB and use relative native diagram sources for large specifications.');
  const parsed = parseExplainer(sourceText, { inputPath: options.inputPath, output: options.output });
  if (!parsed.document || parsed.diagnostics.some(entry => entry.severity !== 'warning')) {
    throwDiagnosticError('Explainer draft could not be parsed.', parsed.diagnostics);
  }
  const validated = validateExplainer(parsed.document, { sourceMap: parsed.sourceMap, inputPath: options.inputPath, writingMode: options.writingMode });
  if (!validated.ok) throwDiagnosticError('Explainer draft is invalid.', validated.diagnostics);
  return { ...parsed, diagnostics: [...parsed.diagnostics, ...validated.diagnostics] };
}

// Discover declared inputs before reading their contents: failed preparation
// must not overwrite the very JSON resource that made preparation fail.
export function declaredExplainerInputPaths(sourceText, inputPath) {
  if (Buffer.byteLength(sourceText) > MAX_SOURCE_BYTES) fail('source-limit', 'Explainer draft exceeds the 16 MiB source budget.', inputPath, 'source-byte-limit');
  const parsed = parseExplainer(sourceText, { inputPath });
  if (!parsed.document || parsed.diagnostics.some(entry => entry.severity !== 'warning')) throwDiagnosticError('Explainer inputs could not be inspected.', parsed.diagnostics);
  const inputs = [path.resolve(inputPath)];
  for (const panel of Array.isArray(parsed.document.panels) ? parsed.document.panels : []) {
    for (const block of Array.isArray(panel?.blocks) ? panel.blocks : []) {
      const reference = block?.type === 'chart' ? block.data?.path : block?.type === 'diagram' ? block.source : undefined;
      if (typeof reference === 'string') inputs.push(path.resolve(path.dirname(inputPath), reference));
    }
  }
  return [...new Set(inputs)];
}

export async function prepareExplainer(sourceText, options = {}) {
  const inputPath = path.resolve(options.inputPath);
  const parsed = parseValidatedExplainer(sourceText, { ...options, inputPath });
  const baseDir = options.baseDir || path.dirname(inputPath);
  const quality = options.quality || parsed.document.meta?.quality_profile || 'standard';
  const common = { repoRoot: options.repoRoot, baseDir, sourceMap: parsed.sourceMap, sourcePath: inputPath, quality };
  const preparedSources = await resolveExplainerSources(parsed.document, common);
  const preparedDiagrams = await prepareExplainerDiagrams(parsed.document, common);
  validatePreparedTargets(parsed.document, preparedDiagrams.diagrams, common);
  const dependencies = [...(preparedSources.dependencies || []), ...(preparedDiagrams.dependencies || [])].map(entry => ({ ...entry, id: entry.id || entry.blockId,
    ...(entry.kind === 'repository' || entry.inline ? {} : { path: path.resolve(baseDir, entry.path) }) }));
  const bundle = { schemaVersion: 1, kind: 'archify-explainer-prepared', ...parsed, sourcePath: inputPath, baseDir,
    quality, writingMode: options.writingMode || 'warn', source: identity(Buffer.from(sourceText)),
    preparedSources: { sources: preparedSources.sources, assets: preparedSources.assets, ...(Object.keys(preparedSources.charts || {}).length ? { charts: preparedSources.charts } : {}), ...(preparedSources.repository ? { repository: preparedSources.repository } : {}) },
    preparedDiagrams: { diagrams: preparedDiagrams.diagrams }, dependencies };
  bundle.digest = digest(bundle);
  assertPreparedDependencies(bundle);
  return bundle;
}
export function assertPreparedDependencies(bundle) {
  for (const dependency of bundle.dependencies || []) {
    // Repository excerpts were read from the pinned Git object, never the mutable checkout.
    if (dependency.kind === 'repository' || dependency.inline || dependency.retained) {
      if (typeof dependency.contentBase64 === 'string') {
        const frozen = identity(Buffer.from(dependency.contentBase64, 'base64'));
        if (frozen.sha256 !== dependency.sha256 || frozen.bytes !== dependency.bytes) fail('prepared-mismatch', 'Frozen resource bytes do not match their identity.', bundle.sourcePath, 'frozen-resource-byte-mismatch');
      } else if (dependency.retained) fail('prepared-invalid', 'Retained resources require their original frozen bytes.', bundle.sourcePath, 'missing-frozen-resource');
      continue;
    }
    let actual;
    try { actual = identity(fs.readFileSync(dependency.path)); } catch (error) {
      fail('dependency-changed', 'A frozen explainer resource is no longer readable.', bundle.sourcePath, error.code || 'read-failed');
    }
    if (actual.sha256 !== dependency.sha256 || actual.bytes !== dependency.bytes) {
      fail('dependency-changed', 'An explainer resource changed during preparation.', bundle.sourcePath, 'frozen-resource-byte-mismatch');
    }
  }
}
export function writePreparedBundle(directory, bundle) {
  const file = path.join(directory, 'explainer.prepared.json');
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.length > MAX_BUNDLE_BYTES) fail('resource-limit', 'Prepared explainer exceeds the resource budget.', bundle.sourcePath, 'bundle-byte-limit');
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return file;
}
export function readPreparedBundle(file, sourceText, inputPath, { checkDependencies = true, expectedInputPath = inputPath, quality, writingMode } = {}) {
  let bundle;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('bundle-byte-limit');
    bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { fail('prepared-invalid', 'Prepared explainer could not be read.', inputPath, error.code || 'invalid-bundle'); }
  const canonical = value => { try { return fs.realpathSync.native(path.resolve(value)); } catch { return path.resolve(value); } };
  if (typeof (bundle.inputPath || bundle.sourcePath) !== 'string' || canonical(bundle.inputPath || bundle.sourcePath) !== canonical(expectedInputPath)) {
    fail('prepared-mismatch', 'Prepared explainer belongs to a different author input path.', inputPath, 'draft-path-mismatch');
  }
  const source = identity(Buffer.from(sourceText));
  if (bundle?.kind !== 'archify-explainer-prepared' || bundle.schemaVersion !== 1 || bundle.digest !== digest(bundle)
    || source.sha256 !== bundle.source?.sha256 || source.bytes !== bundle.source?.bytes || bundle.sourceText !== sourceText) {
    fail('prepared-mismatch', 'Prepared explainer does not match the original draft bytes.', inputPath, 'draft-or-bundle-digest-mismatch');
  }
  if (quality && quality !== bundle.quality) fail('prepared-mismatch', 'Prepared explainer uses a different quality profile.', inputPath, 'quality-profile-mismatch', 'Prepare the original draft again under the requested quality profile.');
  if (writingMode && writingMode !== (bundle.writingMode || 'warn')) fail('prepared-mismatch', 'Prepared explainer uses a different writing check mode.', inputPath, 'writing-mode-mismatch', 'Prepare the original draft again under the requested writing check mode.');
  const parsed = parseValidatedExplainer(sourceText, { inputPath: bundle.sourcePath, writingMode: bundle.writingMode || 'warn' });
  if (JSON.stringify(parsed.document) !== JSON.stringify(bundle.document)) fail('prepared-mismatch', 'Prepared document differs from the authored draft.', inputPath, 'normalized-document-mismatch');
  if (checkDependencies) assertPreparedDependencies(bundle);
  return bundle;
}
export function rebindPreparedBundle(bundle, parsed) {
  const next = { ...bundle, ...parsed, source: identity(Buffer.from(parsed.sourceText)) };
  next.digest = digest(next);
  return next;
}

export function validatePreparedTargets(document, diagrams, options = {}) {
  const visit = (value, pointer, panelId, component) => {
    if (typeof value === 'string') {
      const location = options.sourceMap?.[pointer] || {};
      const inline = parseInline(value, { line: location.line || 1, input: options.sourcePath, panelId, component });
      for (const reference of inline.references) {
        if (!['node','route'].includes(reference.kind)) continue;
        const target = reference.kind === 'node' ? {diagram:reference.diagram,node:reference.node} : {diagram:reference.diagram,route:[reference.from,reference.to]};
        const line = (location.line || 1) + (value.slice(0,reference.offset).match(/\n/g)?.length || 0);
        validateExplainerDiagramTarget(diagrams,target,{...options,pointer,line});
      }
    } else if (Array.isArray(value)) value.forEach((entry,index)=>visit(entry,`${pointer}/${index}`,panelId,component));
    else if (value && typeof value === 'object') for(const [key,entry] of Object.entries(value)) {
      if (['spec','source','path','language','target','changes'].includes(key) || (['diff','snippet'].includes(component) && key==='text')) continue;
      visit(entry,`${pointer}/${key}`,panelId,component);
    }
  };
  visit(document.meta?.title,'/meta/title',undefined,'title');
  visit(document.answer,'/answer',undefined,'answer');
  document.panels.forEach((panel,index)=>{
    visit(panel.title,`/panels/${index}/title`,panel.id,'panel');
    panel.blocks.forEach((block,blockIndex)=>{
      const pointer=`/panels/${index}/blocks/${blockIndex}`;
      visit(block,pointer,panel.id,block.type);
      if(block.type==='diagram')for(const key of ['nodeSources','nodeBlocks'])for(const node of Object.keys(block[key]||{}))validateExplainerDiagramTarget(diagrams,{diagram:block.id,node},{...options,pointer:`${pointer}/${key}/${node}`,line:options.sourceMap?.[`${pointer}/${key}/${node}`]?.line || options.sourceMap?.[pointer]?.line || 1});
      if(block.type==='steps') block.items.forEach((item,itemIndex)=>{
        if(item.target)validateExplainerDiagramTarget(diagrams,item.target,{...options,pointer:`${pointer}/items/${itemIndex}/target`,line:options.sourceMap?.[`${pointer}/items/${itemIndex}`]?.line || options.sourceMap?.[pointer]?.line || 1});
      });
    });
  });
}
