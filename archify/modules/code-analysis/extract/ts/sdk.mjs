import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import bundledTs from 'typescript';
import { fail } from '../shared/diagnostics.mjs';

const load = createRequire(import.meta.url);
const REQUIRED_API = ['createProgram', 'createCompilerHost', 'createSourceFile', 'parseJsonConfigFileContent', 'resolveModuleName', 'getEmitModuleResolutionKind', 'resolveProjectReferencePath', 'matchFiles', 'isIdentifier'];

function declaredTypeScript(data, relative) {
  if (!data) return false;
  let manifest;
  try { manifest = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('extract/typescript-manifest-invalid', 'Cannot inspect a package.json for its TypeScript version.', { subject: { file: relative } }); }
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .some(key => Object.hasOwn(manifest?.[key] || {}, 'typescript'));
}

function loadSdk(root, source) {
  const manifestPath = path.join(root, 'package.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { fail('extract/typescript-sdk-invalid', 'The selected TypeScript SDK has no readable package.json.', { subject: { file: manifestPath } }); }
  if (manifest.name !== 'typescript' || typeof manifest.version !== 'string') {
    fail('extract/typescript-sdk-invalid', 'The selected SDK must be a complete TypeScript package.', { subject: { file: manifestPath } });
  }
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
  if (!version || Number(version[1]) < 5 || (Number(version[1]) === 5 && Number(version[2]) < 6)
    || Number(version[1]) > 6 || (Number(version[1]) === 6 && Number(version[2]) > 0)) {
    fail('extract/typescript-sdk-unsupported', 'This TypeScript SDK version is outside the validated 5.6–6.0 range.', {
      subject: { file: root }, evidence: { version: manifest.version },
      supportedFixes: ['use a project with TypeScript 5.6–6.0', 'set typescript.sdk to "bundled" or to a validated package path you trust'],
    });
  }
  const physicalRoot = fs.realpathSync(root);
  let ts;
  try {
    const entry = load.resolve(physicalRoot);
    if (load.cache[entry] && load.cache[entry].exports.version !== manifest.version) {
      for (const file of Object.keys(load.cache)) if (file === physicalRoot || file.startsWith(`${physicalRoot}${path.sep}`)) delete load.cache[file];
    }
    ts = load(physicalRoot);
  }
  catch (error) {
    fail('extract/typescript-sdk-unavailable', 'Cannot load the selected TypeScript SDK.', {
      subject: { file: root }, evidence: { reason: error.message },
    });
  }
  const missing = REQUIRED_API.filter(name => typeof ts[name] !== 'function');
  if (missing.length || typeof ts.version !== 'string' || ts.version !== manifest.version) {
    fail('extract/typescript-sdk-unsupported', 'The selected TypeScript SDK is incompatible with the analyzer.', {
      subject: { file: root }, evidence: { version: ts.version ?? null, missing },
    });
  }
  return { ts, packagePath: physicalRoot, version: ts.version, source, status: 'matched', limitations: [] };
}

const bundled = { ts: bundledTs, packagePath: null, version: bundledTs.version,
  source: 'bundled', status: 'fallback', limitations: [] };

export function selectTypeScripts(root, snapshot, config, selected, { capturedOnly }) {
  const sourceFiles = snapshot.names.filter(selected);
  // Pinned-tree analysis must not load an SDK from the live filesystem.
  if (capturedOnly) return [{ sdk: bundled, files: sourceFiles }];

  const settings = config.typescript === undefined ? {} : config.typescript;
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)
    || (settings.sdk !== undefined && typeof settings.sdk !== 'string')
    || (settings.requireProjectSdk !== undefined && typeof settings.requireProjectSdk !== 'boolean')) {
    fail('extract/typescript-settings-invalid', 'The TypeScript SDK settings are invalid.', {
      subject: { option: 'typescript' }, supportedFixes: ['set typescript.sdk to "bundled", "auto", or a package path and requireProjectSdk to a boolean'],
    });
  }
  const sdkPath = settings.sdk ?? 'bundled';
  if (!sdkPath.trim()) fail('extract/typescript-settings-invalid', 'The TypeScript SDK path must not be empty.', { subject: { option: 'typescript.sdk' } });
  if (sdkPath === 'bundled') {
    if (settings.requireProjectSdk) fail('extract/typescript-sdk-required', 'Bundled mode cannot satisfy typescript.requireProjectSdk.', {
      subject: { option: 'typescript.sdk' },
      supportedFixes: ['set typescript.sdk to "auto" for a trusted checkout', 'set typescript.sdk to a validated package path you trust', 'disable typescript.requireProjectSdk to use the bundled SDK'],
    });
    return [{ sdk: bundled, files: sourceFiles }];
  }
  if (sdkPath !== 'auto') {
    const explicitRoot = path.resolve(root, sdkPath);
    return [{ sdk: loadSdk(explicitRoot, 'explicit'), files: sourceFiles }];
  }

  if (!sourceFiles.length) return [{ sdk: bundled, files: sourceFiles }];

  const lookup = new Map();
  const projectSdk = boundary => {
    if (lookup.has(boundary)) return lookup.get(boundary);
    // Search only the checkout/ancestor node_modules chain. A local package
    // symlink can still point to a package store outside that chain.
    let installed = null, declared = false;
    for (let directory = boundary; ; directory = path.dirname(directory)) {
      const pkg = path.join(directory, 'node_modules', 'typescript');
      if (fs.existsSync(path.join(pkg, 'package.json'))) {
        installed = fs.realpathSync(pkg);
        break;
      }
      if (!declared) {
        const manifest = path.join(directory, 'package.json');
        const relative = path.relative(root, manifest).split(path.sep).join('/');
        const inside = relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
        const data = inside ? snapshot.contents.get(relative) : fs.existsSync(manifest) ? fs.readFileSync(manifest) : undefined;
        declared = declaredTypeScript(data, manifest);
      }
      if (path.dirname(directory) === directory) break;
    }
    const result = { installed, declared };
    lookup.set(boundary, result);
    return result;
  };

  const groups = new Map();
  for (const source of sourceFiles) {
    const boundary = path.dirname(path.join(root, source));
    const { installed, declared } = projectSdk(boundary);
    if (!groups.has(installed)) {
      const sdk = installed ? loadSdk(installed, 'project') : { ...bundled, limitations: [] };
      groups.set(installed, { sdk, files: [] });
    }
    const group = groups.get(installed);
    if (!installed && declared && !group.sdk.limitations.length) {
      group.sdk.limitations.push('Project TypeScript is declared but unavailable; analysis used the bundled version.');
    }
    group.files.push(source);
  }
  return [...groups.values()];
}
