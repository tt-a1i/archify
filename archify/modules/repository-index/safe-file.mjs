import fs from 'node:fs';
import path from 'node:path';

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function captureRepositoryRoot(root) {
  const physicalRoot = fs.realpathSync(root);
  const stat = fs.statSync(physicalRoot);
  if (!stat.isDirectory()) throw new Error('Repository root must be a directory.');
  return { physicalRoot, dev: stat.dev, ino: stat.ino };
}

export function safeRepositoryEntry(root, relativePath, kind) {
  const identity = typeof root === 'string' ? captureRepositoryRoot(root) : root;
  const { physicalRoot } = identity;
  const currentRoot = fs.statSync(physicalRoot);
  if (currentRoot.dev !== identity.dev || currentRoot.ino !== identity.ino) {
    throw new Error('Repository root changed during inspection.');
  }
  const target = path.resolve(physicalRoot, ...relativePath.split('/'));
  if (!inside(physicalRoot, target)) throw new Error('Repository path escapes the requested root.');
  const physicalTarget = fs.realpathSync(target);
  if (!inside(physicalRoot, physicalTarget)) throw new Error('Repository path resolves outside the requested root.');
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (kind === 'file' && !stat.isFile()) || (kind === 'directory' && !stat.isDirectory())) {
    throw new Error('Repository entry changed type during inspection.');
  }
  return { path: target, stat };
}

export function openSafeRepositoryFile(root, relativePath) {
  const checked = safeRepositoryEntry(root, relativePath, 'file');
  const descriptor = fs.openSync(checked.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== checked.stat.dev || opened.ino !== checked.stat.ino) {
      throw new Error('Repository file changed during inspection.');
    }
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}
