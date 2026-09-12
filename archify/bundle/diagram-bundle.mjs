import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultOwnershipPath, validateChildOwnershipSubset } from '../locate/ownership.mjs';
import { SEMANTIC_COLLECTIONS } from '../renderers/shared/cli.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { bundle as validateBundleSchema } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

const HTML_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/;
const OWNERSHIP_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.ownership\.json$/;
const DIAGRAM_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MANIFEST_SCRIPT_RE = /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>\n?/;

export class BundleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BundleError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new BundleError(code, message, details);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readBytes(file) {
  return fs.readFileSync(file);
}

export function serializeBundleManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')}\n`;
}

export function stripBundleManifest(html) {
  return html.replace(MANIFEST_SCRIPT_RE, '');
}

export function extractBundleManifestText(html) {
  const match = html.match(/<script id="archify-bundle-manifest" type="application\/json">([\s\S]*?)<\/script>/);
  return match ? match[1] : null;
}

export function injectBundleManifest(html, manifestText) {
  const stripped = stripBundleManifest(html);
  const index = stripped.lastIndexOf('</body>');
  if (index < 0) fail('bundle/invalid', 'Entry HTML is missing </body> for manifest embed.', { failures: ['bundle/embed-missing'] });
  const script = `<script id="archify-bundle-manifest" type="application/json">${manifestText}</script>\n`;
  return `${stripped.slice(0, index)}${script}${stripped.slice(index)}`;
}

export function htmlArtifactSha256(fileBytes) {
  const text = fileBytes.toString('utf8');
  if (!text.includes('id="archify-bundle-manifest"')) return sha256Bytes(fileBytes);
  return sha256Bytes(Buffer.from(stripBundleManifest(text), 'utf8'));
}

function writeAtomic(target, contents) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, target);
}

function semanticItems(diagram) {
  const collection = SEMANTIC_COLLECTIONS[diagram?.diagram_type];
  return collection && Array.isArray(diagram[collection]) ? diagram[collection] : [];
}

function svgOpenTag(html) {
  return html.match(/<svg\b[^>]*>/)?.[0] || '';
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '';
}

function ownershipSchemaFailures(sidecar, label) {
  try {
    validateSchema('ownership', sidecar);
    return [];
  } catch (error) {
    if (String(error.message || '').includes('unknown diagram type "ownership"')) {
      // TODO(locate): switch to validateSchema('ownership')
      if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar) || !Array.isArray(sidecar.components)) {
        return [`bundle/ownership-not-subset: ${label} components must be an array of { id, globs }`];
      }
      return [];
    }
    return [`bundle/ownership-not-subset: ${label} failed ownership schema`];
  }
}

export function validateOwnershipSubset(manifest, sidecar, parentSidecar) {
  const failures = [
    ...ownershipSchemaFailures(sidecar, 'child sidecar'),
    ...(parentSidecar ? ownershipSchemaFailures(parentSidecar, 'parent sidecar') : []),
  ];
  const parentLink = sidecar?.parent;
  if (parentLink && typeof parentLink === 'object') {
    const drills = Array.isArray(manifest?.drilldowns) ? manifest.drilldowns : [];
    const match = drills.find((item) => item.component === parentLink.component && item.parent === manifest.entry);
    if (!match) {
      failures.push(`bundle/ownership-not-subset: parent.component ${JSON.stringify(parentLink.component)} is not a drilldown of entry`);
    }
    if (parentLink.map && match) {
      const entry = (manifest.diagrams || []).find((item) => item.id === manifest.entry);
      const expected = entry ? entry.file.replace(/\.html$/, '.json') : '';
      const mapName = String(parentLink.map).split('/').pop();
      if (expected && mapName !== expected) {
        failures.push(`bundle/ownership-not-subset: parent.map ${JSON.stringify(parentLink.map)} does not name the entry spec`);
      }
    }
    if (parentSidecar) {
      for (const failure of validateChildOwnershipSubset(
        parentSidecar,
        parentLink.component,
        sidecar,
        'bundle/ownership-not-subset',
      )) {
        failures.push(`${failure.code}: ${failure.message}`);
      }
    }
  }
  return failures;
}

