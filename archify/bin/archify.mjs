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

function usage() {
  return `Usage:
  archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path]
  archify deliver <type> <input.json> [output.html] [--json] [--open] [--quality standard|showcase] [--repo-root path]
  archify preview <type> <input.json> [output.html] [--no-open] [--quality standard|showcase] [--repo-root path]
  archify validate <type> <input.json> [--json] [--layout-json] [--quality standard|showcase] [--repo-root path]
  archify inspect <type> <input.json>
  archify check <output.html>
  archify guide [scenario or question] [--json] [--lang en|zh]
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
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length);
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

function rendererEnv(quality, repoRoot) {
  return {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
  };
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

function reportDeliveryFailure({ json, stage, type, input, output, error, status = 1, checker }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: 'deliver',
    stage,
    type,
    input,
    output,
    error,
    ...(checker ? { checker } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(error);
  process.exitCode = status;
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

async function commandDeliver(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const json = repoArgs.rest.includes('--json');
  const open = repoArgs.rest.includes('--open');
  const knownOptions = new Set(['--json', '--open']);
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown deliver option "${unknown[0]}".`);
  const positional = repoArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, requestedOutput] = positional;
  if (!type || !input || positional.length > 3) fail(usage());
  assertEvidenceType(type, repoArgs.repoRoot);

  const renderer = rendererPath(type);
  const inputPath = path.resolve(input);
  let diagram;
  try {
    diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    reportDeliveryFailure({
      json,
      stage: 'input',
      type,
      input: inputPath,
      output: path.resolve(requestedOutput || `${type}.html`),
      error: `Could not read delivery input "${inputPath}": ${error.message}`,
    });
    return;
  }

  const authoredOutput = typeof diagram?.meta?.output === 'string' && diagram.meta.output
    ? diagram.meta.output
    : `${type}.html`;
  const outputPath = path.resolve(requestedOutput || authoredOutput);
  const outputDirectory = path.dirname(outputPath);
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: `Could not create delivery directory "${outputDirectory}": ${error.message}`,
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
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: `Could not create a delivery candidate beside "${outputPath}": ${error.message}`,
    });
    return;
  }
  const candidatePath = path.join(stagingDirectory, path.basename(outputPath));

  try {
    const render = runNode([renderer, inputPath, candidatePath], {
      stdio: 'pipe',
      env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot),
    });
    if (render.status !== 0) {
      if (render.stderr) process.stderr.write(render.stderr);
      if (render.stdout) process.stderr.write(render.stdout);
      reportDeliveryFailure({
        json,
        stage: 'render',
        type,
        input: inputPath,
        output: outputPath,
        error: (render.stderr || render.stdout || 'Renderer failed without a diagnostic.').trim(),
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
        status: check.status ?? 1,
        checker,
      });
      return;
    }

    let result;
    try {
      result = JSON.parse(check.stdout);
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: `Could not parse the successful artifact-check receipt: ${error.message}`,
      });
      return;
    }
    let artifact;
    try {
      artifact = fs.readFileSync(candidatePath);
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: `Could not read the verified delivery candidate: ${error.message}`,
      });
      return;
    }
    let sourceEvidence;
    try {
      sourceEvidence = sourceEvidenceFromArtifact(artifact);
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: `Could not read the repository evidence receipt: ${error.message}`,
      });
      return;
    }
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'deliver',
      type,
      input: inputPath,
      output: outputPath,
      artifact: {
        sha256: createHash('sha256').update(artifact).digest('hex'),
        bytes: artifact.byteLength,
      },
      validation: {
        checksPassed: result.checks.filter((checkItem) => checkItem.ok).length,
        checkCount: result.checks.length,
        compositionProfile: result.composition.profile,
        compositionStatus: result.composition.status,
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
      fs.renameSync(candidatePath, outputPath);
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: `Could not commit verified delivery "${outputPath}": ${error.message}`,
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
      console.log(`${receipt.validation.checksPassed}/${receipt.validation.checkCount} artifact checks; composition ${receipt.validation.compositionProfile}: ${receipt.validation.compositionStatus}; sha256 ${receipt.artifact.sha256.slice(0, 12)}`);
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

  const scenarioGuide = path.join(skillRoot, 'recipes/scenarios.mjs');
  checks.push({
    label: 'Scenario recipe guide',
    ok: fs.existsSync(scenarioGuide),
    missing: fs.existsSync(scenarioGuide) ? 0 : 1,
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

function commandValidate(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  args = repoArgs.rest;
  const quality = qualityArgs.quality;
  const repoRoot = repoArgs.repoRoot;
  const json = args.includes('--json');
  const layoutJson = args.includes('--layout-json');
  const rest = args.filter((arg) => arg !== '--json' && arg !== '--layout-json');
  const [type, input] = rest;
  if (!type || !input) fail(usage());
  assertEvidenceType(type, repoRoot);
  const renderer = rendererPath(type);

  if (layoutJson) {
    if (type !== 'architecture') {
      fail('--layout-json is currently supported for architecture diagrams only.');
    }
    const result = runNode([renderer, input, '/dev/null', '--layout-json'], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot),
    });
    if (result.status !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.stdout) process.stdout.write(result.stdout);
      process.exit(result.status ?? 1);
    }
    process.stdout.write(result.stdout);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-'));
  const out = path.join(tmp, `${type}.html`);
  let exitCode = 0;

  try {
    const render = runNode([renderer, input, out], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot),
    });
    if (render.status !== 0) {
      if (render.stderr) process.stderr.write(render.stderr);
      if (render.stdout) process.stdout.write(render.stdout);
      exitCode = render.status ?? 1;
    } else {
      const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), out], { stdio: 'pipe' });
      if (check.status !== 0) {
        if (check.stdout) process.stdout.write(check.stdout);
        if (check.stderr) process.stderr.write(check.stderr);
        exitCode = check.status ?? 1;
      } else {
        const result = JSON.parse(check.stdout);
        if (json) {
          console.log(JSON.stringify({
            ok: true,
            type,
            input: path.resolve(input),
            checks: result.checks,
            composition: result.composition,
          }, null, 2));
        } else {
          console.log(`ok ${type} ${path.resolve(input)} (${result.checks.length} artifact checks; composition ${result.composition.profile}: ${result.composition.summary.errors} errors, ${result.composition.summary.warnings} warnings)`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (exitCode !== 0) process.exit(exitCode);
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
  case 'deliver':
    await commandDeliver(args);
    break;
  case 'preview':
    await commandPreview(args);
    break;
  case 'validate':
    commandValidate(args);
    break;
  case 'inspect':
    commandValidate([...args, '--layout-json']);
    break;
  case 'check':
    commandCheck(args);
    break;
  case 'guide':
    await commandGuide(args);
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
