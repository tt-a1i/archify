#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL_COMMAND = 'npx -y skills add tt-a1i/archify --skill archify --global --copy --yes';
const args = process.argv.slice(2);
const wantsJson = args.includes('--json');
const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const home = process.env.HOME || process.env.USERPROFILE || os.homedir();

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function siblingCandidates() {
  return [path.resolve(skillRoot, '..', 'archify', 'bin', 'archify.mjs')];
}

function globalCandidates() {
  return [
    path.join(home, '.agents', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.codex', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.claude', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.cursor', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.config', 'devin', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.gemini', 'config', 'skills', 'archify', 'bin', 'archify.mjs'),
    path.join(home, '.gemini', 'antigravity', 'skills', 'archify', 'bin', 'archify.mjs'),
  ];
}

function resolveCore() {
  const explicit = process.env.ARCHIFY_BIN;
  if (explicit && explicit.trim()) {
    const resolved = path.resolve(explicit);
    if (!isFile(resolved)) {
      return {
        error: `ARCHIFY_BIN points to a missing archify CLI: ${resolved}`,
        searched: [resolved],
      };
    }
    return { core: resolved, searched: [resolved] };
  }
  const searched = [...siblingCandidates(), ...globalCandidates()];
  const core = searched.find(isFile);
  return core ? { core, searched } : { error: null, searched };
}

function missingCore({ error, searched }) {
  const message = error
    ? `${error}. Install the archify core Skill or point ARCHIFY_BIN at its bin/archify.mjs.`
    : 'The archify core Skill was not found. Install it or point ARCHIFY_BIN at its bin/archify.mjs.';
  const supportedFixes = [
    `install the core Skill: ${INSTALL_COMMAND}`,
    'set ARCHIFY_BIN to the absolute path of archify/bin/archify.mjs, then rerun',
  ];
  if (wantsJson) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      ok: false,
      command: 'archify-pr',
      diagnostics: [{
        code: 'archify-pr/core-skill-missing',
        severity: 'error',
        message,
        evidence: { searched },
        supportedFixes,
      }],
    }, null, 2));
  } else {
    console.error([
      `archify-pr: ${message}`,
      '',
      'Install the core Skill:',
      `  ${INSTALL_COMMAND}`,
      '',
      'Or point at an existing checkout or installation:',
      '  ARCHIFY_BIN=/absolute/path/to/archify/bin/archify.mjs archify-pr <command>',
    ].join('\n'));
  }
  process.exitCode = 1;
}

const resolved = resolveCore();
if (!resolved.core) {
  missingCore(resolved);
} else {
  const result = spawnSync(process.execPath, [resolved.core, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(`archify-pr: could not start ${resolved.core}: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
