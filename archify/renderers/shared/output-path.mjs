import path from 'node:path';
import {
  containedBy,
  isValidWindowsSmbShareName,
  isWindowsIpcShare,
  resolvePhysicalLocation,
  sameLocation,
} from './path-semantics.mjs';
import { PortablePathError, validatePortablePath } from './portable-path.mjs';

export function canonicalFuturePath(targetPath) {
  const resolution = resolvePhysicalLocation(targetPath);
  if (resolution.status === 'resolved') {
    if (resolution.location.kind === 'existing') return resolution.location.path;
    return path.join(
      resolution.location.ancestorPath,
      ...resolution.location.unresolved,
    );
  }
  const output = path.resolve(targetPath);
  if (resolution.reason.code === 'symlink-cycle') {
    throw new OutputPathError(`Output path contains a symbolic-link cycle: "${output}".`, {
      code: 'output/symlink-cycle',
      message: 'Output path could not be resolved because it contains a symbolic-link cycle.',
      subject: { output },
      evidence: { relation: resolution.reason },
      supportedFixes: ['remove the symbolic-link cycle or choose an output path outside it'],
    });
  }
  throw new OutputPathError('Output path could not be resolved safely.', {
    code: 'output/path-resolution-indeterminate',
    message: 'Output path could not be resolved safely for the requested filesystem location.',
    subject: { output },
    evidence: { relation: resolution.reason },
    supportedFixes: ['use an ordinary local filesystem path that can be resolved safely, then retry'],
  });
}

export function pathsAlias(leftPath, rightPath) {
  const relation = sameLocation(leftPath, rightPath);
  if (relation.status === 'match') return true;
  if (relation.status === 'different') return false;
  if (relation.reason.code === 'ancestor-not-directory') return false;
  if (relation.reason.code === 'symlink-cycle') {
    const output = path.resolve(relation.reason.side === 'right' ? rightPath : leftPath);
    throw new OutputPathError(`Output path contains a symbolic-link cycle: "${output}".`, {
      code: 'output/symlink-cycle',
      message: 'Output path could not be resolved because it contains a symbolic-link cycle.',
      subject: { output },
      evidence: { relation: relation.reason },
      supportedFixes: ['remove the symbolic-link cycle or choose an output path outside it'],
    });
  }
  throw new OutputPathError('Path identity could not be determined safely.', {
    code: 'output/path-identity-indeterminate',
    message: 'Path identity could not be determined safely for the requested filesystem location.',
    subject: { left: path.resolve(leftPath), right: path.resolve(rightPath) },
    evidence: { relation: relation.reason },
    supportedFixes: ['use ordinary local filesystem paths whose identity can be verified, then retry'],
  });
}

function pathIsInside(directoryPath, targetPath) {
  const relation = containedBy(directoryPath, targetPath);
  if (relation.status === 'match') return true;
  if (relation.status === 'different') return false;
  throw new OutputPathError('Output containment could not be determined safely.', {
    code: 'output/containment-indeterminate',
    message: 'Output containment could not be determined safely for the requested filesystem location.',
    subject: { output: path.resolve(targetPath), cwd: path.resolve(directoryPath) },
    evidence: { relation: relation.reason },
    supportedFixes: ['use an output beneath an ordinary local directory whose identity can be verified'],
  });
}

function authoredOutputDiagnostic(error, rawOutput) {
  const absolute = error?.reason === 'absolute';
  const code = absolute ? 'output/meta-absolute' : 'output/meta-path-syntax';
  const message = absolute
    ? 'meta.output must be a relative path resolved from the current working directory.'
    : 'meta.output must be a portable POSIX-relative path.';
  return {
    code,
    message,
    subject: { output: rawOutput, path: '/meta/output' },
    evidence: {
      reason: error?.reason || 'invalid',
      ...(error?.segmentIndex !== undefined ? { segmentIndex: error.segmentIndex } : {}),
      ...(error?.segment !== undefined ? { segment: error.segment } : {}),
      ...(error?.utf8Bytes !== undefined ? { utf8Bytes: error.utf8Bytes } : {}),
      ...(error?.utf16CodeUnits !== undefined ? { utf16CodeUnits: error.utf16CodeUnits } : {}),
      ...(error?.limit !== undefined ? { limit: error.limit } : {}),
    },
    supportedFixes: ['set meta.output to a portable relative .html path such as reports/diagram.html'],
  };
}

function nativeOutputDiagnostic(rawOutput, reason, details = {}) {
  return {
    code: 'output/native-path-syntax',
    message: 'The output path is not a valid native filesystem path on this host.',
    subject: { output: rawOutput },
    evidence: { reason, ...details },
    supportedFixes: ['choose an ordinary filesystem path without device names, alternate data streams, trailing dots or spaces, or overlong components'],
  };
}

