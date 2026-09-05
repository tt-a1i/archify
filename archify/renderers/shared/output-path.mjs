import fs from 'node:fs';
import path from 'node:path';

const MAX_SYMLINK_DEPTH = 64;
const directorySemanticsCache = new Map();
let semanticsProbeSequence = 0;

function splitAbsolute(absolutePath) {
  const root = path.parse(absolutePath).root;
  return {
    root,
    segments: absolutePath.slice(root.length).split(path.sep).filter(Boolean),
  };
}

function canonicalize(targetPath, depth) {
  const absolutePath = path.resolve(targetPath);
  const { root, segments } = splitAbsolute(absolutePath);
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const candidate = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return path.resolve(current, ...segments.slice(index));
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      if (depth >= MAX_SYMLINK_DEPTH) {
        const error = new Error(`Could not resolve path because a symbolic-link cycle includes "${candidate}".`);
        error.code = 'ELOOP';
        error.path = candidate;
        throw error;
      }
      const link = fs.readlinkSync(candidate);
      const linkTarget = path.isAbsolute(link) ? link : path.resolve(path.dirname(candidate), link);
      return canonicalize(path.join(linkTarget, ...segments.slice(index + 1)), depth + 1);
    }

    current = fs.realpathSync.native(candidate);
  }

  return path.normalize(current);
}

export function canonicalFuturePath(targetPath) {
  try {
    return canonicalize(targetPath, 0);
  } catch (error) {
    if (error?.code !== 'ELOOP') throw error;
    const output = path.resolve(targetPath);
    throw new OutputPathError(`Output path contains a symbolic-link cycle: "${output}".`, {
      code: 'output/symlink-cycle',
      message: 'Output path could not be resolved because it contains a symbolic-link cycle.',
      subject: { output },
      evidence: {
        systemCode: 'ELOOP',
        ...(error.path ? { cycleAt: path.resolve(error.path) } : {}),
      },
      supportedFixes: ['remove the symbolic-link cycle or choose an output path outside it'],
    });
  }
}

function hasFileIdentity(stat) {
  return stat.ino !== 0 && stat.ino !== 0n;
}

function sameFileIdentity(left, right) {
  return hasFileIdentity(left)
    && hasFileIdentity(right)
    && left.dev === right.dev
    && left.ino === right.ino;
}

