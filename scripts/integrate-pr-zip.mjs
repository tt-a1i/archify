#!/usr/bin/env node
// Resolve only the generated archive conflict; Git and build-zip.sh own the merge/build.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sameLocation } from '../archify/renderers/shared/path-semantics.mjs';

const help = `Usage: node scripts/integrate-pr-zip.mjs --base <ref> --expect-head <sha> --expect-base <sha> [--apply]

Default: inspect a pinned merge without changing the index or working tree.
--apply requires a clean linked worktree on a branch and leaves an uncommitted
merge for review. Only an archify.zip conflict is allowed. The canonical builder
must be runnable with the required Node/zlib on PATH. No fetch, commit or push.
Required final-revision CI (including ZIP freshness) and maintainer review remain.
`;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function main() {
  const options = {};
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return console.log(help);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply' && !options.apply) options.apply = true;
    else if (['--base', '--expect-head', '--expect-base'].includes(arg) && !options[arg] && args[i + 1] && !args[i + 1].startsWith('--')) options[arg] = args[++i];
    else throw new Error(`Unknown, repeated or incomplete option: ${arg}\n${help}`);
  }
  for (const name of ['--base', '--expect-head', '--expect-base']) {
    if (!options[name]) throw new Error(`Missing ${name}\n${help}`);
  }
  for (const name of ['--expect-head', '--expect-base']) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options[name])) throw new Error(`${name} must be a full commit SHA`);
  }
  let root = process.cwd();
  function git(args, allowFailure = false) {
    const result = run('git', args, root);
    if (result.status !== 0 && !allowFailure) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    return result;
  }
  root = git(['rev-parse', '--show-toplevel']).stdout.trim();
  const resolve = ref => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).stdout.trim();
  function checkState() {
    if (resolve('HEAD') !== options['--expect-head']) throw new Error('HEAD drift: expected HEAD does not match');
    if (resolve(options['--base']) !== options['--expect-base']) throw new Error('Base drift: expected base does not match');
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
      const location = git(['rev-parse', '--git-path', name]).stdout.trim();
      if (fs.existsSync(path.resolve(root, location))) throw new Error(`In-progress Git operation: ${name}`);
    }
    if (git(['status', '--porcelain=v1', '--untracked-files=all']).stdout) throw new Error('Checkout must be clean, including untracked files');
    if (options.apply) {
      const gitDir = path.resolve(root, git(['rev-parse', '--git-dir']).stdout.trim());
      const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir']).stdout.trim());
      if (sameLocation(gitDir, commonDir).status !== 'different' || git(['symbolic-ref', '-q', 'HEAD'], true).status !== 0) throw new Error('--apply requires an isolated linked worktree on a branch');
    }
  }
  checkState();
  const head = options['--expect-head'];
  const base = options['--expect-base'];
  const preview = git(['-c', 'rerere.enabled=false', 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', head, base], true);
  if (![0, 1].includes(preview.status)) throw new Error(`Cannot inspect merge: ${preview.stderr.trim()}`);
  const [tree, ...entries] = preview.stdout.split('\0');
  const conflicts = entries.filter(Boolean);
  if (preview.status !== 1 || conflicts.length !== 1 || conflicts[0] !== 'archify.zip') {
    throw new Error(`Requires exactly the archify.zip conflict; found: ${conflicts.join(', ') || 'no conflicts'}`);
  }
  const receipt = { mode: options.apply ? 'apply' : 'plan', head, base, combinedTree: tree, conflicts,
    required: 'Review the uncommitted merge; final-revision required CI including ZIP freshness remains.' };
  if (!options.apply) return console.log(JSON.stringify(receipt, null, 2));
  // Recheck after preview, before any index/working-tree mutation.
  checkState();
  let started = false;
  try {
    started = true;
    const merge = git(['-c', 'rerere.enabled=false', 'merge', '--no-commit', '--no-ff', '--no-autostash', base], true);
    if (merge.status !== 1 || git(['diff', '--name-only', '--diff-filter=U', '-z']).stdout !== 'archify.zip\0') {
      throw new Error(`Merge did not leave the expected sole ZIP conflict: ${merge.stderr.trim() || merge.stdout.trim()}`);
    }
    git(['checkout', '--ours', '--', 'archify.zip']);
    git(['add', '--', 'archify.zip']);
    const verifySource = () => {
      for (const args of [['diff', '--cached', '--quiet', tree, '--', '.', ':(exclude)archify.zip'], ['diff', '--quiet', '--', '.', ':(exclude)archify.zip']]) {
        if (git(args, true).status !== 0) throw new Error('Source differs from Git’s conflict-free combined result');
      }
      if (git(['ls-files', '--others', '--exclude-standard', '-z']).stdout) throw new Error('Build left unexpected untracked files');
    };
    verifySource();
    const build = run('bash', ['scripts/build-zip.sh'], root);
    if (build.status !== 0) throw new Error(`Canonical ZIP build failed (${build.status}): ${build.stderr.trim()}\n${build.stdout.trim()}`);
    verifySource();
    git(['add', '--', 'archify.zip']);
    const mergeHead = fs.readFileSync(path.resolve(root, git(['rev-parse', '--git-path', 'MERGE_HEAD']).stdout.trim()), 'utf8').trim();
    if (resolve('HEAD') !== head || mergeHead !== base) throw new Error('Merge identity changed');
    receipt.resultTree = git(['write-tree']).stdout.trim();
    receipt.zipBlob = git(['rev-parse', ':archify.zip']).stdout.trim();
    receipt.state = 'Uncommitted merge; HEAD unchanged; both parent histories retained in MERGE_HEAD';
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    if (started) error.message += '\nMerge attempt left in place for inspection; no commit or push was made. Inspect git status. To abort the merge: git merge --abort. Builder edits may remain afterward; inspect git status before further action.';
    throw error;
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
