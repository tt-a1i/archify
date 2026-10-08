#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceCommit = '98c839a43eedb95f38700aa5243ea778c0482777';
const sourcePath = '.github/workflows/release.yml';
const cases = ['release-overview', 'stable-release-gates'];
const runtimePaths = ['archify/bin', 'archify/renderers', 'archify/schemas', 'archify/locales', 'archify/assets/template.html'];
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => `${JSON.stringify(value, null, 2)}\n`;
const round = value => Number(value.toFixed(3));

function usage() {
  console.log(`Usage: node generate.mjs --base-repo <checkout> [--candidate-repo <checkout>]
  [--out-dir <directory>] [--benchmark-runs <5..51>] [--benchmark-warmups <1..10>]

Use official Node 22.23.1 with zlib 1.3.1-e00f703. The base checkout must be
${sourceCommit}. The default candidate is this repository.
Output uses a fresh temporary directory, whose path is printed. An explicit
--out-dir must be new or empty. Benchmarking is opt-in and serial.
No browser, installation, network access, Git mutation or test suite is run.`);
}

function options(args) {
  const result = { candidateRepo: path.resolve(here, '../../../..'), benchmarkRuns: 0, benchmarkWarmups: 2 };
  const names = new Map([
    ['--base-repo', 'baseRepo'], ['--candidate-repo', 'candidateRepo'], ['--out-dir', 'outDir'],
    ['--benchmark-runs', 'benchmarkRuns'], ['--benchmark-warmups', 'benchmarkWarmups'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    const value = args[index + 1];
    if (!key || !value || value.startsWith('--')) throw new Error(`Invalid or incomplete option: ${args[index]}`);
    result[key] = key.startsWith('benchmark') ? Number(value) : path.resolve(value);
    index += 1;
  }
  if (!result.baseRepo) throw new Error('--base-repo is required.');
  if (!Number.isInteger(result.benchmarkRuns) || (result.benchmarkRuns !== 0 && (result.benchmarkRuns < 5 || result.benchmarkRuns > 51))) {
    throw new Error('--benchmark-runs must be 0 (disabled) or an integer from 5 to 51.');
  }
  if (!Number.isInteger(result.benchmarkWarmups) || result.benchmarkWarmups < 1 || result.benchmarkWarmups > 10) {
    throw new Error('--benchmark-warmups must be an integer from 1 to 10.');
  }
  return result;
}

export function prepareEvidenceDirectory(outDir) {
  if (outDir === undefined) return fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-evidence-'));
  const directory = path.resolve(outDir);
  if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory()) {
    throw new Error(`Evidence output path must be a directory: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: true });
  if (fs.readdirSync(directory).length) {
    throw new Error(`Evidence output directory must be new or empty: ${directory}`);
  }
  return directory;
}

function execute(command, args, cwd) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed: ${result.error?.message || `exit ${result.status}`}`
      + `\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return { stdout: result.stdout, stderr: result.stderr, elapsedMs };
}

function git(repo, args) {
  return execute('git', ['-C', repo, ...args], repo).stdout;
}

function repositoryIdentity(repo) {
  const commit = git(repo, ['rev-parse', 'HEAD']).trim();
  const dirty = git(repo, ['status', '--porcelain', '--untracked-files=no', '--', ...runtimePaths]).trim();
  if (dirty) throw new Error(`Runtime inputs must be clean before generation:\n${dirty}`);
  const files = git(repo, ['ls-files', '-z', '--', ...runtimePaths]).split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(`${file}\0`);
    digest.update(fs.readFileSync(path.join(repo, file)));
    digest.update('\0');
  }
  return { commit, runtimeSha256: digest.digest('hex'), runtimeFileCount: files.length, dirtyRuntimeInputs: false };
}

function svgFacts(html) {
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  if (!svg) throw new Error('Rendered HTML has no SVG.');
  const values = expression => [...new Set([...svg.matchAll(expression)].map(match => match[1]))].sort();
  return {
    sha256: hash(svg),
    viewBox: svg.match(/\bviewBox="([^"]+)"/)?.[1],
    nodeIds: values(/\bdata-node-id="([^"]+)"/g),
    edgeIds: values(/\bdata-edge-id="([^"]+)"/g),
    texts: [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
      .map(match => match[1].replace(/<[^>]*>/g, '')).sort(),
  };
}

function topology(document) {
  return {
    nodes: document.nodes.map(({ id, lane, col, type, label, sublabel, tag, yOffset }) => ({ id, lane, col, type, label, sublabel, tag, yOffset })),
    edges: document.edges.map(({ id, from, to, label, role }) => ({ id, from, to, label, role })),
    lanes: document.lanes,
    mainPath: document.mainPath,
  };
}

function cli(repo, args) {
  return execute(process.execPath, [path.join(repo, 'archify/bin/archify.mjs'), ...args], repo);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  return ordered[lower] + (ordered[Math.ceil(position)] - ordered[lower]) * (position - lower);
}

function summarize(samples) {
  return {
    samplesMs: samples.map(round), medianMs: round(percentile(samples, 0.5)), p95Ms: round(percentile(samples, 0.95)),
    minimumMs: round(Math.min(...samples)), maximumMs: round(Math.max(...samples)),
  };
}

function benchmark(variants, output, runs, warmups) {
  // 每轮轮换起点，避免总让同一个版本享受最热的文件系统缓存。
  const samples = Object.fromEntries(variants.map(variant => [variant.name, []]));
  for (let roundIndex = -warmups; roundIndex < runs; roundIndex += 1) {
    const offset = (roundIndex + warmups) % variants.length;
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[(index + offset) % variants.length];
      const result = cli(variant.repo, ['render', 'workflow', variant.input, output]);
      if (roundIndex >= 0) samples[variant.name].push(result.elapsedMs);
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)]));
}

async function main() {
  if (process.argv.includes('--help')) return usage();
  const config = options(process.argv.slice(2));
  config.outDir = prepareEvidenceDirectory(config.outDir);
  console.log(`Evidence output directory: ${config.outDir}`);
  if (process.versions.node !== '22.23.1' || process.versions.zlib !== '1.3.1-e00f703') {
    throw new Error(`Use official Node 22.23.1 / zlib 1.3.1-e00f703; got ${process.versions.node} / ${process.versions.zlib}.`);
  }
  const base = repositoryIdentity(config.baseRepo);
  const candidate = repositoryIdentity(config.candidateRepo);
  if (base.commit !== sourceCommit) throw new Error(`Expected base ${sourceCommit}; got ${base.commit}.`);
  git(config.candidateRepo, ['merge-base', '--is-ancestor', sourceCommit, candidate.commit]);
  const source = git(config.baseRepo, ['show', `${sourceCommit}:${sourcePath}`]);
  if (hash(fs.readFileSync(path.join(config.candidateRepo, sourcePath))) !== hash(source)) {
    throw new Error('The candidate release workflow differs from the pinned source. Update the source map before comparing.');
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-generation-'));
  const record = {
    schemaVersion: 1, status: 'running', generatedAt: new Date().toISOString(),
    source: { repository: 'https://github.com/tt-a1i/archify', commit: sourceCommit, path: sourcePath, sha256: hash(source) },
    base, candidate,
    toolchain: { node: process.versions.node, zlib: process.versions.zlib, platform: process.platform, arch: process.arch },
    generatorSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    typographyScale: 1.5,
    cases: [],
  };
  const writeRecord = () => fs.writeFileSync(path.join(config.outDir, 'generation.json'), jsonBytes(record));
  writeRecord();
  const benchmarkCases = [];
  try {
    for (const name of cases) {
      const inputPath = path.join(here, `${name}.workflow.json`);
      const inputBytes = fs.readFileSync(inputPath);
      const document = JSON.parse(inputBytes.toString('utf8'));
      if (document.schema_version !== 2 || document.diagram_type !== 'workflow' || Object.hasOwn(document.meta, 'typography_scale')) {
        throw new Error(`${name}: expected an unscaled Workflow v2 input.`);
      }
      const scaled = structuredClone(document);
      scaled.meta.typography_scale = 1.5;
      const scaledBytes = jsonBytes(scaled);
      const scaledInput = path.join(scratch, `${name}-scaled.workflow.json`);
      fs.writeFileSync(scaledInput, scaledBytes);
      const restored = structuredClone(scaled);
      delete restored.meta.typography_scale;
      if (JSON.stringify(restored) !== JSON.stringify(document)) throw new Error(`${name}: scaling changed authored content.`);
      const directory = path.join(config.outDir, name);
      fs.mkdirSync(directory, { recursive: true });
      const variants = [
        { name: 'before', repo: config.baseRepo, input: inputPath, output: path.join(directory, 'before.html') },
        { name: 'after', repo: config.candidateRepo, input: scaledInput, output: path.join(directory, 'after.html') },
        { name: 'candidate-default', repo: config.candidateRepo, input: inputPath, output: path.join(scratch, `${name}-candidate-default.html`) },
      ];
      const result = {
        name, input: `${name}.workflow.json`, inputSha256: hash(inputBytes), scaledInputSha256: hash(scaledBytes),
        topologySha256: hash(JSON.stringify(topology(document))), onlyTypographyScaleChanged: true,
        authoredNodeCount: document.nodes.length, authoredEdgeCount: document.edges.length, variants: {},
      };
      const rendered = {};
      for (const variant of variants) {
        const validation = cli(variant.repo, ['validate', 'workflow', variant.input, '--json']);
        const receipt = JSON.parse(validation.stdout);
        if (receipt.ok !== true) throw new Error(`${name}/${variant.name}: validation did not report ok=true.`);
        cli(variant.repo, ['render', 'workflow', variant.input, variant.output]);
        const html = fs.readFileSync(variant.output, 'utf8');
        const facts = svgFacts(html);
        if (JSON.stringify(facts.nodeIds) !== JSON.stringify(document.nodes.map(node => node.id).sort())
          || JSON.stringify(facts.edgeIds) !== JSON.stringify(document.edges.map(edge => edge.id).sort())) {
          throw new Error(`${name}/${variant.name}: rendered IDs do not retain the authored topology.`);
        }
        rendered[variant.name] = { html, facts };
        result.variants[variant.name] = {
          ...(variant.name !== 'candidate-default' ? { html: `${name}/${variant.name}.html` } : { temporaryArtifact: true }),
          htmlSha256: hash(html), htmlBytes: Buffer.byteLength(html), svgSha256: facts.sha256,
          viewBox: facts.viewBox, renderedTextCount: facts.texts.length,
          validation: { ok: receipt.ok, diagnostics: receipt.diagnostics || [], desktopReadability: receipt.composition?.desktopReadability },
        };
      }
      result.defaultHtmlByteIdentical = rendered.before.html === rendered['candidate-default'].html;
      result.defaultSvgByteIdentical = rendered.before.facts.sha256 === rendered['candidate-default'].facts.sha256;
      result.renderedTextContentRetained = JSON.stringify(rendered.before.facts.texts) === JSON.stringify(rendered.after.facts.texts);
      record.cases.push(result);
      writeRecord();
      if (!result.defaultHtmlByteIdentical || !result.renderedTextContentRetained) {
        if (!result.defaultHtmlByteIdentical) fs.copyFileSync(variants[2].output, path.join(directory, 'candidate-default.html'));
        throw new Error(`${name}: compatibility/content check failed; inspect generation.json.`);
      }
      benchmarkCases.push({ name, variants });
      console.log(`${name}: validate/render passed; ${document.nodes.length} nodes / ${document.edges.length} edges retained; default HTML byte-identical.`);
    }
    if (config.benchmarkRuns) {
      const timing = {
        schemaVersion: 1, generatedAt: new Date().toISOString(), base, candidate, toolchain: record.toolchain,
        environment: { cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, osRelease: os.release() },
        runsPerVariant: config.benchmarkRuns, warmupsPerVariant: config.benchmarkWarmups,
        timingDefinition: 'Serial fresh-process CLI render wall time; includes Node startup, parsing, validation, generation and output writing. Separate validate commands and browser work are excluded.',
        order: 'The first variant rotates each round; warmup samples are discarded. External concurrent work is not controlled by this script.',
        cases: [],
      };
      for (const entry of benchmarkCases) {
        timing.cases.push({ name: entry.name, variants: benchmark(entry.variants,
          path.join(scratch, 'benchmark.html'), config.benchmarkRuns, config.benchmarkWarmups) });
      }
      fs.writeFileSync(path.join(config.outDir, 'generation-benchmark.json'), jsonBytes(timing));
      record.benchmark = 'generation-benchmark.json';
    }
    record.status = 'complete';
    writeRecord();
  } catch (error) {
    record.status = 'failed';
    record.error = error.message;
    writeRecord();
    throw error;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
