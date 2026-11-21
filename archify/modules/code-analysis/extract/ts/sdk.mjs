import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import bundledTs from 'typescript';
import { fail } from '../shared/diagnostics.mjs';

const load = createRequire(import.meta.url);
const REQUIRED_API = ['createProgram', 'createCompilerHost', 'createSourceFile', 'parseJsonConfigFileContent', 'resolveModuleName', 'resolveProjectReferencePath', 'matchFiles', 'isIdentifier'];

function declaredTypeScript(data, relative) {
  if (!data) return false;
  let manifest;
  try { manifest = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('extract/typescript-manifest-invalid', 'Cannot inspect a package.json for its TypeScript version.', { subject: { file: relative } }); }
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .some(key => Object.hasOwn(manifest?.[key] || {}, 'typescript'));
}

function packageRoot(entry) {
  for (let dir = path.dirname(entry); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      if (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).name === 'typescript') return dir;
    } catch { /* A parent package is not the selected SDK. */ }
  }
  return null;
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
      supportedFixes: ['use a project with TypeScript 5.6–6.0', 'choose a validated SDK with typescript.sdk'],
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
      subject: { option: 'typescript' }, supportedFixes: ['set typescript.sdk to "auto" or a package path and requireProjectSdk to a boolean'],
    });
  }
  const sdkPath = settings.sdk === undefined ? 'auto' : settings.sdk;
  if (!sdkPath.trim()) fail('extract/typescript-settings-invalid', 'The TypeScript SDK path must not be empty.', { subject: { option: 'typescript.sdk' } });
  if (sdkPath !== 'auto') {
    const explicitRoot = path.resolve(root, sdkPath);
    return [{ sdk: loadSdk(explicitRoot, 'explicit'), files: sourceFiles }];
  }

  const lookup = new Map();
  const loaded = new Map();
  const groups = new Map();
  for (const source of sourceFiles.length ? sourceFiles : ['']) {
    const boundary = source ? path.dirname(path.join(root, source)) : root;
    let directory = boundary;
    while (true) {
      const manifest = path.join(directory, 'package.json');
      const relative = path.relative(root, manifest).split(path.sep).join('/');
      const inside = relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
      const data = inside ? snapshot.contents.get(relative) : fs.existsSync(manifest) ? fs.readFileSync(manifest) : undefined;
      const installed = path.join(directory, 'node_modules/typescript/package.json');
      if (declaredTypeScript(data, manifest) || fs.existsSync(installed)) break;
      const parent = path.dirname(directory);
      if (parent === directory) { directory = null; break; }
      directory = parent;
    }
    let sdk = bundled;
    if (directory !== null) {
      if (!lookup.has(boundary)) {
        const resolver = createRequire(path.join(boundary, 'package.json'));
        const installed = (resolver.resolve.paths('typescript') || []).map(base => path.join(base, 'typescript'))
          .find(base => fs.existsSync(path.join(base, 'package.json')));
        let sdkRoot = installed ? fs.realpathSync(installed) : null;
        try { sdkRoot ||= packageRoot(resolver.resolve('typescript')); }
        catch { /* A declared project SDK can be absent. */ }
        lookup.set(boundary, sdkRoot);
      }
      const sdkRoot = lookup.get(boundary);
      if (!sdkRoot) {
        sdk = { ...bundled, limitations: ['Project TypeScript is declared but unavailable; analysis used the bundled version.'] };
      } else {
        if (!loaded.has(sdkRoot)) loaded.set(sdkRoot, loadSdk(sdkRoot, 'project'));
        sdk = loaded.get(sdkRoot);
      }
    }
    const key = sdk.packagePath || 'bundled';
    if (!groups.has(key)) groups.set(key, { sdk: { ...sdk, limitations: [...sdk.limitations] }, files: [] });
    else for (const limitation of sdk.limitations) if (!groups.get(key).sdk.limitations.includes(limitation)) groups.get(key).sdk.limitations.push(limitation);
    if (source) groups.get(key).files.push(source);
  }
  return [...groups.values()];
}
