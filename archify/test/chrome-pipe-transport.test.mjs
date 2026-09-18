import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { ChromeVisualBrowser } from '../bin/visual-check.mjs';

function chromeChild() {
  const child = new EventEmitter();
  child.pid = 7321;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new PassThrough();
  child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
  child.kill = (signal) => {
    child.signalCode = signal;
    queueMicrotask(() => {
      child.emit('exit', null, signal);
      child.emit('close', null, signal);
    });
    return true;
  };
  return child;
}

function browserFor(child) {
  return new ChromeVisualBrowser('/fake/chrome', {
    env: {},
    getuid: () => 1001,
    spawnImpl: () => child,
  });
}

test('Chrome first-command timeout reports the running process, pipe progress and stderr', async (t) => {
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    setTimeout(callback, delay === 15000 ? 5 : delay, ...args));
  const child = chromeChild();
  const browser = browserFor(child);
  child.stderr.write('Browser initialization is waiting for a service\n');
  try {
    await assert.rejects(browser.sessionPromise, (error) => {
      assert.match(error.message, /Target\.getTargets: timed out after 15000ms/);
      assert.match(error.message, /Chrome process: still running/);
      assert.match(error.message, /pid=7321/);
      assert.match(error.message, /Node v\d+.*libuv/);
      assert.match(error.message, /completedWrites=1/);
      assert.match(error.message, /receivedBytes=0/);
      assert.match(error.message, /Browser initialization is waiting for a service/);
      return true;
    });
  } finally {
    await browser.close();
  }
});

test('Chrome pipe EOF fails the pending first command without waiting for process close', async () => {
  const child = chromeChild();
  const browser = browserFor(child);
  try {
    const result = assert.rejects(browser.sessionPromise, /Chrome DevTools read pipe failed:.*ended/);
    child.stdio[4].end();
    await Promise.race([
      result,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('pipe EOF did not reject the pending command')), 100);
        timer.unref();
      }),
    ]);
  } finally {
    await browser.close();
  }
});
