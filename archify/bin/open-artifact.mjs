import { spawnSync } from 'node:child_process';
import path from 'node:path';

const OPENERS = {
  darwin: {
    command: 'open',
    method: 'open',
    args: (target) => [target],
  },
  linux: {
    command: 'xdg-open',
    method: 'xdg-open',
    args: (target) => [target],
  },
  win32: {
    command: 'powershell.exe',
    method: 'powershell',
    // Keep the command constant and pass the target through PowerShell's
    // argument array. Paths are never interpolated into executable source.
    args: (target) => [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Process -FilePath $args[0]',
      target,
    ],
  },
};

export function openArtifact(target, options = {}) {
  const absoluteTarget = path.resolve(target);
  const platform = options.platform || process.platform;
  const opener = OPENERS[platform];
  if (!opener) {
    return {
      requested: true,
      status: 'unsupported',
      target: absoluteTarget,
      method: null,
    };
  }

  const spawn = options.spawn || spawnSync;
  let result;
  try {
    result = spawn(opener.command, opener.args(absoluteTarget), {
      encoding: 'utf8',
      shell: false,
      stdio: 'ignore',
      timeout: options.timeoutMs || 5000,
      windowsHide: true,
    });
  } catch {
    result = { error: new Error('opener threw') };
  }

  let status = 'opened';
  if (result?.error?.code === 'ENOENT') status = 'unsupported';
  else if (result?.error || result?.signal || result?.status !== 0) status = 'failed';

  return {
    requested: true,
    status,
    target: absoluteTarget,
    method: opener.method,
  };
}
