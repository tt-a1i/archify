import fs from 'node:fs';
import path from 'node:path';
import { matcher } from './glob.mjs';

const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function listFiles(root, config) {
  const include = matcher(config.include);
  const exclude = matcher(config.exclude);
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (entry.isDirectory()) { if (!exclude(`${rel}/`)) walk(abs); continue; }
      if (!entry.isFile()) continue;
      if (include(rel) && !exclude(rel)) out.push(rel);
    }
  })(root);
  return out.sort();
}

// Precedence: test > generated > source. A generated file that lives under a
// test directory is test infrastructure, not product code.
export function classifyRole(rel, roles) {
  if (matcher(roles.test)(rel)) return 'test';
  if (matcher(roles.generated)(rel)) return 'generated';
  return 'source';
}

export function lineCount(content) {
  if (!content.length) return 0;
  const lines = content.split(/\r\n|\n|\r/);
  return lines.length - (/(?:\r\n|\n|\r)$/.test(content) ? 1 : 0);
}
