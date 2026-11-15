import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const name = 'archify-dsh-skill-probe';
export const inject = ['skills'];

export async function probeSkills(skills, cwd, expectedNames = ['archify'], {
  timeoutMs = 30_000,
  pollMs = 100,
  sleep = delay,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let list = [];
  do {
    list = await skills.list({ cwd });
    if (expectedNames.every((name) => list.some((skill) => skill.name === name))) break;
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  } while (true);
  const definitions = {};
  for (const name of expectedNames) {
    if (!list.some((skill) => skill.name === name)) continue;
    const definition = await skills.get(name, { cwd });
    if (!definition) continue;
    definitions[name] = {
      name: definition.name,
      provider: definition.provider,
      resourceBase: definition.resourceBase,
      path: definition.path,
      contentLength: definition.content?.length || 0,
      contentSha256: createHash('sha256').update(definition.content || '').digest('hex'),
    };
  }
  return {
    skills: list.map((skill) => ({
      name: skill.name,
      provider: skill.provider,
      resourceBase: skill.resourceBase,
      path: skill.path,
    })),
    definitions,
  };
}

export async function apply(ctx) {
  const out = process.env.ARCHIFY_DSH_PROBE_OUT;
  if (!out) throw new Error('ARCHIFY_DSH_PROBE_OUT is required for the test-only skill probe');
  const expectedNames = JSON.parse(process.env.ARCHIFY_DSH_PROBE_SKILLS || '["archify"]');
  const result = await probeSkills(ctx.skills, process.env.ARCHIFY_DSH_PROBE_CWD || process.cwd(), expectedNames);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  const exit = ctx.cmdlineArgs?.exit || ctx.appExit;
  if (typeof exit === 'function') exit(0);
}
