import path from 'node:path';
import ts from 'typescript';
import { fail } from '../shared/diagnostics.mjs';

// Config and module resolution share captured in-root inputs. Outside inputs
// (including installed config packages) are memoized and checked before return.
export function snapshotHost(root, { contents, names, assertFileUnchanged }) {
  const canonical = file => {
    const absolute = path.resolve(file);
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
  };
  const files = new Set(names.map(name => canonical(path.join(root, name))));
  const bytes = new Map([...contents].map(([name, data]) => [canonical(path.join(root, name)), data]));
  const directories = new Set([canonical(root)]);
  for (const name of names) {
    let dir = path.dirname(path.join(root, name));
    while (!directories.has(canonical(dir))) {
      directories.add(canonical(dir));
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
    if (captured(file)) uncaptured.add(file);
    if (captured(file)) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
    const key = JSON.stringify([method, path.resolve(file)]);
    if (!observed.has(key)) observed.set(key, { method, file, value: ts.sys[method](file) });
    if (captured(file)) assertFileUnchanged(path.relative(root, file).split(path.sep).join('/'));
    return observed.get(key).value;
  };
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => root,
    fileExists: file => captured(file) ? files.has(canonical(file)) : live('fileExists', file),
    directoryExists: dir => captured(dir) ? directories.has(canonical(dir)) : live('directoryExists', dir),
    getDirectories: dir => captured(dir)
      ? [...directories].filter(child => child !== canonical(dir) && canonical(path.dirname(child)) === canonical(dir)).sort()
      : live('getDirectories', dir),
    readFile(file) {
      if (captured(file)) {
        const data = bytes.get(canonical(file));
        if (data !== undefined) return decodeText(data);
        if (!files.has(canonical(file))) return undefined;
        // Unusual config extensions are not eagerly copied. Pin their first
        // read and reject the operation if their content subsequently changes.
      }
      return live('readFile', file);
    },
    realpath: file => captured(file) ? path.resolve(file) : live('realpath', file),
    // Analysis selects its own files; tsconfig include/exclude discovery is not
    // an input to compiler options. Avoid a second live filesystem traversal.
    readDirectory: () => [],
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

function decodeText(data) {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le');
  if (data[0] === 0xfe && data[1] === 0xff) {
    const bytes = Buffer.from(data.subarray(2));
    for (let i = 0; i + 1 < bytes.length; i += 2) [bytes[i], bytes[i + 1]] = [bytes[i + 1], bytes[i]];
    return bytes.toString('utf16le');
  }
  return data.toString('utf8').replace(/^\uFEFF/, '');
}
