#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

async function authoredLanguageAssessment(diagram, requiredLanguage) {
  const module = await import('../authoring/authored-language.mjs');
  return module.authoredLanguageAssessment(diagram, requiredLanguage);
}

function usage() {
  return `Usage:
  archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path (architecture only)]
  archify compare architecture <base.json> <head.json> [output.html] [--receipt path] [--json] [--quality standard|showcase] [--repo-root path]
  archify deliver <type> <input.json> [output.html] [--json] [--open] [--quality standard|showcase] [--repo-root path (architecture only)] [--require-authored-language en|zh-CN]
  archify preview <type> <input.json> [output.html] [--no-open] [--quality standard|showcase] [--repo-root path (architecture only)]
  archify validate <type> <input.json> [--json] [--layout-json] [--preflight] [--repair-history path] [--repair-mode focused|structural-reflow] [--quality standard|showcase] [--repo-root path] [--require-authored-language en|zh-CN]
  archify validate-batch <candidates.json> [--quality standard|showcase] [--json] (candidate entries may include requiredLanguage, repairHistory, and repairMode)
  archify migrate workflow <old.json> <new.json> --to-schema 2 [--json]
  archify inspect <type> <input.json>
  archify check <output.html>
  archify visual-check <output.html>... [--preflight] [--json]
  archify visual-check --probe [--json]
  archify authoring-kit <type> [--json] [--context-json] [--expect-contract sha256]
  archify authoring-run start <type> --run-id id --output directory --repo-root path --project-index file --requirements file --candidate file --scope-profile focused|project-overview --expect-contract sha256 [--require-authored-language en|zh-CN] [--json]
  archify authoring-run finalize <authoring-run.json> --candidate path --evidence path --validation path [--json]
  archify authoring-run stop <authoring-run.json> --status failed|blocked|aborted --reason code [--json]
  archify project-index <repo-root> [--revision ref] [--output path] [--json]
  archify project-index query <index.json> [--symbol name] [--import specifier] [--path prefix] [--language name] [--package name] [--max-results n] [--output path] [--json]
  archify project-index source-search <index.json> --term text [--term text] [--path prefix] [--context n] [--max-results n] [--output path] [--json]
  archify project-index inspect <index.json> --range path:start-end [--range path:start-end] [--max-results n] [--output path] [--json]
  archify evidence-ledger create <index.json> <selections.json> [--output path] [--json]
  archify evidence-ledger hydrate <index.json> <selections.json> [--output path] [--json]
  archify evidence-ledger verify <ledger.json> --project-index <index.json> --repo-root path [--json]
  archify run-suite --manifest <suite.json> --repo-root <checkout> --revision <full-commit-id> --output <directory> [--concurrency n] [--json]
  archify guide [scenario or question] [--json] [--lang en|zh]
  archify brands [name, alias, domain, or category] [--json]
  archify brands capture <url> [--json]
  archify examples
  archify doctor
  archify demo [output-directory]

Types:
  architecture, workflow, sequence, dataflow, lifecycle
`;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function rendererPath(type) {
  if (!TYPES.has(type)) {
    fail(`Unknown diagram type "${type}". Expected one of: ${[...TYPES].join(', ')}`);
  }
  return path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

function extractQualityArgs(args) {
  const rest = [];
  let quality;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--quality') {
      quality = args[index + 1];
      if (!quality || quality.startsWith('--')) fail('--quality requires standard or showcase.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length);
      if (!quality) fail('--quality requires standard or showcase.');
      continue;
    }
    rest.push(arg);
  }
  if (quality !== undefined && !['standard', 'showcase'].includes(quality)) {
    fail(`Unknown quality profile "${quality}". Expected standard or showcase.`);
  }
  return { rest, quality };
}

function extractRepoRootArgs(args) {
  const rest = [];
  let repoRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') {
      repoRoot = args[index + 1];
      if (!repoRoot || repoRoot.startsWith('--')) fail('--repo-root requires a repository path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      repoRoot = arg.slice('--repo-root='.length);
      if (!repoRoot) fail('--repo-root requires a repository path.');
      continue;
    }
    rest.push(arg);
  }
  return { rest, repoRoot: repoRoot ? path.resolve(repoRoot) : undefined };
}

function extractPathOption(args, name) {
  const rest = [];
  let value;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`${name} requires a path.`);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      value = arg.slice(name.length + 1);
      if (!value) fail(`${name} requires a path.`);
      continue;
    }
    rest.push(arg);
  }
  return { rest, value: value ? path.resolve(value) : undefined };
}

function extractEnumOption(args, name, allowed) {
  const rest = [];
  let value;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`${name} requires one of: ${allowed.join(', ')}.`);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      value = arg.slice(name.length + 1);
      if (!value) fail(`${name} requires one of: ${allowed.join(', ')}.`);
      continue;
    }
    rest.push(arg);
  }
  if (value !== undefined && !allowed.includes(value)) {
    fail(`Unknown ${name} value "${value}". Expected one of: ${allowed.join(', ')}.`);
  }
  return { rest, value };
}

function rendererEnv(quality, repoRoot, diagnosticJson = false) {
  return {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
    ...(diagnosticJson ? { ARCHIFY_DIAGNOSTIC_FORMAT: 'json' } : {}),
  };
}

function diagnostic({ code, message, subject = {}, evidence = {}, supportedFixes = [], severity = 'error' }) {
  return {
    code,
    severity,
    message,
    subject,
    evidence,
    supportedFixes,
  };
}

function inputDiagnostic(error, inputPath) {
  const isSyntax = error instanceof SyntaxError;
  return diagnostic({
    code: isSyntax ? 'input/json-parse' : 'input/read',
    message: isSyntax
      ? `Input JSON could not be parsed: ${error.message}`
      : `Input could not be read: ${error.message}`,
    subject: { input: inputPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error.message,
    },
    supportedFixes: [isSyntax
      ? 'repair the JSON syntax and run validation again'
      : 'provide one readable JSON input file'],
  });
}

function rendererFailure(result) {
  if (result.error) {
    return {
      error: 'Renderer process could not start.',
      diagnostics: [diagnostic({
        code: 'internal/renderer-process',
        message: 'Renderer process could not start.',
        evidence: { reason: result.error.message },
      })],
    };
  }
  try {
    const payload = JSON.parse((result.stderr || '').trim());
    if (payload?.ok === false && Array.isArray(payload.diagnostics) && payload.diagnostics.length) {
      return {
        error: payload.error || payload.diagnostics[0].message,
        diagnostics: payload.diagnostics,
      };
    }
  } catch {
    // The diagnostic boundary is intentionally fail-closed. Never copy a raw
    // Node stack into a machine receipt when a renderer exits unexpectedly.
  }
  return {
    error: 'Renderer failed before emitting a structured diagnostic.',
    diagnostics: [diagnostic({
      code: 'internal/unclassified',
      message: 'Renderer failed before emitting a structured diagnostic.',
      evidence: { exitCode: result.status ?? 1 },
    })],
  };
}

const COMPOSITION_CHECKS = new Set([
  'label_route_clearance',
  'relationship_crossings',
  'relationship_corridors',
  'container_border_runs',
  'route_rhythm',
]);

const CHECK_FIXES = {
  single_svg: ['remove additional SVG roots so the artifact contains exactly one diagram SVG'],
  finite_svg: ['replace non-finite coordinates before rendering again'],
  orthogonal_arrows: ['use renderer-supported orthogonal routing controls'],
  legend_clearance: ['move the route or enlarge the viewBox so relationships do not enter the legend'],
};

const COMPOSITION_FIXES = {
  'composition/proper-crossing': ['adjust route/via or channel coordinates so unrelated relationships use separate corridors'],
  'composition/ambiguous-corridor': ['adjust route/via or channel coordinates so unrelated relationships do not visually merge'],
  'composition/container-border-run': ['route across the frame perpendicularly through a clear opening'],
  'composition/label-route-clearance': ['adjust labelAt, labelDx, labelDy, labelSegment, message y, or the other relationship route'],
  'composition/desktop-readability': ['reduce the viewBox width, shorten node copy, widen affected nodes, or split the diagram so node context remains at least 6px at a 1440px desktop viewport'],
  'composition/micro-segment': ['move the route/channel/via point so every visible segment is at least 8px'],
  'composition/short-interior-segment': ['move the route/channel/via point so every interior turn has at least 16px'],
  'composition/relationship-label-containment': ['move the single renderer-supported relationship label control inside the exact allowedLabelAt or allowedTranslation range'],
};

function compositionSupportedFixes(issue) {
  if (Array.isArray(issue?.supportedFixes) && issue.supportedFixes.length) return issue.supportedFixes;
  if (issue?.code === 'composition/desktop-readability' && Number.isFinite(issue.maxViewBoxWidth)) {
    return [`reduce the viewBox width to at most ${issue.maxViewBoxWidth}px so the affected text projects to at least 6px at 1440px`];
  }
  return COMPOSITION_FIXES[issue?.code] || [];
}

function compositionMessage(issue) {
  if (issue?.message) return issue.message;
  if (issue?.code === 'composition/desktop-readability') {
    return `Text ${JSON.stringify(issue.text || '')} projects to ${issue.projectedFontPx}px at the 1440px desktop viewport; use a viewBox width of at most ${issue.maxViewBoxWidth}px.`;
  }
  return `Final artifact failed ${issue?.code || 'a composition check'}.`;
}

function checkerDiagnostics(checker) {
  const diagnostics = [];
  for (const issue of checker?.composition?.issues || []) {
    if (issue.severity !== 'error') continue;
    const {
      severity,
      code,
      relationship,
      message,
      subject: structuredSubject,
      evidence: structuredEvidence,
      supportedFixes,
      ...legacyEvidence
    } = issue;
    diagnostics.push(diagnostic({
      code,
      severity,
      message: compositionMessage({ ...issue, message }),
      subject: structuredSubject || (relationship ? { relationship } : { check: 'composition' }),
      evidence: structuredEvidence || legacyEvidence,
      supportedFixes: compositionSupportedFixes({ ...issue, supportedFixes }),
    }));
  }
  for (const check of checker?.checks || []) {
    if (check.ok || COMPOSITION_CHECKS.has(check.name)) continue;
    diagnostics.push(diagnostic({
      code: `artifact/${check.name.replaceAll('_', '-')}`,
      message: (check.details || []).find(Boolean) || `Final artifact failed ${check.name}.`,
      subject: { check: check.name },
      evidence: { details: check.details || [] },
      supportedFixes: CHECK_FIXES[check.name] || [],
    }));
  }
  return diagnostics.length ? diagnostics : [diagnostic({
    code: 'artifact/check-failed',
    message: 'Final artifact check failed without a classified diagnostic.',
    subject: { check: 'unknown' },
    evidence: {},
  })];
}

function formatDiagnostics(error, diagnostics = []) {
  if (!diagnostics.length) return error;
  return [
    error,
    ...diagnostics.map((entry) => {
      const fix = entry.supportedFixes?.length ? ` Fix: ${entry.supportedFixes.join('; ')}.` : '';
      return `[${entry.code}] ${entry.message}${fix}`;
    }),
  ].join('\n');
}

function assertEvidenceType(type, repoRoot) {
  if (repoRoot && type !== 'architecture') {
    fail('--repo-root is currently supported for architecture diagrams only.');
  }
}

