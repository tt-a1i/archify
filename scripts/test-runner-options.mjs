import path from 'node:path';

// Both runners accept exact files, never infer coverage from changed sources.
export function testRunnerOptions(argv, { repoRoot, testFiles, allowRequireFiles = false, defaultConcurrency = 2 }) {
  let concurrency = defaultConcurrency;
  let explicitConcurrency = false;
  let list = false;
  let requireFiles = false;
  let namePattern;
  const selected = [];
  const knownFiles = new Map(testFiles.map(file => [path.resolve(repoRoot, file), file]));
  for (const argument of argv) {
    if (argument === '--list') {
      list = true;
    } else if (argument === '--require-files' && allowRequireFiles) {
      requireFiles = true;
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
      throw new Error(`Unknown test runner option: ${argument}. Use --list, --concurrency=N or --test-name-pattern=<regex>`);
    } else {
      const file = knownFiles.get(path.resolve(repoRoot, argument));
      if (!file) throw new Error(`File is not in this runner's test inventory: ${argument}`);
      if (!selected.includes(file)) selected.push(file);
    }
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
  const files = selected.length ? selected : testFiles;
  const args = ['--test'];
  if (supportsConcurrency) args.push(`--test-concurrency=${concurrency}`);
  if (namePattern !== undefined) args.push(`--test-name-pattern=${namePattern}`);
  args.push(...files);
  return { files, args, list, concurrency: supportsConcurrency ? concurrency : 'Node default' };
}
