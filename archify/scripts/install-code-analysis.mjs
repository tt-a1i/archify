import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The development workspace installs this module alongside the renderer.
const workspaceInstall = process.env.npm_config_user_agent?.startsWith('pnpm/')
  && existsSync(new URL('../../pnpm-workspace.yaml', import.meta.url));
if (!workspaceInstall) {
  execSync('npm ci --prefix modules/code-analysis --no-audit --no-fund', { stdio: 'inherit' });
}
