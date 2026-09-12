#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { replay, stats, anchorDecay } from './historical-method.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const usage = 'node experiments/legacy-e3-replay/run.mjs --repo <local checkout> --out <new directory>';

function options(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--repo', '--out'].includes(key) || result[key] || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(usage);
    }
    result[key] = path.resolve(args[i + 1]);
  }
  if (!result['--repo'] || !result['--out']) throw new Error(usage);
  // Refuse even an empty existing directory. A replay cannot overwrite prior evidence.
  try {
    fs.lstatSync(result['--out']);
    throw new Error('--out must be a new directory; existing paths are never overwritten.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!fs.statSync(path.dirname(result['--out'])).isDirectory()) throw new Error('--out parent must exist.');
  return { repo: result['--repo'], out: result['--out'] };
}

function ownership(map) {
  // Published head-map labels, metadata and array ordering were hand-edited.
  // Only these sorted sets affect this historical classifier.
  return {
    base: map.base,
    components: Object.fromEntries(Object.entries(map.components).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([id, component]) => [id, [...component.globs].sort()])),
    excluded: [...map.excluded].sort(),
  };
}

function summaryDifferences(actual, expected) {
  return Object.fromEntries([...new Set([...Object.keys(actual), ...Object.keys(expected)])]
    .filter(key => !isDeepStrictEqual(actual[key], expected[key]))
    .map(key => [key, { actual: actual[key], expected: expected[key] }]));
}

