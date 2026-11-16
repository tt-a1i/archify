import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [source, database, cpptools, output] = process.argv.slice(2);
if (!source || !database || !cpptools || !output) {
  console.error('Usage: node run-vscode.mjs <fmt-root> <selected-compile_commands.json> <cpptools-extension-dir> <output.json>');
  process.exit(2);
}
const root = fs.realpathSync(source), cdb = fs.realpathSync(database);
const extension = fs.realpathSync(cpptools), resultPath = path.resolve(output);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cpptools-fmt-'));
fs.mkdirSync(path.join(temporary, 'extensions'));
try {
  const command = process.env.CODE_CLI || 'code';
  const args = ['--verbose', '--user-data-dir', path.join(temporary, 'user'),
    '--extensions-dir', path.join(temporary, 'extensions'),
    `--extensionDevelopmentPath=${path.join(here, 'vscode')}`,
    `--extensionDevelopmentPath=${extension}`,
    `--extensionTestsPath=${path.join(here, 'vscode/test.js')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', root];
  const run = spawnSync(command, args, { encoding: 'utf8', timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_FMT_ROOT: root, ARCHIFY_FMT_CDB: cdb,
      ARCHIFY_FMT_CPPTOOLS_OUTPUT: resultPath,
      ARCHIFY_FMT_COMPARISON: path.join(here, 'comparison.json'), ARCHIFY_FMT_PROFILE: temporary } });
  fs.writeFileSync(`${resultPath}.log`, `${run.stdout || ''}${run.stderr || ''}`);
  if (run.error || run.status !== 0) throw Error(`VS Code extension test failed: ${run.error?.message || run.status}`);
  const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const reference = JSON.parse(fs.readFileSync(path.join(here, 'comparison.json'), 'utf8'));
  if (report.fatalError || report.samples.length !== reference.samples.length) throw Error(report.fatalError || 'Incomplete VS Code comparison');
  const sorted = locations => [...locations].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const identicalLocationSets = report.samples.filter((sample, index) =>
    JSON.stringify(sorted(sample.actual)) === JSON.stringify(sorted(reference.samples[index].cpptools.locations))).length;
  console.log(JSON.stringify({ vscode: report.vscode, cpptools: report.cpptools,
    samples: report.samples.length, counts: report.counts,
    identicalLocationSets, referenceDatabaseMatched:
      report.selectedDatabaseSha256 === report.referenceDatabaseSha256 }, null, 2));
  if (report.counts.positiveMissing) process.exitCode = 1;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
