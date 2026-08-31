#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateStableUpdateManifest } from '../archify/scripts/update-contract.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || null;
}

const repoRoot = path.resolve(argument('--root', scriptRoot));
const archivePath = argument('--archive');
const tag = argument('--tag', process.env.GITHUB_REF_NAME || null);
const sourceRef = argument('--source-ref', 'HEAD');
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch {
    fail(`${relativePath} is missing or invalid JSON.`);
    return {};
  }
}

if (!archivePath) fail('--archive is required.');
const version = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag || '')
  ?.slice(1, 4).join('.') ?? null;
if (!version) fail(`--tag must be a stable vMAJOR.MINOR.PATCH tag; found ${JSON.stringify(tag)}.`);
if (sourceRef !== 'HEAD' && sourceRef !== tag) {
  fail(`--source-ref must be HEAD or the exact release tag ${JSON.stringify(tag)}; found ${JSON.stringify(sourceRef)}.`);
}

const packageJson = readJson('archify/package.json');
const manifest = readJson('docs/skill-updates/archify/stable.json');
if (version && sourceRef === 'HEAD' && packageJson?.version !== version) {
  fail(`archify/package.json ${packageJson?.version || '(missing)'} does not match ${tag}.`);
}

if (version) {
  try {
    const validated = validateStableUpdateManifest(manifest);
    if (validated.version !== version || validated.source.ref !== tag) {
      fail(`stable update manifest identity does not match ${tag}.`);
    }
  } catch {
    fail(`stable update manifest identity does not match ${tag}.`);
  }
}

let taggerTime = null;
if (version) {
  const tagRef = `refs/tags/${tag}`;
  try {
    const objectType = execFileSync('git', ['-C', repoRoot, 'cat-file', '-t', tagRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (objectType !== 'tag') {
      fail(`${tag} must be an annotated tag; found Git object type ${objectType || '(missing)'}.`);
    } else {
      const epochSource = execFileSync('git', [
        '-C', repoRoot,
        'for-each-ref',
        '--format=%(taggerdate:unix)',
        tagRef,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (!/^\d+$/.test(epochSource)) throw new Error('tagger time is missing');
      const epochSeconds = Number(epochSource);
      if (!Number.isSafeInteger(epochSeconds)) throw new Error('tagger time is out of range');
      taggerTime = new Date(epochSeconds * 1_000).toISOString().replace('.000Z', 'Z');
    }
  } catch {
    fail(`could not resolve annotated tag metadata for ${tag}.`);
  }
}
if (taggerTime && manifest?.publishedAt !== taggerTime) {
  fail(`stable update manifest publishedAt ${manifest?.publishedAt || '(missing)'} does not match annotated tagger time ${taggerTime}.`);
}

let treeSha = null;
try {
  treeSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', `${sourceRef}:archify`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch {
  fail(`could not resolve the release Skill tree at ${sourceRef}.`);
}
if (treeSha && manifest?.source?.treeSha !== treeSha) {
  fail(`stable update manifest treeSha ${manifest?.source?.treeSha || '(missing)'} does not match ${sourceRef}:archify ${treeSha}.`);
}

let archiveSha = null;
if (archivePath) {
  try {
    archiveSha = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(archivePath))).digest('hex');
  } catch {
    fail(`release archive is missing or unreadable: ${archivePath}.`);
  }
}
if (archiveSha && manifest?.artifact?.sha256 !== archiveSha) {
  fail(`stable update manifest archive sha256 ${manifest?.artifact?.sha256 || '(missing)'} does not match ${archiveSha}.`);
}

if (failures.length > 0) {
  for (const message of failures) console.error(`stable update manifest: ${message}`);
  process.exit(1);
}

console.log(`stable update manifest ok: ${tag} tree ${treeSha} archive ${archiveSha}`);
