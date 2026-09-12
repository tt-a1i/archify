#!/usr/bin/env node
// Phase 1 generated-artifacts report (docs/maintenance-roadmap.md).
//
// Compares the committed generated site against a rebuild from the same
// source and renders a markdown summary. Informational only: this script
// always exits 0 when it can read its inputs; the zip-freshness job in
// ci.yml keeps the blocking ZIP contract.
//
// Usage:
//   node .github/scripts/generated-artifacts-report.mjs \
//     --committed docs --rebuilt "$RUNNER_TEMP/docs-rebuilt" \
//     --owned gallery,gallery.html,guide.html,start.html \
//     --zip identical|differs|unavailable \
//     [--skipped "$RUNNER_TEMP/skipped.tsv"]
//
// --owned lists the paths (files or directories, relative to both roots)
// that the site builders write. Only those are compared, so hand-maintained
// pages under docs/ never count as "identical". --skipped points at a
// tab-separated file with one `builder<TAB>reason` line per skipped builder.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LISTED_PATHS = 30;

const ZIP_LINES = Object.freeze({
  identical: 'archify.zip: identical to rebuild',
  differs: 'archify.zip: differs from rebuild (zip-freshness is the blocking check)',
  unavailable: 'archify.zip: rebuild unavailable (see the build step log)',
});

// committed / rebuilt: { [relativePath]: sha256 }. Returns sorted entries with
// null for the side where the file is absent.
export function compareTrees(committed, rebuilt) {
  const paths = new Set([...Object.keys(committed), ...Object.keys(rebuilt)]);
  return [...paths].sort().map((file) => ({
    path: file,
    committed: committed[file] ?? null,
    rebuilt: rebuilt[file] ?? null,
  }));
}

export function fileStatus(entry) {
  if (entry.committed === null) return 'only in rebuild';
  if (entry.rebuilt === null) return 'only in checkout';
  return entry.committed === entry.rebuilt ? 'identical' : 'differs';
}

export function parseSkipped(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [builder, ...rest] = line.split('\t');
      return { builder: builder.trim(), reason: rest.join('\t').trim() || 'no reason recorded' };
    });
}

// model: { zip: 'identical'|'differs'|'unavailable', files: compareTrees(...), skipped: [{ builder, reason }] }
export function renderReport(model) {
  const files = model.files ?? [];
  const counts = { identical: 0, differs: 0, 'only in rebuild': 0, 'only in checkout': 0 };
  const listed = [];
  for (const entry of files) {
    const status = fileStatus(entry);
    counts[status] += 1;
    if (status !== 'identical') listed.push(`- ${status}: \`${entry.path}\``);
  }

  const lines = [
    '## Generated artifacts (Phase 1: informational)',
    '',
    'This job never blocks a pull request. It rebuilds the generated site and package from this source and reports whether the committed outputs match; the rebuilt outputs are attached as workflow artifacts.',
    '',
    `- ${ZIP_LINES[model.zip] ?? ZIP_LINES.unavailable}`,
    `- Generated site: ${counts.identical} files identical, ${counts.differs} differ, ${counts['only in rebuild']} only in rebuild, ${counts['only in checkout']} only in checkout`,
  ];
  if (listed.length > 0) {
    lines.push('', ...listed.slice(0, MAX_LISTED_PATHS));
    if (listed.length > MAX_LISTED_PATHS) lines.push(`- … and ${listed.length - MAX_LISTED_PATHS} more`);
  }

  const skipped = model.skipped ?? [];
  lines.push('', skipped.length === 0
    ? 'Skipped: none'
    : `Skipped: ${skipped.map((item) => `${item.builder} (${item.reason})`).join('; ')}`);

  lines.push('', 'Contributors may stop committing rebuilt Gallery once Phase 2 in docs/maintenance-roadmap.md is complete; until then CONTRIBUTING.md#packages-and-generated-artifacts applies.', '');
  return lines.join('\n');
}

// IO shell -------------------------------------------------------------------

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashOwned(root, owned) {
  const hashes = {};
  const visit = (absolute) => {
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute)) visit(path.join(absolute, child));
    } else if (stat.isFile()) {
      hashes[path.relative(root, absolute).split(path.sep).join('/')] = sha256(absolute);
    }
  };
  for (const item of owned) visit(path.join(root, item));
  return hashes;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  for (const required of ['committed', 'rebuilt', 'owned', 'zip']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const owned = args.owned.split(',').map((item) => item.trim()).filter(Boolean);
  const skippedText = args.skipped && fs.existsSync(args.skipped) ? fs.readFileSync(args.skipped, 'utf8') : '';
  const report = renderReport({
    zip: args.zip,
    files: compareTrees(hashOwned(args.committed, owned), hashOwned(args.rebuilt, owned)),
    skipped: parseSkipped(skippedText),
  });
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.stdout.write(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
