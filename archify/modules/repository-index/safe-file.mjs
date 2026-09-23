import fs from 'node:fs';
import path from 'node:path';

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function safeRepositoryEntry(root, relativePath, kind) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...relativePath.split('/'));
  if (!inside(absoluteRoot, target)) throw new Error('Repository path escapes the requested root.');
  const physicalRoot = fs.realpathSync(absoluteRoot);
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