function nearestExistingDirectory(targetPath) {
  let directory = path.dirname(targetPath);
  while (true) {
    try {
      const stat = fs.statSync(directory);
      if (stat.isDirectory()) {
        return {
          path: fs.realpathSync.native(directory),
          stat,
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function directoryIdentityKey(directory) {
  if (!hasFileIdentity(directory.stat)) return null;
  return `${directory.stat.dev}:${directory.stat.ino}`;
}

function probeNamesAlias(directoryPath, authoredName, lookupName) {
  let fileDescriptor;
  let created = false;
  let result = null;
  let cleaned = true;
  const authoredPath = path.join(directoryPath, authoredName);
  const lookupPath = path.join(directoryPath, lookupName);
  try {
    fileDescriptor = fs.openSync(authoredPath, 'wx', 0o600);
    created = true;
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;

    let authored;
    let lookup;
    try {
      authored = fs.statSync(authoredPath);
      lookup = fs.statSync(lookupPath);
    } catch (error) {
      if (error.code === 'ENOENT') result = false;
    }
    if (authored && lookup) {
      if (sameFileIdentity(authored, lookup)) {
        result = true;
      } else {
        try {
          result = fs.realpathSync.native(authoredPath) === fs.realpathSync.native(lookupPath);
        } catch {
          result = null;
        }
      }
    }
  } catch {
    result = null;
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {
        cleaned = false;
      }
    }
    if (created) {
      try {
        fs.unlinkSync(authoredPath);
      } catch {
        cleaned = false;
      }
    }
  }
  return cleaned ? result : null;
}

function probeDirectorySemantics(directory) {
  const cacheKey = directoryIdentityKey(directory);
  if (cacheKey && directorySemanticsCache.has(cacheKey)) {
    return directorySemanticsCache.get(cacheKey);
  }

  semanticsProbeSequence += 1;
  const suffix = `${process.pid}-${Date.now().toString(36)}-${semanticsProbeSequence}`;
  const caseAuthored = `.archify-Case-Probe-${suffix}`;
  const normalizationAuthored = `.archify-norm-\u00e9-probe-${suffix}`;
  const semantics = {
    caseInsensitive: probeNamesAlias(
      directory.path,
      caseAuthored,
      caseAuthored.toLowerCase(),
    ),
    normalizationInsensitive: probeNamesAlias(
      directory.path,
      normalizationAuthored,
      normalizationAuthored.normalize('NFD'),
    ),
  };
  if (
    cacheKey
    && semantics.caseInsensitive !== null
    && semantics.normalizationInsensitive !== null
  ) {
    directorySemanticsCache.set(cacheKey, semantics);
  }
  return semantics;
}

function sameDirectory(left, right) {
  return left.path === right.path || sameFileIdentity(left.stat, right.stat);
}

function futurePathsAlias(leftPath, rightPath) {
  const left = canonicalFuturePath(leftPath);
  const right = canonicalFuturePath(rightPath);
  if (left === right) return true;

  const leftDirectory = nearestExistingDirectory(left);
  const rightDirectory = nearestExistingDirectory(right);
  if (!leftDirectory || !rightDirectory || !sameDirectory(leftDirectory, rightDirectory)) {
    return false;
  }

  const semantics = probeDirectorySemantics(leftDirectory);
  let comparableLeft = path.relative(leftDirectory.path, left);
  let comparableRight = path.relative(rightDirectory.path, right);
  if (semantics.normalizationInsensitive !== false) {
    comparableLeft = comparableLeft.normalize('NFC');
    comparableRight = comparableRight.normalize('NFC');
  }
  if (semantics.caseInsensitive !== false) {
    comparableLeft = comparableLeft.toLowerCase();
    comparableRight = comparableRight.toLowerCase();
  }
  return comparableLeft === comparableRight;
}

export function pathsAlias(leftPath, rightPath) {
  if (futurePathsAlias(leftPath, rightPath)) return true;
  try {
    const left = fs.statSync(leftPath);
    const right = fs.statSync(rightPath);
    return sameFileIdentity(left, right);
  } catch {
    return false;
  }
}

function pathIsInside(directoryPath, targetPath) {
  const relative = path.relative(canonicalFuturePath(directoryPath), canonicalFuturePath(targetPath));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
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
}) {
  const rawOutput = requestedOutput || authoredOutput || defaultOutput;
  const source = requestedOutput ? 'cli' : (authoredOutput ? 'meta' : 'default');
  if (
    source === 'meta'
    && (path.isAbsolute(rawOutput) || path.posix.isAbsolute(rawOutput) || path.win32.isAbsolute(rawOutput))
  ) {
    throw new OutputPathError('meta.output must be a relative path.', {
      code: 'output/meta-absolute',
      message: 'meta.output must be a relative path resolved from the current working directory.',
      subject: { output: rawOutput },
      supportedFixes: ['set meta.output to a relative .html path inside the current working directory'],
    });
  }
  if (source === 'meta' && path.extname(rawOutput).toLowerCase() !== '.html') {
    throw new OutputPathError('meta.output must target an .html file.', {
      code: 'output/meta-extension',
      message: 'meta.output must target an .html file.',
      subject: { output: rawOutput },
      supportedFixes: ['change meta.output to a path ending in .html'],
    });
  }
  const outputPath = path.resolve(cwd, rawOutput);
  if (source === 'meta' && path.extname(canonicalFuturePath(outputPath)).toLowerCase() !== '.html') {
    throw new OutputPathError('meta.output must resolve to an .html file.', {
      code: 'output/meta-resolved-extension',
      message: 'meta.output must resolve to an .html file after symbolic links are followed.',
      subject: { output: rawOutput },
      supportedFixes: ['remove the symbolic-link alias or point it to an .html target inside the current working directory'],
    });
  }
  if (source === 'meta' && !pathIsInside(cwd, outputPath)) {
    throw new OutputPathError('meta.output must stay inside the current working directory.', {
      code: 'output/meta-outside-cwd',
      message: 'meta.output must stay inside the current working directory after symbolic links are resolved.',
      subject: { output: rawOutput, cwd: path.resolve(cwd) },
      supportedFixes: ['set meta.output to a relative .html path inside the current working directory'],
    });
  }

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

  return {
    outputPath,
    source,
  };
}

/**
 * Detect every aliasing form between an import input and its intended output:
 * the same path, a symlink resolving to the input, or a hard link sharing the
 * input's inode. Returns true when writing the output would replace the input.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {boolean}
 */
export function importOutputAliasesInput(inputPath, outputPath) {
  let inputReal = null;
  try {
    inputReal = fs.realpathSync(path.resolve(inputPath));
  } catch {
    return false; // unreadable input is reported by the read path
  }
  let outputReal = null;
  try {
    outputReal = fs.realpathSync(path.resolve(outputPath));
  } catch {
    return false; // output does not exist yet — nothing to alias
  }
  if (inputReal === outputReal) return true;
  try {
    const inputStat = fs.statSync(inputReal);
    const outputStat = fs.statSync(outputReal);
    if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) return true;
  } catch {
    // realpathSync succeeded above, so stat on the same paths cannot fail
  }
  return false;
}

/**
 * Commit the import result through a non-following atomic candidate/rename.
 *
 * The aliasing preflight runs before parsing; the output path can change while
 * the input parses (e.g. an output symlink re-pointed at the input). The
 * candidate is created with O_CREAT|O_EXCL in the output's directory — never
 * at the output path itself — and rename(2) replaces a symlink instead of
 * following it, so no swap between the preflight and the commit can make this
 * write reach the Mermaid source through a symlink. The alias recheck at the
 * commit point reports the same `input/output-alias` condition as the
 * preflight instead of silently replacing a symlink that now resolves to the
 * input.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} data
 * @returns {{ ok: true } | { ok: false, reason: 'input/output-alias' }}
 * @throws {Error} when the output cannot be written (propagated to the CLI's
 *   `output/write` receipt handling); the candidate file is removed first.
 */
export function commitImportOutput(inputPath, outputPath, data) {
  if (importOutputAliasesInput(inputPath, outputPath)) {
    return { ok: false, reason: 'input/output-alias' };
  }
  const resolved = path.resolve(outputPath);
  const candidate = path.join(
    path.dirname(resolved),
    `.archify-import-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(candidate, 'wx');
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    fs.renameSync(candidate, resolved);
  } catch (error) {
    try { fs.rmSync(candidate, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  return { ok: true };
}