function throwNativeOutputDiagnostic(rawOutput, reason, details = {}) {
  const diagnostic = nativeOutputDiagnostic(rawOutput, reason, details);
  throw new OutputPathError(diagnostic.message, diagnostic);
}

function windowsExtendedTailComponents(rawOutput, tail) {
  const authoredComponents = tail.split('\\');
  // Preserve one trailing separator for directory arguments, but never repair
  // an empty component inside the raw extended namespace.
  if (authoredComponents.slice(0, -1).some((component) => component.length === 0)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-extended-root');
  }
  return authoredComponents.filter(Boolean);
}

function rejectWindowsIpcShare(rawOutput, share) {
  if (isWindowsIpcShare(share)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-ipc-namespace', { share });
  }
}

function validateWindowsNativeComponent(
  rawOutput,
  component,
  componentIndex,
  { allowReservedName = false } = {},
) {
  try {
    // Prefix the component so a colon is classified as an ADS separator,
    // rather than allowing the generic URI detector to claim it first.
    validatePortablePath(`native/${component}`, { profile: 'output' });
  } catch (error) {
    if (!(error instanceof PortablePathError)) throw error;
    if (allowReservedName && error.reason === 'windows-reserved-name') return;
    // Native Windows arguments may intentionally name an existing 8.3 alias.
    // Portable authored/archive paths reject that ambiguous spelling, while
    // native resolution lets the filesystem prove the existing target.
    if (error.reason === 'windows-short-name') {
      if (component.length <= 255) return;
      throwNativeOutputDiagnostic(rawOutput, 'component-too-long', {
        component,
        componentIndex,
        utf16CodeUnits: component.length,
        limit: 255,
      });
    }
    // Native Windows filesystems bound components in UTF-16 code units. The
    // stricter UTF-8 bound belongs to portable authored/archive names only.
    if (error.reason === 'component-too-long' && error.utf16CodeUnits <= 255) return;
    throwNativeOutputDiagnostic(rawOutput, error.reason, {
      component,
      componentIndex,
      ...(error.character !== undefined ? { character: error.character } : {}),
      ...(error.utf8Bytes !== undefined ? { utf8Bytes: error.utf8Bytes } : {}),
      ...(error.utf16CodeUnits !== undefined ? { utf16CodeUnits: error.utf16CodeUnits } : {}),
      ...(error.limit !== undefined ? { limit: error.limit } : {}),
    });
  }
}

function validateWindowsUncRootComponents(rawOutput, server, share) {
  rejectWindowsIpcShare(rawOutput, share);
  if (!isValidWindowsSmbShareName(share)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-unc-share-name', {
      share,
      utf16CodeUnits: share.length,
      limit: 80,
    });
  }
  // UNC servers and shares are root components, not DOS file names. Keep the
  // server's ordinary native syntax checks while allowing names such as CON.
  validateWindowsNativeComponent(rawOutput, server, 0, { allowReservedName: true });
}

function windowsExtendedPathComponents(rawOutput) {
  // The extended-length namespace deliberately bypasses Win32 normalization.
  // Inspect its original spelling so a dot segment cannot retarget a UNC share.
  if (rawOutput.includes('/')) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-extended-separator', { character: '/' });
  }
  if (/^\\\\\?\\(?:GLOBALROOT|Device)(?:\\|$)/iu.test(rawOutput)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-device-namespace');
  }

  const drive = rawOutput.match(/^\\\\\?\\[A-Za-z]:\\/u);
  if (drive) {
    return windowsExtendedTailComponents(rawOutput, rawOutput.slice(drive[0].length));
  }

  const uncPrefix = rawOutput.match(/^\\\\\?\\UNC\\/iu);
  if (uncPrefix) {
    const authoredTail = rawOutput.slice(uncPrefix[0].length);
    const components = authoredTail.split('\\');
    if (components.length < 2 || components[0].length === 0 || components[1].length === 0) {
      throwNativeOutputDiagnostic(rawOutput, 'windows-extended-root');
    }
    validateWindowsUncRootComponents(rawOutput, components[0], components[1]);
    return windowsExtendedTailComponents(rawOutput, components.slice(2).join('\\'));
  }

  throwNativeOutputDiagnostic(rawOutput, 'windows-extended-root');
}

function validateWindowsRawUncRoot(rawOutput) {
  if (!/^[\\/]{2}/u.test(rawOutput) || /^[\\/]{2}[.?][\\/]/u.test(rawOutput)) return;
  // Validate the raw server/share boundary before win32.normalize can collapse
  // an empty share or mix the two UNC separator spellings.
  const unc = rawOutput.match(/^([\\/])\1([^\\/]+)\1([^\\/]+)(?:[\\/]|$)/u);
  if (!unc) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-unc-root');
  }
  validateWindowsUncRootComponents(rawOutput, unc[2], unc[3]);
}