function exitFrom(result) {
  if (result.error) fail(result.error.message, 1);
  process.exit(result.status ?? 1);
}

function reportCompareFailure({ json, stage, error, code = 'delta/internal', details = {}, status = 1 }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: 'compare',
    type: 'architecture',
    stage,
    error,
    diagnostics: [{
      code,
      severity: 'error',
      message: error,
      subject: details.side ? { side: details.side, ...(details.path ? { path: details.path } : {}) } : {},
      evidence: Object.fromEntries(Object.entries(details).filter(([key]) => !['side', 'path', 'supportedFixes'].includes(key))),
      supportedFixes: details.supportedFixes || [],
    }],
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, receipt.diagnostics));
  process.exitCode = status;
}

function extractCompareOptions(args) {
  const positional = [];
  let receipt;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--receipt') {
      receipt = args[index + 1];
      if (!receipt || receipt.startsWith('--')) fail('--receipt requires a JSON output path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--receipt=')) {
      receipt = arg.slice('--receipt='.length);
      if (!receipt) fail('--receipt requires a JSON output path.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown compare option "${arg}".`);
    positional.push(arg);
  }
  return { positional, receipt, json };
}

function compareReceiptPath(outputPath) {
  const extension = path.extname(outputPath);
  return extension ? `${outputPath.slice(0, -extension.length)}.receipt.json` : `${outputPath}.receipt.json`;
}

function compareCommitError(message, code, details = {}) {
  const error = new Error(message);
  error.compareStage = 'commit';
  error.compareCode = code;
  error.compareDetails = details;
  return error;
}

function commitComparePair({ htmlCandidate, receiptCandidate, outputPath, receiptPath, stagingDirectory }) {
  const targets = [
    { label: 'HTML artifact', target: outputPath, candidate: htmlCandidate, backup: path.join(stagingDirectory, '.previous-output') },
    { label: 'receipt', target: receiptPath, candidate: receiptCandidate, backup: path.join(stagingDirectory, '.previous-receipt') },
  ];

  // Preflight the whole pair before moving either trusted target. This avoids
  // replacing the HTML and only then discovering that its receipt destination
  // cannot be committed (for example, because it is a directory).
  for (const item of targets) {
    if (!fs.existsSync(item.target)) continue;
    const existing = fs.lstatSync(item.target);
    if (!existing.isFile()) {
      throw compareCommitError(
        `Could not commit Architecture Delta: existing ${item.label} target is not a regular file.`,
        'delta/commit-target',
        {
          target: path.basename(item.target),
          targetType: existing.isDirectory() ? 'directory' : 'non-file',
          supportedFixes: [`choose a regular-file path for the ${item.label}`],
        },
      );
    }
  }

  const backedUp = [];
  const committed = [];
  try {
    for (const item of targets) {
      if (!fs.existsSync(item.target)) continue;
      fs.renameSync(item.target, item.backup);
      backedUp.push(item);
    }
    for (const item of targets) {
      fs.renameSync(item.candidate, item.target);
      committed.push(item);
    }
  } catch (cause) {
    const rollbackErrors = [];
    for (const item of [...committed].reverse()) {
      try {
        fs.rmSync(item.target, { force: true });
      } catch (error) {
        rollbackErrors.push(`${item.label}: remove failed (${error.message})`);
      }
    }
    for (const item of [...backedUp].reverse()) {
      try {
        if (fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
        fs.renameSync(item.backup, item.target);
      } catch (error) {
        rollbackErrors.push(`${item.label}: restore failed (${error.message})`);
      }
    }
    throw compareCommitError(
      rollbackErrors.length
        ? 'Architecture Delta pair commit failed and its previous files could not be fully restored.'
        : 'Architecture Delta pair commit failed; the previous files were restored.',
      rollbackErrors.length ? 'delta/commit-rollback-failed' : 'delta/commit-failed',
      {
        reason: cause.message,
        ...(rollbackErrors.length ? { rollbackErrors } : {}),
        supportedFixes: ['check that both output paths are writable regular files, then retry'],
      },
    );
  }
}

function renderValidatedArchitecture(inputPath, outputPath, quality, repoRoot) {
  const render = runNode([rendererPath('architecture'), inputPath, outputPath], {
    stdio: 'pipe',
    env: rendererEnv(quality, repoRoot, true),
  });
  if (render.status !== 0) {
    const failure = rendererFailure(render);
    const error = new Error(failure.error);
    error.compareStage = 'input';
    error.compareStatus = render.status ?? 1;
    error.diagnostics = failure.diagnostics;
    throw error;
  }
  const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), outputPath], { stdio: 'pipe' });
  if (check.status !== 0) {
    const error = new Error('Validated snapshot failed final artifact checks.');
    error.compareStage = 'check';
    error.compareStatus = check.status ?? 1;
    try {
      error.checker = JSON.parse(check.stdout);
      error.diagnostics = checkerDiagnostics(error.checker);
    } catch {
      error.diagnostics = [];
    }
    throw error;
  }
  const artifact = fs.readFileSync(outputPath);
  return {
    artifact,
    html: artifact.toString('utf8'),
    checks: JSON.parse(check.stdout),
    sourceEvidence: sourceEvidenceFromArtifact(artifact),
  };
}

