import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageCleanCompanionSkill } from '../../scripts/stage-clean-companion-skill.mjs';
import { stageCleanSkill } from '../../scripts/stage-clean-skill.mjs';

const SKILLS = Object.freeze([
  {
    name: 'archify',
    description: 'Create validated interactive diagrams and one-page explainers with your AI agent.',
    stage(repo, destination, modeManifest) {
      stageCleanSkill({ repoRoot: repo, destination, modeManifest });
    },
  },
  {
    name: 'archify-pr',
    description: 'Offer and attach pull-request change walkthroughs for material diffs. Requires the archify core Skill.',
    stage(repo, destination, modeManifest) {
      stageCleanCompanionSkill({ repoRoot: repo, destination, modeManifest });
    },
  },
]);

function writeSkillArchive(repo, scratch, skill) {
  const tree = path.join(scratch, skill.name);
  const modes = path.join(scratch, `${skill.name}.modes.json`);
  skill.stage(repo, tree, modes);
  const archive = path.join(scratch, `${skill.name}.zip`);
  execFileSync(process.execPath, [path.join(repo, 'scripts/write-deterministic-zip.mjs'),
    tree, archive, '--mode-manifest', modes, '--contents-only'], { stdio: 'pipe' });
  const bytes = fs.readFileSync(archive);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { name: skill.name, description: skill.description, bytes, hash };
}

// Reuse the ZIP/DSH file selection and manifest cleanup. The discovery protocol
// needs SKILL.md at the archive root; the existing archify.zip keeps its wrapper.
export function stageSkillDistribution(repo, target) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-distribution-'));
  try {
    const packaged = SKILLS.map((skill) => writeSkillArchive(repo, scratch, skill));
    const directory = path.join(target, '.well-known/agent-skills');
    if (fs.existsSync(directory)) throw new Error('Public assets collide with generated Skill distribution');
    fs.mkdirSync(directory, { recursive: true });
    const index = {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: packaged.map((entry) => {
        const filename = `${entry.name}.${entry.hash}.zip`;
        fs.writeFileSync(path.join(directory, filename), entry.bytes);
        return {
          name: entry.name,
          description: entry.description,
          type: 'archive',
          url: `./${filename}`,
          digest: `sha256:${entry.hash}`,
        };
      }),
    };
    fs.writeFileSync(path.join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
