#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_SKILL_SOURCE = path.join(repoRoot, 'archify');

export const CLEAN_SKILL_EXCLUDED_NAMES = new Set([
  'node_modules',
  'test',
  '.DS_Store',
  '.hive',
  '.workbuddy',
  '.claude-plugin',
  '.codex-plugin',
  'plugin.json',
  'skills',
  'agents',
  'package-lock.json',
]);

export const CLEAN_SKILL_EXCLUDED_FILES = new Set([
  'scripts/generate-brand-marks.mjs',
  'scripts/generate-validators.mjs',
]);

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

export function shouldExcludeFromCleanSkill(sourceRoot, filePath) {
  const relative = posixRelative(sourceRoot, filePath);
  if (!relative || relative === '.') return false;
  const parts = relative.split('/');
  if (parts.some((part) => CLEAN_SKILL_EXCLUDED_NAMES.has(part))) return true;
  if (parts.some((part) => part.startsWith('.validator-check-'))) return true;
  return CLEAN_SKILL_EXCLUDED_FILES.has(relative);
}

function walkTree(root, visit) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    visit(full, entry);
    if (entry.isDirectory() && !entry.isSymbolicLink()) walkTree(full, visit);
  }
}

export function stageCleanSkill(sourceRoot, destRoot) {
  const validators = path.join(sourceRoot, 'renderers/shared/generated-validators.mjs');
  if (!fs.existsSync(validators)) {
    throw new Error('generated validators are missing — run npm run generate:validators in archify/');
  }

  fs.mkdirSync(destRoot, { recursive: true });

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (shouldExcludeFromCleanSkill(sourceRoot, full)) continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(full);
        continue;
      }
      if (entry.isDirectory()) continue;
      const destination = path.join(destRoot, posixRelative(sourceRoot, full));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(full, destination);
    }
  }

  walk(sourceRoot);

  const packagePath = path.join(destRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.rmSync(path.join(destRoot, 'package-lock.json'), { force: true });
}

export function collectRegularFiles(root) {
  const files = [];
  walkTree(root, (full, entry) => {
    if (entry.isDirectory()) return;
    files.push(posixRelative(root, full));
  });
  return files.sort();
}

export function assertNoSymlinks(root) {
  const links = [];
  walkTree(root, (full, entry) => {
    if (entry.isSymbolicLink()) links.push(posixRelative(root, full));
  });
  if (links.length > 0) {
    throw new Error(`symlinks are not allowed under ${root}:\n${links.join('\n')}`);
  }
}

export function diffTrees(leftRoot, rightRoot) {
  const left = collectRegularFiles(leftRoot);
  const right = collectRegularFiles(rightRoot);
  const missing = left.filter((file) => !right.includes(file));
  const extra = right.filter((file) => !left.includes(file));
  const changed = [];
  for (const file of left) {
    if (!right.includes(file)) continue;
    const leftBytes = fs.readFileSync(path.join(leftRoot, file));
    const rightBytes = fs.readFileSync(path.join(rightRoot, file));
    if (!leftBytes.equals(rightBytes)) changed.push(file);
  }
  return { missing, extra, changed };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dest = argValue('--out');
  if (!dest) {
    process.stderr.write('usage: node scripts/stage-clean-skill.mjs --out <dir>\n');
    process.exit(1);
  }
  const source = path.resolve(argValue('--from') || DEFAULT_SKILL_SOURCE);
  const out = path.resolve(dest);
  fs.rmSync(out, { recursive: true, force: true });
  stageCleanSkill(source, out);
}
