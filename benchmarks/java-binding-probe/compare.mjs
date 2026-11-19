import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (![6, 7].includes(process.argv.length) || (process.argv.length === 7 && !['--enhanced', '--base-revision'].includes(process.argv[6]))) {
  throw new Error('usage: node compare.mjs <project-root> <facts.json> <bindings.tsv> <queries.json> [--enhanced|--base-revision]');
}
const [, , rootArg, factsFile, bindingsFile, queriesFile] = process.argv;
const enhanced = process.argv[6] === '--enhanced';
const baseRevision = process.argv[6] === '--base-revision';
const root = path.resolve(rootArg);
const facts = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(queriesFile, 'utf8'));
const prefix = manifest.jsPathPrefix || '';

function inputDigest() {
  const files = [...(manifest.metadataFiles || [])];
  const visit = directory => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && name.endsWith('.java')) files.push(name);
    }
  };
  for (const directory of manifest.sourceDirectories) visit(directory);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file).update(Buffer.from([0]));
    hash.update(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest());
  }
  return hash.digest('hex');
}
const digest = inputDigest();
assert.equal(digest, manifest.inputSha256, 'source snapshot differs from the fixed query manifest');

const [header, ...data] = fs.readFileSync(bindingsFile, 'utf8').trimEnd().split(/\r?\n/);
assert.equal(header, 'file\tline\tcolumn\tendLine\tendColumn\tkind\towner\tmethod\ttargetFile\ttargetLine\ttargetColumn\ttext');
const rows = data.map(line => {
  const [file, lineNumber, column, endLine, endColumn, kind, owner, method, targetFile, targetLine, targetColumn, text] = line.split('\t');
  return { file, line: Number(lineNumber), column: Number(column), endLine: Number(endLine),
    endColumn: Number(endColumn), kind, owner, method, targetFile, targetLine: Number(targetLine), targetColumn: Number(targetColumn), text };
});
const key = call => [call.file, call.line, call.column, call.endLine, call.endColumn].join(':');
const jdkByPosition = new Map(rows.map(row => [key(row), row]));
assert.equal(jdkByPosition.size, rows.length, 'javac emitted duplicate invocation spans');
const jsCalls = facts.calls.map(call => ({ ...call, file: prefix + call.file,
  targetFile: call.target ? prefix + (call.target.file || call.file) : null }));
const jsByPosition = new Map(jsCalls.map(call => [key(call), call]));
assert.equal(jsByPosition.size, jsCalls.length, 'Archify emitted duplicate invocation spans');
const unmatchedJs = jsCalls.filter(call => !jdkByPosition.has(key(call)));
assert.equal(unmatchedJs.length, 0, 'Archify invocation spans did not match the javac source oracle');

const matched = rows.filter(row => jsByPosition.has(key(row))).map(jdk => ({ jdk, js: jsByPosition.get(key(jdk)) }));
const sourceTargets = matched.filter(({ jdk }) => jdk.targetFile);
const known = matched.filter(({ js }) => js.target);
const disagreements = known.filter(({ jdk, js }) => jdk.targetFile !== js.targetFile
  || jdk.targetLine !== js.target.line || jdk.targetColumn !== js.target.column);
const missedSource = sourceTargets.filter(({ js }) => !js.target);
const jdkOnly = rows.filter(row => !jsByPosition.has(key(row)));
const missedAcrossPackages = missedSource.filter(({ jdk }) => path.posix.dirname(jdk.file) !== path.posix.dirname(jdk.targetFile));
const byKindScope = {};
const missedReasons = {};
for (const { jdk, js } of sourceTargets) {
  const category = `${jdk.kind}/${jdk.targetFile === jdk.file ? 'same-file' : 'cross-file'}/${js.target ? 'known' : 'unresolved'}`;
  byKindScope[category] = (byKindScope[category] || 0) + 1;
  if (!js.target) missedReasons[js.reason] = (missedReasons[js.reason] || 0) + 1;
}
const queries = manifest.queries.map(query => {
  const position = key(query);
  const jdk = jdkByPosition.get(position);
  const js = jsByPosition.get(position);
  assert.ok(jdk && js, `missing query ${query.id} at ${position}`);
  const jdkTarget = jdk.targetFile ? `${jdk.targetFile}:${jdk.targetLine}` : null;
  assert.equal(jdkTarget, query.jdkTarget, `javac target changed for ${query.id}`);
  if (!baseRevision) assert.equal(js.target ? 'known' : 'unresolved', enhanced && query.jdkTarget ? 'known' : query.jsStatus, `Archify status changed for ${query.id}`);
  if (js.target) {
    assert.equal(`${js.targetFile}:${js.target.line}`, jdkTarget, `Archify target changed for ${query.id}`);
    assert.equal(js.target.column, jdk.targetColumn, `Archify target column changed for ${query.id}`);
  }
  return { id: query.id, position, text: jdk.text, kind: jdk.kind, owner: jdk.owner,
    method: jdk.method, jdkTarget, jsStatus: js.target ? 'known' : 'unresolved',
    jsTarget: js.target ? `${js.targetFile}:${js.target.line}` : null, jsReason: js.reason || null };
});

console.log(JSON.stringify({ project: manifest.project, inputSha256: digest, sourceFiles: facts.files.length,
  summary: { javacInvocations: rows.length, archifyInvocations: jsCalls.length,
    javacOnlyInvocations: jdkOnly.length,
    javacOnlyConstructorDelegations: jdkOnly.filter(row => /^(?:super|this)\(/.test(row.text)).length,
    matchedInvocations: matched.length,
    javacSourceTargets: rows.filter(row => row.targetFile).length,
    matchedSourceTargets: sourceTargets.length, archifyKnownTargets: known.length,
    knownTargetDisagreements: disagreements.length, sourceTargetsLeftUnresolved: missedSource.length,
    sourceTargetsAcrossPackagesLeftUnresolved: missedAcrossPackages.length,
    byKindScope, missedReasons }, queries }, null, 2));
