import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_NODE_COLLECTIONS, FULL_SHA_RE, hasRepositoryEvidence, runGit, runPinnedDiff, verifyRepositorySourceAnchors } from '../renderers/shared/repository-evidence.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { PrPackError, failPrPack as fail, packDiagnostic, reviewTextFailure } from './errors.mjs';
import { findReviewTextPath } from './markdown.mjs';
import { resolveStorySteps, validatePrStory } from './story-svg.mjs';

export { PrPackError, packDiagnostic };
export const PACK_PLATFORMS = ['github', 'gitlab', 'generic'];
export const DEFAULT_CHANGE_TABLE_LIMIT = 20;

function readJson(file, { stage, subject }) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail('input/not-found', stage, `Could not read ${file}: ${error.message}`, { subject, supportedFixes: ['pass an existing JSON file path'] });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('input/invalid-json', stage, `${file} is not valid JSON: ${error.message}`, { subject, supportedFixes: ['fix the JSON syntax and retry'] });
  }
  return undefined;
}

function schemaFailure(error, stage, subject) {
  const diagnostics = (error.archifyDiagnostics || [{ code: 'schema/invalid', message: error.message }])
    .map((entry) => ({ ...entry, subject: { ...subject, ...(entry.subject || {}) } }));
  return new PrPackError(error.message, { code: diagnostics[0].code, stage, diagnostics });
}

// Loads the manifest, validates it against the precompiled pr-pack schema,
// and validates every referenced diagram against its own diagram schema.
export function loadPrPack(manifestInput, { lens = false, validate = false } = {}) {
  const manifestPath = path.resolve(manifestInput);
  const manifestDir = path.dirname(manifestPath);
  const manifest = readJson(manifestPath, { stage: 'manifest', subject: { manifest: manifestPath } });
  try {
    return validatePackManifest(manifest, manifestPath, manifestDir, { lens, validate });
  } catch (error) {
    if (error instanceof PrPackError && manifest?.walkthrough !== undefined) error.reviewTextBoundary = true;
    throw error;
  }
}

function validatePackManifest(manifest, manifestPath, manifestDir, { lens, validate }) {
  if (lens) assertReviewText(manifest, '', 'manifest');
  for (const key of ['pullRequest', 'walkthrough']) assertReviewText(manifest?.[key], `/${key}`, 'manifest');
  try {
    validateSchema('prPack', manifest);
  } catch (error) {
    const failure = schemaFailure(error, 'manifest', { manifest: manifestPath });
    if (manifest?.walkthrough !== undefined || manifest?.pullRequest !== undefined) {
      const pointer = findReviewTextPath({ message: failure.message, diagnostics: failure.diagnostics });
      if (pointer) throw reviewTextFailure('manifest');
    }
    throw failure;
  }
  const seen = new Set();
  const views = manifest.views.map((view, index) => {
    if (seen.has(view.id)) {
      fail('pr-pack/duplicate-view-id', 'manifest', `View id "${view.id}" is declared more than once.`, {
        subject: { manifest: manifestPath, path: `/views/${index}/id` },
        supportedFixes: ['give every view a unique id'],
      });
    }
    seen.add(view.id);
    const inputPath = path.resolve(manifestDir, view.input);
    const diagram = readJson(inputPath, { stage: 'views', subject: { view: view.id, input: inputPath } });
    if (lens) assertReviewText(diagram, `/views/${index}/diagram`, 'views');
    try {
      validateSchema(view.type, diagram);
    } catch (error) {
      throw schemaFailure(error, 'views', { view: view.id, input: inputPath });
    }
    return {
      ...view,
      inputPath,
      diagram,
      collapsed: Boolean(view.collapsed),
      storyOnly: Boolean(view.storyOnly),
      theme: view.theme || manifest.theme || 'both',
      preset: view.preset || manifest.preset || 'classic',
      evidence: hasRepositoryEvidence(view.type, diagram),
    };
  });
  if (!lens && !(validate && manifest.walkthrough) && views.every((view) => view.storyOnly) && !manifest.story) {
    fail('pr-pack/no-visible-output', 'manifest', 'Every declared view has storyOnly: true and no manifest.story is defined.', {
      subject: { manifest: manifestPath, path: '/views' },
      supportedFixes: ['add manifest.story or remove storyOnly from at least one view'],
    });
  }
  for (const [index, row] of (manifest.changes || []).entries()) {
    if (row.view !== undefined && !seen.has(row.view)) {
      fail('pr-pack/unknown-change-view', 'manifest', `Change row ${index} references unknown view "${row.view}".`, {
        subject: { manifest: manifestPath, path: `/changes/${index}/view` },
        supportedFixes: ['reference a declared view id or drop the view column'],
      });
    }
  }
  const pack = {
    manifestPath,
    manifestDir,
    manifest,
    views,
    story: manifest.story
      ? { ...manifest.story, steps: resolveStorySteps(manifest.story.steps, manifest.story.duration) }
      : null,
    platform: manifest.platform || 'github',
    changeTableLimit: manifest.changeTableLimit || DEFAULT_CHANGE_TABLE_LIMIT,
  };
  validateWalkthrough(pack);
  if (pack.story) validatePrStory(pack.story, pack, { manifestDir });
  return pack;
}

