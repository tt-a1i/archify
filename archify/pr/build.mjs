import fs from 'node:fs';
import path from 'node:path';
import { publishOutputAtomically } from '../renderers/shared/cli.mjs';
import { SvgExportError, exportOutputPaths, exportSvgArtifacts, renderDiagramHtml, themesFor } from '../renderers/shared/svg-export.mjs';
import { loadViewerStyles } from '../renderers/shared/svg-bake.mjs';
import { PACK_PLATFORMS, PrPackError, alignDiagramRevisions, loadPrPack, packDiagnostic, verifyPackRevisions } from './manifest.mjs';
import { PACK_END, PACK_START, packPlaceholderAssets, renderPackMarkdown, sha256 } from './markdown.mjs';
import { compilePrStorySvg, upgradeSvgNodeBadges, validatePrStory } from './story-svg.mjs';

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
    return {
      id: view.id,
      title: view.title,
      type: view.type,
      input: view.inputPath,
      theme: view.theme,
      preset: view.preset,
      collapsed: view.collapsed,
      storyOnly: view.storyOnly,
      evidence: view.evidence,
    };
  });
  if (pack.story) validatePrStory(pack.story, pack, { revisions, manifestDir: pack.manifestDir });
  return {
    schemaVersion: 1,
    ok: true,
    command: 'pr validate',
    manifest: pack.manifestPath,
    platform: pack.platform,
    revisions,
    views,
    story: pack.story ? {
      id: pack.story.id || 'walkthrough',
      duration: pack.story.duration,
      loop: pack.story.loop !== false,
      steps: pack.story.steps.length,
    } : null,
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
  if (pack.story) validatePrStory(pack.story, pack, { revisions, manifestDir: pack.manifestDir, requireDetailSource: true });
  const outputRoot = path.resolve(outDir);
  const viewsDir = path.join(outputRoot, 'views');
  fs.mkdirSync(viewsDir, { recursive: true });
  const styles = loadViewerStyles();
  const env = {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: path.resolve(repoRoot) } : {}),
  };
  const storyThemeSelection = pack.story ? platformTheme(resolvedPlatform, pack.manifest.theme || 'both') : null;
  const storyThemesNeeded = storyThemeSelection ? themesFor(storyThemeSelection) : [];
  const staticBadgeMode = pack.manifest.nodeBadges || pack.story?.nodeBadges || 'labeled';
  const packLocale = pack.views.find((v) => v.diagram?.meta?.locale)?.diagram.meta.locale || '';
  const stagedViews = new Set((pack.story?.stages || []).map((stage) => stage.view));
  const bakedViews = new Map();
  const views = [];
  const viewAssets = [];
  for (const view of pack.views) {
    const aligned = alignDiagramRevisions(view, revisions);
    const snapshot = {
      ...aligned,
      meta: { ...(aligned.meta || {}), visual_preset: view.preset },
    };
    const snapshotPath = path.join(viewsDir, `${view.id}.json`);
    publishOutputAtomically(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const htmlPath = path.join(viewsDir, `${view.id}.html`);
    const themeSelection = platformTheme(resolvedPlatform, view.theme);
    const viewThemes = themesFor(themeSelection);
    const bakeThemes = stagedViews.has(view.id)
      ? [...new Set([...viewThemes, ...storyThemesNeeded])]
      : viewThemes;
    const bakeSelection = bakeThemes.length === 2 ? 'both' : bakeThemes[0];
    let rendered;
    let exported;
    try {
      rendered = renderDiagramHtml({ type: view.type, input: snapshotPath, out: htmlPath, env });
      exported = await exportSvgArtifacts({
        type: view.type,
        input: snapshotPath,
        output: path.join(viewsDir, view.id),
        theme: bakeSelection,
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
    const byTheme = new Map();
    const svgs = {};
    const viewIsZh = String(snapshot.meta?.locale || packLocale).toLowerCase().startsWith('zh');
    for (const output of exported.outputs) {
      const rawSvgText = fs.readFileSync(output.path, 'utf8');
      byTheme.set(output.theme, rawSvgText);
      if (view.storyOnly || !viewThemes.includes(output.theme)) {
        if (!view.storyOnly) fs.rmSync(output.path, { force: true });
        continue;
      }
      const finalSvg = staticBadgeMode === 'compact'
        ? rawSvgText
        : upgradeSvgNodeBadges(rawSvgText, view.type, { isZh: viewIsZh, mode: staticBadgeMode });
      let finalBytes = output.bytes;
      let finalSha = output.sha256;
      if (finalSvg !== rawSvgText) {
        publishOutputAtomically(output.path, finalSvg);
        finalBytes = Buffer.byteLength(finalSvg, 'utf8');
        finalSha = sha256(finalSvg);
      }
      const assetId = `${view.id}-${output.theme}`;
      svgs[output.theme] = output.path;
      viewAssets.push({
        id: assetId,
        view: view.id,
        theme: output.theme,
        path: output.path,
        bytes: finalBytes,
        sha256: finalSha,
        animated: output.animated,
        placeholder: `{{archify:asset:${assetId}}}`,
      });
    }
    bakedViews.set(view.id, byTheme);
    views.push({
      id: view.id,
      title: view.title,
      caption: view.caption ?? null,
      type: view.type,
      collapsed: view.collapsed,
      storyOnly: view.storyOnly,
      input: view.inputPath,
      snapshot: snapshotPath,
      html: html ? htmlPath : null,
      payloads: html ? rendered.includes('id="archify-payloads-data"') : null,
      evidence: { declared: view.evidence, verified: view.evidence && Boolean(repoRoot) },
      theme: view.storyOnly ? storyThemeSelection : themeSelection,
      preset: exported.preset,
      svgs,
    });
  }
  const storyAssets = [];
  let storySummary = null;
  if (pack.story) {
    const storyId = pack.story.id || 'walkthrough';
    const storyPreset = pack.manifest.preset || 'classic';
    const storyPaths = exportOutputPaths(path.join(viewsDir, storyId), storyThemesNeeded);
    const storySvgs = {};
    let meta = null;
    for (const currentTheme of storyThemesNeeded) {
      const compiled = compilePrStorySvg({
        story: pack.story,
        pack,
        bakedViews,
        theme: currentTheme,
        preset: storyPreset,
        styles,
        revisions,
        manifestDir: pack.manifestDir,
      });
      meta = compiled;
      const targetPath = storyPaths[currentTheme];
      publishOutputAtomically(targetPath, compiled.svg);
      const assetId = `${storyId}-${currentTheme}`;
      storySvgs[currentTheme] = targetPath;
      storyAssets.push({
        id: assetId,
        story: storyId,
        theme: currentTheme,
        path: targetPath,
        bytes: Buffer.byteLength(compiled.svg, 'utf8'),
        sha256: sha256(compiled.svg),
        animated: true,
        placeholder: `{{archify:asset:${assetId}}}`,
      });
    }
    storySummary = {
      id: meta.id,
      title: meta.title,
      duration: meta.duration,
      loop: meta.loop,
      steps: pack.story.steps.length,
      theme: storyThemeSelection,
      preset: storyPreset,
      svgs: storySvgs,
    };
  }
  const assets = [...storyAssets, ...viewAssets];
  const placeholders = packPlaceholderAssets({
    ...pack,
    storyTheme: storyThemeSelection,
    views: pack.views.map((view) => ({ ...view, theme: platformTheme(resolvedPlatform, view.theme) })),
  });
  const packForMarkdown = {
    ...pack,
    storyTheme: storyThemeSelection,
    platform: resolvedPlatform,
    baseSha: revisions.baseSha,
    headSha: revisions.headSha,
    baseRef: pack.manifest.baseRef,
    headRef: pack.manifest.headRef,
  };
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
    story: storySummary,
    markdown: { path: markdownPath, sha256: sha256(markdown), anchors: { start: PACK_START, end: PACK_END } },
    assets,
    views,
  };
  const receiptPath = path.join(outputRoot, RECEIPT_FILE);
  publishOutputAtomically(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...receipt, receipt: receiptPath };
}