function windowsPathComponents(rawOutput, normalized) {
  const authoredUncPrefix = /^[\\/]{2}/u.test(rawOutput);
  if (/^\\\\\.\\/u.test(normalized)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-device-namespace');
  }
  if (/^\\\\\?\\/u.test(normalized)) {
    throwNativeOutputDiagnostic(rawOutput, 'windows-extended-root');
  }
  if (normalized.startsWith('\\\\')) {
    const unc = normalized.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/u);
    if (!unc) throwNativeOutputDiagnostic(rawOutput, 'windows-unc-root');
    return normalized.slice(unc[0].length).split('\\').filter(Boolean);
  }
  if (authoredUncPrefix) throwNativeOutputDiagnostic(rawOutput, 'windows-unc-root');
  if (normalized.startsWith('\\')) {
    throwNativeOutputDiagnostic(rawOutput, 'current-drive-rooted');
  }
  const root = path.win32.parse(normalized).root;
  return normalized
    .slice(root.length)
    .split(/[\\/]+/u)
    // normalize() retains leading navigation for a relative path. Those dot
    // segments are path syntax, not filename components subject to name rules.
    .filter((component) => component && component !== '.' && component !== '..');
}

/**
 * Validate command-line/default output paths using the active host's native
 * syntax. Unlike authored portable paths, absolute paths and native separators
 * remain supported. File outputs reject a trailing separator before native
 * resolution can erase it; directory callers must opt in explicitly. The
 * component bound also protects derived sidecars from failing after an
 * operation has already started mutating the destination.
 */
export function validateNativeOutputPath(
  rawOutput,
  { platform = process.platform, kind = 'file' } = {},
) {
  if (kind !== 'file' && kind !== 'directory') {
    throw new TypeError(`Unsupported native output path kind: ${JSON.stringify(kind)}`);
  }
  if (typeof rawOutput !== 'string' || rawOutput.length === 0) {
    throwNativeOutputDiagnostic(rawOutput, 'empty');
  }
  if (rawOutput.includes('\0')) throwNativeOutputDiagnostic(rawOutput, 'nul-character');
  if (/[\uD800-\uDFFF]/u.test(rawOutput)) {
    throwNativeOutputDiagnostic(rawOutput, 'unpaired-surrogate');
  }
  const hasTrailingSeparator = platform === 'win32'
    ? /[\\/]$/u.test(rawOutput)
    : rawOutput.endsWith(path.posix.sep);
  if (kind === 'file' && hasTrailingSeparator) {
    throwNativeOutputDiagnostic(rawOutput, 'trailing-separator', { kind });
  }

  let normalized;
  let components;
  if (platform === 'win32') {
    if (/^[A-Za-z]:(?:$|[^\\/])/u.test(rawOutput)) {
      throwNativeOutputDiagnostic(rawOutput, 'drive-relative');
    }
    const extendedPrefix = rawOutput.startsWith('\\\\?\\');
    if (extendedPrefix) {
      components = windowsExtendedPathComponents(rawOutput);
    } else {
      validateWindowsRawUncRoot(rawOutput);
      normalized = path.win32.normalize(rawOutput);
      components = windowsPathComponents(rawOutput, normalized);
    }
    for (const [componentIndex, component] of components.entries()) {
      validateWindowsNativeComponent(rawOutput, component, componentIndex);
    }
  } else {
    normalized = path.resolve(rawOutput);
    const root = path.parse(normalized).root;
    components = normalized.slice(root.length).split(path.sep).filter(Boolean);
    for (const [componentIndex, component] of components.entries()) {
      const utf8Bytes = Buffer.byteLength(component, 'utf8');
      if (utf8Bytes > 255) {
        throwNativeOutputDiagnostic(rawOutput, 'component-too-long', {
          component,
          componentIndex,
          utf8Bytes,
          limit: 255,
        });
      }
    }
  }
  return rawOutput;
}

/** Validate a CLI directory argument before native resolution can normalize away its raw syntax. */
export function resolveNativeOutputDirectory(
  rawDirectory,
  { platform = process.platform, cwd = process.cwd() } = {},
) {
  validateNativeOutputPath(rawDirectory, { platform, kind: 'directory' });
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.resolve(cwd, rawDirectory);
}

