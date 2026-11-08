import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { listFiles, snapshotTree, classifyRole, lineCount } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';

export const id = 'rust';
export const REVISION = 5;
export const CALL_MODEL = 'rust-source-direct-v5';
export const detect = (root, config) => listFiles(root, config).some(file => file.endsWith('.rs'));
export const countSources = (root, config) => listFiles(root, config).filter(file => file.endsWith('.rs')).length;
const manifest = fileURLToPath(new URL('./Cargo.toml', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = value => value.split(path.sep).join('/');
const metaFile = file => /(?:^|\/)Cargo\.(?:toml|lock)$/.test(file);

function command(executable, args, options, code) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) fail(result.error?.code === 'ENOENT' ? 'extract/rust-unavailable' : code, 'Rust source tooling could not complete. Cargo/rustc 1.71+ and the locked helper dependencies are required.', {
    subject: { command: executable }, evidence: { exit: result.status, code: result.error?.code ?? null, stderr: result.stderr?.trim().split('\n').slice(-8) },
    supportedFixes: ['install a compatible Rust toolchain with Cargo', 'set ARCHIFY_CARGO / ARCHIFY_RUSTC to the installed tools', 'inspect the captured manifest/profile error; no project build is attempted'],
  });
  return result.stdout;
}

function localProfiles(packages, options) {
  const byPath = new Map(packages.map(pkg => [path.dirname(pkg.manifest_path), pkg]));
  const profiles = new Map(packages.map(pkg => [pkg.name, { selected: new Set(options.defaultFeatures === false || !pkg.features.default ? [] : ['default']), dependencies: new Set() }]));
  for (const [name, features] of Object.entries(options.features || {})) {
    const profile = profiles.get(name); if (!profile) fail('extract/rust-config-invalid', `No captured workspace package named ${name}.`);
    for (const feature of features) { if (!packages.find(pkg => pkg.name === name).features[feature]) fail('extract/rust-config-invalid', `No feature ${feature} in ${name}.`); profile.selected.add(feature); }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const pkg of packages) {
      const profile = profiles.get(pkg.name);
      const add = (set, name) => { if (!set.has(name)) { set.add(name); changed = true; } };
      for (const feature of [...profile.selected]) for (const value of pkg.features[feature] || []) {
        if (value.startsWith('dep:')) add(profile.dependencies, value.slice(4));
        else if (value.includes('/')) {
          const [raw, childFeature] = value.split('/'); const alias = raw.replace(/\?$/, '');
          const dep = pkg.dependencies.find(dep => (dep.rename || dep.name) === alias);
          if (dep && (!raw.endsWith('?') || !dep.optional || profile.dependencies.has(alias))) {
            add(profile.dependencies, alias); const child = byPath.get(dep.path); if (child) add(profiles.get(child.name).selected, childFeature);
          }
        } else add(profile.selected, value);
      }
      for (const dep of pkg.dependencies) {
        if (dep.kind === 'build' || (dep.kind === 'dev' && !options.tests)) continue;
        const alias = dep.rename || dep.name;
        if (!dep.optional || profile.dependencies.has(alias) || profile.selected.has(alias)) {
          add(profile.dependencies, alias); const child = byPath.get(dep.path);
          if (child) { const selected = profiles.get(child.name).selected; if (dep.uses_default_features && child.features.default) add(selected, 'default'); for (const f of dep.features || []) add(selected, f); }
        }
      }
    }
  }
  return profiles;
}

