#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { assertDriftPin, captureDriftTree, driftRepository } from '../lib/drift-capture.mjs';
import { readDriftInput } from '../lib/drift-input.mjs';
import { git } from '../lib/git-sources.mjs';
import { containedBy } from '../../../renderers/shared/path-semantics.mjs';
import { resolveNativeOutputDirectory } from '../../../renderers/shared/output-path.mjs';
import { createOwnedTempDirectory } from '../../../renderers/shared/owned-temp-directory.mjs';

const usage = 'Usage: archify code-analysis wiki <git-repo> --commit <full-sha> --language ts|py --out <new-directory> [--scope relative/path] [--locale en|zh-CN] [--narrative file.json] [--include-source] [--json]';
const sha256 = value => createHash('sha256').update(value).digest('hex');

function argumentsFor(args) {
  const invalid = () => fail('wiki/usage', usage);
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true, tokens: true, options: {
        commit: { type: 'string' }, scope: { type: 'string', default: '.' }, language: { type: 'string' },
        out: { type: 'string' }, locale: { type: 'string', default: 'en' }, narrative: { type: 'string' },
        'include-source': { type: 'boolean', default: false }, json: { type: 'boolean' },
      },
    });
  } catch {
    invalid();
  }
  const { values, positionals, tokens } = parsed;
  const names = tokens.filter(token => token.kind === 'option').map(token => token.name);
  if (new Set(names).size !== names.length || positionals.length !== 1 || !values.out || !values.commit ||
      !['ts', 'py'].includes(values.language) || !['en', 'zh-CN'].includes(values.locale) ||
      (Object.hasOwn(values, 'narrative') && !values.narrative)) invalid();
  return { directory: positionals[0], ...values };
}

function outputDirectory(input, root) {
  const resolved = resolveNativeOutputDirectory(input);
  const parent = fs.realpathSync(path.dirname(resolved));
  const out = path.join(parent, path.basename(resolved));
  if (containedBy(root, out).status !== 'different' || fs.existsSync(out)) {
    fail('wiki/output-invalid', 'Select a new wiki output directory outside the input repository.', {
      supportedFixes: ['pass a new --out path and keep the previous wiki in its original directory'],
    });
  }
  return out;
}

async function githubOrigin(root) {
  try {
    const remote = (await git(root, ['config', '--get', 'remote.origin.url'], { noLazyFetch: true })).toString('utf8').trimEnd();
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
    return match ? 'https://github.com/' + match[1] : null;
  } catch (error) {
    if (error.diagnostics?.[0]?.evidence?.exitCode === 1) return null;
    throw error;
  }
}

// A wiki is written to a fresh destination. Reserve the directory exclusively,
// finish every artifact before writing the manifest, and clean only our files.
function publish(out, entries) {
  fs.mkdirSync(out);
  const identity = fs.lstatSync(out, { bigint: true });
  const written = [];
  try {
    for (const [name, body] of entries) {
      const file = path.join(out, name);
      const fd = fs.openSync(file, 'wx');
      written.push(file);
      try { fs.writeFileSync(fd, body); } finally { fs.closeSync(fd); }
    }
  } catch (error) {
    const check = fs.lstatSync(out, { bigint: true, throwIfNoEntry: false });
    if (check?.isDirectory() && check.dev === identity.dev && check.ino === identity.ino && check.birthtimeNs === identity.birthtimeNs) {
      for (const file of written) fs.unlinkSync(file);
      fs.rmdirSync(out);
    }
    throw error;
  }
}

