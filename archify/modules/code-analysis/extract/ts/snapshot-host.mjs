import path from 'node:path';
import bundledTs from '../../vendor/typescript.cjs';
import { fail } from '../shared/diagnostics.mjs';
import { decodeTypeScriptText } from '../../core/index.mjs';

// Config and module resolution share captured in-root inputs. Outside inputs
// (including installed config packages) are memoized and checked before return.
export function snapshotHostTools(ts) {

function snapshotHost(root, { contents, names, assertFileUnchanged }, { capturedOnly = false } = {}) {
  const canonical = file => {
    const absolute = path.resolve(file);
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  };
  const files = new Set(names.map(name => canonical(path.join(root, name))));
  const bytes = new Map([...contents].map(([name, data]) => [canonical(path.join(root, name)), data]));
  const directories = new Set([canonical(root)]);
  const children = new Map();
  const entry = dir => {
    const key = canonical(dir);
    if (!children.has(key)) children.set(key, { files: new Set(), directories: new Set() });
    return children.get(key);
  };
  entry(root);
  for (const name of names) {
    const absolute = path.join(root, name);
    entry(path.dirname(absolute)).files.add(path.basename(absolute));
    let dir = path.dirname(path.join(root, name));
    while (!directories.has(canonical(dir))) {
      directories.add(canonical(dir));
      entry(path.dirname(dir)).directories.add(path.basename(dir));
      entry(dir);
      dir = path.dirname(dir);
    }
  }
  const captured = file => {
    const relative = path.relative(root, path.resolve(file));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      && !relative.split(path.sep).some(part => part === 'node_modules' || part === '.git');
  };
  const observed = new Map();
  const uncaptured = new Set();
  const live = (method, file) => {
    if (capturedOnly && !captured(file)) return method === 'getDirectories' ? [] : undefined;
    if (captured(file)) uncaptured.add(file);
    if (captured(file)) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
    const key = JSON.stringify([method, path.resolve(file)]);
    if (!observed.has(key)) observed.set(key, { method, file, value: ts.sys[method](file) });
    if (captured(file)) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
    return observed.get(key).value;
  };
  const reads = new Map();
  const readFile = file => {
    if (captured(file)) {
      const data = bytes.get(canonical(file));
      if (data !== undefined) return decodeTypeScriptText(data);
      if (!files.has(canonical(file))) return undefined;
      // Unusual config extensions are pinned on their first live read.
    }
    return live('readFile', file);
  };
  return {
    reads,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => root,
    fileExists(file) {
      const exists = captured(file) ? files.has(canonical(file)) : live('fileExists', file);
      if (!exists && file.endsWith('.json')) reads.set(path.resolve(file), undefined);
      return exists;
    },
    directoryExists: dir => captured(dir) ? directories.has(canonical(dir)) : live('directoryExists', dir),
    getDirectories: dir => captured(dir)
      ? [...directories].filter(child => child !== canonical(dir) && canonical(path.dirname(child)) === canonical(dir)).sort()
      : live('getDirectories', dir),
    readFile(file) {
      const text = readFile(file);
      reads.set(path.resolve(file), text);
      return text;
    },
    realpath: file => captured(file) ? path.resolve(file) : live('realpath', file),
    // Let TypeScript apply its own include/exclude rules to the frozen inventory.
    readDirectory(dir, extensions, excludes, includes, depth) {
      return ts.matchFiles(dir, extensions, excludes, includes, ts.sys.useCaseSensitiveFileNames,
        root, depth, current => {
          const found = children.get(canonical(current));
          return { files: [...(found?.files || [])], directories: [...(found?.directories || [])] };
        }, file => path.resolve(file));
    },
    assertUnchanged() {
      for (const file of uncaptured) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
      for (const { method, file, value } of observed.values()) {
        if (captured(file)) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
        let current;
        try { current = ts.sys[method](file); } catch { current = Symbol('unreadable'); }
        if (current !== value && !(Array.isArray(value) && Array.isArray(current) && JSON.stringify(current) === JSON.stringify(value))) fail('extract/source-changed', 'A TypeScript resolution input changed during extraction.', {
          subject: { file }, supportedFixes: ['stop concurrent configuration or dependency changes and retry analysis'],
        });
      }
    },
  };
}

return { snapshotHost };
}

export const { snapshotHost } = snapshotHostTools(bundledTs);