function scanPairs(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('bundle/invalid', `Bundle directory not found: ${dir}`, { failures: ['bundle/dir-missing'], subject: { dir } });
  }
  const names = fs.readdirSync(dir);
  const pairs = [];
  for (const file of names) {
    if (!HTML_FILE.test(file)) continue;
    const id = file.slice(0, -'.html'.length);
    if (!DIAGRAM_ID.test(id)) {
      fail('bundle/invalid', `Diagram file ${file} does not yield a valid diagram id.`, {
        failures: [`bundle/id-invalid: ${file}`],
        subject: { file },
      });
    }
    const specFile = `${id}.json`;
    const specPath = path.join(dir, specFile);
    const htmlPath = path.join(dir, file);
    if (!fs.existsSync(specPath)) {
      fail('bundle/invalid', `HTML ${file} has no same-name JSON spec.`, {
        failures: [`bundle/spec-missing: ${specFile}`],
        subject: { file },
      });
    }
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
      fail('bundle/invalid', `Could not parse ${specFile}: ${error.message}`, {
        failures: [`bundle/spec-parse: ${specFile}`],
        subject: { file: specFile },
      });
    }
    pairs.push({
      id,
      file,
      specFile,
      htmlPath,
      specPath,
      spec,
      specBytes: readBytes(specPath),
    });
  }
  if (!pairs.length) {
    fail('bundle/invalid', 'Bundle directory contains no HTML + same-name JSON pairs.', {
      failures: ['bundle/empty'],
      subject: { dir },
    });
  }
  return pairs;
}

function chooseEntry(pairs) {
  const targets = new Set();
  const withDrilldown = new Set();
  for (const pair of pairs) {
    for (const item of semanticItems(pair.spec)) {
      if (item.drilldown) {
        targets.add(item.drilldown);
        withDrilldown.add(pair.id);
      }
    }
  }
  const roots = [...withDrilldown].filter((id) => !targets.has(id));
  if (roots.length === 1) return roots[0];
  if (pairs.length === 1) return pairs[0].id;
  fail('bundle/invalid', 'Could not determine a unique entry diagram from components[].drilldown.', {
    failures: ['bundle/entry-ambiguous'],
    supportedFixes: ['give exactly one parent diagram drilldown fields that point at the others'],
  });
}

export function bundleRendererEnv(cwd = process.cwd(), env = process.env) {
  const inherited = env.ARCHIFY_REPO_ROOT;
  if (inherited) return { ...env, ARCHIFY_REPO_ROOT: inherited };
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  const top = result.status === 0 ? result.stdout.trim() : '';
  return top ? { ...env, ARCHIFY_REPO_ROOT: top } : { ...env };
}

function chooseOwnershipFile(dir, entryId) {
  const preferred = `${entryId}.ownership.json`;
  if (fs.existsSync(path.join(dir, preferred))) return preferred;
  const names = fs.readdirSync(dir).filter((name) => OWNERSHIP_FILE.test(name));
  if (!names.length) return null;
  fail('bundle/invalid', `Ownership sidecar ${preferred} is missing.`, {
    failures: [`bundle/ownership-missing: ${preferred}`],
    subject: { file: preferred },
  });
}

function renderWithBundleFlags(pair, role, specSha) {
  const type = pair.spec.diagram_type;
  const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
  if (!fs.existsSync(renderer)) {
    fail('bundle/invalid', `No renderer for diagram type ${JSON.stringify(type)}.`, {
      failures: [`bundle/type-unknown: ${type}`],
      subject: { id: pair.id },
    });
  }
  const result = spawnSync(process.execPath, [
    renderer,
    pair.specPath,
    pair.htmlPath,
    '--bundle-id', pair.id,
    '--bundle-role', role,
    '--bundle-spec-sha256', specSha,
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: bundleRendererEnv(),
  });
  if (result.status !== 0) {
    fail('bundle/invalid', `Renderer failed for ${pair.file}: ${(result.stderr || result.stdout || '').trim() || 'unknown error'}`, {
      failures: [`bundle/render-failed: ${pair.id}`],
      subject: { id: pair.id, file: pair.file },
    });
  }
}

