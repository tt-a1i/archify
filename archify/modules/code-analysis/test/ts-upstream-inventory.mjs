// Candidate inventory, not a claim that every upstream test is an Archify test.
// node test/ts-upstream-inventory.mjs <TypeScript source checkout> [output.json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] && path.resolve(process.argv[2]);
const output = process.argv[3] && path.resolve(process.argv[3]);
const directories = ['tests/cases/compiler', 'tests/cases/conformance', 'tests/cases/fourslash', 'tests/cases/projects', 'src/testRunner/unittests/tsserver'];
if (!root || directories.some(dir => !fs.statSync(path.join(root, dir), { throwIfNoEntry: false })?.isDirectory())) {
  process.stderr.write('Pass a TypeScript source checkout with compiler, conformance, fourslash, projects and tsserver test directories.\n');
  process.exitCode = 2;
} else {
  const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0) throw new Error('The upstream checkout must have a Git revision.');
  const paths = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|json)$/.test(entry.name)) paths.push(relative);
    }
  };
  directories.forEach(walk);
  paths.sort();
  const candidates = [];
  for (const file of paths) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const virtualFiles = [...source.matchAll(/^\s*\/\/\s*@filename:\s*(.+?)\s*$/gim)].map(match => match[1]);
    const options = Object.fromEntries([...source.matchAll(/^\s*\/\/\s*@([a-z][a-z0-9]*):\s*(.+?)\s*$/gim)]
      .filter(match => ['allowjs', 'checkjs', 'jsx', 'module', 'moduleresolution'].includes(match[1].toLowerCase()))
      .map(match => [match[1].toLowerCase(), match[2]]));
    const categories = [];
    if (/\.(?:js|jsx|mjs|cjs)$/.test(file) || virtualFiles.some(name => /\.(?:js|jsx|mjs|cjs)$/.test(name)) || options.allowjs === 'true') categories.push('js-source');
    if (/\/projects\/|\/tsserver\//.test(file) || /(?:jsconfig|tsconfig)\.json/i.test(source)) categories.push('project');
    if (/moduleResolution|NodeNext|Node16|Bundler|package\.json|exports|imports|require\(/i.test(source)) categories.push('module');
    if (/\/fourslash\//.test(file) && /(?:goToDefinition|findAllReferences|referenceGroups|goToSourceDefinition)/i.test(source)) categories.push('definition');
    if (categories.length) candidates.push({ file, categories, virtualFiles, options });
  }
  const counts = Object.fromEntries(['js-source', 'project', 'module', 'definition'].map(category =>
    [category, candidates.filter(item => item.categories.includes(category)).length]));
  const result = { upstreamCommit: revision.stdout.trim(), node: process.version,
    scannedFiles: paths.length, candidates: candidates.length, categoryCounts: counts, entries: candidates };
  if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ upstreamCommit: result.upstreamCommit, scannedFiles: result.scannedFiles,
    candidates: result.candidates, categoryCounts: result.categoryCounts, output: output || null })}\n`);
}
