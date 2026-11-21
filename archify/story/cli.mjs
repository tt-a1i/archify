import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { resolveOutputPath } from '../renderers/shared/output-path.mjs';
import { createOwnedTempDirectory } from '../renderers/shared/owned-temp-directory.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

import { prepareStageSvg } from './component-stage.mjs';
import {
  StoryChoreographyError,
  failChoreography,
  fromStoryBriefToChoreography,
  normalizeChoreographySpec,
  readLocalSourceLines,
  validatePlanAgainstParts,
  validatePortableSourcePath,
} from './choreography-plan.mjs';
import { publishStorySvgOutputs, writeStoryOutput } from './output.mjs';
import { buildStoryStageHtml } from './story-stage-html.mjs';
import { compileStorySvg, createCompiledStoryTheme } from './story-svg.mjs';
import { BAKE_PRESETS, BAKE_THEMES, authoredPreset, bakeSvg, extractCanonicalSvg, loadViewerStyles } from './svg-bake.mjs';
import { buildStory, draftStory, scanStory } from './tool.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'tree', 'class', 'timeline', 'waterfall']);
const LEGACY_ACTIONS = new Set(['scan', 'draft', 'attach']);
const CHOREO_ACTIONS = new Set(['validate', 'svg', 'stage', 'video']);
const VALUE_FLAGS = new Set(['--repo-root', '--theme', '--preset', '--quality', '--format', '--fps', '--start', '--seconds']);

function runGit(repoRoot, args) {
  return spawnSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' },
  });
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonFile(filePath, subject = {}) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    failChoreography('input/not-found', 'input', `Could not read "${filePath}": ${error.message}`, {
      subject: { input: filePath, ...subject },
      supportedFixes: ['pass an existing JSON file path'],
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    failChoreography('input/invalid-json', 'input', `Could not parse JSON in "${filePath}": ${error.message}`, {
      subject: { input: filePath, ...subject },
      supportedFixes: ['fix the JSON syntax error and retry'],
    });
  }
  return undefined;
}

function themesFor(selection = 'both') {
  if (!['both', 'light', 'dark'].includes(selection)) {
    failChoreography('cli/unsupported-option', 'arguments', `Unknown theme "${selection}". Expected one of: both, light, dark.`, {
      subject: { option: '--theme', value: selection },
      supportedFixes: ['pass --theme both|light|dark'],
    });
  }
  return selection === 'both' ? [...BAKE_THEMES] : [selection];
}

function exportOutputPaths(output, themes) {
  const resolved = path.resolve(output);
  const hasSvgExt = path.extname(resolved).toLowerCase() === '.svg';
  const stem = hasSvgExt ? resolved.slice(0, -4) : resolved;
  if (themes.length === 1) {
    return { [themes[0]]: hasSvgExt ? resolved : `${resolved}.svg` };
  }
  return Object.fromEntries(themes.map((theme) => [theme, `${stem}-${theme}.svg`]));
}

function renderDiagramToHtml({ type, input, out, env = {} }) {
  if (!EXPORT_TYPES.has(type)) {
    failChoreography('cli/unknown-diagram-type', 'arguments', `Unknown diagram type "${type}".`, {
      subject: { type },
      supportedFixes: [`use one of: ${[...EXPORT_TYPES].join(', ')}`],
    });
  }
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
    } catch {}
    if (result.error) message = `Renderer process could not start: ${result.error.message}`;
    const err = new StoryChoreographyError(message, {
      code: diagnostics[0]?.code || 'internal/renderer-process',
      stage: diagnostics.some((entry) => String(entry.code || '').startsWith('input/')) ? 'input' : 'render',
      diagnostics,
    });
    if (diagnostics.length) err.archifyDiagnostics = diagnostics;
    throw err;
  }
  return fs.readFileSync(out, 'utf8');
}

function detectDiagramTypeFromSvg(svg, htmlText = '') {
  const open = svg.slice(0, svg.indexOf('>') + 1);
  const explicit = /\bdata-diagram-type="([a-z]+)"/.exec(open)?.[1];
  if (explicit) return explicit;
  if (/\bdata-class-ui\b/.test(open)) return 'class';
  if (/\bdata-erd-ui\b/.test(open)) return 'erd';
  if (/\bdata-tree-ui\b/.test(open)) return 'tree';
  if (/\bdata-timeline-ui\b/.test(open)) return 'timeline';
  if (/\bdata-waterfall-ui\b/.test(open)) return 'waterfall';
  if (/\bdata-lifecycle-layout\b/.test(open)) return 'lifecycle';
  if (/\bdata-sequence-column-fit\b|\bdata-motion-choreography="sequence"/.test(open)) return 'sequence';
  if (/\bdata-motion-choreography="stream"/.test(open)) return 'dataflow';
  if (/render-workflow|data-workflow-/.test(htmlText)) return 'workflow';
  if (/\bdata-node-ui\b/.test(open)) return 'architecture';
  return 'workflow';
}