async function commandCompare(args) {
  const { resolveOutputPath } = await import('../renderers/shared/output-path.mjs');
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const options = extractCompareOptions(repoArgs.rest);
  const [type, baseInput, headInput, requestedOutput] = options.positional;
  if (type !== 'architecture' || !baseInput || !headInput || options.positional.length > 4) fail(usage());
  let deltaRuntime;
  try {
    deltaRuntime = await import(pathToFileURL(path.join(skillRoot, 'delta/architecture-delta.mjs')).href);
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: 'Architecture compare runtime is unavailable.', code: 'delta/runtime-missing', details: { reason: error.message, supportedFixes: ['install the complete Archify skill package'] } });
    return;
  }
  const {
    ArchitectureDeltaError,
    annotateArchitectureSideSvg,
    buildDeltaSvg,
    canonicalArchitecture,
    canonicalArchitectureJson,
    compareArchitecture,
    extractArchitectureSvg,
    extractArtifactCss,
    renderArchitectureDeltaHtml,
    validateArchitectureDeltaHtml,
  } = deltaRuntime;

  const basePath = path.resolve(baseInput);
  const headPath = path.resolve(headInput);
  let outputPath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      defaultOutput: 'architecture-delta.html',
      inputPaths: [basePath, headPath],
    }));
  } catch (error) {
    const outputDiagnostic = error.archifyDiagnostics?.[0];
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: error.message,
      code: outputDiagnostic?.code || 'output/path-resolution',
      details: {
        ...(outputDiagnostic?.subject || {}),
        ...(outputDiagnostic?.evidence || {}),
        supportedFixes: outputDiagnostic?.supportedFixes || ['choose a safe output path and retry'],
      },
    });
    return;
  }
  let receiptPath;
  try {
    ({ outputPath: receiptPath } = resolveOutputPath({
      requestedOutput: options.receipt || compareReceiptPath(outputPath),
      defaultOutput: compareReceiptPath(outputPath),
      inputPaths: [basePath, headPath],
      otherOutputPaths: [outputPath],
    }));
  } catch (error) {
    const outputDiagnostic = error.archifyDiagnostics?.[0];
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: error.message,
      code: outputDiagnostic?.code || 'output/path-resolution',
      details: {
        ...(outputDiagnostic?.subject || {}),
        ...(outputDiagnostic?.evidence || {}),
        supportedFixes: outputDiagnostic?.supportedFixes || ['choose a safe receipt path and retry'],
      },
    });
    return;
  }
  let baseBuffer;
  let headBuffer;
  let base;
  let head;
  try {
    baseBuffer = fs.readFileSync(basePath);
    base = JSON.parse(baseBuffer.toString('utf8'));
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'input', error: `Could not read base input: ${error.message}`, code: 'delta/base-input', details: { side: 'base', reason: error.message } });
    return;
  }
  try {
    headBuffer = fs.readFileSync(headPath);
    head = JSON.parse(headBuffer.toString('utf8'));
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'input', error: `Could not read head input: ${error.message}`, code: 'delta/head-input', details: { side: 'head', reason: error.message } });
    return;
  }

  const outputDirectory = path.dirname(outputPath);
  if (path.dirname(receiptPath) !== outputDirectory) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: 'The compare receipt must be written beside the HTML artifact.', code: 'delta/receipt-directory', details: { supportedFixes: ['choose a --receipt path in the same directory as output.html'] } });
    return;
  }
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: `Could not create compare output directory: ${error.message}`, code: 'delta/output-directory', details: { reason: error.message } });
    return;
  }

  let stagingDirectory;
  try {
    stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.archify-compare-'));
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: `Could not create compare candidate: ${error.message}`, code: 'delta/candidate-directory', details: { reason: error.message } });
    return;
  }

  const baseCandidate = path.join(stagingDirectory, 'base.html');
  const headCandidate = path.join(stagingDirectory, 'head.html');
  const rawBaseCandidate = path.join(stagingDirectory, 'base.raw.html');
  const rawHeadCandidate = path.join(stagingDirectory, 'head.raw.html');
  const canonicalBaseInput = path.join(stagingDirectory, 'base.architecture.json');
  const canonicalHeadInput = path.join(stagingDirectory, 'head.architecture.json');
  const htmlCandidate = path.join(stagingDirectory, path.basename(outputPath));
  const receiptCandidate = path.join(stagingDirectory, path.basename(receiptPath));

  try {
    let baseResult;
    let headResult;
    try {
      renderValidatedArchitecture(basePath, rawBaseCandidate, qualityArgs.quality, repoArgs.repoRoot);
    } catch (error) {
      const diagnosticEntry = error.diagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage || 'validate',
        error: `Base snapshot failed validation: ${error.message}`,
        code: diagnosticEntry?.code || 'delta/base-validation',
        details: { side: 'base', ...(diagnosticEntry?.subject?.path ? { path: diagnosticEntry.subject.path } : {}), ...(diagnosticEntry?.evidence || {}), supportedFixes: diagnosticEntry?.supportedFixes || [] },
        status: error.compareStatus || 1,
      });
      return;
    }
    try {
      renderValidatedArchitecture(headPath, rawHeadCandidate, qualityArgs.quality, repoArgs.repoRoot);
    } catch (error) {
      const diagnosticEntry = error.diagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage || 'validate',
        error: `Head snapshot failed validation: ${error.message}`,
        code: diagnosticEntry?.code || 'delta/head-validation',
        details: { side: 'head', ...(diagnosticEntry?.subject?.path ? { path: diagnosticEntry.subject.path } : {}), ...(diagnosticEntry?.evidence || {}), supportedFixes: diagnosticEntry?.supportedFixes || [] },
        status: error.compareStatus || 1,
      });
      return;
    }

    // Validation must see the exact authored inputs. Only after both sides
    // pass do we canonicalize their collection order for deterministic SVG
    // geometry and stable artifact bytes.
    fs.writeFileSync(canonicalBaseInput, JSON.stringify(canonicalArchitecture(base)));
    fs.writeFileSync(canonicalHeadInput, JSON.stringify(canonicalArchitecture(head)));
    baseResult = renderValidatedArchitecture(canonicalBaseInput, baseCandidate, qualityArgs.quality, repoArgs.repoRoot);
    headResult = renderValidatedArchitecture(canonicalHeadInput, headCandidate, qualityArgs.quality, repoArgs.repoRoot);

    const semanticHash = (diagram) => createHash('sha256').update(canonicalArchitectureJson(diagram)).digest('hex');
    let compareIr;
    try {
      compareIr = compareArchitecture(base, head, {
        baseRawSha256: createHash('sha256').update(baseBuffer).digest('hex'),
        headRawSha256: createHash('sha256').update(headBuffer).digest('hex'),
        baseSemanticSha256: semanticHash(base),
        headSemanticSha256: semanticHash(head),
        baseBytes: baseBuffer.byteLength,
        headBytes: headBuffer.byteLength,
        baseVerified: Boolean(baseResult.sourceEvidence),
        headVerified: Boolean(headResult.sourceEvidence),
      });
    } catch (error) {
      if (!(error instanceof ArchitectureDeltaError)) throw error;
      reportCompareFailure({ json: options.json, stage: 'compare', error: error.message, code: error.code, details: error.details });
      return;
    }

    const baseSourceSvg = extractArchitectureSvg(baseResult.html);
    const headSourceSvg = extractArchitectureSvg(headResult.html);
    const baseSvg = annotateArchitectureSideSvg(baseSourceSvg, compareIr, 'base');
    const headSvg = annotateArchitectureSideSvg(headSourceSvg, compareIr, 'head');
    const deltaSvg = buildDeltaSvg(baseSourceSvg, headSourceSvg, compareIr);
    // Raw input hashes and byte counts belong in the sidecar receipt, not the
    // artifact. Keeping them out makes formatting-only input rewrites produce
    // the exact same canonical review HTML and artifact hash.
    const artifactIr = {
      ...compareIr,
      base: Object.fromEntries(Object.entries(compareIr.base).filter(([key]) => !['rawSha256', 'bytes'].includes(key))),
      head: Object.fromEntries(Object.entries(compareIr.head).filter(([key]) => !['rawSha256', 'bytes'].includes(key))),
    };
    const html = renderArchitectureDeltaHtml({
      receipt: artifactIr,
      baseSvg,
      deltaSvg,
      headSvg,
      baseHtml: baseResult.html,
      headHtml: headResult.html,
      artifactCss: extractArtifactCss(headResult.html),
    });
    const deltaValidation = validateArchitectureDeltaHtml(html, artifactIr);
    fs.writeFileSync(htmlCandidate, html);
    const artifact = fs.readFileSync(htmlCandidate);
    const baseChecks = baseResult.checks.checks.filter((check) => check.ok).length;
    const headChecks = headResult.checks.checks.filter((check) => check.ok).length;
    const finalReceipt = {
      ...compareIr,
      artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
      validation: {
        checksPassed: baseChecks + headChecks + deltaValidation.checksPassed,
        checkCount: baseResult.checks.checks.length + headResult.checks.checks.length + deltaValidation.checkCount,
        baseComposition: baseResult.checks.composition.status,
        headComposition: headResult.checks.composition.status,
      },
    };
    fs.writeFileSync(receiptCandidate, `${JSON.stringify(finalReceipt, null, 2)}\n`);

    try {
      const currentOutput = resolveOutputPath({
        requestedOutput,
        defaultOutput: 'architecture-delta.html',
        inputPaths: [basePath, headPath],
      }).outputPath;
      resolveOutputPath({
        requestedOutput: options.receipt || compareReceiptPath(currentOutput),
        defaultOutput: compareReceiptPath(currentOutput),
        inputPaths: [basePath, headPath],
        otherOutputPaths: [currentOutput],
      });
    } catch (error) {
      const outputDiagnostic = error.archifyDiagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: 'commit',
        error: error.message,
        code: outputDiagnostic?.code || 'output/path-resolution',
        details: {
          ...(outputDiagnostic?.subject || {}),
          ...(outputDiagnostic?.evidence || {}),
          supportedFixes: outputDiagnostic?.supportedFixes || ['restore safe output paths and retry'],
        },
      });
      return;
    }

    commitComparePair({ htmlCandidate, receiptCandidate, outputPath, receiptPath, stagingDirectory });
    if (options.json) console.log(JSON.stringify(finalReceipt, null, 2));
    else {
      console.log(`compared architecture ${outputPath}`);
      console.log(`${finalReceipt.validation.checksPassed}/${finalReceipt.validation.checkCount} checks; completeness ${finalReceipt.completeness}; ${finalReceipt.proofLevel}; sha256 ${finalReceipt.artifact.sha256.slice(0, 12)}`);
      console.log(`receipt ${receiptPath}`);
    }
  } catch (error) {
    if (error instanceof ArchitectureDeltaError) {
      reportCompareFailure({ json: options.json, stage: 'artifact', error: error.message, code: error.code, details: error.details });
    } else if (error.compareStage === 'commit') {
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage,
        error: error.message,
        code: error.compareCode,
        details: error.compareDetails,
      });
    } else {
      reportCompareFailure({ json: options.json, stage: 'internal', error: 'Architecture compare failed before commit.', code: 'delta/internal', details: { reason: error.message } });
    }
  } finally {
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove compare staging directory: ${error.message}`);
    }
  }
}

function commandRender(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const [type, input, output] = repoArgs.rest;
  if (!type || !input) fail(usage());
  assertEvidenceType(type, repoArgs.repoRoot);
  const result = runNode([rendererPath(type), input, ...(output ? [output] : [])], {
    env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot),
  });
  if (result.status !== 0) exitFrom(result);
}

function reportArtifactFailure({ command, json, stage, type, input, output, error, diagnostics = [], status = 1, checker }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command,
    stage,
    type,
    input,
    ...(output === undefined ? {} : { output }),
    error,
    diagnostics,
    ...(checker ? { checker } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, diagnostics));
  process.exitCode = status;
}

async function persistRepairAttempt({ repairHistory, type, input, stage, diagnostics, repairMode = 'focused' }) {
  if (!repairHistory) return null;
  const { pathsAlias } = await import('../renderers/shared/output-path.mjs');
  if (pathsAlias(repairHistory, input)) {
    throw new Error(`Repair history must not replace or alias its candidate input: ${repairHistory}`);
  }
  let prior = [];
  if (fs.existsSync(repairHistory)) {
    const parsed = JSON.parse(fs.readFileSync(repairHistory, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.attempts)) {
      throw new Error(`Repair history is not a supported schemaVersion 1 document: ${repairHistory}`);
    }
    if (parsed.type !== type || path.resolve(parsed.input) !== path.resolve(input)) {
      throw new Error(`Repair history belongs to ${parsed.type} ${parsed.input}, not ${type} ${input}.`);
    }
    prior = parsed.attempts;
  }
  const attempt = {
    stage,
    repairMode,
    errorCount: diagnostics.length,
    diagnostics,
  };
  const attempts = [...prior, attempt].slice(-64);
  writeJsonAtomic(repairHistory, {
    schemaVersion: 1,
    type,
    input: path.resolve(input),
    attempts,
  });
  return {
    path: repairHistory,
    previousAttempts: prior.slice(-63),
    attemptCount: attempts.length,
  };
}

async function reportValidateFailure({ json, stage, type, input, error, diagnostics = [], status = 1, checker, preflight, repairHistory, repairMode = 'focused' }) {
  let candidate = null;
  try {
    candidate = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  } catch {
    // Input diagnostics remain authoritative when the candidate cannot be read.
  }
  let repairPlan;
  let repairHistoryReceipt;
  try {
    repairHistoryReceipt = await persistRepairAttempt({ repairHistory, type, input, stage, diagnostics, repairMode });
    const { createRepairPlan } = await import('../authoring/repair-plan.mjs');
    repairPlan = createRepairPlan({
      type,
      candidate,
      stage,
      diagnostics,
      preflight,
      attemptHistory: repairHistoryReceipt?.previousAttempts || [],
      repairMode,
    });
  } catch (repairError) {
    repairPlan = {
      schemaVersion: 1,
      type,
      stage,
      status: 'unavailable',
      reason: repairError.message,
      actions: [],
    };
  }
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: 'validate',
    stage,
    type,
    input,
    error,
    diagnostics,
    repairPlan,
    ...(repairHistoryReceipt ? { repairHistory: {
      path: repairHistoryReceipt.path,
      attemptCount: repairHistoryReceipt.attemptCount,
    } } : {}),
    ...(checker ? { checker } : {}),
    ...(preflight ? { preflight } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, diagnostics));
  process.exitCode = status;
}

function reportDeliveryFailure(options) {
  reportArtifactFailure({ ...options, command: 'deliver' });
}

function sourceEvidenceFromArtifact(artifact) {
  const html = artifact.toString('utf8');
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  const evidence = JSON.parse(match[1]);
  if (evidence?.verified !== true || !evidence.repository?.url || !evidence.repository?.revision || !Number.isInteger(evidence.referenceCount)) {
    throw new Error('Rendered source evidence receipt is incomplete.');
  }
  return evidence;
}

function engineeringProfileFromArtifact(artifact) {
  const match = artifact.toString('utf8').match(/<svg[^>]*\sdata-engineering-profile="([^"]+)"/);
  return match ? match[1] : null;
}

async function commandDeliver(args) {
  const { resolveOutputPath } = await import('../renderers/shared/output-path.mjs');
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const languageArgs = extractEnumOption(repoArgs.rest, '--require-authored-language', ['en', 'zh-CN']);
  const json = languageArgs.rest.includes('--json');
  const open = languageArgs.rest.includes('--open');
  const knownOptions = new Set(['--json', '--open']);
  const unknown = languageArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown deliver option "${unknown[0]}".`);
  const positional = languageArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, requestedOutput] = positional;
  if (!type || !input || positional.length > 3) fail(usage());
  assertEvidenceType(type, repoArgs.repoRoot);

  const renderer = rendererPath(type);
  const inputPath = path.resolve(input);
  let specification;
  let diagram;
  try {
    specification = fs.readFileSync(inputPath);
    diagram = JSON.parse(specification.toString('utf8'));
  } catch (error) {
    const repair = inputDiagnostic(error, inputPath);
    reportDeliveryFailure({
      json,
      stage: 'input',
      type,
      input: inputPath,
      output: path.resolve(requestedOutput || `${type}.html`),
      error: `Could not read delivery input "${inputPath}": ${error.message}`,
      diagnostics: [repair],
    });
    return;
  }

  const languageAssessment = languageArgs.value
    ? await authoredLanguageAssessment(diagram, languageArgs.value)
    : { diagnostics: [], receipt: null };
  if (languageAssessment.diagnostics.length) {
    reportDeliveryFailure({
      json,
      stage: 'language',
      type,
      input: inputPath,
      output: path.resolve(requestedOutput || `${type}.html`),
      error: 'Authored language validation failed.',
      diagnostics: languageAssessment.diagnostics,
    });
    return;
  }

  const authoredOutput = typeof diagram?.meta?.output === 'string' && diagram.meta.output
    ? diagram.meta.output
    : undefined;
  let outputPath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      authoredOutput,
      defaultOutput: `${type}.html`,
      inputPaths: [inputPath],
    }));
  } catch (error) {
    const attemptedOutput = path.resolve(requestedOutput || authoredOutput || `${type}.html`);
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: attemptedOutput,
      error: error.message,
      diagnostics: error.archifyDiagnostics || [diagnostic({
        code: 'output/path-resolution',
        message: error.message,
        subject: { output: attemptedOutput },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['choose a safe output path and retry'],
      })],
    });
    return;
  }
  const outputDirectory = path.dirname(outputPath);
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    const message = `Could not create delivery directory "${outputDirectory}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-directory',
        message,
        subject: { outputDirectory },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory'],
      })],
    });
    return;
  }

  // Keep the candidate beside the target so the final rename is one
  // same-filesystem commit. A render or artifact-check failure never touches
  // an existing trusted output.
  let stagingDirectory;
  try {
    stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.archify-delivery-'));
  } catch (error) {
    const message = `Could not create a delivery candidate beside "${outputPath}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-candidate',
        message,
        subject: { output: outputPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory on the target filesystem'],
      })],
    });
    return;
  }
  const candidatePath = path.join(stagingDirectory, path.basename(outputPath));
  const specificationSnapshotPath = path.join(stagingDirectory, 'specification.snapshot.json');

  try {
    try {
      fs.writeFileSync(specificationSnapshotPath, specification, { flag: 'wx' });
    } catch (error) {
      const message = `Could not freeze the delivery specification: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'prepare',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/freeze-specification',
          message,
          subject: { input: inputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
          supportedFixes: ['choose a writable output directory on the target filesystem'],
        })],
      });
      return;
    }

    const render = runNode([renderer, specificationSnapshotPath, candidatePath], {
      stdio: 'pipe',
      env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportDeliveryFailure({
        json,
        stage: 'render',
        type,
        input: inputPath,
        output: outputPath,
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
      });
      return;
    }

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), candidatePath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      if (check.stderr) process.stderr.write(check.stderr);
      let checker;
      try {
        checker = JSON.parse(check.stdout);
        checker.file = outputPath;
      } catch {
        checker = { ok: false, file: outputPath, diagnostic: check.stdout.trim() };
      }
      reportDeliveryFailure({
        json,
        stage: 'check',
        type,
        input: inputPath,
        output: outputPath,
        error: 'Final artifact check failed; the previous artifact was preserved.',
        diagnostics: checkerDiagnostics(checker),
        status: check.status ?? 1,
        checker,
      });
      return;
    }

    let result;
    try {
      result = JSON.parse(check.stdout);
    } catch (error) {
      const message = `Could not parse the successful artifact-check receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    let artifact;
    try {
      artifact = fs.readFileSync(candidatePath);
    } catch (error) {
      const message = `Could not read the verified delivery candidate: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/candidate-unreadable',
          message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        })],
      });
      return;
    }
    let sourceEvidence;
    try {
      sourceEvidence = sourceEvidenceFromArtifact(artifact);
    } catch (error) {
      const message = `Could not read the repository evidence receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/evidence-receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    const engineeringProfile = engineeringProfileFromArtifact(artifact);
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'deliver',
      type,
      input: inputPath,
      output: outputPath,
      specification: {
        sha256: createHash('sha256').update(specification).digest('hex'),
        bytes: specification.byteLength,
      },
      artifact: {
        sha256: createHash('sha256').update(artifact).digest('hex'),
        bytes: artifact.byteLength,
      },
      ...(languageAssessment.receipt ? { authoredLanguage: languageAssessment.receipt } : {}),
      validation: {
        checksPassed: result.checks.filter((checkItem) => checkItem.ok).length,
        checkCount: result.checks.length,
        compositionProfile: result.composition.profile,
        compositionStatus: result.composition.status,
        ...(engineeringProfile ? { engineeringProfile } : {}),
        errors: result.composition.summary.errors,
        warnings: result.composition.summary.warnings,
      },
      ...(sourceEvidence ? {
        evidence: {
          verified: true,
          repository: sourceEvidence.repository.url,
          revision: sourceEvidence.repository.revision,
          references: sourceEvidence.referenceCount,
        },
      } : {}),
    };

    try {
      resolveOutputPath({
        requestedOutput,
        authoredOutput,
        defaultOutput: `${type}.html`,
        inputPaths: [inputPath],
      });
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: error.message,
        diagnostics: error.archifyDiagnostics || [diagnostic({
          code: 'output/path-resolution',
          message: error.message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
          supportedFixes: ['restore a safe output path and retry'],
        })],
      });
      return;
    }

    try {
      fs.renameSync(candidatePath, outputPath);
    } catch (error) {
      const message = `Could not commit verified delivery "${outputPath}": ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/commit',
          message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
          supportedFixes: ['choose a replaceable file target on the same writable filesystem'],
        })],
      });
      return;
    }

    if (open) {
      try {
        const { openArtifact } = await import('./open-artifact.mjs');
        receipt.open = openArtifact(outputPath);
      } catch {
        receipt.open = {
          requested: true,
          status: 'unsupported',
          target: outputPath,
          method: null,
        };
      }
      if (receipt.open.status !== 'opened') {
        console.error(`Could not open the verified artifact (${receipt.open.status}). Open it manually: ${outputPath}`);
      }
    }

    if (json) {
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      console.log(`delivered ${type} ${outputPath}`);
      const engineering = receipt.validation.engineeringProfile
        ? `; engineering ${receipt.validation.engineeringProfile}: pass`
        : '';
      console.log(`${receipt.validation.checksPassed}/${receipt.validation.checkCount} artifact checks; composition ${receipt.validation.compositionProfile}: ${receipt.validation.compositionStatus}${engineering}; sha256 ${receipt.artifact.sha256.slice(0, 12)}`);
      if (receipt.open?.status === 'opened') console.log(`opened ${outputPath}`);
    }
  } finally {
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove delivery staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

async function commandPreview(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const noOpen = repoArgs.rest.includes('--no-open');
  const knownOptions = new Set(['--no-open']);
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown preview option "${unknown[0]}".`);
  const positional = repoArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, output] = positional;
  if (!type || !input || positional.length > 3) fail(usage());
  assertEvidenceType(type, repoArgs.repoRoot);
  rendererPath(type);

  let runPreview;
  try {
    ({ runPreview } = await import('./preview.mjs'));
  } catch (error) {
    fail(`Could not load live preview: ${error.message}`, 1);
  }
  try {
    await runPreview({
      type,
      input,
      output,
      quality: qualityArgs.quality,
      repoRoot: repoArgs.repoRoot,
      open: !noOpen,
    });
  } catch (error) {
    fail(`Could not start live preview: ${error.message}`, 1);
  }
}

