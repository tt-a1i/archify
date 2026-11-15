import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Stable entry point for the original three examples, now through the public toolchain.
// The public renderer is the single source of the three pages.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const [outputArg, ...extra] = process.argv.slice(2);
if (!outputArg || extra.length) throw new Error('Usage: node build.mjs <output-directory>');
const output = path.resolve(outputArg);
const cli = path.join(repoRoot, 'archify/bin/archify.mjs');
const examples = path.resolve(here, '../examples');
const stages = ['validate', 'deliver', 'check'];
const receiptFile = path.join(output, 'prototype-build.json');
const receipt = { kind: 'finalized-explainer-examples', createdAt: new Date().toISOString(), status: 'running', pages: [] };
fs.mkdirSync(output, { recursive: true });
const save = () => fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
for (const id of ['comparison', 'mechanism', 'diagram']) {
  const input = path.join(examples, `${id}.md`);
  const artifact = path.join(output, `${id}.html`);
  console.error(`finalize explainer ${id}: running ${stages.join('/')}`);
  const start = performance.now();
  const child = spawnSync(process.execPath, [cli, 'finalize', 'explainer', input, artifact,
    '--quality', 'showcase', '--repo-root', repoRoot, '--json'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  let summary;
  try { summary = JSON.parse(child.stdout || ''); } catch {}
  const passed = !child.error && child.status === 0 && summary?.ok === true && stages.every(stage => summary.gates?.[stage] === 'pass');
  const entry = { id, input, file: `${id}.html`, buildMs: Number((performance.now() - start).toFixed(3)),
    status: passed ? 'pass' : 'fail', exitCode: child.status, ...(summary ? { finalize: summary } : {}) };
  if (!passed) {
    entry.failure = child.error?.message || child.stderr?.trim() || (!summary ? 'CLI did not return a JSON finalize receipt.' : 'At least one required finalize gate did not pass.');
    receipt.pages.push(entry); receipt.status = 'fail'; save();
    if (summary) console.error(JSON.stringify(summary, null, 2));
    if (child.stderr?.trim()) console.error(child.stderr.trim());
    throw new Error(`Explainer ${id} failed required finalize gates. Inspect ${receiptFile}.`);
  }
  const bytes = fs.readFileSync(artifact);
  entry.bytes = bytes.length;
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  receipt.pages.push(entry); save();
  console.log(`${id}.html ${entry.bytes}B: ${stages.join('/')} pass`);
}
receipt.status = 'pass'; save();