function makeSourceLoader({ baseDir, repoRoot, viewDiagrams, inputPaths, htmlFacts = null, requireDetailSource = false }) {
  const revisionForView = (viewId) => {
    const repository = viewDiagrams.get(viewId)?.meta?.repository;
    if (repository?.revision) {
      return { head: repository.revision, base: repository.base_revision || null };
    }
    if (htmlFacts?.repository?.revision) {
      return { head: htmlFacts.repository.revision, base: htmlFacts.repository.baseRevision || null };
    }
    return { head: null, base: null };
  };

  return (detail) => {
    validatePortableSourcePath(detail.path);
    const revs = revisionForView(detail.view);
    const requested = detail.revision;
    const sha = requested === 'base' ? revs.base : (!requested || requested === 'head' ? revs.head : requested);
    if (requested || revs.head) {
      if (!repoRoot || !sha || !/^[0-9a-f]{40}$/i.test(sha)) {
        failChoreography('story/source-revision-unavailable', 'views', `Cannot resolve revision "${requested || 'head'}" for ${detail.path}.`, {
          subject: { path: detail.path, view: detail.view, revision: requested || 'head' },
          supportedFixes: ['pass --repo-root and supply the requested view revision, or cite an explicit full commit SHA'],
        });
      }
      inputPaths.push(path.resolve(repoRoot, ...detail.path.split('/')));
      const gitRes = runGit(repoRoot, ['show', '--no-textconv', `${sha.toLowerCase()}:${detail.path}`]);
      if (gitRes.status === 0) {
        if (gitRes.stdout.includes('\0')) {
          failChoreography('story/source-not-found', 'views', `story detail "${detail.path}" is a binary file.`, {
            subject: { path: detail.path },
            supportedFixes: ['cite a text source file'],
          });
        }
        return gitRes.stdout.split(/\r?\n/);
      }
      failChoreography('story/source-not-found', 'views', `Could not read ${detail.path} at ${sha.slice(0, 7)}: ${(gitRes.stderr || '').trim() || 'missing file'}.`, {
        subject: { path: detail.path, revision: sha },
        supportedFixes: ['cite an existing file at that revision'],
      });
    }
    return readLocalSourceLines(detail.path, {
      baseDir, repoRoot, requireSource: requireDetailSource, onRead: resolved => inputPaths.push(resolved),
    });
  };
}

function parseEnumFlag(flag, raw, allowed, subject = {}) {
  if (!allowed.includes(raw)) {
    failChoreography('cli/unsupported-option', 'arguments', `Unknown ${flag.slice(2)} "${raw}". Expected one of: ${allowed.join(', ')}.`, {
      subject: { option: flag, value: raw, ...subject },
      supportedFixes: [`pass ${flag} ${allowed.join('|')}`],
    });
  }
  return raw;
}

function parseFpsFlag(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
    failChoreography('cli/unsupported-option', 'arguments', '--fps must be an integer between 1 and 120.', {
      subject: { option: '--fps', value: parsed },
      supportedFixes: ['pass --fps 30 or --fps 60'],
    });
  }
  return parsed;
}

function parseVideoSecondsFlag(flag, raw) {
  const parsed = Number(raw);
  const nonNegative = flag === '--start';
  if (!Number.isFinite(parsed) || (nonNegative ? parsed < 0 : parsed <= 0)) {
    failChoreography('cli/unsupported-option', 'arguments', `${flag} requires a finite ${nonNegative ? 'non-negative' : 'positive'} number of seconds.`, {
      subject: { option: flag, value: parsed },
      supportedFixes: [`pass a valid number of seconds to ${flag}`],
    });
  }
  return parsed;
}

function takeFlagValue(name, args, index) {
  const val = args[index + 1];
  if (!val || val.startsWith('--')) throw new Error(`${name} requires one value.`);
  return val;
}