function commandCheck(args) {
  const [html] = args;
  if (!html) fail(usage());
  const result = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), html]);
  if (result.status !== 0) exitFrom(result);
}

async function commandVisualCheck(args) {
  const json = args.includes('--json');
  const preflight = args.includes('--preflight');
  const probe = args.includes('--probe');
  const knownOptions = new Set(['--json', '--preflight', '--probe']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown visual-check option "${unknown[0]}".`, 1);
  const positional = args.filter((arg) => !knownOptions.has(arg));
  if (probe ? (preflight || positional.length !== 0) : positional.length === 0) fail(usage(), 1);

  let visual;
  try {
    visual = await import('./visual-check.mjs');
  } catch (error) {
    fail(`Could not load visual-check: ${error.message}`, 1);
  }

  if (probe) {
    const result = await visual.probeVisualCheckCapability();
    if (json) console.log(JSON.stringify(result.receipt, null, 2));
    else {
      console.log(`visual capability ${result.receipt.status}: ${result.receipt.chrome.executable || 'Chrome unavailable'}`);
      if (result.receipt.error) console.error(result.receipt.error);
    }
    process.exitCode = result.exitCode;
    return;
  }

  if (positional.length > 1) {
    const audit = visual.auditVisualCheckBatch(positional, {
      mode: preflight ? 'preflight' : 'full',
    });
    if (!audit.ok) {
      const command = preflight ? 'visual-preflight-batch' : 'visual-check-batch';
      const failure = diagnostic({
        code: audit.code,
        message: audit.message,
        subject: { artifacts: audit.artifacts.map((entry) => entry.path) },
        evidence: { conflicts: audit.conflicts },
        supportedFixes: [
          'pass each delivered artifact exactly once',
          'rename artifacts so every visual evidence sidecar has an independent path',
        ],
      });
      const receipt = {
        schemaVersion: visual.VISUAL_RECEIPT_SCHEMA_VERSION,
        ok: false,
        command,
        status: 'fail',
        audit: { status: 'fail', code: audit.code },
        error: audit.message,
        diagnostics: [failure],
        artifacts: audit.artifacts.map((entry) => ({
          schemaVersion: visual.VISUAL_RECEIPT_SCHEMA_VERSION,
          ok: false,
          command: preflight ? 'visual-preflight' : 'visual-check',
          status: 'fail',
          ...(preflight ? {} : { visualReview: 'pending' }),
          artifact: { path: entry.path },
          error: audit.message,
          diagnostics: [failure],
        })),
      };
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else {
        console.log(`${receipt.command} fail: ${receipt.artifacts.length} artifacts`);
        console.error(receipt.error);
      }
      process.exitCode = 1;
      return;
    }
  }

  const session = new visual.VisualCheckSession();
  const results = [];
  let capability;
  try {
    capability = await session.probe();
    for (const [index, artifactPath] of positional.entries()) {
      try {
        const finalArtifact = index === positional.length - 1;
        results.push(preflight
          ? await session.preflight({ artifactPath, finalArtifact })
          : await session.run({ artifactPath, finalArtifact }));
      } catch (error) {
        results.push({
          exitCode: 1,
          receipt: {
            schemaVersion: visual.VISUAL_RECEIPT_SCHEMA_VERSION,
            ok: false,
            command: preflight ? 'visual-preflight' : 'visual-check',
            status: 'fail',
            ...(preflight ? {} : { visualReview: 'pending' }),
            artifact: { path: path.resolve(artifactPath) },
            error: error.message,
            diagnostics: [diagnostic({
              code: 'viewer/visual-check-runtime',
              message: error.message,
              subject: { artifact: path.resolve(artifactPath) },
            })],
          },
        });
      }
    }
  } finally {
    await session.close();
  }

  if (results.length === 1) {
    const [result] = results;
    if (json) {
      console.log(JSON.stringify(result.receipt, null, 2));
    } else {
      const artifactPath = result.receipt.artifact?.path || '(unknown artifact)';
      console.log(`${result.receipt.command} ${result.receipt.status}: ${artifactPath}`);
      const summary = [];
      if (result.receipt.containment?.status) {
        summary.push(`containment ${result.receipt.containment.status}`);
      }
      if (result.receipt.captures?.status) {
        summary.push(`captures ${result.receipt.captures.status}`);
      }
      if (!preflight) summary.push(`visual review ${result.receipt.visualReview || 'pending'}`);
      if (summary.length) console.log(summary.join('; '));
      if (result.receipt.sidecars?.receipt && result.receipt.artifact?.path) {
        console.log(`receipt ${path.join(path.dirname(artifactPath), result.receipt.sidecars.receipt)}`);
      }
      if (result.receipt.captures?.contactSheet && result.receipt.artifact?.path) {
        console.log(`contact sheet ${path.join(path.dirname(artifactPath), result.receipt.captures.contactSheet)}`);
      }
      if (result.receipt.error) console.error(result.receipt.error);
    }
    process.exitCode = result.exitCode;
    return;
  }

  const exitCode = results.every((result) => result.exitCode === 0)
    ? 0
    : results.every((result) => result.exitCode === 2) ? 2 : 1;
  const receipt = {
    schemaVersion: visual.VISUAL_RECEIPT_SCHEMA_VERSION,
    ok: exitCode === 0,
    command: preflight ? 'visual-preflight-batch' : 'visual-check-batch',
    status: exitCode === 0 ? 'pass' : exitCode === 2 ? 'skipped' : 'fail',
    capability,
    artifacts: results.map((result) => result.receipt),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else {
    console.log(`${receipt.command} ${receipt.status}: ${receipt.artifacts.length} artifacts`);
    for (const artifact of receipt.artifacts) {
      const artifactPath = artifact.artifact?.path || '(unknown artifact)';
      console.log(`[${artifact.status}] ${artifactPath}`);
      if (artifact.error) console.error(`${artifactPath}: ${artifact.error}`);
    }
    if (receipt.error) console.error(receipt.error);
  }
  process.exitCode = exitCode;
}

function writeJsonAtomic(targetInput, value) {
  const target = path.resolve(targetInput);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return target;
}

function utilityFailure(command, error, json) {
  const diagnostics = Array.isArray(error?.archifyDiagnostics) && error.archifyDiagnostics.length
    ? error.archifyDiagnostics
    : [diagnostic({
      code: error.code || `${command}/failed`,
      message: error.message,
      evidence: error.details || {},
    })];
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command,
    error: error.message,
    diagnostics,
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(`${command} failed: ${error.message}`);
  process.exitCode = 1;
}

async function commandAuthoringKit(args) {
  let json = false;
  let contextJson = false;
  let expectContract;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--context-json') {
      contextJson = true;
      continue;
    }
    if (arg === '--expect-contract') {
      expectContract = args[index + 1];
      if (!expectContract || expectContract.startsWith('--')) fail('--expect-contract requires a SHA-256 digest.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--expect-contract=')) {
      expectContract = arg.slice('--expect-contract='.length);
      if (!expectContract) fail('--expect-contract requires a SHA-256 digest.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown authoring-kit option "${arg}".`);
    positional.push(arg);
  }
  if (positional.length !== 1) fail(usage());
  try {
    const { loadAuthoringKit } = await import('../authoring/authoring-kit.mjs');
    const packet = loadAuthoringKit(positional[0], {
      skillRoot,
      contextJson,
      ...(expectContract ? { expectContract } : {}),
    });
    if (json) {
      console.log(JSON.stringify(packet, null, contextJson ? 0 : 2));
      return;
    }
    console.log(`Archify authoring kit: ${packet.type}`);
    for (const [role, file] of Object.entries(packet.files)) {
      console.log(`${role}: ${file.path} (${file.bytes} bytes; sha256 ${file.sha256})`);
    }
  } catch (error) {
    utilityFailure('authoring-kit', error, json);
  }
}