function drilldownsFrom(entryId, spec) {
  const rows = [];
  const seen = new Set();
  for (const item of semanticItems(spec)) {
    if (!item.drilldown) continue;
    const key = `${entryId}\u001f${item.id}`;
    if (seen.has(key)) {
      fail('bundle/invalid', `Component ${item.id} declares more than one drilldown.`, {
        failures: [`bundle/drilldown-duplicate: ${item.id}`],
      });
    }
    seen.add(key);
    rows.push({
      parent: entryId,
      component: item.id,
      child: item.drilldown,
      ...(item.label ? { label: String(item.label).slice(0, 80) } : {}),
    });
  }
  return rows;
}

export function buildBundleManifest(dir) {
  const resolved = path.resolve(dir);
  const pairs = scanPairs(resolved);
  const entryId = chooseEntry(pairs);
  const byId = new Map(pairs.map((pair) => [pair.id, pair]));
  if (!byId.has(entryId)) {
    fail('bundle/invalid', `Entry ${entryId} is missing from the directory.`, { failures: ['bundle/entry-missing'] });
  }

  for (const pair of pairs) {
    pair.specSha = sha256Bytes(pair.specBytes);
    const role = pair.id === entryId ? 'entry' : 'child';
    renderWithBundleFlags(pair, role, pair.specSha);
    pair.htmlBytes = readBytes(pair.htmlPath);
    pair.artifactSha = htmlArtifactSha256(pair.htmlBytes);
  }

  const entry = byId.get(entryId);
  const drilldowns = drilldownsFrom(entryId, entry.spec);
  const diagrams = pairs
    .slice()
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((pair) => ({
      id: pair.id,
      file: pair.file,
      diagram_type: pair.spec.diagram_type,
      title: pair.spec.meta?.title || pair.id,
      level: pair.id === entryId ? 0 : 1,
      node_count: semanticItems(pair.spec).length,
      spec_sha256: pair.specSha,
      artifact_sha256: pair.artifactSha,
    }));

  const manifest = {
    schema_version: 1,
    bundle_type: 'drilldown',
    entry: entryId,
    max_depth: 2,
    diagrams,
    drilldowns,
  };

  const ownershipFile = chooseOwnershipFile(resolved, entryId);
  if (ownershipFile) {
    manifest.ownership = {
      file: ownershipFile,
      sha256: sha256Bytes(readBytes(path.join(resolved, ownershipFile))),
    };
  }

  const manifestText = serializeBundleManifest(manifest);
  const manifestPath = path.join(resolved, 'manifest.json');
  writeAtomic(manifestPath, manifestText);

  const entryHtml = injectBundleManifest(fs.readFileSync(entry.htmlPath, 'utf8'), manifestText);
  writeAtomic(entry.htmlPath, entryHtml);

  return {
    ok: true,
    command: 'bundle',
    dir: resolved,
    manifest,
    manifestPath,
  };
}

function loadSiblingSidecar(dir, sidecar) {
  const map = sidecar?.parent?.map;
  if (!map) return null;
  const base = path.basename(String(map)).replace(/\.json$/, '');
  const candidate = path.join(dir, `${base}.ownership.json`);
  if (!fs.existsSync(candidate)) return null;
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    return null;
  }
}

function checkSummary(checks) {
  return {
    checksPassed: checks.filter((item) => item.ok).length,
    checkCount: checks.length,
  };
}