function main() {
  const args = options(process.argv.slice(2));
  if (!args) { console.log(usage); return; }
  const provenanceBytes = fs.readFileSync(path.join(here, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes);
  const { base: BASE, head: HEAD, inputRevision } = provenance;
  const overrides = ['core.quotePath=true', 'diff.algorithm=myers', 'diff.renames=true', 'diff.renameLimit=1000', 'log.showSignature=false'];
  const gitPrefix = ['--no-pager', '--no-replace-objects', ...overrides.flatMap(value => ['-c', value])];
  const cache = new Map();
  let gitInvocations = 0;
  function git(command) {
    const key = JSON.stringify(command);
    if (cache.has(key)) return cache.get(key);
    const result = spawnSync('git', [...gitPrefix, ...command], {
      cwd: args.repo, encoding: 'utf8', maxBuffer: 1 << 28,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
    });
    gitInvocations++;
    if (result.error || result.status !== 0) {
      throw new Error(`Read-only git ${command.join(' ')} failed: ${result.error?.message || result.stderr.trim()}`);
    }
    cache.set(key, result.stdout);
    return result.stdout;
  }
  const repoRoot = fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim());
  if (repoRoot !== fs.realpathSync(args.repo)) throw new Error('--repo must be the Git top-level directory.');
  for (const revision of [BASE, HEAD, inputRevision]) {
    if (!/^[a-f0-9]{40}$/.test(revision) || git(['rev-parse', '--verify', `${revision}^{commit}`]).trim() !== revision) {
      throw new Error(`Pinned commit unavailable: ${revision}. This tool never fetches missing history.`);
    }
  }
  git(['merge-base', '--is-ancestor', BASE, HEAD]);

  const inputs = {};
  const inputValues = {};
  for (const [name, expected] of Object.entries(provenance.gitInputs)) {
    const bytes = Buffer.from(git(['cat-file', 'blob', `${inputRevision}:${expected.path}`]));
    if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw new Error(`Pinned input digest mismatch: ${name}`);
    inputs[name] = bytes;
    inputValues[name] = JSON.parse(bytes);
  }
  const editsBytes = fs.readFileSync(path.join(here, 'edits.json'));
  if (hash(editsBytes) !== provenance.recoveredSources['edits.json'].sha256) throw new Error('Recovered edits.json digest mismatch.');
  const mapInput = inputValues['e3-map-at-base.json'];
  if (mapInput.base !== BASE) throw new Error('The authored base map names a different revision.');

  // Observe blobs only at the pinned revisions. Missing files are null; other Git
  // errors remain fatal instead of being mistaken for removed anchor files.
  const trees = new Map();
  function show(revision, file) {
    if (!trees.has(revision)) trees.set(revision, new Set(git(['ls-tree', '-r', '--name-only', '-z', revision]).split('\0').filter(Boolean)));
    if (!trees.get(revision).has(file)) return null;
    return git(['cat-file', 'blob', `${revision}:${file}`]);
  }

  const replayed = replay({ git, BASE, HEAD, mapInput, edits: JSON.parse(editsBytes) });
  const statistics = stats({ git, HEAD, map: replayed.map, replay: replayed.replay });
  const scriptAnchors = anchorDecay({ git, show, BASE, HEAD });
  // Coordinates are recoverable from the published report. Base text and all
  // transitions are recomputed from Git; no old validity/event fields are reused.
  const archivedDecay = inputValues['e3-sources-decay.json'];
  const selection = archivedDecay.anchors.map(({ component, path, line }) => ({ component, path, line }));
  const publishedAnchors = anchorDecay({ git, show, BASE, HEAD, selection });
  const sameCoordinates = (a, b) => isDeepStrictEqual(a.map(({ component, path, line }) => ({ component, path, line })), b);
  const comparison = {
    replay: {
      jsonEqual: isDeepStrictEqual(replayed.replay, inputValues['e3-replay.json']),
      byteEqual: Buffer.from(json(replayed.replay)).equals(inputs['e3-replay.json']),
    },
    headMap: {
      byteEqual: Buffer.from(json(replayed.map)).equals(inputs['e3-map-at-head.json']),
      ownershipRulesEqual: isDeepStrictEqual(ownership(replayed.map), ownership(inputValues['e3-map-at-head.json'])),
      excludedFromRuleComparison: ['schema', 'note', 'revision', 'glob_syntax', 'component labels', 'edits_during_replay', 'component/glob ordering'],
      explanation: 'The recovered replay emits only base/components/excluded. The published map adds manual metadata and reorders equivalent glob sets.',
    },
    anchorsRecoveredScript: {
      jsonEqual: isDeepStrictEqual(scriptAnchors, archivedDecay),
      coordinatesEqual: sameCoordinates(scriptAnchors.anchors, selection),
      summaryDifferences: summaryDifferences(scriptAnchors.summary, archivedDecay.summary),
      explanation: 'Recovered FILES.tests selects architecture-render.test.mjs, absent at BASE. The published report selects cli.test.mjs and architecture-delta.test.mjs instead. The recovered FILES table is preserved.',
    },
    anchorsPublishedSelection: {
      jsonEqual: isDeepStrictEqual(publishedAnchors, archivedDecay),
      byteEqual: Buffer.from(json(publishedAnchors)).equals(inputs['e3-sources-decay.json']),
      summaryDifferences: summaryDifferences(publishedAnchors.summary, archivedDecay.summary),
      selectionSource: `${inputRevision}:docs/decisions/e3-sources-decay.json#anchors(component,path,line)`,
      explanation: 'This reconstructs the report cohort, not the different recovered script selection; pinned line text and all observations are newly read from Git.',
    },
    stats: {
      traceSource: 'This run: e3-replay.json',
      originalTraceSource: 'The old stats.mjs read the already-published docs/decisions/e3-replay.json, even when replay output changed.',
      originalStdoutAvailable: false,
      explanation: 'Original formulas are preserved and consume this run. There is no recovered standalone stats stdout for a byte comparison.',
    },
  };
  const reproduced = comparison.replay.jsonEqual && comparison.headMap.ownershipRulesEqual && comparison.anchorsPublishedSelection.jsonEqual;
  const data = {
    'e3-replay.json': replayed.replay,
    'e3-map-at-head.json': replayed.map,
    'e3-replay-summary.json': replayed.summary,
    'e3-stats.json': statistics,
    'e3-sources-decay-recovered-script.json': scriptAnchors,
    'e3-sources-decay-published-selection.json': publishedAnchors,
    'published-anchor-selection.json': selection,
    'comparison.json': comparison,
  };
  const rendered = Object.fromEntries(Object.entries(data).map(([name, value]) => [name, json(value)]));
  const receipt = {
    schemaVersion: 1,
    status: reproduced ? 'reproduced-with-documented-selection-difference' : 'comparison-differs',
    purpose: 'Retrospective replay of authored path globs and scheduled human edits. No live maintenance cost or reader efficiency claim.',
    revisions: { base: BASE, head: HEAD, inputs: inputRevision },
    runtime: { node: process.version, git: git(['--version']).trim(), platform: process.platform, arch: process.arch, gitOverrides: overrides, gitInvocations },
    sources: Object.fromEntries(['run.mjs', 'historical-method.mjs', 'edits.json', 'provenance.json'].map(name => [name, hash(fs.readFileSync(path.join(here, name)))])),
    recoveredSources: provenance.recoveredSources,
    inputs: provenance.gitInputs,
    outputs: Object.fromEntries(Object.entries(rendered).map(([name, bytes]) => [name, { bytes: Buffer.byteLength(bytes), sha256: hash(bytes) }])),
    methodLimits: [
      'Retrospective human-authored map and edit schedule; edit count is not elapsed effort, minimum necessary edits, automation accuracy or prospective maintenance cost.',
      'Legacy matcher and destination-only rename/copy classification are intentionally retained; current Locate behavior is not measured.',
      'Anchor files are manually selected. First invalidation latches, while final HEAD validity is checked independently.',
      'anchorFilesTouched counts touched anchors, not distinct files. Percent decayed anchors and percent commits needing map edits use different denominators.',
      'Published map labels/metadata and historical stats stdout are not generated by the recovered replay source.',
      'No runtime/renderer/browser acceptance, external repository replay or human-efficiency experiment is performed.',
    ],
  };
  // All computation and input checks finish before any write. mkdir is exclusive;
  // every subsequent file is a fixed basename inside the explicit output path.
  fs.mkdirSync(args.out);
  for (const [name, bytes] of Object.entries(rendered)) fs.writeFileSync(path.join(args.out, name), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(args.out, 'receipt.json'), `${json(receipt)}\n`, { flag: 'wx' });
  console.log(json({ status: receipt.status, out: args.out, replay: replayed.summary, anchors: {
    recoveredScript: scriptAnchors.summary, publishedSelection: publishedAnchors.summary,
  }, comparison }));
  if (!reproduced) process.exitCode = 1;
}

try { main(); } catch (error) {
  console.error(`legacy-e3-replay: ${error.message}`);
  process.exitCode = 2;
}