async function commandAuthoringRun(args) {
  const [action, ...actionArgs] = args;
  const positional = [];
  const values = {};
  let json = false;
  const allowed = action === 'start'
    ? new Set(['--run-id', '--output', '--repo-root', '--project-index', '--requirements', '--candidate', '--scope-profile', '--expect-contract', '--require-authored-language'])
    : action === 'finalize'
      ? new Set(['--candidate', '--evidence', '--validation'])
      : action === 'stop'
        ? new Set(['--status', '--reason'])
      : null;
  if (!allowed) fail(usage());
  for (let index = 0; index < actionArgs.length; index += 1) {
    const arg = actionArgs[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    const option = [...allowed].find((candidate) => arg === candidate || arg.startsWith(`${candidate}=`));
    if (option) {
      const inline = arg.startsWith(`${option}=`);
      const value = inline ? arg.slice(option.length + 1) : actionArgs[index + 1];
      if (!value || (!inline && value.startsWith('--'))) fail(`${option} requires a value.`);
      if (!inline) index += 1;
      values[option] = value;
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown authoring-run ${action} option "${arg}".`);
    positional.push(arg);
  }
  if (action === 'start' && values['--require-authored-language']
    && !['en', 'zh-CN'].includes(values['--require-authored-language'])) {
    fail('Unknown --require-authored-language value. Expected one of: en, zh-CN.');
  }
  if (action === 'start' && values['--scope-profile']
    && !['focused', 'project-overview'].includes(values['--scope-profile'])) {
    fail('Unknown --scope-profile value. Expected one of: focused, project-overview.');
  }
  try {
    const module = await import('../authoring/authoring-run.mjs');
    if (action === 'start') {
      if (positional.length !== 1 || !TYPES.has(positional[0])
        || !values['--run-id'] || !values['--output']
        || !values['--repo-root'] || !values['--project-index']
        || !values['--requirements'] || !values['--candidate']
        || !values['--scope-profile'] || !values['--expect-contract']) fail(usage());
      const started = module.startAuthoringRun({
        run: {
          id: values['--run-id'],
          diagramType: positional[0],
          scopeProfile: values['--scope-profile'],
          ...(values['--require-authored-language']
            ? { requiredLanguage: values['--require-authored-language'] }
            : {}),
        },
        outputDirectory: values['--output'],
        repoRoot: values['--repo-root'],
        projectIndexPath: values['--project-index'],
        requirementsPath: values['--requirements'],
        candidatePath: values['--candidate'],
        expectContract: values['--expect-contract'],
      });
      const receipt = {
        schemaVersion: 1,
        ok: true,
        command: 'authoring-run-start',
        status: 'started',
        envelope: started.envelope,
        paths: started.paths,
      };
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else console.log(`Authoring run started: ${started.paths.envelopePath}`);
      return;
    }
    if (action === 'stop') {
      if (positional.length !== 1 || !values['--status'] || !values['--reason']
        || !['failed', 'blocked', 'aborted'].includes(values['--status'])) fail(usage());
      const stopped = module.terminalizeAuthoringRun({
        envelopePath: positional[0],
        status: values['--status'],
        reason: values['--reason'],
      });
      const receipt = {
        schemaVersion: 1,
        ok: true,
        command: 'authoring-run-stop',
        status: stopped.timing.status,
        timing: stopped.timing,
        terminalReceipt: stopped.terminalReceipt,
        paths: stopped.paths,
      };
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else {
        console.log(`Authoring run ${stopped.timing.status}: ${stopped.paths.timingPath}`);
        console.log(`Report: ${stopped.paths.reportPath}`);
      }
      return;
    }
    if (positional.length !== 1 || !values['--candidate']
      || !values['--evidence'] || !values['--validation']) fail(usage());
    const completed = module.finalizeAuthoringRun({
      envelopePath: positional[0],
      candidatePath: values['--candidate'],
      evidencePath: values['--evidence'],
      validationPath: values['--validation'],
    });
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'authoring-run-finalize',
      status: completed.report.status,
      timing: completed.timing,
      handoff: completed.handoff,
      paths: completed.paths,
    };
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else {
      console.log(`Authoring run ready: ${completed.paths.handoffPath}`);
      console.log(`Timing: ${completed.paths.timingPath}`);
      console.log(`Report: ${completed.paths.reportPath}`);
    }
  } catch (error) {
    utilityFailure(`authoring-run-${action}`, error, json);
  }
}

async function commandValidateBatch(args) {
  const qualityArgs = extractQualityArgs(args);
  const json = qualityArgs.rest.includes('--json');
  const unknown = qualityArgs.rest.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (unknown.length) fail(`Unknown validate-batch option "${unknown[0]}".`);
  const positional = qualityArgs.rest.filter((arg) => arg !== '--json');
  if (positional.length !== 1) fail(usage());
  try {
    const manifestPath = path.resolve(positional[0]);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.candidates)) {
      throw new Error('validate-batch requires a schemaVersion 1 manifest with candidates[].');
    }
    const directory = path.dirname(manifestPath);
    const candidates = manifest.candidates.map((candidate) => ({
      ...candidate,
      input: path.resolve(directory, candidate.input),
      ...(candidate.repoRoot ? { repoRoot: path.resolve(directory, candidate.repoRoot) } : {}),
      ...(candidate.repairHistory ? { repairHistory: path.resolve(directory, candidate.repairHistory) } : {}),
    }));
    const { runCandidatePreflightBatch } = await import('../authoring/candidate-preflight.mjs');
    const result = await runCandidatePreflightBatch({
      candidates,
      skillRoot,
      quality: qualityArgs.quality || 'showcase',
    });
    if (json) console.log(JSON.stringify(result.receipt, null, 2));
    else console.log(`validate-batch ${result.receipt.status}: ${result.receipt.candidates.filter((candidate) => candidate.ok).length}/${result.receipt.candidates.length}`);
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
  } catch (error) {
    utilityFailure('validate-batch', error, json);
  }
}

function utilityOptions(args, { allowRevision = false, allowRepoRoot = false, allowProjectIndex = false } = {}) {
  const positional = [];
  let json = false;
  let output;
  let revision;
  let repoRoot;
  let projectIndex;
  const valueOptions = new Set([
    '--output',
    ...(allowRevision ? ['--revision'] : []),
    ...(allowRepoRoot ? ['--repo-root'] : []),
    ...(allowProjectIndex ? ['--project-index'] : []),
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value.`);
      if (arg === '--output') output = value;
      if (arg === '--revision') revision = value;
      if (arg === '--repo-root') repoRoot = path.resolve(value);
      if (arg === '--project-index') projectIndex = path.resolve(value);
      index += 1;
      continue;
    }
    const matched = [...valueOptions].find((option) => arg.startsWith(`${option}=`));
    if (matched) {
      const value = arg.slice(matched.length + 1);
      if (!value) fail(`${matched} requires a value.`);
      if (matched === '--output') output = value;
      if (matched === '--revision') revision = value;
      if (matched === '--repo-root') repoRoot = path.resolve(value);
      if (matched === '--project-index') projectIndex = path.resolve(value);
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown option "${arg}".`);
    positional.push(arg);
  }
  return { positional, json, output, revision, repoRoot, projectIndex };
}

async function commandProjectIndex(args) {
  if (args[0] === 'source-search') {
    const searchArgs = args.slice(1);
    const positional = [];
    const terms = [];
    const paths = [];
    let contextLines = 2;
    let maxResults = 20;
    let output;
    let json = false;
    for (let index = 0; index < searchArgs.length; index += 1) {
      const arg = searchArgs[index];
      if (arg === '--json') {
        json = true;
        continue;
      }
      const matchedValueOption = ['--term', '--path', '--context', '--context-lines', '--max-results', '--output']
        .find((option) => arg === option || arg.startsWith(`${option}=`));
      if (matchedValueOption) {
        const inline = arg.startsWith(`${matchedValueOption}=`);
        const value = inline ? arg.slice(matchedValueOption.length + 1) : searchArgs[index + 1];
        if (!value || (!inline && value.startsWith('--'))) fail(`${matchedValueOption} requires a value.`);
        if (!inline) index += 1;
        if (matchedValueOption === '--term') terms.push(value);
        else if (matchedValueOption === '--path') paths.push(value);
        else if (matchedValueOption === '--context' || matchedValueOption === '--context-lines') contextLines = Number(value);
        else if (matchedValueOption === '--max-results') maxResults = Number(value);
        else output = value;
        continue;
      }
      if (arg.startsWith('--')) fail(`Unknown project-index source-search option "${arg}".`);
      positional.push(arg);
    }
    if (positional.length !== 1) fail(usage());
    try {
      const { searchProjectSource } = await import('../evidence/project-index.mjs');
      const projectIndex = JSON.parse(fs.readFileSync(path.resolve(positional[0]), 'utf8'));
      const receipt = searchProjectSource(projectIndex, {
        terms,
        paths,
        contextLines,
        maxResults,
      });
      const outputPath = output ? writeJsonAtomic(output, receipt) : null;
      if (json || !outputPath) console.log(JSON.stringify(receipt, null, 2));
      else console.log(`Project source search ready: ${outputPath} (${receipt.returned} matches)`);
    } catch (error) {
      utilityFailure('project-index-source-search', error, json);
    }
    return;
  }
  if (args[0] === 'inspect') {
    const inspectArgs = args.slice(1);
    const positional = [];
    const ranges = [];
    let maxResults = 20;
    let output;
    let json = false;
    for (let index = 0; index < inspectArgs.length; index += 1) {
      const arg = inspectArgs[index];
      if (arg === '--json') {
        json = true;
        continue;
      }
      const matchedValueOption = ['--range', '--max-results', '--output']
        .find((option) => arg === option || arg.startsWith(`${option}=`));
      if (matchedValueOption) {
        const inline = arg.startsWith(`${matchedValueOption}=`);
        const value = inline ? arg.slice(matchedValueOption.length + 1) : inspectArgs[index + 1];
        if (!value || (!inline && value.startsWith('--'))) fail(`${matchedValueOption} requires a value.`);
        if (!inline) index += 1;
        if (matchedValueOption === '--range') {
          const match = value.match(/^(.+):([1-9]\d*)-([1-9]\d*)$/);
          if (!match) fail('--range requires path:start-end with positive line numbers.');
          ranges.push({ path: match[1], line: Number(match[2]), endLine: Number(match[3]) });
        } else if (matchedValueOption === '--max-results') maxResults = Number(value);
        else output = value;
        continue;
      }
      if (arg.startsWith('--')) fail(`Unknown project-index inspect option "${arg}".`);
      positional.push(arg);
    }
    if (positional.length !== 1) fail(usage());
    try {
      const { inspectProjectSource } = await import('../evidence/project-index.mjs');
      const projectIndex = JSON.parse(fs.readFileSync(path.resolve(positional[0]), 'utf8'));
      const receipt = inspectProjectSource(projectIndex, { ranges, maxResults });
      const outputPath = output ? writeJsonAtomic(output, receipt) : null;
      if (json || !outputPath) console.log(JSON.stringify(receipt, null, 2));
      else console.log(`Project source inspection ready: ${outputPath} (${receipt.returned} ranges)`);
    } catch (error) {
      utilityFailure('project-index-source-inspect', error, json);
    }
    return;
  }
  if (args[0] === 'query') {
    const queryArgs = args.slice(1);
    const positional = [];
    const criteria = { symbols: [], imports: [], paths: [], languages: [], packages: [] };
    let json = false;
    let output;
    let maxResults = 20;
    const optionMap = new Map([
      ['--symbol', 'symbols'],
      ['--symbols', 'symbols'],
      ['--import', 'imports'],
      ['--imports', 'imports'],
      ['--path', 'paths'],
      ['--language', 'languages'],
      ['--package', 'packages'],
    ]);
    for (let index = 0; index < queryArgs.length; index += 1) {
      const arg = queryArgs[index];
      if (arg === '--json') {
        json = true;
        continue;
      }
      const mapped = optionMap.get(arg);
      if (mapped) {
        const value = queryArgs[index + 1];
        if (!value || value.startsWith('--')) fail(`${arg} requires a value.`);
        criteria[mapped].push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
        index += 1;
        continue;
      }
      if (arg === '--max-results' || arg === '--output') {
        const value = queryArgs[index + 1];
        if (!value || value.startsWith('--')) fail(`${arg} requires a value.`);
        if (arg === '--max-results') maxResults = Number(value);
        else output = value;
        index += 1;
        continue;
      }
      if (arg.startsWith('--')) fail(`Unknown project-index query option "${arg}".`);
      positional.push(arg);
    }
    if (positional.length !== 1) fail(usage());
    try {
      const { queryProjectIndex } = await import('../evidence/project-index.mjs');
      const projectIndex = JSON.parse(fs.readFileSync(path.resolve(positional[0]), 'utf8'));
      const receipt = queryProjectIndex(projectIndex, { ...criteria, maxResults });
      const outputPath = output ? writeJsonAtomic(output, receipt) : null;
      if (json || !outputPath) console.log(JSON.stringify(receipt, null, 2));
      else console.log(`Project index query ready: ${outputPath} (${receipt.summary.returned} results)`);
    } catch (error) {
      utilityFailure('project-index-query', error, json);
    }
    return;
  }
  const options = utilityOptions(args, { allowRevision: true });
  if (options.positional.length !== 1) fail(usage());
  try {
    const { buildProjectIndex } = await import('../evidence/project-index.mjs');
    const index = buildProjectIndex({
      repoRoot: options.positional[0],
      revision: options.revision || 'HEAD',
    });
    const output = options.output ? writeJsonAtomic(options.output, index) : null;
    if (options.json || !output) {
      console.log(JSON.stringify(index, null, 2));
      return;
    }
    console.log(`Project index ready: ${output}`);
    console.log(`${index.files.length} files; ${index.analysis.filesAnalyzed} analyzed; revision ${index.repository.revision}`);
  } catch (error) {
    utilityFailure('project-index', error, options.json);
  }
}

async function commandEvidenceLedger(args) {
  const [action, ...rest] = args;
  const options = utilityOptions(rest, {
    allowRepoRoot: action === 'verify',
    allowProjectIndex: action === 'verify',
  });
  let module;
  try {
    module = await import('../evidence/project-index.mjs');
  } catch (error) {
    utilityFailure('evidence-ledger', error, options.json);
    return;
  }

  try {
    let result;
    if (action === 'create' || action === 'hydrate') {
      if (options.positional.length !== 2 || options.repoRoot) fail(usage());
      const index = JSON.parse(fs.readFileSync(path.resolve(options.positional[0]), 'utf8'));
      const selections = JSON.parse(fs.readFileSync(path.resolve(options.positional[1]), 'utf8'));
      result = module.createEvidenceLedger(index, selections);
    } else if (action === 'verify') {
      if (options.positional.length !== 1 || !options.repoRoot || !options.projectIndex) fail(usage());
      const ledger = JSON.parse(fs.readFileSync(path.resolve(options.positional[0]), 'utf8'));
      const projectIndex = JSON.parse(fs.readFileSync(options.projectIndex, 'utf8'));
      result = module.verifyEvidenceLedger(ledger, { repoRoot: options.repoRoot, projectIndex });
    } else {
      fail(usage());
    }
    const output = options.output ? writeJsonAtomic(options.output, result) : null;
    if (options.json || !output) console.log(JSON.stringify(result, null, 2));
    else console.log(`Evidence ledger ${action} complete: ${output}`);
  } catch (error) {
    utilityFailure('evidence-ledger', error, options.json);
  }
}

async function commandRunSuite(args) {
  const { main } = await import('./run-suite.mjs');
  const exitCode = await main(args);
  if (exitCode !== 0) process.exitCode = exitCode;
}

function commandExamples() {
  const result = runNode([path.join(skillRoot, 'scripts/render-examples.mjs')], { cwd: skillRoot });
  if (result.status !== 0) exitFrom(result);
}

async function commandDoctor() {
  const checks = [];
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    label: `Node.js v${process.versions.node} (requires >=18)`,
    ok: nodeMajor >= 18,
    missing: 0,
    failureLabel: 'unsupported',
  });

  const template = path.join(skillRoot, 'assets/template.html');
  checks.push({
    label: 'Core template',
    ok: fs.existsSync(template),
    missing: fs.existsSync(template) ? 0 : 1,
  });

  const examplesRenderer = path.join(skillRoot, 'scripts/render-examples.mjs');
  checks.push({
    label: 'Example renderer',
    ok: fs.existsSync(examplesRenderer),
    missing: fs.existsSync(examplesRenderer) ? 0 : 1,
  });

  const previewRuntime = path.join(skillRoot, 'bin/preview.mjs');
  checks.push({
    label: 'Live preview runtime',
    ok: fs.existsSync(previewRuntime),
    missing: fs.existsSync(previewRuntime) ? 0 : 1,
  });

  const visualCheckRuntime = path.join(skillRoot, 'bin/visual-check.mjs');
  checks.push({
    label: 'Visual-check runtime',
    ok: fs.existsSync(visualCheckRuntime),
    missing: fs.existsSync(visualCheckRuntime) ? 0 : 1,
  });

  const optimizationRuntimes = [
    path.join(skillRoot, 'authoring', 'authoring-kit.mjs'),
    path.join(skillRoot, 'authoring', 'authoring-run.mjs'),
    path.join(skillRoot, 'authoring', 'candidate-preflight.mjs'),
    path.join(skillRoot, 'authoring', 'repair-plan.mjs'),
    path.join(skillRoot, 'authoring', 'quality-contract.mjs'),
    path.join(skillRoot, 'evidence', 'project-index.mjs'),
    path.join(skillRoot, 'orchestration', 'suite-runner.mjs'),
    path.join(skillRoot, 'orchestration', 'run-recorder.mjs'),
    path.join(skillRoot, 'bin', 'run-suite.mjs'),
  ];
  const optimizationRuntimesMissing = optimizationRuntimes.filter((file) => !fs.existsSync(file)).length;
  checks.push({
    label: 'Authoring, evidence, and suite orchestration runtimes',
    ok: optimizationRuntimesMissing === 0,
    missing: optimizationRuntimesMissing,
  });

  const outputPathRuntime = path.join(skillRoot, 'renderers/shared/output-path.mjs');
  checks.push({
    label: 'Output path safety runtime',
    ok: fs.existsSync(outputPathRuntime),
    missing: fs.existsSync(outputPathRuntime) ? 0 : 1,
  });

  const scenarioGuide = path.join(skillRoot, 'recipes/scenarios.mjs');
  checks.push({
    label: 'Scenario recipe guide',
    ok: fs.existsSync(scenarioGuide),
    missing: fs.existsSync(scenarioGuide) ? 0 : 1,
  });

  const authoringReferences = [
    path.join(skillRoot, 'references', 'authoring-contract.md'),
    path.join(skillRoot, 'references', 'viewer-runtime.md'),
    path.join(skillRoot, 'references', 'delivery-contract.md'),
  ];
  const authoringReferencesMissing = authoringReferences.filter((file) => !fs.existsSync(file)).length;
  checks.push({
    label: 'Progressive authoring references',
    ok: authoringReferencesMissing === 0,
    missing: authoringReferencesMissing,
  });

  const compareRuntime = path.join(skillRoot, 'delta/architecture-delta.mjs');
  const compareFixtures = [
    path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples/checkout-platform.head.architecture.json'),
  ];
  const compareMissing = [compareRuntime, ...compareFixtures].filter((file) => !fs.existsSync(file)).length;
  checks.push({
    label: 'Architecture compare runtime and proof fixtures',
    ok: compareMissing === 0,
    missing: compareMissing,
  });

  const validators = path.join(skillRoot, 'renderers/shared/generated-validators.mjs');
  const validatorsExist = fs.existsSync(validators);
  let validatorsValid = false;
  if (validatorsExist) {
    try {
      const module = await import(`${pathToFileURL(validators).href}?doctor=${Date.now()}`);
      validatorsValid = [...TYPES].every((type) => typeof module[type] === 'function');
    } catch {
      validatorsValid = false;
    }
  }
  checks.push({
    label: 'Standalone schema validators',
    ok: validatorsValid,
    missing: validatorsExist ? 0 : 1,
    invalid: validatorsExist && !validatorsValid ? 1 : 0,
    failureLabel: validatorsExist ? 'invalid' : 'missing',
  });

  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };

  for (const type of TYPES) {
    const required = [
      path.join(skillRoot, 'renderers', type, `render-${type}.mjs`),
      path.join(skillRoot, 'schemas', `${type}.schema.json`),
      path.join(skillRoot, 'examples', examples[type]),
    ];
    const missing = required.filter((file) => !fs.existsSync(file)).length;
    checks.push({
      label: `${type} renderer, schema, and example`,
      ok: missing === 0,
      missing,
    });
  }

  console.log('Archify doctor\n');
  for (const check of checks) {
    console.log(`[${check.ok ? 'ok' : (check.failureLabel || 'missing')}] ${check.label}`);
  }

  const nodeFailed = checks[0].ok ? 0 : 1;
  const missingFiles = checks.reduce((count, check) => count + check.missing, 0);
  const invalidRuntime = checks.reduce((count, check) => count + (check.invalid || 0), 0);
  if (nodeFailed === 0 && missingFiles === 0 && invalidRuntime === 0) {
    console.log('\nArchify is ready.');
    return;
  }

  const problems = [];
  if (nodeFailed) problems.push('Node.js 18 or newer is required');
  if (missingFiles) problems.push(`${missingFiles} required file${missingFiles === 1 ? '' : 's'} missing`);
  if (invalidRuntime) problems.push(`${invalidRuntime} runtime check${invalidRuntime === 1 ? '' : 's'} failed`);
  console.error(`\nArchify is not ready: ${problems.join('; ')}.`);
  process.exitCode = 1;
}

async function commandGuide(args) {
  let lang;
  let json = false;
  const queryParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--lang') {
      const value = args[index + 1];
      if (value !== 'en' && value !== 'zh') fail('--lang must be "en" or "zh".');
      lang = value;
      index += 1;
    } else if (arg.startsWith('--lang=')) {
      const value = arg.slice('--lang='.length);
      if (value !== 'en' && value !== 'zh') fail('--lang must be "en" or "zh".');
      lang = value;
    } else if (arg.startsWith('--')) {
      fail(`Unknown guide option "${arg}".`);
    } else {
      queryParts.push(arg);
    }
  }

  const guidePath = path.join(skillRoot, 'recipes/scenarios.mjs');
  let guide;
  try {
    guide = await import(pathToFileURL(guidePath).href);
  } catch (error) {
    fail(`Could not load the scenario recipe guide: ${error.message}`, 1);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    const selectedLang = lang || 'en';
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'list',
        lang: selectedLang,
        recipes: guide.listScenarioRecipes(selectedLang),
      }, null, 2));
    } else {
      console.log(guide.formatScenarioList(selectedLang));
    }
    return;
  }

  const result = guide.recommendScenario(query, lang ? { lang } : {});
  console.log(json ? JSON.stringify(result, null, 2) : guide.formatScenarioRecommendation(result));
}

async function commandBrands(args) {
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (unknown.length) fail(`Unknown brands option "${unknown[0]}".`);
  const positional = args.filter((arg) => arg !== '--json');
  if (positional[0] === 'capture') {
    if (positional.length !== 2) fail('Usage: archify brands capture <url> [--json]');
    const { captureBrandReference } = await import('../renderers/shared/brand-marks.mjs');
    let capture;
    try {
      capture = await captureBrandReference(positional[1]);
    } catch (error) {
      fail(error.message);
    }
    const result = {
      schemaVersion: 1,
      ok: true,
      command: 'brands capture',
      brand: capture.brand,
      evidence: {
        status: capture.resolved.status,
        source: capture.resolved.sourceUrl,
        ...(capture.resolved.sha256 ? { sha256: capture.resolved.sha256 } : {}),
        ...(capture.resolved.contentType ? { contentType: capture.resolved.contentType } : {}),
      },
    };
    console.log(json ? JSON.stringify(result, null, 2) : JSON.stringify(result.brand));
    return;
  }
  const query = positional.join(' ').trim();
  const { listBrandMarks } = await import('../renderers/shared/brand-marks.mjs');
  const marks = listBrandMarks(query);
  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'brands',
      query,
      count: marks.length,
      marks,
      fallback: 'Run "archify brands capture <url> --json", then use the returned digest-pinned brand value.',
    }, null, 2));
    return;
  }
  if (!marks.length) {
    console.log(`No built-in brand matched "${query}". Run "archify brands capture <url> --json", then use the returned digest-pinned brand value.`);
    return;
  }
  const grouped = Map.groupBy
    ? Map.groupBy(marks, (mark) => mark.category)
    : marks.reduce((map, mark) => map.set(mark.category, [...(map.get(mark.category) || []), mark]), new Map());
  for (const [category, entries] of grouped) {
    console.log(`${category}: ${entries.map((mark) => mark.id).join(', ')}`);
  }
}

function commandDemo(args) {
  if (args.length > 1) fail(usage());

  const outputDirectory = path.resolve(args[0] || process.cwd());
  const output = path.join(outputDirectory, 'archify-demo.html');
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');

  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    fail(`Could not create demo directory "${outputDirectory}": ${error.message}`, 1);
  }

  const result = runNode([rendererPath('architecture'), input, output]);
  if (result.status !== 0) exitFrom(result);

  console.log(`\nDemo ready: ${output}`);
  console.log('Next: open the HTML in your browser, then render your own diagram:');
  console.log('  archify render architecture <input.json> <output.html>');
}

function ephemeralPreflightReceipt(receipt) {
  return {
    ...receipt,
    artifact: {
      ...receipt.artifact,
      ephemeral: true,
    },
    captures: {
      ...receipt.captures,
      retained: false,
    },
    sidecars: {
      ...receipt.sidecars,
      retained: false,
    },
  };
}

function migrationPathDiagnostics(error, sourcePath, destinationPath) {
  if (Array.isArray(error?.archifyDiagnostics) && error.archifyDiagnostics.length) {
    return error.archifyDiagnostics.map((entry) => ({
      ...entry,
      subject: { ...(entry.subject || {}) },
      evidence: { ...(entry.evidence || {}) },
      supportedFixes: [...(entry.supportedFixes || [])],
    }));
  }
  return [diagnostic({
    code: 'migration/path-preflight',
    message: 'Could not verify that the workflow migration paths are distinct.',
    subject: { source: sourcePath, destination: destinationPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error?.message || String(error),
    },
    supportedFixes: ['remove unsafe path aliases or choose a different destination path'],
  })];
}

function migrationReport({
  ok,
  sourcePath,
  destinationPath,
  sourceBytes,
  destinationBytes,
  fromSchemaVersion,
  preExistingDiagnostics = [],
  migrationDiagnostics = [],
  newSchemaDiagnostics = [],
  changedCoordinates = [],
  oldRequiredViewBox = null,
  newRequiredViewBox = null,
}) {
  const report = {
    ok,
    command: 'migrate',
    type: 'workflow',
    source: {
      path: sourcePath,
      ...(sourceBytes ? {
        sha256: createHash('sha256').update(sourceBytes).digest('hex'),
        bytes: sourceBytes.length,
      } : {}),
    },
    destination: {
      path: destinationPath,
      ...(destinationBytes ? {
        sha256: createHash('sha256').update(destinationBytes).digest('hex'),
        bytes: destinationBytes.length,
      } : {}),
    },
    fromSchemaVersion: fromSchemaVersion ?? null,
    toSchemaVersion: 2,
    preExistingDiagnostics,
    migrationDiagnostics,
    newSchemaDiagnostics,
    changedCoordinates,
    oldRequiredViewBox,
    newRequiredViewBox,
  };
  if (!ok) {
    report.diagnostics = [
      ...migrationDiagnostics,
      ...newSchemaDiagnostics,
      ...preExistingDiagnostics,
    ];
    if (!report.diagnostics.length) {
      report.diagnostics.push(diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed without a classified diagnostic.',
      }));
    }
    report.error = report.diagnostics[0].message;
  }
  return report;
}

function extractMigrationOptions(args) {
  const positional = [];
  let json = false;
  let toSchema;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--to-schema') {
      toSchema = args[index + 1];
      if (!toSchema || toSchema.startsWith('--')) fail('--to-schema requires a schema version.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--to-schema=')) {
      toSchema = arg.slice('--to-schema='.length);
      if (!toSchema) fail('--to-schema requires a schema version.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown migrate option "${arg}".`);
    positional.push(arg);
  }
  return { positional, json, toSchema };
}