async function build(args) {
  const options = argumentsFor(args);
  const root = driftRepository(options.directory);
  assertDriftPin(root, options.commit, 'wiki');
  const out = outputDirectory(options.out, root);
  const narrative = options.narrative ? readDriftInput(options.narrative, 'wiki narrative', 1024 * 1024).doc : null;
  if (options.narrative && (!narrative || typeof narrative !== 'object')) fail('wiki/narrative-invalid', 'Select a wiki narrative JSON object.');
  const url = await githubOrigin(root);
  const { buildGraph, evaluateGraph, extractFacts, stableJson } = await import('../lib/analysis.mjs');
  const { buildOverlay } = await import('../overlay/inject.mjs');
  const { buildWiki } = await import('../wiki/model.mjs');
  const { wikiHtml, wikiMarkdown } = await import('../wiki/render.mjs');
  const scratch = createOwnedTempDirectory('archify-wiki-');
  let built;
  try {
    const captured = path.join(scratch.path, 'source');
    const omitted = captureDriftTree(root, options.commit, captured, { scope: options.scope });
    const scope = options.scope;
    const { facts, config, otherLanguages } = extractFacts(captured, { language: options.language, capturedOnly: true });
    if (!facts.files.length) fail('wiki/scope-empty', 'No supported source files were found in the selected Git tree and scope.', {
      subject: { scope, language: options.language },
      supportedFixes: ['select a directory and language with source files at the pinned commit'],
    });
    const { snapshotId, ...identity } = facts.repository;
    facts.repository = { ...identity, root: scope, revision: options.commit, sourceKind: 'git-tree', baseRevision: null, url };
    facts.repository.snapshotId = sha256(stableJson(facts));
    const graph = buildGraph(facts, config);
    const findings = evaluateGraph(graph, config, facts);
    const title = (url ? url.split('/').at(-1) : path.basename(root)) + (scope === '.' ? '' : ' / ' + scope);
    // Reuse the real Atlas and analysis coverage. Omit sourceRoot and
    // findingsDocument so this graph artifact contains no excerpts or tasks.
    const overlay = buildOverlay({ ir: null, graph, facts, findings: findings.diagnostics, run: {
      locale: options.locale, title, openAnalysis: true, rules: findings.rules, otherLanguages,
      exclude: config.exclude || [], suppressed: config.ignore || [], duplicates: findings.analysis?.duplicates || null,
    } });
    const wiki = buildWiki({ facts, graph, overview: overlay.overview, findings, title, locale: options.locale, omitted,
      configDigest: sha256(stableJson(config)), narrative, includeSource: options['include-source'] });
    const markdown = wikiMarkdown(wiki.document);
    const artifacts = new Map([
      ['index.html', wikiHtml(wiki, markdown)], ['wiki.md', markdown], ['atlas.html', overlay.html],
    ]);
    const manifest = { ...wiki.document, artifacts: Object.fromEntries([...artifacts].map(([name, body]) => [name, {
      sha256: sha256(body), bytes: Buffer.byteLength(body),
    }])) };
    artifacts.set('wiki.json', stableJson(manifest));
    built = { artifacts, manifest };
  } finally {
    await scratch.cleanup();
  }

  publish(out, built.artifacts);
  return receipt('ok', { command: 'wiki', out, revision: built.manifest.repository.revision, scope: built.manifest.repository.scope,
    counts: { modules: built.manifest.modules.length, citations: built.manifest.citations.length },
    artifacts: Object.fromEntries([...built.artifacts.keys()].map(name => [name, path.join(out, name)])),
  });
}

const args = process.argv.slice(2);
if (!args.length || ['-h', '--help'].includes(args[0])) console.log(usage);
else {
  try {
    const result = await build(args);
    if (args.includes('--json')) console.log(JSON.stringify(result));
    else console.log('Repository wiki: ' + result.artifacts['index.html']);
  } catch (error) {
    const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{
      code: 'wiki/build-failed', severity: 'error', message: error.message, subject: {}, evidence: {},
      supportedFixes: ['check the local Git objects and choose a writable new output directory'],
    }];
    if (args.includes('--json')) console.log(JSON.stringify(receipt('error', { command: 'wiki', diagnostics })));
    else diagnostics.forEach(diagnostic => console.error(diagnostic.message));
    process.exitCode = 2;
  }
}
