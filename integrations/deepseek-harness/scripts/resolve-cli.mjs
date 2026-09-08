import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CMD_SHIMS = new Set(['npm', 'npx']);

export function resolveCli(command, platform = process.platform) {
  if (platform !== 'win32') return command;
  if (typeof command !== 'string' || command.length === 0) return command;
  if (/[\\/]/.test(command) || /^[A-Za-z]:/.test(command)) return command;
  if (/\.(?:cmd|bat|exe)$/i.test(command)) return command;
  if (CMD_SHIMS.has(command)) return `${command}.cmd`;
  return `${command}.exe`;
}

function nodeCliPath(command, {
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  existsSync = fs.existsSync,
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const script = `${command}-cli.js`;
  const candidates = [];
  const npmExecPath = env.npm_execpath;
  if (npmExecPath) {
    candidates.push(pathApi.join(pathApi.dirname(npmExecPath), script));
  }
  candidates.push(pathApi.join(pathApi.dirname(execPath), 'node_modules', 'npm', 'bin', script));
  const pathValue = env.PATH || env.Path || env.path || '';
  for (const entry of pathValue.split(pathApi.delimiter).filter(Boolean)) {
    candidates.push(pathApi.join(entry, 'node_modules', 'npm', 'bin', script));
  }
  return candidates.find((candidate) => existsSync(candidate));
}

export function resolveCliInvocation(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32' && command === 'pnpm') {
    const env = options.env || process.env;
    const existsSync = options.existsSync || fs.existsSync;
    const execPath = options.execPath || process.execPath;
    const roots = [path.win32.dirname(execPath), env.PNPM_HOME,
      ...(env.PATH || env.Path || env.path || '').split(';')].filter(Boolean);
    // action-setup and npm-global installs expose pnpm.cmd, which cannot be
    // spawned directly without a shell. Launch its JS entry with Node instead.
    const candidates = roots.flatMap((root) => [
      path.win32.join(root, '..', 'pnpm', 'bin', 'pnpm.cjs'),
      path.win32.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    ]);
    const cliPath = candidates.find((candidate) => existsSync(candidate));
    if (cliPath) return { command: execPath, args: [cliPath, ...args] };
    // Standalone pnpm distributions still provide a native pnpm.exe.
  }
  if (platform === 'win32' && command === 'tar') {
    const env = options.env || process.env;
    const existsSync = options.existsSync || fs.existsSync;
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR;
    const systemTar = systemRoot && path.win32.join(systemRoot, 'System32', 'tar.exe');
    if (systemTar && existsSync(systemTar)) return { command: systemTar, args };
  }
  if (platform === 'win32' && CMD_SHIMS.has(command)) {
    const cliPath = nodeCliPath(command, options);
    if (!cliPath) {
      throw new Error(`Cannot locate npm's ${command}-cli.js for a safe Windows launch`);
    }
    return { command: options.execPath || process.execPath, args: [cliPath, ...args] };
  }
  return { command: resolveCli(command, platform), args };
}

export function spawnCliSync(command, args, options) {
  const invocation = resolveCliInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, options);
}

export function spawnCli(command, args, options) {
  const invocation = resolveCliInvocation(command, args);
  return spawn(invocation.command, invocation.args, options);
}
