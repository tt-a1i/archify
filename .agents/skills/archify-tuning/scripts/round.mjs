#!/usr/bin/env node
// Usage: node round.mjs <project-path> [--types architecture,workflow,...] [--archify <archify-dir>] [--name <round>]
//
// Prepares <tuning-home>/rounds/<round>/<type>/ for one generation round,
// records the project and Archify revisions, and writes prompts.json: one
// {type, title, task} per diagram type, each to be run as its own subagent.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGRAM_TYPES, TYPE_NAMES_ZH, tuningHome } from './lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const here = path.dirname(fileURLToPath(import.meta.url));
const project = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const archify = path.resolve(option('--archify', path.join(here, '../../../../archify')));
const types = (option('--types', DIAGRAM_TYPES.join(','))).split(',').map((type) => type.trim()).filter(Boolean);
const git = (cwd, ...command) => execFileSync('git', ['-C', cwd, ...command], { encoding: 'utf8' }).trim();
if (!project || !fs.existsSync(path.join(archify, 'bin/archify.mjs')) || types.some((type) => !DIAGRAM_TYPES.includes(type))) {
  console.error(`Usage: node round.mjs <project-path> [--types ${DIAGRAM_TYPES.join(',')}] [--archify <archify-dir>] [--name <round>]`);
  process.exit(2);
}

const rounds = path.join(tuningHome(), 'rounds');
fs.mkdirSync(rounds, { recursive: true });
const next = 1 + Math.max(0, ...fs.readdirSync(rounds).map((name) => Number((name.match(/^r(\d+)-/) || [])[1]) || 0));
const name = option('--name', `r${String(next).padStart(2, '0')}-${path.basename(project)}`);
const root = path.join(rounds, name);
if (fs.existsSync(root)) {
  console.error(`Round ${root} already exists; choose another --name.`);
  process.exit(2);
}

const dirty = git(project, 'status', '--porcelain').split('\n').filter(Boolean).map((line) => line.slice(3));
const archifyDirty = git(archify, 'status', '--porcelain', '--', '.').split('\n').filter(Boolean);
const record = {
  name,
  created: new Date().toISOString(),
  project: { path: project, revision: git(project, 'rev-parse', 'HEAD'), origin: (() => { try { return git(project, 'remote', 'get-url', 'origin'); } catch { return null; } })(), dirty },
  archify: { path: archify, revision: git(archify, 'rev-parse', 'HEAD'), dirty: archifyDirty },
  types,
};
const ignore = dirty.length
  ? `ignore its pre-existing uncommitted files (${dirty.join(', ')}) and do not cite them`
  : 'it has no uncommitted files';
const prompts = types.map((type) => {
  const workdir = path.join(root, type);
  fs.mkdirSync(workdir, { recursive: true });
  return {
    type,
    title: `${name} ${TYPE_NAMES_ZH[type]}`,
    task: `画 ${project} 这个项目的${TYPE_NAMES_ZH[type]}。

Use the Archify skill located at ${archify} (read ${archify}/SKILL.md first and follow it exactly, including the references it tells you to read). Do NOT install, update, or copy Archify anywhere; use the CLI directly as \`node ${archify}/bin/archify.mjs ...\`.

Constraints:
- Your working directory for all Archify commands and outputs is ${workdir} (cd there; the skill's \`.archify/<type>-<slug>-<timestamp>/\` folder must be created under it, not inside the project).
- ${project} is read-only source evidence. Do not create, modify, or delete any file in it (${ignore}). Pass it as \`--repo-root\` where the skill requires.
- Do not modify anything under ${archify}.
- Follow the skill's repair loop until finalize passes or the skill tells you to stop.

When done, reply concisely with: diagram type, absolute path of the final candidate JSON and final HTML, whether finalize passed (key status lines), and every repair iteration (diagnostic code + what you changed). Also list any point where the skill docs or CLI messages were unclear, contradictory, or sent you the wrong way.`,
  };
});
fs.writeFileSync(path.join(root, 'round.json'), `${JSON.stringify(record, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'prompts.json'), `${JSON.stringify(prompts, null, 2)}\n`);
console.log(`round ${name}: ${types.length} prompts in ${path.join(root, 'prompts.json')}`);
if (archifyDirty.length) console.log(`warning: ${archify} has uncommitted changes; commit them or the round will not be reproducible.`);
console.log('Run each prompt as its own background subagent, and do not edit the Archify tree until every subagent has finished.');