async function commandMigrate(args) {
  const options = extractMigrationOptions(args);
  const [type, sourceArgument, destinationArgument] = options.positional;
  if (
    type !== 'workflow'
    || !sourceArgument
    || !destinationArgument
    || options.positional.length !== 3
    || options.toSchema !== '2'
  ) {
    fail('Usage: archify migrate workflow <old.json> <new.json> --to-schema 2 [--json]');
  }

  const sourcePath = path.resolve(sourceArgument);
  const destinationPath = path.resolve(destinationArgument);
  let sourceBytes;
  let sourceDocument;
  const reportMigrationFailure = ({ status = 1, ...details }) => {
    const report = migrationReport({
      ...details,
      ok: false,
      sourcePath,
      destinationPath,
      sourceBytes,
      fromSchemaVersion: sourceDocument?.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.error(formatDiagnostics(report.error, report.diagnostics));
    process.exitCode = status;
  };
  try {
    sourceBytes = fs.readFileSync(sourcePath);
    sourceDocument = JSON.parse(sourceBytes.toString('utf8'));
  } catch (error) {
    reportMigrationFailure({
      preExistingDiagnostics: [inputDiagnostic(error, sourcePath)],
    });
    return;
  }
  // Unlike render/validate, migrate has no --quality override. Pin every stage
  // to the document's durable policy and scrub any ambient profile from the
  // staged renderer by passing this value explicitly.
  const activeQualityProfile = sourceDocument?.meta?.quality_profile || 'standard';

  const { pathsAlias } = await import('../renderers/shared/output-path.mjs');
  let sourceDestinationAlias;
  try {
    sourceDestinationAlias = pathsAlias(sourcePath, destinationPath);
  } catch (error) {
    reportMigrationFailure({
      migrationDiagnostics: migrationPathDiagnostics(error, sourcePath, destinationPath),
    });
    return;
  }
  if (sourceDestinationAlias) {
    reportMigrationFailure({
      migrationDiagnostics: [diagnostic({
        code: 'migration/source-destination',
        message: 'Workflow migration source and destination must be different files.',
        subject: { source: sourcePath, destination: destinationPath },
        supportedFixes: ['choose a different destination path and keep the source unchanged'],
      })],
    });
    return;
  }

  const { migrateWorkflowDocument, serializeMigratedWorkflow } = await import('../migrations/workflow-v2.mjs');
  let migration;
  try {
    migration = migrateWorkflowDocument(sourceDocument);
  } catch (error) {
    migration = {
      ok: false,
      migrationDiagnostics: [diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed unexpectedly.',
        evidence: { reason: error.message },
        supportedFixes: ['report the source workflow and this diagnostic to the Archify maintainers'],
      })],
    };
  }

  if (!migration.ok) {
    reportMigrationFailure(migration);
    return;
  }

  if (fs.existsSync(destinationPath) && !fs.lstatSync(destinationPath).isFile()) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/destination-type',
        message: 'Workflow migration destination must be a regular file path.',
        subject: { destination: destinationPath },
        supportedFixes: ['choose a destination path that is absent or names a regular file'],
      })],
    });
    return;
  }

  const destinationDirectory = path.dirname(destinationPath);
  let stagingDirectory;
  try {
    fs.mkdirSync(destinationDirectory, { recursive: true });
    stagingDirectory = fs.mkdtempSync(path.join(destinationDirectory, '.archify-migration-'));
  } catch (error) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/prepare-destination',
        message: 'Could not prepare the workflow migration destination.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable destination directory'],
      })],
    });
    return;
  }

  const candidatePath = path.join(stagingDirectory, 'candidate.workflow.json');
  const artifactPath = path.join(stagingDirectory, 'migration-check.html');
  const destinationBytes = Buffer.from(serializeMigratedWorkflow(migration.document));
  try {
    fs.writeFileSync(candidatePath, destinationBytes, { flag: 'wx' });
    const render = runNode([rendererPath('workflow'), candidatePath, artifactPath], {
      stdio: 'pipe',
      env: rendererEnv(activeQualityProfile, undefined, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [...migration.newSchemaDiagnostics, ...failure.diagnostics],
        status: render.status ?? 1,
      });
      return;
    }

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), artifactPath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      let checker;
      try {
        checker = JSON.parse(check.stdout);
      } catch {
        checker = null;
      }
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [
          ...migration.newSchemaDiagnostics,
          ...checkerDiagnostics(checker),
        ],
        status: check.status ?? 1,
      });
      return;
    }

    if (pathsAlias(sourcePath, destinationPath)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-destination',
          message: 'Workflow migration source and destination resolved to the same file before commit.',
          subject: { source: sourcePath, destination: destinationPath },
          supportedFixes: ['choose a different destination path and retry'],
        })],
      });
      return;
    }
    const currentSourceBytes = fs.readFileSync(sourcePath);
    if (!currentSourceBytes.equals(sourceBytes)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-changed',
          message: 'Workflow migration source changed while the destination was being verified.',
          subject: { source: sourcePath },
          supportedFixes: ['retry the migration from a stable workflow source file'],
        })],
      });
      return;
    }

    fs.renameSync(candidatePath, destinationPath);
    const report = migrationReport({
      ...migration,
      sourcePath,
      destinationPath,
      sourceBytes,
      destinationBytes,
      fromSchemaVersion: sourceDocument.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else if (sourceDocument.schema_version === 1) {
      console.log(`migrated workflow schema v1→v2: ${sourcePath} → ${destinationPath}`);
    } else {
      console.log(`verified workflow schema v2 migration: ${sourcePath} → ${destinationPath}`);
    }
  } catch (error) {
    const migrationDiagnostics = Array.isArray(error?.archifyDiagnostics)
      ? migrationPathDiagnostics(error, sourcePath, destinationPath)
      : [diagnostic({
        code: 'migration/commit',
        message: 'Could not commit the verified workflow migration.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable regular-file destination and retry'],
      })];
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, ...migrationDiagnostics],
    });
  } finally {
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove workflow migration staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

async function commandValidate(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const repairHistoryArgs = extractPathOption(repoArgs.rest, '--repair-history');
  const repairModeArgs = extractEnumOption(repairHistoryArgs.rest, '--repair-mode', ['focused', 'structural-reflow']);
  const languageArgs = extractEnumOption(repairModeArgs.rest, '--require-authored-language', ['en', 'zh-CN']);
  args = languageArgs.rest;
  const quality = qualityArgs.quality;
  const repoRoot = repoArgs.repoRoot;
  const repairHistory = repairHistoryArgs.value;
  const repairMode = repairModeArgs.value || 'focused';
  const json = args.includes('--json');
  const layoutJson = args.includes('--layout-json');
  const preflight = args.includes('--preflight');
  const knownOptions = new Set(['--json', '--layout-json', '--preflight']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown validate option "${unknown[0]}".`);
  if (layoutJson && preflight) fail('--layout-json and --preflight cannot be combined.');
  const rest = args.filter((arg) => !knownOptions.has(arg));
  const [type, input] = rest;
  if (!type || !input || rest.length !== 2) fail(usage());
  assertEvidenceType(type, repoRoot);
  const renderer = rendererPath(type);
  const inputPath = path.resolve(input);
  let specification;
  let diagram;
  try {
    specification = fs.readFileSync(inputPath);
    diagram = JSON.parse(specification.toString('utf8'));
  } catch (error) {
    await reportValidateFailure({
      json,
      stage: 'input',
      type,
      input: inputPath,
      error: `Could not read validation input "${inputPath}": ${error.message}`,
      diagnostics: [inputDiagnostic(error, inputPath)],
      repairHistory,
      repairMode,
    });
    return;
  }
  const specificationReceipt = {
    type,
    bytes: specification.byteLength,
    sha256: createHash('sha256').update(specification).digest('hex'),
  };
  let languageReceipt = null;

  if (languageArgs.value) {
    const assessment = await authoredLanguageAssessment(diagram, languageArgs.value);
    languageReceipt = assessment.receipt;
    if (assessment.diagnostics.length) {
      await reportValidateFailure({
        json,
        stage: 'language',
        type,
        input: inputPath,
        error: 'Authored language validation failed.',
        diagnostics: assessment.diagnostics,
        repairHistory,
        repairMode,
      });
      return;
    }
  }

  if (layoutJson) {
    const inspectOutput = path.join(os.tmpdir(), `archify-inspect-${process.pid}-${type}.html`);
    const result = runNode([renderer, input, inspectOutput, '--layout-json'], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (result.status !== 0) {
      try {
        const report = JSON.parse((result.stdout || '').trim());
        if ((report?.schemaVersion === 1
          && report?.type === type
          && report?.validation?.status === 'fail'
          && report?.resolved)
          || (report?.contract && Array.isArray(report?.diagnostics))) {
          process.stdout.write(result.stdout);
          process.exitCode = result.status ?? 1;
          return;
        }
      } catch {
        // Failures before the resolved-layout seam use renderer diagnostics.
      }
      const failure = rendererFailure(result);
      await reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: result.status ?? 1,
        repairHistory,
        repairMode,
      });
      return;
    }
    process.stdout.write(result.stdout);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-'));
  const out = path.join(tmp, `${type}.html`);
  const frozenInput = path.join(tmp, 'specification.snapshot.json');
  let exitCode = 0;

  try {
    fs.writeFileSync(frozenInput, specification, { flag: 'wx', mode: 0o400 });
    const render = runNode([renderer, frozenInput, out], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      await reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
        repairHistory,
        repairMode,
      });
      exitCode = render.status ?? 1;
    } else {
      const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), out], { stdio: 'pipe' });
      if (check.status !== 0) {
        let checker;
        try {
          checker = JSON.parse(check.stdout);
          checker.file = path.resolve(input);
        } catch {
          checker = { ok: false, diagnostic: 'Artifact checker failed without a parseable receipt.' };
        }
        await reportValidateFailure({
          json,
          stage: 'check',
          type,
          input: path.resolve(input),
          error: 'Final artifact check failed.',
          diagnostics: checkerDiagnostics(checker),
          checker,
          status: check.status ?? 1,
          repairHistory,
          repairMode,
        });
        exitCode = check.status ?? 1;
      } else {
        const result = JSON.parse(check.stdout);
        const artifact = fs.readFileSync(out);
        const artifactReceipt = {
          bytes: artifact.byteLength,
          sha256: createHash('sha256').update(artifact).digest('hex'),
          ephemeral: true,
        };
        const engineeringProfile = engineeringProfileFromArtifact(artifact);
        let preflightReceipt = null;
        if (preflight) {
          const { runVisualPreflight } = await import('./visual-check.mjs');
          const browserResult = await runVisualPreflight({ artifactPath: out });
          preflightReceipt = ephemeralPreflightReceipt(browserResult.receipt);
          if (browserResult.exitCode !== 0) {
            await reportValidateFailure({
              json,
              stage: 'preflight',
              type,
              input: path.resolve(input),
              error: browserResult.receipt.error || `Viewport preflight ${browserResult.receipt.status}.`,
              diagnostics: browserResult.receipt.diagnostics || [],
              checker: result,
              preflight: preflightReceipt,
              status: browserResult.exitCode,
              repairHistory,
              repairMode,
            });
            exitCode = browserResult.exitCode;
          }
        }
        if (exitCode === 0 && json) {
          console.log(JSON.stringify({
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            type,
            input: inputPath,
            specification: specificationReceipt,
            artifact: artifactReceipt,
            checks: result.checks,
            composition: result.composition,
            ...(languageReceipt ? { authoredLanguage: languageReceipt } : {}),
            ...(engineeringProfile ? { engineeringProfile } : {}),
            ...(preflightReceipt ? { preflight: preflightReceipt } : {}),
          }, null, 2));
        } else if (exitCode === 0) {
          const engineering = engineeringProfile
            ? `; engineering ${engineeringProfile}: pass`
            : '';
          const viewport = preflightReceipt
            ? `; viewport preflight ${preflightReceipt.containment.viewports.filter((entry) => entry.ok).length}/${preflightReceipt.containment.viewports.length}`
            : '';
          console.log(`ok ${type} ${path.resolve(input)} (${result.checks.length} artifact checks; composition ${result.composition.profile}: ${result.composition.summary.errors} errors, ${result.composition.summary.warnings} warnings${engineering}${viewport})`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined:
  case '-h':
  case '--help':
  case 'help':
    console.log(usage());
    break;
  case 'render':
    commandRender(args);
    break;
  case 'compare':
    await commandCompare(args);
    break;
  case 'deliver':
    await commandDeliver(args);
    break;
  case 'preview':
    await commandPreview(args);
    break;
  case 'validate':
    await commandValidate(args);
    break;
  case 'validate-batch':
    await commandValidateBatch(args);
    break;
  case 'migrate':
    await commandMigrate(args);
    break;
  case 'inspect':
    await commandValidate([...args, '--layout-json']);
    break;
  case 'check':
    commandCheck(args);
    break;
  case 'visual-check':
    await commandVisualCheck(args);
    break;
  case 'authoring-kit':
    await commandAuthoringKit(args);
    break;
  case 'authoring-run':
    await commandAuthoringRun(args);
    break;
  case 'project-index':
    await commandProjectIndex(args);
    break;
  case 'evidence-ledger':
    await commandEvidenceLedger(args);
    break;
  case 'run-suite':
    await commandRunSuite(args);
    break;
  case 'guide':
    await commandGuide(args);
    break;
  case 'brands':
    await commandBrands(args);
    break;
  case 'examples':
    commandExamples();
    break;
  case 'doctor':
    await commandDoctor();
    break;
  case 'demo':
    commandDemo(args);
    break;
  default:
    fail(`Unknown command "${command}".\n\n${usage()}`);
}
