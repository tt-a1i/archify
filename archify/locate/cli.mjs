import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { parseRepositoryRemote } from '../renderers/shared/repository-location.mjs';
import { LocateError, locateDiagnostic, locateFail } from './error.mjs';
import {
  defaultOwnershipPath,
  inheritParentExcluded,
  loadChildOwnership,
  loadOwnership,
} from './ownership.mjs';
import {
  diffNameStatus,
  gitShow,
  gitTopLevel,
  listTree,
  resolveCommit,
  resolveRepoRoot,
  revListCount,
} from './git.mjs';
import {
  buildLocateProjection,
  embedProjection,
  locateLint,
  locateRange,
} from './locate.mjs';
import { renderLocateHtml, stampUncoveredCount, validateLocateHtml } from './locate-html.mjs';

const cliPath = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));

function need(args, index, flag, fail) {
  const value = args[index];
  if (!value || value.startsWith('--')) fail(`${flag} requires a value.`, 2);
  return value;
}

export function parseLocateArgs(args, { usage, fail }) {
  let lint = false;
  let map;
  let ownership;
  let repoRoot;
  let facts;
  let out;
  let bundle;
  let json = false;
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--lint') {
      lint = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--map') {
      map = need(args, index + 1, '--map', fail);
      index += 1;
      continue;
    }
    if (arg === '--ownership') {
      ownership = need(args, index + 1, '--ownership', fail);
      index += 1;
      continue;
    }
    if (arg === '--repo-root') {
      repoRoot = need(args, index + 1, '--repo-root', fail);
      index += 1;
      continue;
    }
    if (arg === '--out') {
      out = need(args, index + 1, '--out', fail);
      index += 1;
      continue;
    }
    if (arg === '--bundle') {
      bundle = need(args, index + 1, '--bundle', fail);
      index += 1;
      continue;
    }
    if (arg === '--facts') {
      const first = args[index + 1];
      const second = args[index + 2];
      if (!first || !second || first.startsWith('--') || second.startsWith('--')) {
        fail('--facts requires two JSON paths.', 2);
      }
      facts = [first, second];
      index += 2;
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown locate option "${arg}".\n\n${usage()}`, 2);
    positionals.push(arg);
  }
  if (!map) fail(usage(), 2);
  if (lint) {
    if (positionals.length > 1) fail(usage(), 2);
    if (positionals[0] && /\.\./.test(positionals[0])) fail('--lint cannot be combined with a range.', 2);
    return { lint: true, lintRev: positionals[0] || 'HEAD', map, ownership, repoRoot, out, bundle, json };
  }
  if (positionals.length !== 1) fail(usage(), 2);
  const range = positionals[0];
  const parts = range.split('..');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    locateFail('locate/range-invalid', 'locate range must be <base>..<head>.', {
      evidence: { range, stderr: '' },
      supportedFixes: ['pass a git revision range as <base>..<head>'],
    });
  }
  return {
    lint: false, range, base: parts[0], head: parts[1], map, ownership, repoRoot, facts, out, bundle, json,
  };
}

function toRepoPath(absPath, repoRoot) {
  const resolved = fs.realpathSync(path.resolve(absPath));
  const root = fs.realpathSync(path.resolve(repoRoot));
  return path.relative(root, resolved).split(path.sep).join('/');
}

function loadMap(mapPath) {
  let raw;
  try {
    raw = fs.readFileSync(mapPath);
  } catch (error) {
    locateFail('locate/map-unreadable', `Could not read map: ${error.message}`, {
      evidence: { path: mapPath, reason: error.message },
      supportedFixes: ['pass a readable diagram JSON as --map'],
    });
  }
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    locateFail('locate/map-invalid', `Could not parse map: ${error.message}`, {
      evidence: { path: mapPath, reason: error.message },
    });
  }
  const type = data?.diagram_type;
  if (!['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].includes(type)) {
    locateFail('locate/map-invalid', 'Map is not a supported Archify diagram JSON.', {
      evidence: { path: mapPath, diagramType: type },
    });
  }
  try {
    validateSchema(type, data);
  } catch (error) {
    locateFail('locate/map-invalid', error.message, {
      evidence: { path: mapPath, reason: error.message },
    });
  }
  return data;
}

function loadFactsPair(paths) {
  const loaded = [];
  for (const [index, filePath] of paths.entries()) {
    try {
      loaded.push(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      locateFail('locate/facts-invalid', `Could not read facts file ${index ? 'after' : 'before'}: ${error.message}`, {
        evidence: { path: filePath, reason: error.message },
      });
    }
  }
  return { before: loaded[0], after: loaded[1] };
}

function repositoryMeta(map) {
  const repository = map.meta?.repository;
  if (!repository) return {};
  const location = parseRepositoryRemote(repository.url, { authored: true });
  return {
    repositoryUrl: location?.url || repository.url,
    linkMode: repository.link_mode || 'web',
  };
}

function childOwnerships(ownership, ownershipPath) {
  const children = {};
  for (const component of ownership.components) {
    if (!component.child_map) continue;
    const child = loadChildOwnership(ownershipPath, component.child_map);
    if (child) children[component.id] = child.ownership;
  }
  return children;
}

function prepareOutDir(out) {
  const dir = path.resolve(out);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    locateFail('locate/out-directory', `Could not create --out directory: ${error.message}`, {
      evidence: { reason: error.message },
    });
  }
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (error) {
    locateFail('locate/out-directory', `Could not read --out directory: ${error.message}`, {
      evidence: { reason: error.message },
    });
  }
  if (!stat.isDirectory()) {
    locateFail('locate/out-directory', '--out must be a directory.', {
      supportedFixes: ['pass a writable directory to --out'],
    });
  }
  return dir;
}

function commitReceiptOnly({ receiptCandidate, outputReceipt, stagingDirectory }) {
  if (fs.existsSync(outputReceipt)) {
    const existing = fs.lstatSync(outputReceipt);
    if (!existing.isFile()) {
      locateFail('locate/out-directory', 'Existing receipt target is not a regular file.', {
        evidence: { target: outputReceipt },
      });
    }
    fs.renameSync(outputReceipt, path.join(stagingDirectory, '.previous-receipt'));
  }
  fs.renameSync(receiptCandidate, outputReceipt);
}

function commitLocatePair({ htmlCandidate, receiptCandidate, outputHtml, outputReceipt, stagingDirectory }) {
  const targets = [
    { label: 'HTML artifact', target: outputHtml, candidate: htmlCandidate, backup: path.join(stagingDirectory, '.previous-html') },
    { label: 'receipt', target: outputReceipt, candidate: receiptCandidate, backup: path.join(stagingDirectory, '.previous-receipt') },
  ];
  for (const item of targets) {
    if (!fs.existsSync(item.target)) continue;
    const existing = fs.lstatSync(item.target);
    if (!existing.isFile()) {
      locateFail('locate/out-directory', `Existing ${item.label} target is not a regular file.`, {
        evidence: { target: item.target },
      });
    }
  }
  for (const item of targets) {
    if (fs.existsSync(item.target)) fs.renameSync(item.target, item.backup);
  }
  for (const item of targets) fs.renameSync(item.candidate, item.target);
}

function reportLocateFailure({ json, error, status = 1, diagnostics }) {
  const list = diagnostics || [(error instanceof LocateError
    ? locateDiagnostic(error)
    : {
      code: 'locate/internal',
      severity: 'error',
      message: error.message,
      subject: {},
      evidence: {},
      supportedFixes: [],
    })];
  const payload = {
    schemaVersion: 1,
    ok: false,
    command: 'locate',
    error: error.message,
    diagnostics: list,
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else console.error(`[${list[0].code}] ${error.message}`);
  process.exitCode = status;
}

function childSpecPath(bundleDir, diagram) {
  const candidates = [];
  if (diagram?.id) {
    for (const suffix of ['.json', '.architecture.json', '.workflow.json', '.sequence.json', '.dataflow.json', '.lifecycle.json']) {
      candidates.push(path.join(bundleDir, `${diagram.id}${suffix}`));
    }
  }
  const file = diagram.file || diagram.spec;
  if (file) {
    const jsonName = file.endsWith('.html') ? file.replace(/\.html$/i, '.json') : file;
    candidates.push(path.join(bundleDir, jsonName));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function entryHtmlPath(bundleDir, manifest) {
  const diagram = (manifest.diagrams || []).find((item) => item.id === manifest.entry);
  if (diagram?.file) return path.join(bundleDir, diagram.file);
  const raw = manifest.entry || '';
  return path.join(bundleDir, raw.endsWith('.html') ? raw : `${raw}.html`);
}

function writeBundleProjection({
  bundleDir, receipt, changes, headTree, base, head, mapPath, outDir, parentOwnership,
}) {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const childReceipts = {};
  for (const link of manifest.drilldowns || []) {
    const diagram = (manifest.diagrams || []).find((item) => item.id === link.child);
    if (!diagram) continue;
    const childMapPath = childSpecPath(bundleDir, diagram);
    if (!childMapPath) continue;
    const childOwnPath = defaultOwnershipPath(childMapPath);
    if (!fs.existsSync(childOwnPath)) continue;
    const childMap = loadMap(childMapPath);
    const loaded = loadOwnership({ ownershipPath: childOwnPath, mapPath: childMapPath, map: childMap });
    if (!loaded.ownership.parent) continue;
    childReceipts[link.child] = locateRange({
      base,
      head,
      map: childMap,
      ownership: inheritParentExcluded(parentOwnership, loaded.ownership),
      changes,
      headTree,
      mapPath: path.basename(childMapPath),
      ownershipPath: path.basename(childOwnPath),
      ownershipSha256: loaded.sha256,
      ...repositoryMeta(childMap),
    });
  }
  const projection = buildLocateProjection({ base, head, entryReceipt: receipt, childReceipts });
  const sourceHtmlPath = entryHtmlPath(bundleDir, manifest);
  const entryHtml = fs.readFileSync(sourceHtmlPath, 'utf8');
  const projected = stampUncoveredCount(
    embedProjection(entryHtml, projection),
    projection.uncovered?.count || 0,
  );
  const mapBase = path.basename(mapPath || sourceHtmlPath).replace(/\.json$/i, '').replace(/\.html$/i, '');
  const fileName = `${mapBase}.locate.html`;
  const copied = [];
  let outPath = null;
  if (outDir) {
    outPath = path.join(outDir, fileName);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, projected);
    copied.push(outPath);
  }
  return { projection, outPath, copied };
}

export function measureMapBehind(root, mapRevision, head) {
  if (!mapRevision) return {};
  try {
    return { mapBehindBy: revListCount(root, mapRevision, head) };
  } catch (error) {
    if (error instanceof LocateError && (error.code === 'locate/git-command' || error.code === 'locate/revision-unavailable')) {
      return { mapRevisionUnavailable: true };
    }
    throw error;
  }
}

function resolveRangeCommit(root, rev) {
  try {
    return resolveCommit(root, rev);
  } catch (error) {
    if (error instanceof LocateError && (error.code === 'locate/revision-unavailable' || error.code === 'locate/git-command')) {
      locateFail('locate/range-invalid', error.message, {
        evidence: {
          revision: rev,
          exitCode: error.evidence?.exitCode,
          stderr: error.evidence?.stderr || '',
        },
        supportedFixes: ['pass a git revision range whose endpoints exist locally'],
      });
    }
    throw error;
  }
}

function attachCompare({ type, root, base, head, mapPath, outDir, stagingDirectory }) {
  if (type !== 'architecture') {
    return { status: 'unsupported-type' };
  }
  const compareDir = path.join(outDir, 'compare');
  fs.mkdirSync(compareDir, { recursive: true });
  const htmlAbs = path.join(compareDir, 'map-delta.html');
  const receiptAbs = path.join(compareDir, 'map-delta.receipt.json');
  const baseMap = path.join(stagingDirectory, 'map.base.json');
  const headMap = path.join(stagingDirectory, 'map.head.json');
  fs.writeFileSync(baseMap, gitShow(root, base, mapPath));
  fs.writeFileSync(headMap, gitShow(root, head, mapPath));
  const result = spawnSync(process.execPath, [
    cliPath,
    'compare',
    type,
    baseMap,
    headMap,
    htmlAbs,
    '--receipt',
    receiptAbs,
    '--json',
  ], {
    encoding: 'utf8',
    cwd: path.resolve(path.dirname(cliPath), '..'),
    maxBuffer: 16 * 1024 * 1024,
  });
  const compared = result.status === 0 && fs.existsSync(receiptAbs) && fs.existsSync(htmlAbs);
  return compared
    ? { status: 'compared', receiptPath: 'compare/map-delta.receipt.json', htmlPath: 'compare/map-delta.html', exitCode: 0 }
    : { status: 'compare-failed', exitCode: result.status ?? 1 };
}

function ambiguousDiagnostics(receipt) {
  const files = receipt.files.filter((file) => file.state === 'ambiguous');
  const rows = files.length ? files : [{ path: '(unknown)', candidates: [] }];
  return rows.map((file) => ({
    code: 'locate/ambiguous-ownership',
    severity: 'error',
    message: `Path ${file.path} matches more than one component.`,
    subject: { path: file.path },
    evidence: { candidates: file.candidates || [] },
    supportedFixes: ['narrow overlapping globs so each path matches exactly one component'],
  }));
}

export async function commandLocate(args, ctx) {
  const jsonFlag = args.includes('--json');
  let options;
  let stagingDirectory;
  try {
    options = parseLocateArgs(args, ctx);
    if (!options.out) {
      ctx.fail(`--out <dir> is required.\n\n${ctx.usage()}`, 2);
    }
    const mapAbs = path.resolve(options.map);
    const map = loadMap(mapAbs);
    const discoveredRoot = options.repoRoot
      ? path.resolve(options.repoRoot)
      : gitTopLevel(path.dirname(mapAbs));
    const root = resolveRepoRoot(discoveredRoot);
    const ownershipAbs = path.resolve(options.ownership || defaultOwnershipPath(mapAbs));
    const loaded = loadOwnership({ ownershipPath: ownershipAbs, mapPath: mapAbs, map });
    const children = childOwnerships(loaded.ownership, ownershipAbs);
    const mapPath = toRepoPath(mapAbs, root);
    const ownershipPath = toRepoPath(ownershipAbs, root);
    const meta = repositoryMeta(map);
    const outDir = prepareOutDir(options.out);
    stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-locate-'));
    const htmlPath = path.join(outDir, 'locate.html');
    const receiptPath = path.join(outDir, 'locate.receipt.json');

    let receipt;
    let changes = [];
    let headTree = [];
    let base;
    let head;
    if (options.lint) {
      const revision = resolveCommit(root, options.lintRev);
      headTree = listTree(root, revision);
      const behind = measureMapBehind(root, map.meta?.repository?.revision, revision);
      receipt = locateLint({
        revision,
        map,
        ownership: loaded.ownership,
        tree: headTree,
        mapPath,
        ownershipPath,
        ownershipSha256: loaded.sha256,
        ...behind,
        children,
        ...meta,
      });
    } else {
      base = resolveRangeCommit(root, options.base);
      head = resolveRangeCommit(root, options.head);
      changes = diffNameStatus(root, base, head);
      headTree = listTree(root, head);
      const behind = measureMapBehind(root, map.meta?.repository?.revision, head);
      receipt = locateRange({
        base,
        head,
        map,
        ownership: loaded.ownership,
        changes,
        headTree,
        facts: options.facts ? loadFactsPair(options.facts) : undefined,
        mapPath,
        ownershipPath,
        ownershipSha256: loaded.sha256,
        ...behind,
        children,
        ...meta,
      });
    }

    let mapDeltaHref;
    if (receipt.mapDelta && !options.lint) {
      const attached = attachCompare({
        type: map.diagram_type,
        root,
        base,
        head,
        mapPath: receipt.map.path,
        outDir,
        stagingDirectory,
      });
      receipt = { ...receipt, mapDelta: { ...receipt.mapDelta, ...attached } };
      if (attached.status === 'compared') mapDeltaHref = attached.htmlPath;
    }

    const receiptCandidate = path.join(stagingDirectory, 'locate.receipt.json');
    fs.writeFileSync(receiptCandidate, `${JSON.stringify(receipt, null, 2)}\n`);
    if (options.lint) {
      commitReceiptOnly({
        receiptCandidate,
        outputReceipt: receiptPath,
        stagingDirectory,
      });
    } else {
      const html = renderLocateHtml({ receipt, mapDeltaHref });
      validateLocateHtml(html, receipt);
      const htmlCandidate = path.join(stagingDirectory, 'locate.html');
      fs.writeFileSync(htmlCandidate, html);
      commitLocatePair({
        htmlCandidate,
        receiptCandidate,
        outputHtml: htmlPath,
        outputReceipt: receiptPath,
        stagingDirectory,
      });
    }

    if (options.bundle) {
      writeBundleProjection({
        bundleDir: path.resolve(options.bundle),
        receipt,
        changes,
        headTree,
        base: receipt.repository.base,
        head: receipt.repository.head,
        mapPath,
        outDir,
        parentOwnership: loaded.ownership,
      });
    }

    if (options.lint && receipt.summary.files.ambiguous) {
      const diagnostics = ambiguousDiagnostics(receipt);
      reportLocateFailure({
        json: options.json,
        error: new LocateError('locate/ambiguous-ownership', 'Ownership lint found ambiguous paths.', {
          evidence: { files: diagnostics.map((item) => item.subject.path) },
        }),
        status: 1,
        diagnostics,
      });
      return;
    }

    if (options.json) console.log(JSON.stringify(receipt, null, 2));
    else {
      const files = receipt.summary.files;
      console.log(`locate ${receipt.mode} ${receipt.map.path} ${files.touched} touched / ${files.uncovered} uncovered / ${files.ambiguous} ambiguous / ${files.excluded} excluded`);
      console.log(`receipt ${receiptPath}`);
      if (!options.lint) console.log(`html ${htmlPath}`);
    }
  } catch (error) {
    if (error instanceof LocateError) {
      reportLocateFailure({
        json: options?.json || jsonFlag,
        error,
        status: error.code === 'locate/range-invalid' ? 2 : 1,
      });
    } else {
      throw error;
    }
  } finally {
    if (stagingDirectory) {
      try {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
      } catch {
        // Staging is best-effort cleanup; locate artifacts are already committed or never written.
      }
    }
  }
}