export function assertReviewText(value, pointer = '', stage = 'render') {
  const found = findReviewTextPath(value, pointer);
  if (found) throw reviewTextFailure(stage, found);
}

const reviewEdgeCollections = {
  architecture: 'connections', sequence: 'messages', erd: 'relationships', class: 'relationships',
  workflow: 'edges', dataflow: 'flows', lifecycle: 'transitions',
};

export function reviewElements({ type, diagram }) {
  return {
    nodeIds: diagram[EVIDENCE_NODE_COLLECTIONS[type]] || [],
    edgeIds: diagram[reviewEdgeCollections[type]] || [],
  };
}

function validateWalkthrough({ manifest, views }) {
  if (!manifest.walkthrough) return;
  const { steps, slices = [] } = manifest.walkthrough;
  const sliceIds = new Set();
  const stepIds = new Set();
  const invalid = (pointer, message) => fail('pr-pack/invalid-walkthrough', 'manifest', message, { subject: { path: pointer } });
  for (const [index, slice] of slices.entries()) {
    if (sliceIds.has(slice.id)) invalid(`/walkthrough/slices/${index}/id`, 'Slice ID is declared more than once.');
    sliceIds.add(slice.id);
  }
  for (const [index, step] of steps.entries()) {
    const pointer = `/walkthrough/steps/${index}`;
    if (stepIds.has(step.id)) invalid(`${pointer}/id`, 'Step ID is declared more than once.');
    stepIds.add(step.id);
    const view = views.find((entry) => entry.id === step.viewId);
    if (!view) invalid(`${pointer}/viewId`, 'Step must reference a declared view.');
    for (const [field, elements] of Object.entries(reviewElements(view))) {
      for (const [item, id] of (step[field] || []).entries()) {
        if (elements.filter((element) => element.id === id).length !== 1) {
          invalid(`${pointer}/${field}/${item}`, 'Element reference must identify one explicit ID in this view.');
        }
      }
    }
    if (step.primarySliceId && !sliceIds.has(step.primarySliceId)) invalid(`${pointer}/primarySliceId`, 'Primary slice must reference a declared slice.');
    for (const [item, id] of (step.relatedSliceIds || []).entries()) {
      if (!sliceIds.has(id) || id === step.primarySliceId) invalid(`${pointer}/relatedSliceIds/${item}`, 'Related slice must reference a declared slice other than the primary slice.');
    }
  }
}

export function changeSourceAnchors(row) {
  if (!row.path) return [];
  if (row.change === 'removed') return [{ side: 'base', path: row.basePath || row.path, line: row.baseLine ?? row.line }];
  const anchors = [];
  if (row.line !== undefined || row.baseLine === undefined || row.basePath !== undefined) anchors.push({ side: 'head', path: row.path, line: row.line });
  if (row.baseLine !== undefined || row.basePath !== undefined) anchors.push({ side: 'base', path: row.basePath || row.path, line: row.baseLine });
  return anchors;
}

function readPackFilePairs(root, baseSha, headSha) {
  const diff = runPinnedDiff(root, baseSha, headSha, ['--name-status', '-z'], { bytes: true });
  if (diff.status !== 0) fail('pr-pack/invalid-source-anchor', 'revisions', 'Could not read the pinned PR diff to verify source anchors.', {
    supportedFixes: ['verify both pinned revisions are available in the local checkout'],
  });
  const fields = diff.stdout.toString('latin1').split('\0');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const decodePath = (raw) => {
    try {
      return decoder.decode(Buffer.from(raw, 'latin1'));
    } catch {
      // An authored JSON path cannot address a non-UTF-8 Git pathname.
      return null;
    }
  };
  const pairs = new Map();
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++];
    const first = fields[index++];
    const current = /^[RC]/.test(status) ? fields[index++] : first;
    const oldPath = status === 'A' ? null : decodePath(first);
    const newPath = status === 'D' ? null : decodePath(current);
    const pair = { status, oldPath, newPath, addressable: (status === 'A' || oldPath !== null) && (status === 'D' || newPath !== null) };
    if (pair.oldPath) pairs.set(`base:${pair.oldPath}`, pair);
    if (pair.newPath) pairs.set(`head:${pair.newPath}`, pair);
  }
  return pairs;
}

