import path from 'node:path';
import { publishOutputAtomically } from '../renderers/shared/cli.mjs';
import { createOwnedTempDirectory } from '../renderers/shared/owned-temp-directory.mjs';
import { loadViewerStyles } from '../renderers/shared/svg-bake.mjs';
import { packRevisions, preparePackView } from './build.mjs';
import { failPrPack, PrPackError } from './errors.mjs';
import { loadLensEvidence } from './lens-evidence.mjs';
import { compileLensHtml } from './lens-html.mjs';
import { compileLensScene } from './lens-scene.mjs';
import { assertReviewText, loadPrPack, reviewElements } from './manifest.mjs';
import { sha256 } from './markdown.mjs';

export function lensFailure(error) {
  const argument = error.archifyArgument;
  const stage = argument ? 'arguments' : error.stage || 'render';
  const details = error.diagnostics || error.archifyDiagnostics || (argument ? [argument] : []);
  if (error instanceof PrPackError) return error;
  if (argument) return new PrPackError(error.message, { stage, code: argument.code, diagnostics: [{ ...argument, message: error.message, severity: 'error' }] });
  if (details.length) return new PrPackError(details[0].message, { stage, code: details[0].code, diagnostics: details });
  return new PrPackError('Could not generate the review file.', { stage, code: 'pr-lens/failed' });
}

function payloadsFor(view, step, fallback) {
  if (step.payload) return [{ label: 'Step payload', payload: step.payload }];
  const { edgeIds: edges } = reviewElements(view);
  const ordered = fallback ? edges : (step.edgeIds || []).map((id) => edges.find((edge) => edge.id === id));
  if (!['sequence', 'dataflow'].includes(view.type)) return [];
  return ordered.filter((edge) => edge.payload).map((edge) => ({
    label: [edge.label, edge.id].filter(Boolean).join(' · ') || 'Edge payload',
    payload: edge.payload,
  }));
}

function makeModel(pack, revisions, evidence, scenes) {
  const { manifest, views } = pack;
  const changes = (manifest.changes || []).map((row, index) => ({ row, index }));
  const unassigned = changes.filter(({ row }) => row.view === undefined);
  const authored = manifest.walkthrough?.steps;
  const steps = authored || views.map(({ id, title, caption }) => ({ id, title, body: caption, viewId: id }));

  const counts = Object.entries(evidence.counts || {}).map(([key, value]) => ({ key, value, origin: 'Git' }));
  for (const [key, value] of Object.entries(manifest.stats || {})) {
    if (evidence.counts && Object.hasOwn(evidence.counts, key) && evidence.counts[key] === value) continue;
    counts.push({ key, value, origin: 'Declared' });
  }

  return {
    title: manifest.title,
    summary: manifest.summary,
    repository: manifest.repository,
    pullRequest: manifest.pullRequest,
    revisions: { baseRef: manifest.baseRef, headRef: manifest.headRef, baseSha: revisions.baseSha, headSha: revisions.headSha, verified: revisions.verified },
    counts,
    unavailable: revisions.verified ? null : evidence.unavailable,
    unassigned: unassigned.map(({ row }) => row),
    unassignedCitations: evidence.forChanges(unassigned),
    views: views.map(({ id, title, type, caption, storyOnly }, index) => ({
      id, title, type, caption, storyOnly, nodes: scenes[index].nodes, edges: scenes[index].edges,
    })),
    steps: steps.map((step, index) => {
      const viewIndex = views.findIndex((view) => view.id === step.viewId);
      const scene = scenes[viewIndex];
      const focus = [];
      for (const [field, owners] of [['nodeIds', scene.nodes], ['edgeIds', scene.edges]]) {
        for (const [position, id] of (step[field] || []).entries()) {
          const matches = owners.filter((owner) => owner.id === id);
          if (matches.length !== 1) failPrPack('pr-lens/element-not-rendered', 'render', 'Step target does not identify one rendered element.', {
            subject: { path: `/walkthrough/steps/${index}/${field}/${position}` },
          });
          focus.push(matches[0].key);
        }
      }
      const rows = authored ? [] : changes.filter(({ row }) => row.view === step.viewId);
      const citations = authored
        ? [step.primarySliceId, ...(step.relatedSliceIds || [])].filter(Boolean).map((id) => ({ id, ...evidence.named.get(id) }))
        : evidence.forChanges(rows);
      return {
        id: step.id, title: step.title, body: step.body, change: step.change, viewIndex, focus,
        beforeLabel: step.beforeLabel, afterLabel: step.afterLabel,
        changes: rows.map(({ row }) => row), citations,
        payloads: payloadsFor(views[viewIndex], step, !authored),
      };
    }),
    hunks: evidence.hunks,
  };
}

export async function buildPrLens(manifestInput, { outDir, repoRoot, quality } = {}) {
  if (!outDir) failPrPack('cli/missing-option-value', 'arguments', 'pr lens requires --out-dir <dir>.');
  if (quality !== undefined && !['standard', 'showcase'].includes(quality)) {
    failPrPack('cli/unsupported-option', 'arguments', 'pr lens quality must be standard or showcase.');
  }
  const output = path.resolve(outDir, 'pr-lens.html');
  assertReviewText(output, '/output/path', 'arguments');
  const pack = loadPrPack(manifestInput, { lens: true });
  const revisions = packRevisions(pack, repoRoot);
  const evidence = loadLensEvidence(pack, revisions, { stats: true });
  const temporary = createOwnedTempDirectory('archify-pr-lens-');
  let artifact;
  let model;
  try {
    const styles = loadViewerStyles();
    const viewsDir = path.join(temporary.path, 'views');
    const scenes = pack.views.map((view, index) => {
      const prepared = preparePackView(view, revisions, viewsDir, { lens: true });
      return compileLensScene(prepared.render({ quality, repoRoot }), prepared.snapshot, view, styles, index);
    });
    model = makeModel(pack, revisions, evidence, scenes);
    artifact = compileLensHtml(model, scenes, styles.fontCss);
  } finally {
    await temporary.cleanup();
  }
  try {
    publishOutputAtomically(output, artifact, { replaceEntry: true });
  } catch {
    throw new PrPackError('Could not publish pr-lens.html in the output directory.', {
      code: 'pr-lens/publication-failed', stage: 'publication',
    });
  }
  return {
    schemaVersion: 1, ok: true, command: 'pr lens', kind: 'pr-lens-result',
    output: { path: output, bytes: Buffer.byteLength(artifact), sha256: sha256(artifact) },
    revisions: { baseSha: revisions.baseSha, headSha: revisions.headSha, verified: revisions.verified },
    viewCount: model.views.length, stepCount: model.steps.length, verifiedHunkCount: model.hunks.length,
  };
}
