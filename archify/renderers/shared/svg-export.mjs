import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedTempDirectory } from './owned-temp-directory.mjs';
import { publishOutputAtomically } from './cli.mjs';
import { BAKE_PRESETS, BAKE_THEMES, assertCamoSafeSvg, authoredPreset, bakeSvg, extractCanonicalSvg, loadViewerStyles } from './svg-bake.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXPORT_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'tree', 'class', 'timeline', 'waterfall'];
export const THEME_SELECTIONS = ['both', 'light', 'dark'];

export class SvgExportError extends Error {
  constructor(message, { code, stage, diagnostics = [] }) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.diagnostics = diagnostics;
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function themesFor(selection = 'both') {
  if (!THEME_SELECTIONS.includes(selection)) {
    throw new SvgExportError(`Unknown theme "${selection}". Expected one of: ${THEME_SELECTIONS.join(', ')}`, {
      code: 'cli/unsupported-option',
      stage: 'arguments',
      diagnostics: [{ code: 'cli/unsupported-option', message: `--theme must be one of ${THEME_SELECTIONS.join(', ')}`, supportedFixes: ['pass --theme both|light|dark'] }],
    });
  }
  return selection === 'both' ? [...BAKE_THEMES] : [selection];
}

// `both` writes `<stem>-light.svg` and `<stem>-dark.svg`; a single theme
// writes exactly the requested path (adding `.svg` when a stem was given).
export function exportOutputPaths(output, themes) {
  const resolved = path.resolve(output);
  const hasSvgExtension = path.extname(resolved).toLowerCase() === '.svg';
  const stem = hasSvgExtension ? resolved.slice(0, -4) : resolved;
  if (themes.length === 1) {
    return { [themes[0]]: hasSvgExtension ? resolved : `${resolved}.svg` };
  }
  return Object.fromEntries(themes.map((theme) => [theme, `${stem}-${theme}.svg`]));
}

// Runs the native renderer once and returns the offline HTML it wrote to `out`.
export function renderDiagramHtml({ type, input, out, env = {} }) {
  const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
  const result = spawnSync(process.execPath, [renderer, input, out], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json', ...env },
  });
  if (result.error || result.status !== 0) {
    let diagnostics = [];
    let message = 'Renderer failed before emitting a structured diagnostic.';
    try {
      const payload = JSON.parse((result.stderr || '').trim());
      if (payload?.ok === false && Array.isArray(payload.diagnostics) && payload.diagnostics.length) {
        diagnostics = payload.diagnostics;
        message = payload.error || payload.diagnostics[0].message;
      }
    } catch {
      // fail closed: never surface a raw stack through the receipt
    }
    if (result.error) message = `Renderer process could not start: ${result.error.message}`;
    throw new SvgExportError(message, {
      code: diagnostics[0]?.code || 'internal/renderer-process',
      stage: diagnostics.some((entry) => String(entry.code || '').startsWith('input/')) ? 'input' : 'render',
      diagnostics,
    });
  }
  return fs.readFileSync(out, 'utf8');
}

async function renderToHtml({ type, input, env }) {
  const temporary = createOwnedTempDirectory('archify-export-svg-');
  try {
    return renderDiagramHtml({ type, input, out: path.join(temporary.path, `${type}.html`), env });
  } finally {
    await temporary.cleanup();
  }
}

// Renders `input` once, bakes the canonical SVG per theme, gates each file
// through the Camo checks, and publishes atomically. Returns a receipt.
export async function exportSvgArtifacts({ type, input, output, theme = 'both', preset, animateFlow = false, env = {}, styles = loadViewerStyles(), html = null }) {
  if (!EXPORT_TYPES.includes(type)) {
    throw new SvgExportError(`Unknown diagram type "${type}" for export-svg. Expected one of: ${EXPORT_TYPES.join(', ')}`, {
      code: 'cli/unknown-diagram-type',
      stage: 'arguments',
      diagnostics: [{ code: 'cli/unknown-diagram-type', message: `export-svg supports ${EXPORT_TYPES.join(', ')}`, supportedFixes: ['use a standalone diagram type (explainer bundles are not exported as a single SVG)'] }],
    });
  }
  if (preset !== undefined && !BAKE_PRESETS.includes(preset)) {
    throw new SvgExportError(`Unknown preset "${preset}". Expected one of: ${BAKE_PRESETS.join(', ')}`, {
      code: 'cli/unsupported-option',
      stage: 'arguments',
      diagnostics: [{ code: 'cli/unsupported-option', message: `--preset must be one of ${BAKE_PRESETS.join(', ')}`, supportedFixes: [`pass --preset ${BAKE_PRESETS.join('|')}`] }],
    });
  }
  const themes = themesFor(theme);
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    throw new SvgExportError(`Input file not found: ${inputPath}`, {
      code: 'input/not-found',
      stage: 'input',
      diagnostics: [{ code: 'input/not-found', message: `Input file not found: ${inputPath}`, supportedFixes: ['pass an existing diagram JSON path'] }],
    });
  }
  const canonical = extractCanonicalSvg(html ?? await renderToHtml({ type, input: inputPath, env }));
  const resolvedPreset = preset || authoredPreset(canonical) || 'classic';
  const paths = exportOutputPaths(output, themes);
  const outputs = [];
  for (const currentTheme of themes) {
    const svg = bakeSvg(canonical, { theme: currentTheme, preset: resolvedPreset, diagramType: type, animateFlow, styles });
    const camo = assertCamoSafeSvg(svg, { assert: false });
    if (!camo.ok) {
      throw new SvgExportError(`Baked ${currentTheme} SVG is not Camo-safe: ${camo.problems.map((problem) => `[${problem.code}] ${problem.message}`).join(' ')}`, {
        code: camo.problems[0].code,
        stage: 'camo',
        diagnostics: camo.problems.map((problem) => ({ code: problem.code, message: problem.message, subject: { theme: currentTheme }, supportedFixes: [problem.fix] })),
      });
    }
    const target = paths[currentTheme];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    publishOutputAtomically(target, svg);
    outputs.push({
      theme: currentTheme,
      path: target,
      bytes: camo.bytes,
      sha256: sha256(svg),
      animated: svg.includes('data-archify-bake="animate-flow"'),
      camo: { ok: camo.ok, bytes: camo.bytes, maxBytes: camo.maxBytes, problems: camo.problems },
    });
  }
  return {
    schemaVersion: 1,
    ok: true,
    command: 'export-svg',
    type,
    input: inputPath,
    theme,
    preset: resolvedPreset,
    animateFlow: Boolean(animateFlow),
    outputs,
  };
}
