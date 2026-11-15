import fs from 'node:fs';
import path from 'node:path';
import { publishOutputAtomically } from '../renderers/shared/cli.mjs';
import { SvgExportError, exportSvgArtifacts, renderDiagramHtml } from '../renderers/shared/svg-export.mjs';
import { loadViewerStyles } from '../renderers/shared/svg-bake.mjs';
import { PACK_PLATFORMS, PrPackError, alignDiagramRevisions, loadPrPack, packDiagnostic, verifyPackRevisions } from './manifest.mjs';
import { PACK_END, PACK_START, packPlaceholderAssets, renderPackMarkdown, sha256 } from './markdown.mjs';

export const RECEIPT_FILE = 'pr-pack.receipt.json';
export const MARKDOWN_FILE = 'pr-pack.md';

function optionFailure(code, message, supportedFixes) {
  return new PrPackError(message, { code, stage: 'arguments', diagnostics: [packDiagnostic({ code, message, supportedFixes })] });
}

function exportFailure(error, view) {
  if (error instanceof PrPackError) return error;
  if (!(error instanceof SvgExportError)) throw error;
  const diagnostics = (error.diagnostics.length ? error.diagnostics : [packDiagnostic({ code: error.code || 'render/failed', message: error.message })])
    .map((entry) => ({ ...entry, subject: { view: view.id, input: view.inputPath, ...(entry.subject || {}) } }));
  return new PrPackError(`View "${view.id}": ${error.message}`, { code: diagnostics[0].code, stage: error.stage === 'arguments' ? 'views' : error.stage, diagnostics });
}

// Validates the manifest and every view without writing anything.
export function validatePrPack(manifestInput, { repoRoot } = {}) {
  const pack = loadPrPack(manifestInput);
  const revisions = repoRoot ? verifyPackRevisions(pack, repoRoot) : { baseSha: pack.manifest.baseSha ?? null, headSha: pack.manifest.headSha ?? null, mergeBase: null, verified: false };
  const views = pack.views.map((view) => {
    alignDiagramRevisions(view, revisions);
    return { id: view.id, title: view.title, type: view.type, input: view.inputPath, theme: view.theme, collapsed: view.collapsed, evidence: view.evidence };
  });
  return {
    schemaVersion: 1,
    ok: true,
    command: 'pr validate',
    manifest: pack.manifestPath,
    platform: pack.platform,
    revisions,
    views,
  };
}

// Renders every view once (offline HTML with payload data), bakes the Camo-safe
// SVG themes from that same render, and writes the Markdown draft + receipt.
// Only GitHub renders <picture> sources per theme; other platforms get one light SVG.
const platformTheme = (platform, theme) => (platform === 'github' ? theme : (theme === 'both' ? 'light' : theme));

export async function buildPrPack(manifestInput, { outDir, repoRoot, platform, html = true, animateFlow = false, quality } = {}) {
  if (!outDir) throw optionFailure('cli/missing-option-value', 'pr build requires --out-dir <dir>.', ['pass --out-dir with a writable directory']);
  if (platform !== undefined && !PACK_PLATFORMS.includes(platform)) {
    throw optionFailure('cli/unsupported-option', `Unknown platform "${platform}". Expected one of: ${PACK_PLATFORMS.join(', ')}`, [`pass --platform ${PACK_PLATFORMS.join('|')}`]);
  }
  const pack = loadPrPack(manifestInput);
  const resolvedPlatform = platform || pack.platform;
  const revisions = repoRoot ? verifyPackRevisions(pack, repoRoot) : { baseSha: pack.manifest.baseSha ?? null, headSha: pack.manifest.headSha ?? null, mergeBase: null, verified: false };
  const outputRoot = path.resolve(outDir);
  const viewsDir = path.join(outputRoot, 'views');
  fs.mkdirSync(viewsDir, { recursive: true });
  const styles = loadViewerStyles();
  const env = {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: path.resolve(repoRoot) } : {}),
  };
  const views = [];
  const assets = [];
  for (const view of pack.views) {
    const snapshot = alignDiagramRevisions(view, revisions);
    const snapshotPath = path.join(viewsDir, `${view.id}.json`);
    publishOutputAtomically(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const htmlPath = path.join(viewsDir, `${view.id}.html`);
    const themeSelection = platformTheme(resolvedPlatform, view.theme);
    let rendered;
    let exported;
    try {
      rendered = renderDiagramHtml({ type: view.type, input: snapshotPath, out: htmlPath, env });
      exported = await exportSvgArtifacts({
        type: view.type,
        input: snapshotPath,
        output: path.join(viewsDir, view.id),
        theme: themeSelection,
        preset: view.preset,
        animateFlow: animateFlow && ['sequence', 'dataflow'].includes(view.type),
        env,
        styles,
        html: rendered,
      });
    } catch (error) {
      throw exportFailure(error, view);
    }
    if (!html) fs.rmSync(htmlPath, { force: true });
    const svgs = {};
    for (const output of exported.outputs) {
      const assetId = `${view.id}-${output.theme}`;
      svgs[output.theme] = output.path;
      assets.push({
        id: assetId,
        view: view.id,
        theme: output.theme,
        path: output.path,
        bytes: output.bytes,
        sha256: output.sha256,
        animated: output.animated,
        placeholder: `{{archify:asset:${assetId}}}`,
      });
    }
    views.push({
      id: view.id,
      title: view.title,
      caption: view.caption ?? null,
      type: view.type,
      collapsed: view.collapsed,
      input: view.inputPath,
      snapshot: snapshotPath,
      html: html ? htmlPath : null,
      payloads: html ? rendered.includes('id="archify-payloads-data"') : null,
      evidence: { declared: view.evidence, verified: view.evidence && Boolean(repoRoot) },
      theme: themeSelection,
      preset: exported.preset,
      svgs,
    });
  }
  const placeholders = packPlaceholderAssets({ ...pack, views: pack.views.map((view) => ({ ...view, theme: platformTheme(resolvedPlatform, view.theme) })) });
  const packForMarkdown = { ...pack, platform: resolvedPlatform, baseSha: revisions.baseSha, headSha: revisions.headSha, baseRef: pack.manifest.baseRef, headRef: pack.manifest.headRef };
  let markdown;
  try {
    markdown = renderPackMarkdown(packForMarkdown, placeholders);
  } catch (error) {
    if (error.code !== 'pr-pack/risk-verdict') throw error;
    throw new PrPackError(error.message, { code: error.code, stage: 'manifest', diagnostics: [packDiagnostic({ code: error.code, message: error.message, evidence: { verdict: error.verdict }, supportedFixes: ['replace the verdict with objective counts or evidence'] })] });
  }
  const markdownPath = path.join(outputRoot, MARKDOWN_FILE);
  publishOutputAtomically(markdownPath, `${markdown}\n`);
  const receipt = {
    schemaVersion: 1,
    ok: true,
    command: 'pr build',
    kind: 'pr-pack-receipt',
    manifest: pack.manifestPath,
    outDir: outputRoot,
    platform: resolvedPlatform,
    title: pack.manifest.title,
    repository: pack.manifest.repository ?? null,
    baseRef: pack.manifest.baseRef ?? null,
    headRef: pack.manifest.headRef ?? null,
    revisions,
    animateFlow: Boolean(animateFlow),
    markdown: { path: markdownPath, sha256: sha256(markdown), anchors: { start: PACK_START, end: PACK_END } },
    assets,
    views,
  };
  const receiptPath = path.join(outputRoot, RECEIPT_FILE);
  publishOutputAtomically(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...receipt, receipt: receiptPath };
}