function gitCommit(repoRoot, ref, label) {
  const result = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  if (result.status !== 0 || !FULL_SHA_RE.test(sha)) {
    fail('pr-pack/ref-unavailable', 'revisions', `${label} "${ref}" does not resolve to a commit in ${repoRoot}.`, {
      subject: { repoRoot, ref: ref },
      supportedFixes: ['fetch the ref or declare one that exists in the local checkout'],
    });
  }
  return sha;
}

// Three-dot semantics: the PR base is merge-base(baseRef, headRef), never a
// two-dot diff against the branch tip. Returns the verified revisions.
export function verifyPackRevisions(pack, repoRoot) {
  const { manifest } = pack;
  const root = path.resolve(repoRoot);
  if (!fs.existsSync(root)) {
    fail('repository-evidence/root-unreadable', 'revisions', `Repository root ${root} does not exist.`, {
      subject: { repoRoot: root }, supportedFixes: ['pass --repo-root with the matching local Git checkout'],
    });
  }
  let headSha = manifest.headSha;
  let baseSha = manifest.baseSha;
  let mergeBase = null;
  if (manifest.baseRef && manifest.headRef) {
    const headRefSha = gitCommit(root, manifest.headRef, 'headRef');
    const baseRefSha = gitCommit(root, manifest.baseRef, 'baseRef');
    const result = runGit(root, ['merge-base', baseRefSha, headRefSha]);
    mergeBase = result.stdout.trim();
    if (result.status !== 0 || !FULL_SHA_RE.test(mergeBase)) {
      fail('pr-pack/merge-base-unavailable', 'revisions', `No merge-base between "${manifest.baseRef}" and "${manifest.headRef}".`, {
        subject: { repoRoot: root, baseRef: manifest.baseRef, headRef: manifest.headRef },
        supportedFixes: ['fetch both refs so they share history'],
      });
    }
    if (headSha && headSha !== headRefSha) {
      fail('pr-pack/head-sha-mismatch', 'revisions', `headSha ${headSha} does not match headRef "${manifest.headRef}" (${headRefSha}).`, {
        subject: { repoRoot: root, headRef: manifest.headRef }, evidence: { declared: headSha, resolved: headRefSha },
        supportedFixes: [`set headSha to ${headRefSha} or point headRef at the declared commit`],
      });
    }
    if (baseSha && baseSha !== mergeBase) {
      fail('pr-pack/base-sha-not-merge-base', 'revisions', `baseSha ${baseSha} is not merge-base(${manifest.baseRef}, ${manifest.headRef}) = ${mergeBase}; PR diagrams must describe the three-dot diff.`, {
        subject: { repoRoot: root, baseRef: manifest.baseRef, headRef: manifest.headRef }, evidence: { declared: baseSha, mergeBase },
        supportedFixes: [`set baseSha to ${mergeBase}`, 'run git merge-base <baseRef> <headRef> and author the diagrams against that commit'],
      });
    }
    headSha = headRefSha;
    baseSha = mergeBase;
  } else if (manifest.baseRef || manifest.headRef) {
    fail('pr-pack/refs-incomplete', 'revisions', 'baseRef and headRef must be declared together.', {
      supportedFixes: ['declare both refs, or declare baseSha and headSha only'],
    });
  } else {
    if (!headSha || !baseSha) {
      fail('pr-pack/revisions-required', 'revisions', '--repo-root verification needs baseRef/headRef or baseSha/headSha in the manifest.', {
        supportedFixes: ['declare baseRef and headRef (preferred) or both full SHAs'],
      });
    }
    headSha = gitCommit(root, headSha, 'headSha');
    baseSha = gitCommit(root, baseSha, 'baseSha');
    const result = runGit(root, ['merge-base', baseSha, headSha]);
    mergeBase = result.stdout.trim();
    if (mergeBase !== baseSha) {
      fail('pr-pack/base-sha-not-merge-base', 'revisions', `baseSha ${baseSha} is not the merge-base of itself and headSha ${headSha} (${mergeBase || 'none'}).`, {
        subject: { repoRoot: root }, evidence: { declared: baseSha, mergeBase: mergeBase || null },
        supportedFixes: [mergeBase ? `set baseSha to ${mergeBase}` : 'declare a baseSha that shares history with headSha'],
      });
    }
  }
  const anchors = [];
  const groups = [['changes', manifest.changes || []], ['story/steps', manifest.story?.steps || []]];
  for (const [group, rows] of groups) for (const [index, row] of rows.entries()) {
    const subject = { manifest: pack.manifestPath, path: `/${group}/${index}` };
    for (const anchor of changeSourceAnchors(row)) {
      anchors.push({ ...anchor, revision: anchor.side === 'base' ? baseSha : headSha, subject });
    }
  }
  if (anchors.length || manifest.walkthrough?.slices?.length) {
    pack.filePairs = readPackFilePairs(root, baseSha, headSha);
    const diffPaths = new Map([...pack.filePairs].map(([key, pair]) => [
      key.replace(/^(base|head):/, (_, side) => side === 'base' ? 'L:' : 'R:'), pair.newPath || pair.oldPath,
    ]));
    for (const anchor of anchors) {
      const side = anchor.side === 'base' ? 'L' : 'R';
      const diffPath = diffPaths.get(`${side}:${anchor.path}`);
      if (!diffPath) fail('pr-pack/invalid-source-anchor', 'revisions', `${anchor.subject.path} cites ${anchor.path}, which is not on the ${side === 'L' ? 'base' : 'head'} side of this PR diff.`, {
        subject: anchor.subject, evidence: { sourcePath: anchor.path, revision: anchor.revision, baseSha, headSha },
        supportedFixes: ['cite a file changed in the pinned PR diff; put unchanged context in the summary or diagram sources instead', 'for a rename, use path for the new filename and basePath for the old filename; story baseLine may cite the old filename'],
      });
    }
    for (const [index, row] of (manifest.changes || []).entries()) {
      if (!row.basePath) continue;
      const baseDiffPath = diffPaths.get(`L:${row.basePath}`);
      const sameFile = row.change === 'removed'
        ? row.path === baseDiffPath || row.path === row.basePath
        : diffPaths.get(`R:${row.path}`) === baseDiffPath;
      if (!sameFile) fail('pr-pack/invalid-source-anchor', 'revisions', `/changes/${index} path and basePath do not identify the same file in the pinned PR diff.`, {
        subject: { manifest: pack.manifestPath, path: `/changes/${index}` },
        evidence: { path: row.path, basePath: row.basePath },
        supportedFixes: ['use the new and old names of one renamed file from git diff --name-status --find-renames'],
      });
    }
    pack.sourceAnchorPaths = diffPaths;
  }
  try {
    verifyRepositorySourceAnchors(root, anchors);
  } catch (error) {
    if (!error.archifyDiagnostics) throw error;
    const diagnostics = error.archifyDiagnostics.map((entry) => ({ ...entry, subject: { ...entry.subject, surface: 'pr-pack' } }));
    throw new PrPackError(error.message, { code: diagnostics[0].code, stage: 'revisions', diagnostics });
  }
  return { repoRoot: root, baseSha, headSha, mergeBase, verified: true };
}

