import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem';

export const name = 'archify-dsh';
export const inject = ['skills'];
export const PACKAGE_NAME = '@tt-a1i/archify-dsh';
export const Config = skillFilesystem.Config;

// Keep the Cordis patch owned by this package while delegating only to DSH's
// documented filesystem Skill provider. This makes the runtime surface
// explicit without patching or shadowing an official DSH package.
export function apply(ctx, config = {}) {
  return skillFilesystem.apply(ctx, config);
}

export function resolveArchifySkillRoot(profileBaseUrl) {
  if (!profileBaseUrl) {
    throw new Error('archify-dsh: missing DSH profile baseUrl for package resolution');
  }
  let manifestPath;
  try {
    manifestPath = createRequire(profileBaseUrl).resolve(`${PACKAGE_NAME}/package.json`);
  } catch (error) {
    throw new Error(
      `archify-dsh: cannot resolve ${PACKAGE_NAME}/package.json from the DSH profile`,
      { cause: error },
    );
  }
  return join(dirname(manifestPath), '.dsh-bundled-skills');
}