export function validateBundle(dir) {
  const resolved = path.resolve(dir);
  const failures = [];
  const checks = [];
  const note = (message) => { failures.push(message); };
  const record = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); };
  const runCheck = (name, fn) => {
    const before = failures.length;
    fn();
    record(name, failures.length === before);
  };
  const abort = (message, extra = {}) => {
    fail('bundle/invalid', message, {
      supportedFixes: extra.supportedFixes || ['run archify bundle <dir> to refresh the manifest'],
      ...checkSummary(checks),
      ...extra,
      failures: extra.failures || failures,
    });
  };

  const manifestPath = path.join(resolved, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    record('manifest', false);
    abort('manifest.json is missing.', {
      failures: ['bundle/manifest-missing'],
      subject: { dir: resolved },
    });
  }
  const manifestBytes = readBytes(manifestPath);
  const manifestText = manifestBytes.toString('utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    record('manifest', false);
    abort(`manifest.json is not valid JSON: ${error.message}`, {
      failures: ['bundle/manifest-parse'],
    });
  }

  if (!validateBundleSchema(manifest)) {
    const first = validateBundleSchema.errors?.[0];
    record('manifest', false);
    abort('Diagram bundle failed validation: bundle/schema.', {
      failures: [`bundle/schema: ${first?.instancePath || '/'} ${first?.message || 'failed schema'}`],
    });
  }
  record('manifest', true);

  const diagrams = (Array.isArray(manifest.diagrams) ? manifest.diagrams : [])
    .filter((item) => HTML_FILE.test(item.file || ''));
  const entry = diagrams.find((item) => item.id === manifest.entry);
  runCheck('levels', () => {
    if (!entry || entry.level !== 0) note('bundle/entry-level: entry must exist in diagrams[] at level 0');
    if (diagrams.some((item) => item.id !== manifest.entry && item.level !== 1)) {
      note('bundle/child-level: every non-entry diagram must be level 1');
    }
    if (manifest.max_depth !== 2) note('bundle/max-depth: max_depth must be 2');
  });

  const ids = diagrams.map((item) => item.id);
  const files = diagrams.map((item) => item.file);
  runCheck('files', () => {
    if (new Set(ids).size !== ids.length) note('bundle/duplicate-id: diagrams[].id must be unique');
    if (new Set(files).size !== files.length) note('bundle/duplicate-file: diagrams[].file must be unique');
    for (const diagram of diagrams) {
      if (!HTML_FILE.test(diagram.file || '')) {
        note(`bundle/file-path: ${diagram.file} must be a same-directory HTML filename`);
        continue;
      }
      const htmlPath = path.join(resolved, diagram.file);
      if (!fs.existsSync(htmlPath)) {
        note(`bundle/file-missing: ${diagram.file}`);
      }
    }
  });

  const pairById = new Map();
  runCheck('bundle-attrs', () => {
    for (const diagram of diagrams) {
      if (!HTML_FILE.test(diagram.file || '')) continue;
      const htmlPath = path.join(resolved, diagram.file);
      const specPath = path.join(resolved, diagram.file.replace(/\.html$/, '.json'));
      if (!fs.existsSync(htmlPath) || !fs.existsSync(specPath)) continue;
      const htmlBytes = readBytes(htmlPath);
      const specBytes = readBytes(specPath);
      const html = htmlBytes.toString('utf8');
      const tag = svgOpenTag(html);
      const role = diagram.id === manifest.entry ? 'entry' : 'child';
      if (attr(tag, 'data-bundle-id') !== diagram.id
        || attr(tag, 'data-bundle-role') !== role
        || attr(tag, 'data-bundle-spec-sha256') !== diagram.spec_sha256) {
        note(`bundle/child-stale: ${diagram.id} data-bundle-* does not match the manifest`);
      }
      let spec = null;
      try { spec = JSON.parse(specBytes.toString('utf8')); } catch { /* counted in digests */ }
      pairById.set(diagram.id, { html, spec, specPath, htmlPath, htmlBytes, specBytes });
    }
  });

  runCheck('digests', () => {
    for (const diagram of diagrams) {
      const pair = pairById.get(diagram.id);
      if (!pair) continue;
      const artifactSha = htmlArtifactSha256(pair.htmlBytes);
      const specSha = sha256Bytes(pair.specBytes);
      if (artifactSha !== diagram.artifact_sha256) {
        note(`bundle/child-stale: ${diagram.id} artifact_sha256 expected ${diagram.artifact_sha256?.slice(0, 12)} actual ${artifactSha.slice(0, 12)}`);
      }
      if (specSha !== diagram.spec_sha256) {
        note(`bundle/child-stale: ${diagram.id} spec_sha256 expected ${diagram.spec_sha256?.slice(0, 12)} actual ${specSha.slice(0, 12)}`);
      }
    }
  });

  runCheck('embed', () => {
    if (!entry) return;
    const entryPair = pairById.get(entry.id);
    const embeds = entryPair?.html.match(/id="archify-bundle-manifest"/g) || [];
    if (embeds.length !== 1) note('bundle/embed-count: entry must embed exactly one archify-bundle-manifest');
    else {
      const embedded = extractBundleManifestText(entryPair.html);
      if (embedded !== manifestText) note('bundle/embed-mismatch: embedded manifest is not byte-identical to disk manifest.json');
    }
  });

  runCheck('drilldowns', () => {
    const drills = Array.isArray(manifest.drilldowns) ? manifest.drilldowns : [];
    const seenPair = new Set();
    const childAsParent = new Set();
    const entrySpec = pairById.get(manifest.entry)?.spec;
    const entryIds = new Set(semanticItems(entrySpec).map((item) => item.id));
    const diagramIds = new Set(ids);
    for (const row of drills) {
      if (row.parent !== manifest.entry) note(`bundle/drilldown-parent: ${row.component} parent must be the entry`);
      if (!entryIds.has(row.component)) note(`bundle/drilldown-component: ${row.component} is not in the entry semantic collection`);
      if (!diagramIds.has(row.child)) note(`bundle/drilldown-child: ${row.child} is not in diagrams[]`);
      const key = `${row.parent}\u001f${row.component}`;
      if (seenPair.has(key)) note(`bundle/drilldown-duplicate: ${row.component}`);
      seenPair.add(key);
      if (row.child === manifest.entry) note('bundle/drilldown-cycle: a child cannot be the entry');
      childAsParent.add(row.child);
    }
    if (drills.some((row) => childAsParent.has(row.parent) && row.parent !== manifest.entry)) {
      note('bundle/drilldown-nested: a child cannot be a parent');
    }
  });

  runCheck('node-cap', () => {
    for (const diagram of diagrams) {
      const spec = pairById.get(diagram.id)?.spec;
      const count = semanticItems(spec).length;
      if (count > 12 || (diagram.node_count != null && diagram.node_count > 12)) {
        note(`bundle/node-cap: ${diagram.id} exceeds the 12-node cap`);
      }
      if (count < 1) note(`bundle/node-cap: ${diagram.id} has no primary nodes`);
    }
  });

  runCheck('child-mark', () => {
    for (const diagram of diagrams) {
      if (diagram.id === manifest.entry) continue;
      const html = pairById.get(diagram.id)?.html || '';
      const marks = (html.match(/\bdata-drilldown-child="/g) || []).length;
      if (marks) note(`bundle/child-mark: ${diagram.id} has ${marks} drilldown mark(s); the second layer cannot drill down`);
    }
  });

  runCheck('ownership', () => {
    if (!manifest.ownership) return;
    const ownershipFile = manifest.ownership.file || '';
    if (!OWNERSHIP_FILE.test(ownershipFile)) {
      note('bundle/ownership-missing: ownership sidecar listed in the manifest is not a same-directory file');
      return;
    }
    const ownershipPath = path.join(resolved, ownershipFile);
    if (!fs.existsSync(ownershipPath)) {
      note('bundle/ownership-missing: ownership sidecar listed in the manifest is not a same-directory file');
      return;
    }
    const sidecarBytes = readBytes(ownershipPath);
    if (sha256Bytes(sidecarBytes) !== manifest.ownership.sha256) {
      note('bundle/ownership-stale: ownership sidecar sha256 does not match the manifest');
    }
    let sidecar;
    try { sidecar = JSON.parse(sidecarBytes.toString('utf8')); } catch {
      note('bundle/ownership-parse: ownership sidecar is not valid JSON');
      sidecar = null;
    }
    if (!sidecar) return;
    const parentSidecar = loadSiblingSidecar(resolved, sidecar);
    for (const failure of validateOwnershipSubset(manifest, sidecar, parentSidecar)) note(failure);
    for (const component of Array.isArray(sidecar.components) ? sidecar.components : []) {
      if (!component.child_map) continue;
      const childOwnPath = defaultOwnershipPath(path.join(resolved, component.child_map));
      if (!fs.existsSync(childOwnPath)) continue;
      let childSidecar;
      try {
        childSidecar = JSON.parse(fs.readFileSync(childOwnPath, 'utf8'));
      } catch {
        note('bundle/ownership-parse: child ownership sidecar is not valid JSON');
        continue;
      }
      for (const failure of validateChildOwnershipSubset(
        sidecar,
        component.id,
        childSidecar,
        'bundle/ownership-not-subset',
      )) {
        note(`${failure.code}: ${failure.message}`);
      }
    }
  });

  if (failures.length) {
    abort(`Diagram bundle failed validation: ${failures.join('; ')}.`);
  }
  return { ok: true, ...checkSummary(checks) };
}
