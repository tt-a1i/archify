import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openArtifact, openLoopbackUrl } from '../bin/open-artifact.mjs';

const target = path.resolve("/tmp/-复杂 path 'quoted'/diagram.html");

test('open artifact: uses argument arrays without shell interpolation on every supported platform', () => {
  const cases = [
    {
      platform: 'darwin',
      command: 'open',
      args: [target],
      method: 'open',
    },
    {
      platform: 'linux',
      command: 'xdg-open',
      args: [target],
      method: 'xdg-open',
    },
    {
      platform: 'win32',
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -FilePath $env:ARCHIFY_OPEN_TARGET',
      ],
      method: 'powershell',
    },
  ];

  for (const expected of cases) {
    let invocation;
    const result = openArtifact(target, {
      platform: expected.platform,
      spawn(command, args, options) {
        invocation = { command, args, options };
        return { status: 0 };
      },
    });

    assert.deepEqual(result, {
      requested: true,
      status: 'opened',
      target,
      method: expected.method,
    });
    assert.equal(invocation.command, expected.command);
    assert.deepEqual(invocation.args, expected.args);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.timeout, expected.platform === 'win32' ? 15000 : 5000);
    if (expected.platform === 'win32') {
      assert.equal(invocation.options.env.ARCHIFY_OPEN_TARGET, target);
    } else {
      assert.equal(invocation.options.env, undefined);
    }
  }
});

test('open artifact: Windows PowerShell launches a real target', { skip: process.platform !== 'win32' }, () => {
  // Use a bundled console executable so this exercises PowerShell without a browser.
  // CI runners can cold-start PowerShell well beyond the 5s production default.
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const target = path.join(systemRoot, 'System32', 'where.exe');
  const result = openArtifact(target, { timeoutMs: 60_000 });

  assert.deepEqual(result, {
    requested: true,
    status: 'opened',
    target: path.resolve(target),
    method: 'powershell',
  });
});

test('open artifact: normalizes missing opener and timeout failures', () => {
  const missing = openArtifact(target, {
    platform: 'linux',
    spawn() {
      return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) };
    },
  });
  assert.deepEqual(missing, {
    requested: true,
    status: 'unsupported',
    target,
    method: 'xdg-open',
    failure: {
      code: 'opener/unavailable',
      reason: 'Could not find xdg-open. Install or enable the platform opener, then open the target manually.',
      systemCode: 'ENOENT',
    },
  });

  const timedOut = openArtifact(target, {
    platform: 'win32',
    timeoutMs: 1234,
    spawn(command, args, options) {
      assert.equal(options.timeout, 1234);
      return { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
    },
  });
  assert.deepEqual(timedOut, {
    requested: true,
    status: 'failed',
    target,
    method: 'powershell',
    failure: {
      code: 'opener/timeout',
      reason: 'powershell.exe did not finish within 1234ms. Open the target manually or retry when the system is less busy.',
      systemCode: 'ETIMEDOUT',
      timeoutMs: 1234,
    },
  });
});

test('open artifact: invalid timeout overrides retain the bounded platform default', () => {
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1000']) {
    let observedTimeout;
    const result = openArtifact(target, {
      platform: 'win32',
      timeoutMs,
      spawn(command, args, options) {
        observedTimeout = options.timeout;
        return { status: 0 };
      },
    });
    assert.equal(result.status, 'opened');
    assert.equal(observedTimeout, 15000, String(timeoutMs));
  }
});

test('open artifact: normalizes nonzero exits, signals, and thrown spawn errors', () => {
  const nonzero = openArtifact(target, {
    platform: 'darwin',
    spawn() {
      return { status: 7 };
    },
  });
  assert.deepEqual(nonzero.failure, {
    code: 'opener/nonzero-exit',
    reason: 'open exited with status 7. Open the target manually.',
    exitCode: 7,
  });

  const signaled = openArtifact(target, {
    platform: 'linux',
    spawn() {
      return { status: null, signal: 'SIGTERM' };
    },
  });
  assert.deepEqual(signaled.failure, {
    code: 'opener/signaled',
    reason: 'xdg-open was terminated by SIGTERM. Open the target manually.',
    signal: 'SIGTERM',
  });

  const denied = openArtifact(target, {
    platform: 'linux',
    spawn() {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
  });
  assert.deepEqual(denied.failure, {
    code: 'opener/spawn-failed',
    reason: 'permission denied',
    systemCode: 'EACCES',
  });
  for (const result of [nonzero, signaled, denied]) {
    assert.equal(result.status, 'failed');
  }
});

test('open artifact: unsupported platforms retain the public result shape', () => {
  const unknown = openArtifact(target, { platform: 'plan9' });

  assert.deepEqual(unknown, {
    requested: true,
    status: 'unsupported',
    target,
    method: null,
  });
});

test('open artifact: live preview opens only an exact loopback HTTP root', () => {
  const url = 'http://127.0.0.1:43127/';
  let invocation;
  const result = openLoopbackUrl(url, {
    platform: 'darwin',
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0 };
    },
  });

  assert.deepEqual(result, {
    requested: true,
    status: 'opened',
    target: url,
    method: 'open',
  });
  assert.deepEqual(invocation.args, [url]);
  assert.equal(invocation.options.shell, false);

  let windowsInvocation;
  const windowsResult = openLoopbackUrl(url, {
    platform: 'win32',
    spawn(command, args, options) {
      windowsInvocation = { command, args, options };
      return { status: 0 };
    },
  });
  assert.deepEqual(windowsResult, {
    requested: true,
    status: 'opened',
    target: url,
    method: 'powershell',
  });
  assert.deepEqual(windowsInvocation.args, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Start-Process -FilePath $env:ARCHIFY_OPEN_TARGET',
  ]);
  assert.equal(windowsInvocation.options.env.ARCHIFY_OPEN_TARGET, url);

  for (const rejected of [
    'https://127.0.0.1:43127/',
    'http://localhost:43127/',
    'http://0.0.0.0:43127/',
    'http://127.0.0.1:43127/path',
    'http://127.0.0.1:43127/?source=secret',
    'not a url',
  ]) {
    assert.throws(() => openLoopbackUrl(rejected), /loopback|valid/i, rejected);
  }
});