export function extract(root, config, { onCapture } = {}) {
  const rust = config.rust || {};
  if ((rust.features !== undefined && (!rust.features || Array.isArray(rust.features) || typeof rust.features !== 'object' || !Object.values(rust.features).every(v => Array.isArray(v) && v.every(x => typeof x === 'string'))))
    || ['tests', 'defaultFeatures', 'offline'].some(key => rust[key] !== undefined && typeof rust[key] !== 'boolean')
    || (rust.cfg !== undefined && (!Array.isArray(rust.cfg) || !rust.cfg.every(x => typeof x === 'string')))
    || (rust.target !== undefined && typeof rust.target !== 'string')) fail('extract/rust-config-invalid', 'Rust profile accepts features keyed by package, defaultFeatures/tests/offline booleans, target and cfg strings.');
  const tree = snapshotTree(root, file => file.endsWith('.rs') || metaFile(file));
  if (!tree.contents.has('Cargo.toml')) fail('extract/rust-manifest-missing', 'Rust source analysis requires a captured root Cargo.toml.', { supportedFixes: ['analyze the Cargo workspace/package root'] });
  const cargo = process.env.ARCHIFY_CARGO || 'cargo', rustc = process.env.ARCHIFY_RUSTC || 'rustc';
  const env = { ...process.env, RUSTC: rustc, RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '', CARGO_BUILD_RUSTC_WRAPPER: '', CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER: '', RUSTFLAGS: '', CARGO_ENCODED_RUSTFLAGS: '' };
  delete env.CARGO_BUILD_TARGET;
  // Different checkouts otherwise reuse one helper executable, which caused
  // v2 output to reach a v1 reader in baseline replay. Isolate helper contents
  // while allowing identical source and extracted packages to share builds.
  const helperDigest = createHash('sha256');
  for (const file of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) helperDigest.update(fs.readFileSync(path.join(path.dirname(manifest), file)));
  const cache = path.join(os.tmpdir(), `archify-rust-source-target-${helperDigest.digest('hex')}`); fs.mkdirSync(cache, { recursive: true });
  const cfg = command(rustc, ['--print', 'cfg', ...(rust.target ? ['--target', rust.target] : [])], { cwd: cache, env }, 'extract/rust-cfg-failed').trim().split(/\r?\n/);
  const cargoVersion = command(cargo, ['--version'], { cwd: cache, env }, 'extract/rust-unavailable').trim();
  const verboseToolchain = command(rustc, ['--version', '--verbose'], { cwd: cache, env }, 'extract/rust-unavailable').trim();
  const toolchain = verboseToolchain.split(/\r?\n/)[0];
  const helperHost = verboseToolchain.match(/^host:\s*(\S+)/m)?.[1];
  if (!helperHost) fail('extract/rust-unavailable', 'rustc did not report its host triple.');
  const metadata = [...tree.contents].filter(([file]) => metaFile(file)).map(([file, bytes]) => ({ file, sourceText: bytes.toString('utf8'), sha256: hash(bytes) }));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-rust-metadata-'));
  let cargoMetadata, stage;
  try {
    stage = fs.realpathSync(temporary);
    // Cargo gets only captured manifests and zero-byte source inventory stubs.
    // No project code, .cargo config, build output or toolchain file is staged.
    for (const [file, bytes] of tree.contents) {
      const destination = path.join(stage, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, metaFile(file) ? bytes : '');
    }
    cargoMetadata = JSON.parse(command(cargo, ['metadata', '--offline', '--locked', '--no-deps', '--format-version', '1'], { cwd: stage, env }, 'extract/rust-metadata-failed'));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const inside = file => { const rel = posix(path.relative(stage, file)); return rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel) ? rel : null; };
  const packages = cargoMetadata.packages.filter(pkg => inside(pkg.manifest_path) !== null);
  const profiles = localProfiles(packages, rust);
  const libraries = new Map(), libraryNames = new Map();
  for (const pkg of packages) { const target = pkg.targets.find(t => t.kind.some(k => ['lib', 'rlib', 'proc-macro'].includes(k))); if (target) { libraries.set(path.dirname(pkg.manifest_path), `${inside(pkg.manifest_path)}#${target.kind.join("+")}:${target.name}`); libraryNames.set(path.dirname(pkg.manifest_path), target.name); } }
  const crates = [], excludedTargets = [];
  for (const pkg of packages) for (const target of pkg.targets) {
    const profile = profiles.get(pkg.name), source = inside(target.src_path);
    const kinds = target.kind;
    if (!source || kinds.includes('custom-build') || kinds.includes('proc-macro') || kinds.includes('bench') || kinds.includes('example') || (kinds.includes('test') && !rust.tests)
      || (target['required-features'] || []).some(f => !profile.selected.has(f))) { excludedTargets.push({ package: pkg.name, name: target.name, kinds, source, reason: 'target-not-in-source-profile' }); continue; }
    const deps = {};
    for (const dep of pkg.dependencies) {
      if (dep.kind === 'build' || (dep.kind === 'dev' && !rust.tests) || !profile.dependencies.has(dep.rename || dep.name)) continue;
      const library = libraries.get(dep.path); if (library) deps[(dep.rename || libraryNames.get(dep.path) || dep.name).replace(/-/g, '_')] = library;
    }
    // A binary can refer to its package's library through the extern prelude.
    const library = libraries.get(path.dirname(pkg.manifest_path)); if (library && library !== `${inside(pkg.manifest_path)}#${target.kind.join("+")}:${target.name}`) deps[libraryNames.get(path.dirname(pkg.manifest_path)).replace(/-/g, '_')] = library;
    crates.push({ id: `${inside(pkg.manifest_path)}#${target.kind.join("+")}:${target.name}`, package: pkg.name, name: target.name, root: source, edition: target.edition || pkg.edition, deps, features: [...profile.selected].sort(), targetKinds: kinds });
  }
  const include = matcher(config.include), exclude = matcher(config.exclude || []), sources = {}, excludedFiles = [];
  for (const [file, bytes] of tree.contents) if (file.endsWith('.rs')) {
    const parts = file.split('/');
    if (parts.slice(0, -1).includes('target')) excludedFiles.push({ file, reason: 'cargo-build-output-not-loaded' });
    else if (!include(file) || exclude(file) || parts.slice(0, -1).some((_, i) => exclude(`${parts.slice(0, i + 1).join('/')}/`))) excludedFiles.push({ file, reason: 'config-include-exclude' });
    else sources[file] = bytes.toString('utf8');
  }
  const output = JSON.parse(command(cargo, ['run', '--quiet', '--locked', '--target', helperHost, ...(rust.offline ? ['--offline'] : []), '--manifest-path', manifest], {
    cwd: cache, env: { ...env, CARGO_TARGET_DIR: cache }, input: JSON.stringify({ sources, crates, cfg: [...cfg, ...(rust.cfg || [])], tests: Boolean(rust.tests) }),
  }, 'extract/rust-parser-failed'));
  const selected = new Set(output.selected);
  for (const file of Object.keys(sources)) if (!selected.has(file)) excludedFiles.push({ file, reason: 'not-in-selected-crate-module-tree' });
  const seal = (range, file) => { const { _start, _end, ...location } = range; return { ...location, sha256: hash(Buffer.from(sources[file]).subarray(_start, _end)) }; };
  const functions = output.functions.map(({ _cfg, ...fn }) => ({ ...fn, sourceRange: seal(fn.sourceRange, fn.file), definition: { ...fn.definition, sourceRange: seal(fn.definition.sourceRange, fn.file) } }));
  const uniqueFunctions = [...new Map(functions.map(fn => [`${fn.file}:${fn.sourceRange.line}:${fn.sourceRange.column}`, fn])).values()];
  const imports = [...new Map(output.imports.filter(edge => selected.has(edge.from) && (!edge.to || selected.has(edge.to))).map(edge => [JSON.stringify(edge), edge])).values()];
  const unresolved = { external: 0, outside: 0, unknown: imports.filter(edge => !edge.resolved).length, opaque: 0 };
  onCapture?.({ coverage: 'source-profile', model: CALL_MODEL, options: { toolchain, cargoVersion, helperHost, cfg, tests: Boolean(rust.tests), crates }, reads: metadata.map(input => [path.join(root, input.file), input.sourceText]) });
  return {
    schema_version: 1, callModel: CALL_MODEL, repository: { ...describeRepository(root), language: id, adapter: 'rust-syn@2.0.119', adapterRevision: REVISION },
    files: [...selected].map(file => ({ path: file, sourceText: sources[file], loc: lineCount(sources[file]), role: /(?:^|\/)(?:tests|benches)\//.test(file) ? 'test' : classifyRole(file, config.roles) })),
    packageMarkers: metadata.filter(x => x.file.endsWith('Cargo.toml')).map(x => x.file), imports, symbols: [], functions: uniqueFunctions, calls: output.calls, traits: output.traits, traitImplementations: output.traitImplementations, unresolved,
    ...(output.parse_errors.length ? { parse_errors: output.parse_errors } : {}),
    languageScope: { language: id, build: { toolchain, cargoVersion, helperHost, targetCfg: cfg, customCfg: rust.cfg || [], tests: Boolean(rust.tests), profile: 'all local workspace targets; defaults and local path feature propagation; not a Cargo build/resolve graph', buildScripts: false, procMacros: false, cargoConfig: 'not-loaded' },
      crates: crates.map(c => ({ ...c, files: [...new Set(output.modules.filter(m => m.crate === c.id).map(m => m.file))] })), selectedFiles: [...selected], excludedFiles, metadata, excludedTargets,
      conditionalDefinitions: output.functions.filter(fn => fn._cfg === 0).map(fn => ({ file: fn.file, name: fn.name, line: fn.line, reason: 'enclosing cfg or attribute not established by the source profile' })),
      excludedRegions: output.excludedRegions, opaqueMacros: output.opaqueMacros, missingModules: output.missingModules,
      limitations: ['Explicit free-function paths, monomorphic inherent source candidates and bare generic-struct paths to unique concrete-specialization source candidates. Lifetime-only struct/enum owners additionally allow bare paths to unique receiver-free inherent declarations when unbounded impl lifetime names map one-to-one to owner arguments; unsupported siblings and enum variant names block selection. Specializations require named type arguments and no impl generics/where clause; competing unsupported inherent declarations block the candidate. No type/argument inference, visibility checking, Self/type-alias resolution, explicit generic call arguments, mixed lifetime/type parameters, concrete or bounded lifetime specializations, const/bounded/defaulted generic owners, receiver types beyond explicit parameters, adjacent-before-let bindings and trait objects, macro expansion, build-script execution or external dependency source loading.',
        'Cargo metadata reads captured manifests with zero-byte source inventory stubs, offline/no-deps/locked; the syntax parser reads captured source text only. Active cfg derives from rustc target cfg plus the declared local feature profile; custom build-script cfg stays unknown.',
        'Call inventory covers parsed function/method bodies; macros are opaque records. Missing/excluded modules, conditional scopes and unsupported local items limit target/caller completeness.'] },
  };
}
