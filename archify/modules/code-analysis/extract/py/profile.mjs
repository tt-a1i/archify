import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { snapshotFiles } from '../shared/files.mjs';
import { fail } from '../shared/diagnostics.mjs';

const pythonFile = /\.pyi?$/;
const moduleName = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const relativeDirectory = /^(?![A-Za-z]:)[^/\\]+(?:\/[^/\\]+)*$/;
const platforms = ['All', 'Darwin', 'Linux', 'Windows', 'Android', 'iOS'];

function invalid(setting, message) {
  fail('extract/python-profile', message, { subject: { setting: `python.${setting}` } });
}

export function pythonProfile(config = {}) {
  const { targetVersion, targetPlatform, extraPaths = [], declarations = {} } = config ?? {};
  if (targetVersion !== undefined && (typeof targetVersion !== 'string' || !/^3\.(?:[89]|[1-9]\d)$/.test(targetVersion))) {
    invalid('targetVersion', 'Select a Python version such as "3.12" or "3.14".');
  }
  if (targetPlatform !== undefined && !platforms.includes(targetPlatform)) invalid('targetPlatform', 'Select a supported Python target platform.');
  if (!Array.isArray(extraPaths) || extraPaths.some(p => typeof p !== 'string' || !relativeDirectory.test(p) || p.split('/').some(part => part === '.' || part === '..' || part.includes('\0')))) {
    invalid('extraPaths', 'Use directories relative to the analyzed root.');
  }
  if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) invalid('declarations', 'Map a Python module name to a declaration file or package directory.');
  return { targetVersion, targetPlatform, extraPaths: [...new Set(extraPaths)], declarations };
}

export function captureDeclarations(root, mappings) {
  const result = new Map();
  for (const name of Object.keys(mappings).sort()) {
    const input = mappings[name];
    if (!moduleName.test(name) || typeof input !== 'string' || !input || input.includes('\0')) invalid('declarations', 'Each declaration needs a module name and an existing path.');
    const location = path.resolve(root, input);
    const stat = fs.statSync(location, { throwIfNoEntry: false });
    const directory = stat?.isDirectory();
    if (!directory && !(stat?.isFile() && pythonFile.test(location))) invalid('declarations', `No Python declaration file or package directory for ${name}.`);
    const files = snapshotFiles(directory ? location : path.dirname(location), {
      include: ['**/*.py', '**/*.pyi'],
      exclude: directory ? ['**/__pycache__/**'] : ['*/'],
    }, file => directory || file === path.basename(location));
    if (!files.size) invalid('declarations', `No Python declarations were captured for ${name}.`);
    const prefix = name.replaceAll('.', '/');
    for (const [file, bytes] of files) {
      const key = directory ? `${prefix}/${file}` : `${prefix}${path.extname(file)}`;
      if (result.has(key)) invalid('declarations', `Multiple declarations map to ${key}.`);
      result.set(key, bytes);
    }
  }
  return result;
}

export function hashedInputs(files) {
  return [...files].map(([file, bytes]) => ({ file, sha256: createHash('sha256').update(bytes).digest('hex') }));
}
