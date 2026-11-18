import path from 'node:path';
import { PrPackError } from './manifest.mjs';
import { buildPrPack, validatePrPack } from './build.mjs';
import { attachPrPack, createGhExecutor } from './attach.mjs';
import { preflightPrPack } from './preflight.mjs';

const SUBCOMMANDS = ['preflight', 'validate', 'build', 'attach'];

function parseOptions(args, { flags = [], values = [] }, subcommand, rejectCliArgument) {
  const options = { flags: {}, values: {}, positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options.positional.push(arg);
      continue;
    }
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flags.includes(name) && inline === undefined) {
      options.flags[name] = true;
      continue;
    }
    if (values.includes(name)) {
      const value = inline !== undefined ? inline : args[index + 1];
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) {
        rejectCliArgument(`${name} requires a value.`, { code: 'cli/missing-option-value', subject: { command: `pr ${subcommand}`, option: name }, supportedFixes: [`pass a value after ${name}`] });
      }
      options.values[name] = value;
      if (inline === undefined) index += 1;
      continue;
    }
    rejectCliArgument(`Unknown pr ${subcommand} option "${arg}".`, { code: 'cli/unsupported-option', subject: { command: `pr ${subcommand}`, option: arg }, supportedFixes: ['remove the unknown option and retry'] });
  }
  return options;
}

function formatFailure(error) {
  const lines = [`archify pr: ${error.message}`];
  for (const entry of error.diagnostics || []) {
    lines.push(`  [${entry.code}] ${entry.message}`);
    for (const fix of entry.supportedFixes || []) lines.push(`    fix: ${fix}`);
  }
  return lines.join('\n');
}

function report({ subcommand, json, error, input }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: `pr ${subcommand}`,
    stage: error.stage || 'internal',
    input,
    error: error.message,
    diagnostics: error.diagnostics || [],
    ...(error.rollback ? { rollback: error.rollback } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatFailure(error));
  process.exitCode = error.stage === 'arguments' ? 2 : 1;
}