// Pins each diagram's evidence to the pack revisions: head for added/modified
// citations, base_revision for removed ghosts. Returns a snapshot diagram.
export function alignDiagramRevisions(view, { baseSha, headSha }) {
  const diagram = view.diagram;
  if (!view.evidence) return diagram;
  const repository = diagram.meta?.repository;
  if (!repository) {
    fail('repository-evidence/repository-required', 'views', `View "${view.id}" cites sources but has no /meta/repository.`, {
      subject: { view: view.id, path: '/meta/repository' },
      supportedFixes: ['add the pinned repository metadata or remove the sources'],
    });
  }
  if (headSha && repository.revision && repository.revision.toLowerCase() !== headSha) {
    fail('pr-pack/view-revision-mismatch', 'views', `View "${view.id}" pins /meta/repository/revision ${repository.revision} but the pack head is ${headSha}.`, {
      subject: { view: view.id, path: '/meta/repository/revision' }, evidence: { declared: repository.revision, headSha },
      supportedFixes: [`set revision to ${headSha}`],
    });
  }
  if (baseSha && repository.base_revision && repository.base_revision.toLowerCase() !== baseSha) {
    fail('pr-pack/view-base-revision-mismatch', 'views', `View "${view.id}" pins /meta/repository/base_revision ${repository.base_revision} but the pack merge-base is ${baseSha}.`, {
      subject: { view: view.id, path: '/meta/repository/base_revision' }, evidence: { declared: repository.base_revision, baseSha },
      supportedFixes: [`set base_revision to ${baseSha} or remove it`],
    });
  }
  return {
    ...diagram,
    meta: {
      ...diagram.meta,
      repository: {
        ...repository,
        ...(headSha && !repository.revision ? { revision: headSha } : {}),
        ...(baseSha && !repository.base_revision ? { base_revision: baseSha } : {}),
      },
    },
  };
}
