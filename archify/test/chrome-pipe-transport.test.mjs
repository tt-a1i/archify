import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

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

function answerCommands(child, answer = () => ({})) {
  child.stdio[3].on('data', (chunk) => {
    for (const raw of String(chunk).split('\0').filter(Boolean)) {
      const command = JSON.parse(raw);
      const result = answer(command);
      if (result === undefined) continue;
      queueMicrotask(() => child.stdio[4].write(JSON.stringify({ id: command.id, result }) + '\0'));
    }
  });
}

function fastCommandTimeout(t) {
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    setTimeout(callback, delay === 15000 ? 5 : delay, ...args));
}

test('Chrome replaces a silent first-handshake process once before any navigation', async (t) => {
  fastCommandTimeout(t);
  const children = [];
  const profiles = [];
  const commands = [];
  const browser = new ChromeVisualBrowser('/fake/chrome', {
    spawnImpl: (_command, args) => {
      if (children.length) {
        assert.equal(children[0].signalCode, 'SIGTERM', 'old Chrome must be stopped first');
        assert.equal(fs.existsSync(profiles[0]), false, 'old profile must be released first');
      }
      const child = chromeChild();
      children.push(child);
      profiles.push(args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length));
      if (children.length === 2) answerCommands(child, ({ method }) => {
        commands.push(method);
        if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'page' }] };
        if (method === 'Target.attachToTarget') return { sessionId: 'ready' };
        return {};
      });
      return child;
    },
  });
  try {
    assert.equal(await browser.sessionPromise, 'ready');
    assert.equal(children.length, 2);
    assert.notEqual(profiles[0], profiles[1]);
    assert.deepEqual(commands, ['Target.getTargets', 'Target.attachToTarget', 'Page.enable', 'Runtime.enable']);
    assert.equal(browser.child, children[1]);
  } finally {
    await browser.close();
  }
  assert.ok(profiles.every(profile => !fs.existsSync(profile)));
});

test('Chrome first-command timeout reports the running process, pipe progress and stderr', async (t) => {
  fastCommandTimeout(t);
  let attempts = 0;
  const browser = new ChromeVisualBrowser('/fake/chrome', {
    spawnImpl: () => {
      attempts += 1;
      const child = chromeChild();
      queueMicrotask(() => child.stderr.write(`Browser initialization is waiting for a service: attempt ${attempts}\n`));
      return child;
    },
  });
  try {
    await assert.rejects(browser.sessionPromise, (error) => {
      assert.match(error.message, /Chrome startup failed after one retry/);
      assert.match(error.message, /Target\.getTargets: timed out after 15000ms/);
      assert.match(error.message, /Chrome process: still running/);
      assert.match(error.message, /pid=7321/);
      assert.match(error.message, /Node v\d+.*libuv/);
      assert.match(error.message, /completedWrites=1/);
      assert.match(error.message, /receivedBytes=0/);
      assert.match(error.message, /Browser initialization is waiting for a service/);
      assert.match(error.message, /service: attempt 1/);
      assert.match(error.message, /service: attempt 2/);
      return true;
    });
    assert.equal(attempts, 2, 'persistent startup failure must stop after two processes');
  } finally {
    await browser.close();
  }
});

test('Chrome does not restart after partial protocol input or a later command timeout', async (t) => {
  fastCommandTimeout(t);
  for (const scenario of ['partial input', 'later command']) {
    let attempts = 0;
    const browser = new ChromeVisualBrowser('/fake/chrome', {
      spawnImpl: () => {
        attempts += 1;
        const child = chromeChild();
        if (scenario === 'partial input') queueMicrotask(() => child.stdio[4].write('{'));
        else answerCommands(child, ({ method }) => method === 'Target.getTargets'
          ? { targetInfos: [{ type: 'page', targetId: 'page' }] } : undefined);
        return child;
      },
    });
    try {
      await assert.rejects(browser.sessionPromise, /timed out/);
      assert.equal(attempts, 1, scenario);
    } finally {
      await browser.close();
    }
  }
});

test('closing Chrome during startup cleanup prevents a replacement process', async (t) => {
  fastCommandTimeout(t);
  let stopped;
  const stopping = new Promise(resolve => { stopped = resolve; });
  let attempts = 0;
  const child = chromeChild();
  child.kill = () => { stopped(); return true; };
  const browser = new ChromeVisualBrowser('/fake/chrome', {
    spawnImpl: () => { attempts += 1; return child; },
  });
  const rejected = assert.rejects(browser.sessionPromise, /Target.getTargets: timed out/);
  await stopping;
  const closing = browser.close();
  child.exitCode = 0;
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  await closing;
  await rejected;
  assert.equal(attempts, 1);
});

test('Chrome cleanup releases inherited pipes after the browser process exits', async (t) => {
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    setTimeout(callback, delay === 1500 ? 5 : delay, ...args));
  const child = chromeChild();
  answerCommands(child, ({ method }) => method === 'Target.getTargets'
    ? { targetInfos: [{ type: 'page', targetId: 'page' }] } : {});
  child.kill = signal => {
    child.signalCode = signal;
    // Renderer/recording descendants can retain inherited pipe handles after
    // Chrome exits. Node's close event waits for those handles, not just exit.
    queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };
  const browser = browserFor(child);
  await browser.sessionPromise;
  await browser.close();
  assert.ok(child.stdio.filter(Boolean).every(stream => stream.destroyed));
  assert.equal(fs.existsSync(browser.profileRoot), false);
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

test('Chrome startup recovery reaches a real browser after retiring a silent subprocess', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async (t) => {
  let attempts = 0;
  let silent;
  const profiles = [];
  const setTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    setTimeout(callback, attempts === 1 && delay === 15000 ? 30 : delay, ...args));
  const browser = new ChromeVisualBrowser(chromePath, {
    spawnImpl: (command, args, options) => {
      attempts += 1;
      profiles.push(args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length));
      if (attempts === 1) {
        // Own a real child with the same inherited pipes, but never answer CDP.
        silent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
        return silent;
      }
      assert.ok(silent.exitCode !== null || silent.signalCode !== null);
      return spawn(command, args, options);
    },
  });
  try {
    const session = await browser.sessionPromise;
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: 'about:blank' }, session);
    await loaded;
    const result = await browser.cdp.send('Runtime.evaluate', {
      expression: 'document.readyState', returnByValue: true,
    }, session);
    assert.equal(result.result.value, 'complete');
    assert.equal(attempts, 2);
  } finally {
    await browser.close();
  }
  assert.ok(profiles.every(profile => !fs.existsSync(profile)));
});