export async function commandPr(args, { rejectCliArgument, usage }) {
  const [subcommand, ...rest] = args;
  if (!SUBCOMMANDS.includes(subcommand)) {
    rejectCliArgument(`archify pr expects one of: ${SUBCOMMANDS.join(', ')}.\n\n${usage()}`, { code: 'cli/invalid-arguments', subject: { command: 'pr', subcommand: subcommand ?? null }, supportedFixes: SUBCOMMANDS.map((name) => `use: archify pr ${name} ...`) });
  }
  const json = rest.includes('--json');
  let input;
  try {
    if (subcommand === 'preflight') {
      const { positional, values } = parseOptions(rest, { flags: ['--json'], values: ['--repo-root', '--base', '--head', '--init', '--mode', '--target', '--global-rules'] }, subcommand, rejectCliArgument);
      if (positional.length) rejectCliArgument('pr preflight accepts named options only.', { code: 'cli/invalid-arguments', subject: { command: 'pr preflight' } });
      input = path.resolve(values['--repo-root'] || '.');
      const receipt = preflightPrPack({
        repoRoot: input, base: values['--base'], head: values['--head'], init: values['--init'],
        mode: values['--mode'], target: values['--target'], globalRulesFile: values['--global-rules'],
      });
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else {
        const { stats, policy, materiality } = receipt;
        console.log(`${receipt.baseRef}...${receipt.headRef} (${receipt.baseSha.slice(0, 7)} → ${receipt.headSha.slice(0, 7)})`);
        console.log(`${stats.filesChanged} files, +${stats.additions} −${stats.deletions}`);
        console.log(`Offer diagram: ${materiality.shouldOffer} (${materiality.reasons.join(', ')}). Policy: ${policy.mode}, target=${policy.target}`);
        if (receipt.initialized) console.log(receipt.initialized.manifest);
      }
      return;
    }
    if (subcommand === 'validate') {
      const options = parseOptions(rest, { flags: ['--json'], values: ['--repo-root'] }, subcommand, rejectCliArgument);
      const [manifest] = options.positional;
      if (!manifest || options.positional.length !== 1) rejectCliArgument(`pr validate expects <manifest.json>.\n\n${usage()}`, { code: 'cli/invalid-arguments', subject: { command: 'pr validate' } });
      input = path.resolve(manifest);
      const receipt = validatePrPack(manifest, { repoRoot: options.values['--repo-root'] });
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else console.log(`archify pr validate: ${receipt.views.length} view(s) valid${receipt.story ? ` + story (${receipt.story.steps} steps)` : ''}${receipt.revisions.verified ? ` at ${receipt.revisions.baseSha.slice(0, 7)}...${receipt.revisions.headSha.slice(0, 7)}` : ''}`);
      return;
    }
    if (subcommand === 'build') {
      const options = parseOptions(rest, { flags: ['--json', '--html', '--no-html', '--animate-flow'], values: ['--out-dir', '--repo-root', '--platform', '--quality'] }, subcommand, rejectCliArgument);
      const [manifest] = options.positional;
      if (!manifest || options.positional.length !== 1) rejectCliArgument(`pr build expects <manifest.json> --out-dir <dir>.\n\n${usage()}`, { code: 'cli/invalid-arguments', subject: { command: 'pr build' } });
      if (!options.values['--out-dir']) rejectCliArgument('pr build requires --out-dir <dir>.', { code: 'cli/missing-option-value', subject: { command: 'pr build', option: '--out-dir' }, supportedFixes: ['pass --out-dir with a writable directory'] });
      input = path.resolve(manifest);
      const receipt = await buildPrPack(manifest, {
        outDir: options.values['--out-dir'],
        repoRoot: options.values['--repo-root'],
        platform: options.values['--platform'],
        quality: options.values['--quality'],
        html: !options.flags['--no-html'],
        animateFlow: Boolean(options.flags['--animate-flow']),
      });
      if (json) console.log(JSON.stringify(receipt, null, 2));
      else {
        console.log(receipt.markdown.path);
        console.log(receipt.receipt);
        for (const asset of receipt.assets) console.log(asset.path);
      }
      return;
    }
    const options = parseOptions(rest, { flags: ['--json', '--dry-run', '--allow-stale'], values: ['--manifest', '--target', '--repo'] }, subcommand, rejectCliArgument);
    const [pullRequest] = options.positional;
    if (!pullRequest || options.positional.length !== 1) rejectCliArgument(`pr attach expects <pr-number-or-url> --manifest <build-receipt.json>.\n\n${usage()}`, { code: 'cli/invalid-arguments', subject: { command: 'pr attach' } });
    if (!options.values['--manifest']) rejectCliArgument('pr attach requires --manifest <build-receipt.json>.', { code: 'cli/missing-option-value', subject: { command: 'pr attach', option: '--manifest' }, supportedFixes: ['pass --manifest with the pr-pack.receipt.json from archify pr build'] });
    input = path.resolve(options.values['--manifest']);
    const receipt = await attachPrPack({
      pullRequest,
      receipt: options.values['--manifest'],
      target: options.values['--target'] || 'body',
      repo: options.values['--repo'],
      dryRun: Boolean(options.flags['--dry-run']),
      allowStale: Boolean(options.flags['--allow-stale']),
      gh: createGhExecutor({ binary: process.env.ARCHIFY_GH || 'gh' }),
    });
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else {
      console.log(`archify pr attach${receipt.dryRun ? ' (dry-run)' : ''}: ${receipt.pullRequest.url || `#${receipt.pullRequest.number}`} target=${receipt.target}`);
      for (const [file, url] of Object.entries(receipt.assets)) console.log(`${file} -> ${url || '(not uploaded)'}`);
    }
  } catch (error) {
    if (!(error instanceof PrPackError)) throw error;
    report({ subcommand, json, error, input });
  }
}