function parseChoreographyArgs(args, action) {
  const options = {
    json: false, still: false, repoRoot: undefined, theme: undefined, preset: undefined, quality: undefined,
    format: undefined, fps: undefined, start: undefined, seconds: undefined, positional: [],
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--still') {
      if (action !== 'svg') throw new Error('--still is supported for story svg only.');
      options.still = true; continue;
    }
    if (arg === '--repo-root') {
      if (options.repoRoot) throw new Error('--repo-root may only be specified once.');
      options.repoRoot = path.resolve(takeFlagValue('--repo-root', args, i));
      i += 1; continue;
    }
    if (arg === '--theme') { options.theme = takeFlagValue('--theme', args, i); i += 1; continue; }
    if (arg === '--preset') { options.preset = parseEnumFlag('--preset', takeFlagValue('--preset', args, i), BAKE_PRESETS); i += 1; continue; }
    if (arg === '--quality') { options.quality = parseEnumFlag('--quality', takeFlagValue('--quality', args, i), ['standard', 'showcase']); i += 1; continue; }
    if (arg === '--format') {
      if (action !== 'video') throw new Error('--format is supported for story video only.');
      options.format = parseEnumFlag('--format', takeFlagValue('--format', args, i).toLowerCase(), ['mp4', 'webm']);
      i += 1; continue;
    }
    if (arg === '--fps') {
      if (action !== 'video') throw new Error('--fps is supported for story video only.');
      options.fps = parseFpsFlag(takeFlagValue('--fps', args, i));
      i += 1; continue;
    }
    if (arg === '--start' || arg === '--seconds') {
      if (action !== 'video') throw new Error(`${arg} is supported for story video only.`);
      options[arg.slice(2)] = parseVideoSecondsFlag(arg, takeFlagValue(arg, args, i));
      i += 1; continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown story option ${arg}`);
    options.positional.push(arg);
  }
  return options;
}

function bakeSingleHtmlBundleView({ singleHtml, presetOverride, rawPreset, themeList, styles, switchable }) {
  const htmlText = fs.readFileSync(singleHtml.htmlPath, 'utf8');
  const canonical = extractCanonicalSvg(htmlText);
  const resolvedPreset = presetOverride || rawPreset || authoredPreset(canonical) || 'classic';
  const byTheme = new Map(themeList.map((theme) => [theme, bakeSvg(canonical, { theme, preset: resolvedPreset, styles, switchable })]));
  return {
    bakedViews: new Map([['main', byTheme]]),
    viewTypes: new Map([['main', singleHtml.diagramType]]),
    viewDiagrams: new Map(),
    inputPaths: [singleHtml.htmlPath, singleHtml.briefPath],
    resolvedPreset,
  };
}

function resolveViewDiagramSource(view, { baseDir, tempDir, inputPaths }) {
  if (view.diagram) {
    const diagramInputPath = path.join(tempDir, `${view.id}.inline.json`);
    fs.writeFileSync(diagramInputPath, `${JSON.stringify(view.diagram, null, 2)}\n`, 'utf8');
    return { diagramObj: view.diagram, diagramInputPath };
  }
  const diagramInputPath = path.resolve(baseDir, view.input);
  inputPaths.push(diagramInputPath);
  return { diagramObj: readJsonFile(diagramInputPath, { view: view.id }), diagramInputPath };
}

function loadCanonicalViewSvg(view, { baseDir, tempDir, env, inputPaths, viewDiagrams }) {
  if (!view.diagram && !/\.json$/i.test(view.input || '')) {
    const htmlPath = path.resolve(baseDir, view.input);
    inputPaths.push(htmlPath);
    if (!fs.existsSync(htmlPath)) {
      failChoreography('input/not-found', 'views', `View "${view.id}" HTML input not found: "${htmlPath}".`, {
        subject: { view: view.id, input: htmlPath },
        supportedFixes: ['pass an existing rendered native HTML file'],
      });
    }
    const facts = scanStory(htmlPath);
    if (facts.repository) viewDiagrams.set(view.id, { meta: { repository: {
      ...facts.repository, base_revision: facts.repository.baseRevision,
    } } });
    return extractCanonicalSvg(fs.readFileSync(htmlPath, 'utf8'));
  }

  const { diagramObj, diagramInputPath } = resolveViewDiagramSource(view, { baseDir, tempDir, inputPaths });
  validateSchema(view.type, diagramObj);
  viewDiagrams.set(view.id, diagramObj);
  const htmlText = renderDiagramToHtml({
    type: view.type,
    input: diagramInputPath,
    out: path.join(tempDir, `${view.id}.html`),
    env,
  });
  return extractCanonicalSvg(htmlText);
}

async function bakeDeclaredChoreographyViews({ rawSpec, baseDir, presetOverride, env, themeList, styles, switchable }) {
  const bakedViews = new Map();
  const viewTypes = new Map();
  const viewDiagrams = new Map();
  const inputPaths = [];
  let resolvedPreset;
  const temp = createOwnedTempDirectory('archify-story-choreo-');
  try {
    for (const view of rawSpec.views) {
      if (viewTypes.has(view.id)) {
        failChoreography('story/duplicate-view-id', 'manifest', `Duplicate view id "${view.id}" in choreography.`, {
          subject: { view: view.id },
          supportedFixes: ['give every entry in views[] a unique id'],
        });
      }
      viewTypes.set(view.id, view.type);
      const canonical = loadCanonicalViewSvg(view, { baseDir, tempDir: temp.path, env, inputPaths, viewDiagrams });
      const effectivePreset = presetOverride || view.preset || rawSpec.preset || authoredPreset(canonical) || 'classic';
      resolvedPreset ??= effectivePreset;
      const preset = switchable ? resolvedPreset : effectivePreset;
      const byTheme = new Map(themeList.map((theme) => [theme, bakeSvg(canonical, { theme, preset, styles, switchable })]));
      bakedViews.set(view.id, byTheme);
    }
  } finally {
    await temp.cleanup();
  }
  return { bakedViews, viewTypes, viewDiagrams, inputPaths, resolvedPreset };
}

async function prepareChoreographyBundle({
  rawSpec, baseDir, themeList, presetOverride, quality, repoRoot,
  singleHtml = null, requireDetailSource = false, validateParts = false, switchable = false,
}) {
  validateSchema('storyChoreography', rawSpec);
  const styles = loadViewerStyles();
  const env = {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
  };

  const baked = singleHtml
    ? bakeSingleHtmlBundleView({ singleHtml, presetOverride, rawPreset: rawSpec.preset, themeList, styles, switchable })
    : await bakeDeclaredChoreographyViews({ rawSpec, baseDir, presetOverride, env, themeList, styles, switchable });

  const loadSourceLines = makeSourceLoader({
    baseDir, repoRoot, viewDiagrams: baked.viewDiagrams, inputPaths: baked.inputPaths,
    htmlFacts: singleHtml?.facts || null, requireDetailSource,
  });
  const plan = normalizeChoreographySpec(rawSpec, {
    declaredViews: [...baked.viewTypes.keys()], loadSourceLines, baseDir, repoRoot, requireDetailSource,
  });

  if (validateParts) {
    const firstTheme = themeList[0];
    const isZh = (plan.locale || '').toLowerCase().startsWith('zh');
    const parts = {};
    for (const stage of plan.stages) {
      const rawSvg = baked.bakedViews.get(stage.view)?.get(firstTheme);
      parts[stage.view] = prepareStageSvg({
        view: { id: stage.view, type: baked.viewTypes.get(stage.view) },
        rawSvg,
        statusBadges: plan.statusBadges,
        callouts: plan.viewCallouts?.[stage.view] || plan.callouts,
        isZh: isZh || /lang="zh/i.test(rawSvg || ''),
      });
    }
    validatePlanAgainstParts(plan, parts);
  }

  return {
    plan,
    bakedViews: baked.bakedViews,
    viewTypes: baked.viewTypes,
    styles,
    inputPaths: baked.inputPaths,
    resolvedPreset: baked.resolvedPreset,
  };
}

function buildInputSpec(positional, action, repoRoot) {
  if (positional.length === (action === 'validate' ? 2 : 3)) {
    const specPath = path.resolve(positional[1]);
    const rawSpec = readJsonFile(specPath);
    return {
      mode: 'choreography',
      specPath,
      baseDir: path.dirname(specPath),
      rawSpec,
      inputPaths: [specPath],
      singleHtml: null,
    };
  }
  if ((action === 'svg' || action === 'stage' || action === 'video') && positional.length === 4) {
    const htmlPath = path.resolve(positional[1]);
    const briefPath = path.resolve(positional[2]);
    if (!fs.existsSync(htmlPath)) {
      failChoreography('input/not-found', 'input', `Source HTML not found: "${htmlPath}".`, {
        subject: { input: htmlPath },
        supportedFixes: ['pass an existing native Archify HTML file'],
      });
    }
    const brief = readJsonFile(briefPath, { brief: briefPath });
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      failChoreography('input/invalid-brief', 'input', 'The story brief must be a JSON object.', {
        subject: { brief: briefPath },
        supportedFixes: ['supply a valid version-2 story brief JSON object'],
      });
    }
    const facts = scanStory(htmlPath);
    const htmlText = fs.readFileSync(htmlPath, 'utf8');
    const canonical = extractCanonicalSvg(htmlText);
    const diagramType = detectDiagramTypeFromSvg(canonical, htmlText);
    const localeMatch = /<html\b[^>]*\blang="([^"]+)"/i.exec(htmlText);
    const rawSpec = fromStoryBriefToChoreography(brief, facts, {
      viewId: 'main',
      diagramType,
      locale: localeMatch?.[1] || 'en',
    });
    return {
      mode: 'bridge',
      specPath: briefPath,
      baseDir: path.dirname(briefPath),
      rawSpec,
      inputPaths: [htmlPath, briefPath],
      singleHtml: { htmlPath, briefPath, facts, diagramType, repoRoot },
    };
  }
  throw new Error(
    'Use story validate <choreography.json>, story svg|stage|video <choreography.json> <output>, or story svg|stage|video <native.html> <brief.json> <output>.',
  );
}

function stillOutputPath({ outputArg, themes, theme, stillCount, stillIndex }) {
  const resolved = path.resolve(outputArg);
  const hasSvgExt = /\.svg$/i.test(resolved);
  const stem = hasSvgExt ? resolved.slice(0, -4) : resolved;
  if (stillCount === 0) {
    return themes.length === 1 ? `${stem}.still.svg` : `${stem}-still-${theme}.svg`;
  }
  const num = stillIndex + 1;
  return themes.length === 1 ? `${stem}-still-${num}.svg` : `${stem}-still-${num}-${theme}.svg`;
}

async function renderStageVideoViaChrome({ html, format, fps, start, seconds }) {
  const chrome = findChrome();
  if (!chrome) {
    failChoreography('story/browser-unavailable', 'export', 'Google Chrome or Chromium is required for `archify story video`.', {
      subject: { format },
      supportedFixes: ['Install Google Chrome / Chromium or set ARCHIFY_CHROME, or generate interactive HTML via `archify story stage`.'],
    });
  }
  const temp = createOwnedTempDirectory('archify-story-video-');
  const stageFile = path.join(temp.path, 'stage.html');
  let browser;
  try {
    fs.writeFileSync(stageFile, html, 'utf8');
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const send = (method, params = {}, timeoutMs = 30000) => browser.cdp.send(method, params, session, timeoutMs);
    const evaluate = async (expression, timeoutMs = 30000) => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs);
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Browser evaluation failed');
      }
      return res.result?.value;
    };

    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(stageFile).href });
    await loaded;

    const ready = await evaluate(
      `(async () => { for (let i = 0; i < 300 && !window.storyStageReady; i++) await new Promise((r) => setTimeout(r, 25)); return Boolean(window.storyStageReady); })()`,
      20000,
    );
    if (!ready) {
      failChoreography('story/video-export-failed', 'export', 'Story stage failed to initialize before video export.', {
        subject: { format },
        supportedFixes: ['verify the generated stage HTML opens cleanly in Chrome'],
      });
    }

    const encodeTimeoutMs = Math.max(120000, Math.ceil((seconds ?? 30) * 6000) + 30000);
    const encoded = await evaluate(
      `(async () => {
        try {
          const blob = await window.ArchifyStoryStage.exportVideo(${JSON.stringify({ format, fps, ...(start !== undefined ? { start } : {}), ...(seconds !== undefined ? { seconds } : {}) })});
          const bytes = new Uint8Array(await blob.arrayBuffer());
          window.__storyVideoBytes = bytes;
          return { ok: true, size: bytes.length, type: blob.type };
        } catch (error) {
          return { ok: false, message: error?.message || String(error) };
        }
      })()`,
      encodeTimeoutMs,
    );
    if (!encoded?.ok) {
      const msg = encoded?.message || 'Browser video encoding failed.';
      const codecErr = /cannot encode|WebCodecs|VideoEncoder|supported/i.test(msg);
      failChoreography(
        codecErr ? 'story/codec-unavailable' : 'story/video-export-failed',
        'export',
        msg,
        {
          subject: { format, fps },
          supportedFixes: codecErr
            ? ['Use Google Chrome/Edge for MP4 (H.264), or pass --format webm for VP9 WebM.']
            : ['verify Chrome WebCodecs hardware/software encoder availability and retry'],
        },
      );
    }

    const CHUNK = 1048576;
    const buffers = [];
    for (let offset = 0; offset < encoded.size; offset += CHUNK) {
      const end = Math.min(encoded.size, offset + CHUNK);
      const b64 = await evaluate(
        `(() => {
          const slice = window.__storyVideoBytes.subarray(${offset}, ${end});
          let bin = '';
          for (let i = 0; i < slice.length; i += 32768) {
            bin += String.fromCharCode.apply(null, slice.subarray(i, i + 32768));
          }
          return btoa(bin);
        })()`,
        30000,
      );
      buffers.push(Buffer.from(b64, 'base64'));
    }
    await evaluate('delete window.__storyVideoBytes; true').catch(() => {});
    const fullBuffer = Buffer.concat(buffers);
    if (fullBuffer.length !== encoded.size) {
      failChoreography('story/video-export-failed', 'export', `Transferred ${fullBuffer.length} of ${encoded.size} encoded video bytes.`, {
        subject: { format },
        supportedFixes: ['retry video export cleanly'],
      });
    }
    return fullBuffer;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await temp.cleanup().catch(() => {});
  }
}

function writeValidatedStoryFile({ requestedOutput, requiredExtension, inputPaths, content, otherOutputPaths = [] }) {
  const guardReq = {
    requestedOutput,
    requiredExtension,
    inputPaths,
    inputDescription: 'the story choreography or view input',
    ...(otherOutputPaths.length ? { otherOutputPaths } : {}),
  };
  const { outputPath: safeOut } = resolveOutputPath(guardReq);
  writeStoryOutput(safeOut, content, () => resolveOutputPath(guardReq));
  return safeOut;
}

function runLegacyStoryCommand(args, json) {
  const positional = [];
  let repoRoot;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--json') continue;
    if (value === '--repo-root') {
      if (repoRoot || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--repo-root requires one repository path.');
      repoRoot = path.resolve(args[++index]);
      continue;
    }
    if (value.startsWith('--')) throw new Error(`Unknown story option ${value}`);
    positional.push(value);
  }
  const [action, input, second, third] = positional;
  const count = { scan: 2, draft: 3, attach: 4 }[action];
  if (!count || positional.length !== count) {
    throw new Error('Use story scan <native.html>, story draft <native.html> <brief.json>, or story attach <native.html> <brief.json> <enhanced.html>.');
  }
  if (repoRoot && action !== 'attach') throw new Error('--repo-root is supported for story attach code excerpts only.');
  const result = action === 'scan'
    ? scanStory(path.resolve(input))
    : action === 'draft'
      ? draftStory(path.resolve(input), path.resolve(second))
      : buildStory(path.resolve(input), path.resolve(second), path.resolve(third), { repoRoot });
  if (json || action === 'scan') console.log(JSON.stringify({ ok: true, command: 'story', action, ...result }, null, 2));
  else if (action === 'draft') console.log(`Brief: ${result.brief}\nSource map: ${result.sourceMap}`);
  else console.log(result.output);
  return result;
}

async function runStoryValidateCommand(spec, opts) {
  const { plan } = await prepareChoreographyBundle({
    rawSpec: spec.rawSpec,
    baseDir: spec.baseDir,
    themeList: ['light'],
    presetOverride: opts.preset,
    quality: opts.quality,
    repoRoot: opts.repoRoot,
    singleHtml: spec.singleHtml,
    requireDetailSource: false,
    validateParts: true,
  });
  const result = {
    ok: true,
    command: 'story',
    action: 'validate',
    id: plan.id,
    title: plan.title,
    duration: plan.duration,
    loop: plan.loop,
    stages: plan.stages.map((s) => s.view),
    steps: plan.steps.length,
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`archify story validate: ${result.stages.length} stage(s), ${result.steps} step(s), ${result.duration}s`);
  return result;
}

async function runStorySvgCommand(spec, opts) {
  const outputArg = opts.positional.at(-1);
  const bridge = spec.mode === 'bridge';
  const themes = themesFor(opts.theme || spec.rawSpec.theme || (bridge ? 'light' : 'both'));
  const bundle = await prepareChoreographyBundle({
    rawSpec: spec.rawSpec,
    baseDir: spec.baseDir,
    themeList: themes,
    presetOverride: opts.preset,
    quality: opts.quality,
    repoRoot: opts.repoRoot,
    singleHtml: spec.singleHtml,
    requireDetailSource: true,
  });
  const allInputPaths = [...new Set([...spec.inputPaths, ...bundle.inputPaths])];
  const outPaths = exportOutputPaths(outputArg, themes);
  const stillTimes = bundle.plan.stills?.length ? bundle.plan.stills : bridge ? [0] : opts.still ? [null] : [];
  const stillPaths = new Map(themes.map(theme => [theme, stillTimes.map((_, stillIndex) => stillOutputPath({
    outputArg, themes, theme, stillCount: bundle.plan.stills?.length || 0, stillIndex,
  }))]));
  const destinations = [...Object.values(outPaths), ...[...stillPaths.values()].flat()];
  const outputGuards = destinations.map((requestedOutput, index) => ({
    requestedOutput,
    requiredExtension: '.svg',
    inputPaths: allInputPaths,
    otherOutputPaths: destinations.filter((_, sibling) => sibling !== index),
    inputDescription: 'the story choreography or view input',
  }));
  const guardsByPath = new Map();
  const outputPaths = new Map(outputGuards.map(guard => {
    const { outputPath } = resolveOutputPath(guard);
    const existing = fs.statSync(outputPath, { throwIfNoEntry: false });
    if (existing && !existing.isFile()) {
      failChoreography('output/invalid-target', 'output', 'Story SVG output must target a regular file.', {
        subject: { output: outputPath }, supportedFixes: ['choose a filename that does not already name a directory or another special file'],
      });
    }
    guardsByPath.set(outputPath, guard);
    return [guard.requestedOutput, outputPath];
  }));
  const outputs = [];
  const stills = [];
  let meta = null;

  const validateOutput = file => resolveOutputPath(guardsByPath.get(file));
  publishStorySvgOutputs([...outputPaths.values()], validateOutput, publish => {
    for (const theme of themes) {
      const compiledTheme = createCompiledStoryTheme({
        plan: bundle.plan,
        bakedViews: bundle.bakedViews,
        viewTypes: bundle.viewTypes,
        theme,
        preset: bundle.resolvedPreset,
        styles: bundle.styles,
      });
      const animated = compiledTheme.renderAnimatedSvg();
      meta = compiledTheme.meta;
      const safeOut = outputPaths.get(outPaths[theme]);
      publish(safeOut, animated.svg);
      outputs.push({ theme, path: safeOut, bytes: Buffer.byteLength(animated.svg, 'utf8'), sha256: sha256(animated.svg) });

      for (const [si, atTime] of stillTimes.entries()) {
        const stillCompiled = compiledTheme.renderStillSvg(atTime);
        const safeStill = outputPaths.get(stillPaths.get(theme)[si]);
        publish(safeStill, stillCompiled.svg);
        stills.push({
          time: atTime ?? Math.max(0, bundle.plan.duration - 0.5),
          theme,
          path: safeStill,
          bytes: Buffer.byteLength(stillCompiled.svg, 'utf8'),
          sha256: sha256(stillCompiled.svg),
        });
      }
    }
  });

  const result = {
    ok: true,
    command: 'story',
    action: 'svg',
    id: bundle.plan.id,
    title: meta.title,
    duration: meta.duration,
    loop: meta.loop,
    steps: bundle.plan.steps.length,
    preset: bundle.resolvedPreset,
    outputs,
    stills,
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of outputs) console.log(item.path);
    for (const item of stills) console.log(item.path);
  }
  return result;
}

function compileStoryStage(bundle, defaultTheme) {
  const stageSvg = compileStorySvg({
    plan: bundle.plan, bakedViews: bundle.bakedViews, viewTypes: bundle.viewTypes,
    theme: defaultTheme, preset: bundle.resolvedPreset, styles: bundle.styles,
    reducedMotionFallback: false, switchable: true,
  }).svg;
  return buildStoryStageHtml({
    plan: bundle.plan, stageSvg, defaultTheme, preset: bundle.resolvedPreset, styles: bundle.styles,
  });
}

async function runStoryVideoCommand(spec, opts, defaultTheme) {
  const outputArg = opts.positional.at(-1);
  const ext = path.extname(outputArg).toLowerCase();
  const format = opts.format || (ext === '.mp4' ? 'mp4' : 'webm');
  const requiredExt = format === 'webm' ? '.webm' : '.mp4';
  if ((ext === '.mp4' || ext === '.webm') && ext !== requiredExt) {
    failChoreography('cli/unsupported-option', 'arguments', `Output extension "${ext}" does not match --format ${format}.`, {
      subject: { output: outputArg, format },
      supportedFixes: [`use a ${requiredExt} filename or match --format`],
    });
  }
  const fps = opts.fps || 60;
  const bundle = await prepareChoreographyBundle({
    rawSpec: spec.rawSpec,
    baseDir: spec.baseDir,
    themeList: [defaultTheme],
    switchable: true,
    presetOverride: opts.preset,
    quality: opts.quality,
    repoRoot: opts.repoRoot,
    singleHtml: spec.singleHtml,
    requireDetailSource: true,
  });
  const allInputPaths = [...new Set([...spec.inputPaths, ...bundle.inputPaths])];
  const start = opts.start ?? 0;
  resolveOutputPath({ requestedOutput: outputArg, requiredExtension: requiredExt, inputPaths: allInputPaths });
  const seconds = opts.seconds ?? (bundle.plan.duration - start);
  if (start >= bundle.plan.duration || start + seconds > bundle.plan.duration + 0.001) {
    failChoreography('story/invalid-timing', 'arguments', `Requested video interval (${start}s..${start + seconds}s) exceeds story duration (${bundle.plan.duration}s).`, {
      subject: { start, seconds, duration: bundle.plan.duration },
      supportedFixes: [`choose start/seconds within 0..${bundle.plan.duration}s`],
    });
  }

  const html = compileStoryStage(bundle, defaultTheme);

  const buffer = await renderStageVideoViaChrome({ html, format, fps, start, seconds });
  const safeVideo = writeValidatedStoryFile({
    requestedOutput: outputArg,
    requiredExtension: requiredExt,
    inputPaths: allInputPaths,
    content: buffer,
  });
  const result = {
    ok: true,
    command: 'story',
    action: 'video',
    id: bundle.plan.id,
    title: bundle.plan.title,
    format,
    width: 1920,
    height: 1080,
    fps,
    start,
    seconds,
    theme: defaultTheme,
    preset: bundle.resolvedPreset,
    output: safeVideo,
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(safeVideo);
  return result;
}

async function runStoryStageCommand(spec, opts, defaultTheme) {
  const bundle = await prepareChoreographyBundle({
    rawSpec: spec.rawSpec,
    baseDir: spec.baseDir,
    themeList: [defaultTheme],
    switchable: true,
    presetOverride: opts.preset,
    quality: opts.quality,
    repoRoot: opts.repoRoot,
    singleHtml: spec.singleHtml,
    requireDetailSource: true,
  });
  const allInputPaths = [...new Set([...spec.inputPaths, ...bundle.inputPaths])];
  const html = compileStoryStage(bundle, defaultTheme);
  const safeHtml = writeValidatedStoryFile({
    requestedOutput: opts.positional.at(-1),
    requiredExtension: '.html',
    inputPaths: allInputPaths,
    content: html,
  });
  const result = {
    ok: true,
    command: 'story',
    action: 'stage',
    id: bundle.plan.id,
    title: bundle.plan.title,
    duration: bundle.plan.duration,
    loop: bundle.plan.loop,
    defaultTheme,
    preset: bundle.resolvedPreset,
    output: safeHtml,
    bytes: Buffer.byteLength(html, 'utf8'),
    sha256: sha256(html),
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(safeHtml);
  return result;
}

export async function commandStory(args) {
  const json = args.includes('--json');
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++;
    else if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  let [action] = positional;
  let inputForError;
  let briefForError;
  try {
    if (!action || (!LEGACY_ACTIONS.has(action) && !CHOREO_ACTIONS.has(action))) {
      throw new Error('Use story scan|draft|attach|validate|svg|stage|video ...');
    }
    if (LEGACY_ACTIONS.has(action)) {
      inputForError = positional[1] && path.resolve(positional[1]);
      briefForError = positional[2] && path.resolve(positional[2]);
      return runLegacyStoryCommand(args, json);
    }

    const opts = parseChoreographyArgs(args, action);
    [action] = opts.positional;
    inputForError = opts.positional[1] && path.resolve(opts.positional[1]);
    briefForError = opts.positional.length >= 4 ? path.resolve(opts.positional[2]) : undefined;
    const spec = buildInputSpec(opts.positional, action, opts.repoRoot);

    if (action === 'validate') return await runStoryValidateCommand(spec, opts);
    if (action === 'svg') return await runStorySvgCommand(spec, opts);

    if (opts.theme !== undefined && !['light', 'dark'].includes(opts.theme)) {
      failChoreography('cli/unsupported-option', 'arguments', `story ${action} --theme expects "light" or "dark", got "${opts.theme}".`, {
        subject: { option: '--theme', value: opts.theme },
        supportedFixes: ['pass --theme light or --theme dark'],
      });
    }
    const defaultTheme = opts.theme || (spec.rawSpec.theme === 'dark' ? 'dark' : 'light');
    if (action === 'video') return await runStoryVideoCommand(spec, opts, defaultTheme);
    return await runStoryStageCommand(spec, opts, defaultTheme);
  } catch (error) {
    if (error instanceof StoryChoreographyError && !error.archifyDiagnostics) {
      error.archifyDiagnostics = error.diagnostics;
    }
    const diagnostics = error.archifyDiagnostics || error.diagnostics || [{
      code: error.code || 'story/invalid-input',
      severity: 'error',
      message: error.message,
      subject: { action, input: inputForError, ...(briefForError ? { brief: briefForError } : {}) },
      evidence: { reason: error.code || error.message },
      supportedFixes: ['Use valid inputs, source IDs and distinct output paths; read references/story-authoring.md.'],
    }];
    if (json) console.log(JSON.stringify({ ok: false, command: 'story', action, diagnostics }, null, 2));
    else console.error(error.message);
    process.exitCode = 1;
  }
  return undefined;
}