export function validateAuthoredOutputPath(rawOutput, { cwd = process.cwd() } = {}) {
  try {
    validatePortablePath(rawOutput, { profile: 'output' });
  } catch (error) {
    if (!(error instanceof PortablePathError)) throw error;
    const diagnostic = authoredOutputDiagnostic(error, rawOutput);
    throw new OutputPathError(diagnostic.message, diagnostic);
  }
  if (path.posix.extname(rawOutput).toLowerCase() !== '.html') {
    throw new OutputPathError('meta.output must target an .html file.', {
      code: 'output/meta-extension',
      message: 'meta.output must target an .html file.',
      subject: { output: rawOutput, path: '/meta/output' },
      supportedFixes: ['change meta.output to a portable path ending in .html'],
    });
  }
  const outputPath = path.resolve(cwd, rawOutput);
  if (path.extname(canonicalFuturePath(outputPath)).toLowerCase() !== '.html') {
    throw new OutputPathError('meta.output must resolve to an .html file.', {
      code: 'output/meta-resolved-extension',
      message: 'meta.output must resolve to an .html file after symbolic links are followed.',
      subject: { output: rawOutput },
      supportedFixes: ['remove the symbolic-link alias or point it to an .html target inside the current working directory'],
    });
  }
  if (!pathIsInside(cwd, outputPath)) {
    throw new OutputPathError('meta.output must stay inside the current working directory.', {
      code: 'output/meta-outside-cwd',
      message: 'meta.output must stay inside the current working directory after symbolic links are resolved.',
      subject: { output: rawOutput, cwd: path.resolve(cwd) },
      supportedFixes: ['set meta.output to a relative .html path inside the current working directory'],
    });
  }
  return rawOutput;
}

export class OutputPathError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = 'OutputPathError';
    this.archifyDiagnostics = [{
      severity: 'error',
      subject: {},
      evidence: {},
      supportedFixes: [],
      ...diagnostic,
    }];
  }
}

export function resolveOutputPath({
  requestedOutput,
  authoredOutput,
  defaultOutput,
  inputPaths = [],
  inputDescription = 'an input',
  otherOutputPaths = [],
  cwd = process.cwd(),
  requiredExtension = '.html',
  platform = process.platform,
}) {
  if (authoredOutput !== undefined) validateAuthoredOutputPath(authoredOutput, { cwd });
  const source = requestedOutput !== undefined
    ? 'cli'
    : (authoredOutput !== undefined ? 'meta' : 'default');
  const rawOutput = source === 'cli'
    ? requestedOutput
    : (source === 'meta' ? authoredOutput : defaultOutput);
  if (source !== 'meta') validateNativeOutputPath(rawOutput, { platform, kind: 'file' });
  const outputPath = path.resolve(cwd, rawOutput);
  for (const inputPath of inputPaths) {
    if (!pathsAlias(outputPath, inputPath)) continue;
    throw new OutputPathError(`Output must not replace ${inputDescription}.`, {
      code: 'output/input-alias',
      message: `Output must not replace ${inputDescription}, including through a symbolic-link or future-path alias.`,
      subject: { output: outputPath, input: path.resolve(inputPath) },
      supportedFixes: ['choose an output path that is distinct from every input path'],
    });
  }
  for (const otherOutputPath of otherOutputPaths) {
    if (!pathsAlias(outputPath, otherOutputPath)) continue;
    throw new OutputPathError('Output targets must use distinct paths.', {
      code: 'output/target-alias',
      message: 'Output targets must use distinct paths, including symbolic-link and future-path aliases.',
      subject: { output: outputPath, conflictingOutput: path.resolve(otherOutputPath) },
      supportedFixes: ['choose distinct paths for every generated output'],
    });
  }

  // Keep explicit CLI directories unrestricted, but reject mistaken file types.
  // Alias checks above retain priority when a target would overwrite an input.
  if (source === 'cli') {
    const resolvedOutput = canonicalFuturePath(outputPath);
    const authoredExtension = path.extname(rawOutput).toLowerCase();
    const existingWindowsHtmlAlias = platform === 'win32'
      && requiredExtension === '.html'
      && authoredExtension === '.htm'
      && path.extname(resolvedOutput).toLowerCase() === requiredExtension
      && pathsAlias(outputPath, resolvedOutput);
    const authoredMatches = authoredExtension === requiredExtension || existingWindowsHtmlAlias;
    const resolvedMatches = path.extname(resolvedOutput).toLowerCase() === requiredExtension;
    if (!authoredMatches || !resolvedMatches) {
      const message = `CLI output must ${authoredMatches ? 'resolve to' : 'target'} a ${requiredExtension} file.`;
      throw new OutputPathError(message, {
        code: authoredMatches ? 'output/cli-resolved-extension' : 'output/cli-extension',
        message,
        subject: { output: rawOutput },
        evidence: { resolvedOutput, requiredExtension },
        supportedFixes: [`choose a path ending in ${requiredExtension} whose symbolic-link target also ends in ${requiredExtension}`],
      });
    }
  }

  return {
    outputPath,
    source,
  };
}
