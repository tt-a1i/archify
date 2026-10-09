import path from 'node:path';

// Both runners accept exact files, never infer coverage from changed sources.
export function testRunnerOptions(argv, { repoRoot, testFiles, allowRequireFiles = false, defaultConcurrency = 2, allowShards = false }) {
  let concurrency = defaultConcurrency;
  let explicitConcurrency = false;
  let list = false;
  let requireFiles = false;
  let namePattern;
  let shard;
  const selected = [];
  const knownFiles = new Map(testFiles.map(file => [path.resolve(repoRoot, file), file]));
  for (const argument of argv) {
    if (argument === '--list') {
      list = true;
    } else if (argument === '--require-files' && allowRequireFiles) {
      requireFiles = true;
    } else if (argument.startsWith('--shard') && allowShards) {
      if (shard) throw new Error('--shard may be specified only once');
      const match = /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(argument);
      if (!match) throw new Error('Use --shard=<index>/<count> with positive integers');
      const index = Number(match[1]);
      const count = Number(match[2]);
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) {
        throw new Error('--shard index must be a safe integer within the shard count');
      }
      if (count > testFiles.length) throw new Error('--shard count would create empty test shards');
      if (knownFiles.size !== testFiles.length) throw new Error('Test inventory contains duplicate files');
      shard = { index, count };
    } else if (argument.startsWith('--concurrency=')) {
      const value = argument.slice('--concurrency='.length);
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('--concurrency must be a positive safe integer');
      }
      concurrency = Number(value);
      explicitConcurrency = true;
    } else if (argument.startsWith('--test-name-pattern=')) {
      const value = argument.slice('--test-name-pattern='.length);
      if (!value) throw new Error('--test-name-pattern=<regex> requires a non-empty regular expression');
      try {
        new RegExp(value);
      } catch {
        throw new Error('--test-name-pattern=<regex> requires a valid regular expression');
      }
      namePattern = value;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown test runner option: ${argument}. Use --list, --concurrency=N, --test-name-pattern=<regex>${allowShards ? ' or --shard=index/count' : ''}`);
    } else {
      const file = knownFiles.get(path.resolve(repoRoot, argument));
      if (!file) throw new Error(`File is not in this runner's test inventory: ${argument}`);
      if (!selected.includes(file)) selected.push(file);
    }
  }
  if (shard && (selected.length || namePattern !== undefined)) {
    throw new Error('--shard cannot be combined with explicit files or a test-name selection');
  }
  if (requireFiles && selected.length === 0) {
    throw new Error('Focused tests require at least one explicit test file');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supportsConcurrency = major > 18 || (major === 18 && minor >= 19);
  const supportsNamePattern = major > 18 || (major === 18 && minor >= 11);
  if (explicitConcurrency && !supportsConcurrency) {
    throw new Error('--concurrency requires Node 18.19 or newer');
  }
  if (namePattern !== undefined && !supportsNamePattern) {
    throw new Error('--test-name-pattern requires Node 18.11 or newer');
  }
  const files = shard
    ? testFiles.filter((_, index) => index % shard.count === shard.index - 1)
    : selected.length ? selected : testFiles;
  const args = ['--test'];
  if (supportsConcurrency) args.push(`--test-concurrency=${concurrency}`);
  if (namePattern !== undefined) args.push(`--test-name-pattern=${namePattern}`);
  args.push(...files);
  return { files, args, list, shard, concurrency: supportsConcurrency ? concurrency : 'Node default' };
}
