import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { startPreview } from '../bin/preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function windowsShortPath(targetPath) {
  if (process.platform !== 'win32') return null;
  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', '"for %I in ("%ARCHIFY_SHORT_PATH_TARGET%") do @echo %~sI"'],
    {
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_SHORT_PATH_TARGET: targetPath },
      windowsHide: true,
      // cmd.exe does not understand the CRT-style backslash escaping that
      // Node otherwise applies to argv containing quotes.
      windowsVerbatimArguments: true,
    },
  );
  if (result.error) throw new Error(`Could not query a Windows 8.3 path: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || 'no stderr';
    throw new Error(`Could not query a Windows 8.3 path (exit ${result.status}): ${detail}`);
  }
  const shortPath = result.stdout.trim();
  if (!shortPath) throw new Error('Windows returned an empty 8.3 path');
  if (path.resolve(shortPath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return null;
  if (fs.realpathSync.native(shortPath).toLowerCase() !== fs.realpathSync.native(targetPath).toLowerCase()) {
    throw new Error('Windows returned an 8.3 path for a different directory');
  }
  return shortPath;
}

function assignWindowsShortName(targetPath, shortName) {
  const result = spawnSync(
    'fsutil.exe',
    ['file', 'setshortname', targetPath, shortName],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) {
    throw new Error(`Could not assign Windows 8.3 name ${shortName}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no command output';
    throw new Error(`Could not assign Windows 8.3 name ${shortName} (exit ${result.status}): ${detail}`);
  }
  const alias = path.join(path.dirname(targetPath), shortName);
  const aliasStat = fs.statSync(alias, { bigint: true });
  const targetStat = fs.statSync(targetPath, { bigint: true });
  assert.deepEqual(
    [aliasStat.dev, aliasStat.ino],
    [targetStat.dev, targetStat.ino],
    'the explicitly assigned 8.3 name must resolve to the requested entry',
  );
  return alias;
}

function controlledWindowsShortRoot(required) {
  const root = process.env.ARCHIFY_WINDOWS_8DOT3_ROOT;
  const shortRoot = process.env.ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT;
  if (!root && !shortRoot) {
    if (required) {
      assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires the controlled long and short roots');
    }
    return null;
  }
  assert.ok(root && shortRoot, 'the controlled Windows 8.3 roots must be configured together');
  assert.match(
    path.win32.basename(shortRoot),
    /~/u,
    'the controlled short root must use an explicit 8.3 alias',
  );
  assert.equal(
    fs.realpathSync.native(root).toLowerCase(),
    fs.realpathSync.native(shortRoot).toLowerCase(),
    'the controlled long and short roots must identify the same directory',
  );
  return { root, shortRoot };
}

async function stateAt(url) {
  const response = await fetch(new URL('/state', url));
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForState(url, predicate, message, timeoutMs = 12000) {
  const started = Date.now();
  const requestedDeadline = started + timeoutMs;
  // A real delivery can spend several seconds in the renderer while other
  // preview/visual-check tests are running. Once the state endpoint confirms
  // that the requested generation is actively checking, keep waiting up to a
  // bounded adaptive deadline instead of failing on a fixed caller-side
  // timeout. An explicit timeout longer than the adaptive window is preserved.
  // The transition trace makes a genuine stalled build distinguishable from a
  // slow one when the bounded wait expires.
  const hardWaitMs = Math.max(timeoutMs, 20000);
  const hardDeadline = started + hardWaitMs;
  let deadline = Math.min(requestedDeadline, hardDeadline);
  let latest;
  const transitions = [];
  let previousMarker;
  while (Date.now() < hardDeadline) {
    latest = await stateAt(url);
    const marker = `${latest.status}/generation-${latest.generation}/revision-${latest.revision}`;
    if (marker !== previousMarker) {
      transitions.push(`${Date.now() - started}ms ${marker}`);
      previousMarker = marker;
    }
    if (predicate(latest)) return latest;
    if (Date.now() >= deadline && latest.status === 'checking' && latest.generation > 0) {
      deadline = hardDeadline;
    } else if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(
    `${message}; waited ${Date.now() - started}ms; transitions: ${transitions.join(' -> ') || 'none'}; latest state: ${JSON.stringify(latest)}`,
  );
}

function rawRequest(url, { method = 'GET', pathname = '/', hostHeader } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      method,
      path: pathname,
      headers: hostHeader ? { Host: hostHeader } : undefined,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function waitForPath(target, message, timeoutMs = 3000) {
  const started = Date.now();
  while (!fs.existsSync(target) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(fs.existsSync(target), message);
}

function writeDelayedDeliveryCli(deliveryCli, marker, title) {
  fs.writeFileSync(deliveryCli, `
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [, , , output] = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(marker)}, 'ready');
await new Promise((resolve) => setTimeout(resolve, 220));
const artifact = Buffer.from(${JSON.stringify(`<!doctype html><title>${title}</title><svg></svg>`)});
fs.writeFileSync(output, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
  validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass' }
}));
`);
}

test('preview: rejects destructive or unsupported startup targets before watching', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-startup-'));
  const input = path.join(tmp, 'diagram.json');
  fs.writeFileSync(input, '{}');
  await assert.rejects(
    startPreview({ type: 'architecture', input, output: input, open: false }),
    /must not replace its JSON input/i,
  );
  await assert.rejects(
    startPreview({ type: 'mindmap', input, output: path.join(tmp, 'out.html'), open: false }),
    /Unknown diagram type/i,
  );
  await assert.rejects(
    startPreview({ type: 'architecture', input, output: path.join(tmp, 'out.html'), quality: 'pretty', open: false }),
    /Unknown quality profile/i,
  );

  const realDirectory = path.join(tmp, 'real');
  const linkedDirectory = path.join(tmp, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  await assert.rejects(
    startPreview({
      type: 'architecture',
      input: path.join(realDirectory, 'future.json'),
      output: path.join(linkedDirectory, 'future.json'),
      open: false,
    }),
    /must not replace its JSON input/i,
  );
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('preview: invalid candidates preserve the last verified artifact and repair automatically', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-last-good-'));
  const input = path.join(tmp, 'diagram.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Last Good One';
  fs.writeFileSync(input, JSON.stringify(source));

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    quality: 'showcase',
    open: false,
    debounceMs: 60,
    pollMs: 80,
  });

  try {
    const first = await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'first revision did not verify');
    assert.equal(first.generation, 1);
    assert.equal(first.lastVerified.sha256, sha256(output));
    const firstSha = sha256(output);
    const firstArtifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(firstArtifact, /Last Good One/);

    fs.rmSync(input);
    const missing = await waitForState(preview.url, (state) => state.status === 'needs-fix' && state.generation === 2, 'deleted source did not report failure');
    assert.equal(missing.failure.stage, 'input');
    assert.equal(missing.revision, 1);
    assert.equal(sha256(output), firstSha, 'deleted input replaced the last verified output');

    fs.writeFileSync(input, '{"meta":');
    const failed = await waitForState(preview.url, (state) => state.status === 'needs-fix' && state.generation === 3, 'invalid source did not report failure');
    assert.equal(failed.revision, 1);
    assert.equal(failed.failure.stage, 'input');
    assert.match(failed.failure.message, /Could not read delivery input/);
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(sha256(output), firstSha, 'invalid input replaced the last verified output');
    assert.equal(await (await fetch(new URL('/artifact.html', preview.url))).text(), firstArtifact);

    source.components[0].unexpected = true;
    fs.writeFileSync(input, JSON.stringify(source));
    const schemaFailed = await waitForState(preview.url, (state) => state.status === 'needs-fix' && state.generation === 4, 'schema failure did not report render stage');
    assert.equal(schemaFailed.failure.stage, 'render');
    assert.match(schemaFailed.failure.message, /\/components\/0.*additional properties/i);
    assert.doesNotMatch(schemaFailed.failure.message, /file:\/\/|\/Users\/|node:internal/);
    assert.equal(sha256(output), firstSha, 'schema failure replaced the last verified output');

    delete source.components[0].unexpected;
    source.meta.title = 'Verified Repair';
    source.components[0].label = 'Repaired Browser';
    fs.writeFileSync(input, JSON.stringify(source));
    const repaired = await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 2, 'repaired source did not publish');
    assert.equal(repaired.generation, 5);
    assert.notEqual(repaired.lastVerified.sha256, firstSha);
    const repairedArtifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(repairedArtifact, /Verified Repair/);
    assert.match(repairedArtifact, /Repaired Browser/);
    assert.equal(repaired.lastVerified.sha256, sha256(output));

    const page = await rawRequest(preview.url);
    assert.equal(page.status, 200);
    assert.match(page.body, /Archify Live Preview/);
    assert.match(page.body, /<summary role="button" aria-controls="diagnostic-panel">View diagnostic<\/summary>/);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    const script = page.body.match(/<script>\n([\s\S]*?)\n  <\/script>/)?.[1];
    assert.ok(script, 'preview shell script missing');
    assert.doesNotThrow(() => new vm.Script(script));
    assert.equal((await rawRequest(preview.url, { method: 'POST' })).status, 405);
    assert.equal((await rawRequest(preview.url, { pathname: '/../../etc/passwd' })).status, 404);
    assert.equal((await rawRequest(preview.url, { hostHeader: 'example.com' })).status, 403);
  } finally {
    await preview.stop();
  }

  await assert.rejects(fetch(preview.url));
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('preview: content digests suppress identical writes and a burst publishes only its stable tail', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-burst-'));
  const input = path.join(tmp, 'diagram.workflow.json');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  const original = JSON.stringify(source);
  fs.writeFileSync(input, original);
  const preview = await startPreview({
    type: 'workflow',
    input,
    output,
    open: false,
    debounceMs: 90,
    pollMs: 70,
  });

  try {
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'initial workflow did not verify');
    fs.writeFileSync(input, original);
    await new Promise((resolve) => setTimeout(resolve, 350));
    let state = await stateAt(preview.url);
    assert.equal(state.generation, 1);
    assert.equal(state.revision, 1);

    fs.writeFileSync(input, JSON.stringify(source, null, 2));
    state = await waitForState(preview.url, (candidate) => candidate.status === 'verified' && candidate.generation === 2, 'semantically identical source did not settle');
    assert.equal(state.revision, 1, 'identical artifact bytes triggered a browser revision');

    for (let index = 0; index < 8; index += 1) {
      source.meta.title = `Burst ${index}`;
      fs.writeFileSync(input, JSON.stringify(source));
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    source.meta.title = 'Stable Tail';
    fs.writeFileSync(input, JSON.stringify(source));

    state = await waitForState(preview.url, (candidate) => candidate.status === 'verified' && candidate.revision === 2, 'stable burst tail did not verify');
    assert.equal(state.generation, 3);
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Stable Tail/);
    assert.doesNotMatch(artifact, /Burst 7/);
  } finally {
    await preview.stop();
  }
});

test('preview: a superseded slow candidate can never become a published revision', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-latest-wins-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'fake-delivery.mjs');
  fs.writeFileSync(deliveryCli, `
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [, , input, output] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
await new Promise((resolve) => setTimeout(resolve, source.title === 'Slow Old' ? 550 : 40));
const artifact = Buffer.from('<!doctype html><title>' + source.title + '</title><svg></svg>');
fs.writeFileSync(output, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
  validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass' }
}));
`);
  fs.writeFileSync(input, JSON.stringify({ title: 'Slow Old' }));

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 25,
    pollMs: 40,
    deliveryCli,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'checking' && state.generation === 1, 'slow generation did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(input, JSON.stringify({ title: 'Fast New' }));
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified' && candidate.generation === 2, 'latest generation did not publish');
    assert.equal(state.revision, 1, 'superseded generation was published before the latest one');
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Fast New/);
    assert.doesNotMatch(artifact, /Slow Old/);
    assert.equal(fs.readFileSync(output, 'utf8'), artifact);
  } finally {
    await preview.stop();
  }
});

test('preview: each delivery reads the immutable bytes bound to its observed digest', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-snapshot-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'snapshot-delivery.mjs');
  const readMarker = path.join(tmp, 'delivery-read.txt');
  fs.writeFileSync(deliveryCli, `
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [, , input, output] = process.argv.slice(2);
await new Promise((resolve) => setTimeout(resolve, 120));
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
fs.writeFileSync(${JSON.stringify(readMarker)}, source.title);
await new Promise((resolve) => setTimeout(resolve, 180));
const artifact = Buffer.from('<!doctype html><title>' + source.title + '</title><svg></svg>');
fs.writeFileSync(output, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
  validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass' }
}));
`);
  fs.writeFileSync(input, JSON.stringify({ title: 'Source A' }));

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 10,
    pollMs: 5000,
    watch: false,
    deliveryCli,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'checking' && state.generation === 1, 'snapshot generation did not start');
    fs.writeFileSync(input, JSON.stringify({ title: 'Source B' }));
    const markerStarted = Date.now();
    while (!fs.existsSync(readMarker) && Date.now() - markerStarted < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fs.existsSync(readMarker), 'fake delivery never read its generation input');
    fs.writeFileSync(input, JSON.stringify({ title: 'Source A' }));

    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified' && candidate.revision === 1, 'snapshot generation did not verify');
    assert.equal(state.generation, 1, 'an unobserved A → B → A edit started a second generation');
    assert.equal(fs.readFileSync(readMarker, 'utf8'), 'Source A');
    assert.match(fs.readFileSync(output, 'utf8'), /Source A/);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /Source B/);
  } finally {
    await preview.stop();
  }
});

test('preview: commit rechecks the live digest when watcher and poll have not seen a newer save', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-commit-race-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'commit-race-delivery.mjs');
  fs.writeFileSync(deliveryCli, `
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [, , input, output] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
await new Promise((resolve) => setTimeout(resolve, source.title === 'Prior Good' ? 30 : 260));
const artifact = Buffer.from('<!doctype html><title>' + source.title + '</title><svg></svg>');
fs.writeFileSync(output, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
  validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass' }
}));
`);
  fs.writeFileSync(input, JSON.stringify({ title: 'Prior Good' }));

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 10,
    pollMs: 800,
    watch: false,
    deliveryCli,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'prior good revision did not verify');
    const priorArtifact = fs.readFileSync(output, 'utf8');
    fs.writeFileSync(input, JSON.stringify({ title: 'Intermediate A' }));
    await waitForState(preview.url, (state) => state.status === 'checking' && state.generation === 2, 'intermediate generation did not start');
    fs.writeFileSync(input, JSON.stringify({ title: 'Current B' }));

    await new Promise((resolve) => setTimeout(resolve, 340));
    assert.equal(fs.readFileSync(output, 'utf8'), priorArtifact, 'superseded intermediate bytes replaced the prior last-good output');
    const pending = await stateAt(preview.url);
    assert.equal(pending.revision, 1, 'superseded intermediate bytes advanced the browser revision');

    const current = await waitForState(preview.url, (state) => state.status === 'verified' && state.generation === 3, 'current generation did not verify');
    assert.equal(current.revision, 2);
    assert.match(fs.readFileSync(output, 'utf8'), /Current B/);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /Intermediate A/);
  } finally {
    await preview.stop();
  }
});

test('preview: an in-place content change to the staged commit candidate is not published', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-candidate-content-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Candidate content binding');

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  const writeFileSync = fs.writeFileSync;
  let candidatePath;
  let modified = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-preview-commit-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!modified && candidatePath && path.resolve(target) === output) {
      const before = fs.statSync(candidatePath, { bigint: true });
      writeFileSync(candidatePath, '<!doctype html><title>same inode claimant</title>');
      const after = fs.statSync(candidatePath, { bigint: true });
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      modified = true;
    }
    return lstatSync(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'candidate content change did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.equal(state.failure.evidence.relation.code, 'candidate-content-changed');
    assert.equal(modified, true);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-commit-')), []);
  } finally {
    await preview.stop();
  }
});

test('preview: an in-place mode change to the staged commit candidate is not published', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX candidate mode regression');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-candidate-mode-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Candidate mode binding');

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  let candidatePath;
  let modified = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-preview-commit-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!modified && candidatePath && path.resolve(target) === output) {
      const before = fs.statSync(candidatePath, { bigint: true });
      fs.chmodSync(candidatePath, Number(before.mode & 0o777n) ^ 0o111);
      const after = fs.statSync(candidatePath, { bigint: true });
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      assert.notEqual(after.mode & 0o777n, before.mode & 0o777n);
      modified = true;
    }
    return lstatSync(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'candidate mode change did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.equal(state.failure.evidence.relation.code, 'candidate-mode-changed');
    assert.equal(modified, true);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-commit-')), []);
  } finally {
    await preview.stop();
  }
});

test('preview: replacing the staged commit candidate preserves the claimant', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-candidate-replacement-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const detachedCandidate = path.join(tmp, 'detached-preview-candidate.html');
  const sentinel = '<!doctype html><title>preview claimant must survive</title>';
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Candidate identity binding');

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  const writeFileSync = fs.writeFileSync;
  let candidatePath;
  let replaced = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-preview-commit-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced && candidatePath && path.resolve(target) === output) {
      fs.renameSync(candidatePath, detachedCandidate);
      writeFileSync(candidatePath, sentinel);
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'candidate replacement did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.equal(state.failure.evidence.relation.code, 'candidate-identity-changed');
    assert.equal(replaced, true);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(candidatePath, 'utf8'), sentinel);
    assert.equal(fs.existsSync(detachedCandidate), true);
  } finally {
    await preview.stop();
  }
});

test('preview: a candidate swapped at publication cannot replace the last good artifact', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-publication-binding-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const detachedCandidate = path.join(tmp, 'detached-preview-publication-candidate.html');
  const previous = '<!doctype html><title>previous preview artifact</title>\n';
  const claimant = '<!doctype html><title>preview publication claimant</title>\n';
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(output, previous);
  writeDelayedDeliveryCli(deliveryCli, marker, 'Bound preview candidate');

  const openSync = fs.openSync.bind(fs);
  const closeSync = fs.closeSync.bind(fs);
  const linkSync = fs.linkSync.bind(fs);
  const writeFileSync = fs.writeFileSync.bind(fs);
  let candidatePath;
  let candidateDescriptor;
  let injected = false;
  const inject = () => {
    injected = true;
    fs.renameSync(candidatePath, detachedCandidate);
    writeFileSync(candidatePath, claimant, { flag: 'wx' });
  };
  t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    const descriptor = openSync(file, flags, ...args);
    const resolved = path.resolve(String(file));
    if (path.basename(resolved).startsWith('.archify-preview-commit-')
      && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = resolved;
      candidateDescriptor = descriptor;
    }
    return descriptor;
  });
  t.mock.method(fs, 'closeSync', (descriptor) => {
    const result = closeSync(descriptor);
    if (!injected && descriptor === candidateDescriptor && fs.existsSync(candidatePath)) inject();
    return result;
  });
  t.mock.method(fs, 'linkSync', (source, target) => {
    if (!injected
      && candidatePath
      && path.resolve(String(source)) === candidatePath
      && path.basename(String(target)) === path.basename(output)) inject();
    return linkSync(source, target);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false,
    pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(
      preview.url,
      (candidate) => candidate.status === 'needs-fix',
      'publication-boundary replacement did not fail preview',
    );
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.equal(state.failure.evidence.relation.code, 'candidate-identity-changed');
    assert.equal(injected, true);
    assert.equal(fs.readFileSync(output, 'utf8'), previous);
    assert.equal(fs.readFileSync(candidatePath, 'utf8'), claimant);
    assert.equal(fs.existsSync(detachedCandidate), true);
  } finally {
    await preview.stop();
  }
});

test('preview: replacing the delivered source candidate preserves the claimant', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-source-replacement-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const detachedCandidate = path.join(tmp, 'detached-delivery-candidate.html');
  const sentinel = '<!doctype html><title>delivery claimant must survive</title>';
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Delivered source identity binding');

  const lstatSync = fs.lstatSync;
  let candidatePath;
  let replaced = false;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced
      && path.basename(String(target)) === 'generation-1.html'
      && fs.existsSync(target)) {
      candidatePath = path.resolve(target);
      fs.renameSync(candidatePath, detachedCandidate);
      fs.writeFileSync(candidatePath, sentinel, { flag: 'wx' });
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false,
    pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForState(
      preview.url,
      (candidate) => candidate.status === 'needs-fix',
      'source candidate replacement did not fail preview',
    );
    assert.equal(replaced, true);
    assert.equal(fs.readFileSync(candidatePath, 'utf8'), sentinel);
    assert.equal(fs.existsSync(output), false);
  } finally {
    await preview.stop();
  }
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), sentinel);
  assert.equal(fs.existsSync(detachedCandidate), true);
});

test('preview: a delivery candidate replaced by a symlink is rejected without following it', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-source-symlink-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const claimant = path.join(tmp, 'claimant.html');
  const probe = path.join(tmp, 'symlink-probe');
  const sentinel = '<!doctype html><title>external symlink claimant</title>';
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(claimant, sentinel);
  try {
    fs.symlinkSync(claimant, probe, process.platform === 'win32' ? 'file' : undefined);
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`file aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not follow replacement');

  const lstatSync = fs.lstatSync;
  let replaced = false;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced
      && path.basename(target) === 'generation-1.html'
      && fs.existsSync(target)) {
      fs.renameSync(target, `${target}.detached`);
      fs.symlinkSync(claimant, target, process.platform === 'win32' ? 'file' : undefined);
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'symlink delivery candidate did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-not-regular-file');
    assert.equal(state.failure.evidence.relation.code, 'candidate-not-regular-file');
    assert.equal(state.failure.evidence.relation.entryType, 'symbolic-link');
    assert.equal(replaced, true);
    assert.equal(fs.existsSync(output), false);
  } finally {
    await preview.stop();
  }
  assert.equal(fs.readFileSync(claimant, 'utf8'), sentinel);
});

test('preview: a delivery candidate replaced by a FIFO is rejected without blocking', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('FIFO files are unavailable on Windows');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-source-fifo-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not read FIFO replacement');

  const lstatSync = fs.lstatSync;
  let replaced = false;
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced
      && path.basename(target) === 'generation-1.html'
      && fs.existsSync(target)) {
      fs.renameSync(target, `${target}.detached`);
      const created = spawnSync('mkfifo', [target], { encoding: 'utf8' });
      assert.equal(created.status, 0, created.stderr || created.error?.message);
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  const startedAt = Date.now();
  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'FIFO delivery candidate did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-not-regular-file');
    assert.equal(state.failure.evidence.relation.code, 'candidate-not-regular-file');
    assert.equal(state.failure.evidence.relation.entryType, 'fifo');
    assert.equal(replaced, true);
    assert.ok(Date.now() - startedAt < 5000, 'preview blocked while inspecting a FIFO replacement');
    assert.equal(fs.existsSync(output), false);
  } finally {
    await preview.stop();
  }
});

test('preview: publishing through an existing output symlink preserves the link and updates its target', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-symlink-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const target = path.join(tmp, 'target.html');
  const output = path.join(tmp, 'linked.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(target, '<!doctype html><title>Previous target</title>');
  try {
    fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  writeDelayedDeliveryCli(deliveryCli, marker, 'Published through symlink');
  const physicalTarget = fs.realpathSync.native(target);
  const linkSync = fs.linkSync.bind(fs);
  let commits = 0;
  t.mock.method(fs, 'linkSync', (source, destination) => {
    if (path.resolve(destination) === physicalTarget
      && path.basename(String(source)).startsWith('.archify-preview-commit-')) {
      commits += 1;
      assert.equal(path.dirname(source), path.dirname(physicalTarget));
      assert.match(path.basename(source), /^\.archify-preview-commit-/);
    }
    return linkSync(source, destination);
  });

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified', 'symlinked preview did not verify');
    assert.equal(commits, 1);
    assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
    assert.match(fs.readFileSync(target, 'utf8'), /Published through symlink/);
  } finally {
    await preview.stop();
  }
});

test('preview: cleanup stays bound to the physical output parent after a directory alias is redirected', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-cleanup-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const first = path.join(tmp, 'first');
  const second = path.join(tmp, 'second');
  const alias = path.join(tmp, 'output-alias');
  const input = path.join(tmp, 'diagram.json');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  fs.writeFileSync(input, '{}');
  try {
    fs.symlinkSync(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const preview = await startPreview({
    type: 'architecture', input, output: path.join(alias, 'diagram.html'), open: false, watch: false, pollMs: 60_000,
  });
  const stagingName = fs.readdirSync(first).find((name) => name.startsWith('.archify-preview-'));
  assert.ok(stagingName, 'preview did not create its private staging directory');
  const originalStaging = path.join(first, stagingName);
  const decoyStaging = path.join(second, stagingName);
  const sentinel = path.join(decoyStaging, 'claimant.txt');
  try {
    fs.unlinkSync(alias);
    fs.symlinkSync(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
    fs.mkdirSync(decoyStaging);
    fs.writeFileSync(sentinel, 'preserve claimant');
  } finally {
    await preview.stop();
  }

  assert.equal(fs.existsSync(originalStaging), false, 'owned physical staging directory was not removed');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve claimant');
});

test('preview: cleanup retries transient remote ENOTEMPTY', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-cleanup-enotempty-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000,
  });
  const rmdirSync = fs.rmdirSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
    if (!injected && path.basename(String(directory)).startsWith('.archify-preview-')) {
      injected = true;
      throw Object.assign(new Error('simulated remote deletion visibility delay'), { code: 'ENOTEMPTY' });
    }
    return rmdirSync(directory, ...args);
  });

  await preview.stop();

  assert.equal(injected, true);
  assert.deepEqual(
    fs.readdirSync(tmp).filter((entry) => entry.startsWith('.archify-preview-')),
    [],
  );
});

test('preview: publishing through a dangling output symlink creates its target without replacing the link', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-dangling-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const target = path.join(tmp, 'future-target.html');
  const output = path.join(tmp, 'linked.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  fs.writeFileSync(input, '{}');
  try {
    fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  writeDelayedDeliveryCli(deliveryCli, marker, 'Published through dangling symlink');

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified', 'dangling symlink preview did not verify');
    assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
    assert.match(fs.readFileSync(target, 'utf8'), /Published through dangling symlink/);
  } finally {
    await preview.stop();
  }
});

test('preview: recreating an output symlink to the same target fails the commit even when its inode is reused', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-recreated-symlink-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const target = path.join(tmp, 'target.html');
  const output = path.join(tmp, 'linked.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const previous = '<!doctype html><title>Previous target</title>';
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(target, previous);
  try {
    fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  // Filesystems can immediately reuse an unlinked symlink's inode. Preserve
  // that behavior deterministically instead of depending on the host allocator.
  const lstatSync = fs.lstatSync.bind(fs);
  const originalLink = lstatSync(output, { bigint: true });
  t.mock.method(fs, 'lstatSync', (filePath, ...args) => {
    const metadata = lstatSync(filePath, ...args);
    if (String(filePath) === output && metadata.isSymbolicLink()) {
      metadata.ino = typeof metadata.ino === 'bigint' ? originalLink.ino : Number(originalLink.ino);
    }
    return metadata;
  });
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not publish');

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForPath(marker, 'fake delivery did not start');
    fs.unlinkSync(output);
    fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
    const state = await waitForState(
      preview.url,
      (candidate) => ['needs-fix', 'verified'].includes(candidate.status),
      'recreated symlink did not finish preview',
    );
    assert.equal(state.status, 'needs-fix', 'a recreated output symlink must prevent publication');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.equal(state.failure.evidence.relation.code, 'requested-entry-changed');
    assert.match(state.failure.message, /requested-entry-changed/);
    assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(target, 'utf8'), previous);
  } finally {
    await preview.stop();
  }
});

test('preview: a concurrently claimed absent output is preserved and fails the commit', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-claim-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const claimant = '<!doctype html><title>Concurrent claimant</title>';
  fs.writeFileSync(input, '{}');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not publish');

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForPath(marker, 'fake delivery did not start');
    fs.writeFileSync(output, claimant);
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'output claim did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.match(state.failure.message, /requested-entry-changed|target-existence-changed|write-slot-changed/);
    assert.equal(fs.readFileSync(output, 'utf8'), claimant);
  } finally {
    await preview.stop();
  }
});

test('preview: a concurrent replacement of an existing output is preserved and fails the commit', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-replacement-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const detached = path.join(tmp, 'detached-original.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const replacement = '<!doctype html><title>Concurrent replacement</title>';
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(output, '<!doctype html><title>Original output</title>');
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not publish');

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    await waitForPath(marker, 'fake delivery did not start');
    fs.renameSync(output, detached);
    fs.writeFileSync(output, replacement);
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'output replacement did not fail preview');
    assert.equal(state.failure.stage, 'commit');
    assert.equal(state.failure.code, 'output/target-changed');
    assert.match(state.failure.message, /requested-entry-changed|target-identity-changed/);
    assert.equal(fs.readFileSync(output, 'utf8'), replacement);
  } finally {
    await preview.stop();
  }
});

test('preview: a hardlinked existing output is unsupported before delivery starts', { timeout: 10000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-output-hardlink-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const alias = path.join(tmp, 'diagram-alias.html');
  const deliveryCli = path.join(tmp, 'delivery.mjs');
  const marker = path.join(tmp, 'delivery-started');
  const previous = '<!doctype html><title>Hardlinked output</title>';
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(output, previous);
  try {
    fs.linkSync(output, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  writeDelayedDeliveryCli(deliveryCli, marker, 'Must not publish');

  const preview = await startPreview({
    type: 'architecture', input, output, open: false, watch: false, pollMs: 60_000, debounceMs: 10, deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'hardlinked output was not rejected');
    assert.equal(state.failure.stage, 'prepare');
    assert.equal(state.failure.code, 'output/target-hardlinked');
    assert.equal(state.failure.evidence.relation.code, 'target-hardlinked');
    assert.match(state.failure.message, /multiple hard-link names/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.readFileSync(output, 'utf8'), previous);
    assert.equal(fs.readFileSync(alias, 'utf8'), previous);
  } finally {
    await preview.stop();
  }
});

test('preview: stopping drains an active delivery without publishing it', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-stop-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'slow-delivery.mjs');
  const prior = '<!doctype html><title>Prior verified artifact</title>';
  fs.writeFileSync(output, prior);
  fs.writeFileSync(input, JSON.stringify({ title: 'Do not publish after stop' }));
  fs.writeFileSync(deliveryCli, `
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [, , , output] = process.argv.slice(2);
await new Promise((resolve) => setTimeout(resolve, 450));
const artifact = Buffer.from('<!doctype html><title>Late candidate</title><svg></svg>');
fs.writeFileSync(output, artifact);
console.log(JSON.stringify({
  ok: true,
  artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
  validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass' }
}));
`);

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 10,
    pollMs: 100,
    deliveryCli,
  });
  await waitForState(preview.url, (state) => state.status === 'checking' && state.generation === 1, 'slow stop candidate did not start');
  await new Promise((resolve) => setTimeout(resolve, 90));
  const stoppedAt = Date.now();
  await preview.stop();
  assert.ok(Date.now() - stoppedAt >= 250, 'preview did not drain the active delivery');
  assert.equal(fs.readFileSync(output, 'utf8'), prior);
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('preview: stopping has a bounded kill path for a delivery that never exits', { timeout: 5000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-hung-stop-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'hung-delivery.mjs');
  const prior = '<!doctype html><title>Keep me</title>';
  fs.writeFileSync(input, JSON.stringify({ title: 'Never completes' }));
  fs.writeFileSync(output, prior);
  fs.writeFileSync(deliveryCli, `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 10,
    pollMs: 5000,
    deliveryCli,
    stopGraceMs: 80,
    stopKillMs: 80,
  });
  await waitForState(preview.url, (state) => state.status === 'checking' && state.generation === 1, 'hung generation did not start');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const stoppedAt = Date.now();
  await preview.stop();
  assert.ok(Date.now() - stoppedAt < 1000, 'hung delivery kept preview shutdown open');
  assert.equal(fs.readFileSync(output, 'utf8'), prior);
  await assert.rejects(fetch(preview.url));
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('preview: checker failures keep their actionable detail instead of a generic stage only', { timeout: 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-checker-'));
  const input = path.join(tmp, 'diagram.json');
  const output = path.join(tmp, 'diagram.html');
  const deliveryCli = path.join(tmp, 'checker-failure.mjs');
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(deliveryCli, `
console.log(JSON.stringify({
  ok: false,
  stage: 'check',
  error: 'Final artifact check failed; the previous artifact was preserved.',
  checker: { checks: [{ name: 'single_svg', ok: false, details: ['found 2 <svg> blocks; expected exactly one'] }] }
}));
process.exitCode = 1;
`);
  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 10,
    pollMs: 100,
    deliveryCli,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix', 'checker failure did not surface');
    assert.equal(state.failure.stage, 'check');
    assert.match(state.failure.message, /Final artifact check failed/);
    assert.match(state.failure.message, /found 2 <svg> blocks; expected exactly one/);
  } finally {
    await preview.stop();
  }
});

test('preview: all five typed renderers reach a verified first revision', { timeout: 60000 }, async () => {
  const cases = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };

  for (const [type, example] of Object.entries(cases)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `archify-preview-${type}-`));
    const input = path.join(tmp, example);
    const output = path.join(tmp, `${type}.html`);
    fs.copyFileSync(path.join(skillRoot, 'examples', example), input);
    const preview = await startPreview({ type, input, output, open: false, debounceMs: 10, pollMs: 500 });
    try {
      const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified', `${type} did not verify`);
      assert.equal(state.revision, 1, type);
      assert.equal(state.lastVerified.checksPassed, state.lastVerified.checkCount, type);
      assert.equal(state.lastVerified.sha256, sha256(output), type);
    } finally {
      await preview.stop();
    }
  }
});


test('preview: polling continues after an asynchronous watcher error', { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-watch-error-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  fs.writeFileSync(input, JSON.stringify(source));

  const watcher = new EventEmitter();
  let closeCount = 0;
  watcher.close = () => { closeCount += 1; };
  t.mock.method(fs, 'watch', () => watcher);
  const preview = await startPreview({ type: 'architecture', input, output, open: false, pollMs: 40, debounceMs: 20 });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'initial artifact did not verify');
    watcher.emit('error', Object.assign(new Error('watch limit reached'), { code: 'EMFILE' }));
    assert.equal(closeCount, 1, 'the failed watcher must be closed');
    source.meta.title = 'Recovered using polling';
    fs.writeFileSync(input, JSON.stringify(source));
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 2, 'polling did not publish the edited source');
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Recovered using polling/);
  } finally {
    await preview.stop();
  }
  assert.equal(closeCount, 1, 'shutdown must not close the failed watcher again');
  await assert.rejects(fetch(preview.url));
});

test('preview: watcher accepts an existing file alias with a different basename', { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-watch-file-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.architecture.json');
  const alias = path.join(tmp, 'DIAGRAM~1.JSON');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Watched through original basename';
  fs.writeFileSync(input, JSON.stringify(source));
  fs.linkSync(input, alias);

  const watcher = new EventEmitter();
  watcher.close = () => {};
  let observeWatchEvent;
  t.mock.method(fs, 'watch', (target, listener) => {
    assert.equal(target, fs.realpathSync.native(tmp));
    observeWatchEvent = listener;
    return watcher;
  });

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 20,
    pollMs: 60_000,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'initial artifact did not verify');
    source.meta.title = 'Watcher accepted file alias';
    fs.writeFileSync(alias, JSON.stringify(source));
    observeWatchEvent('change', Buffer.from(path.basename(alias)));
    await waitForState(
      preview.url,
      (state) => state.status === 'verified' && state.revision === 2,
      'watcher ignored an event for the same file through another basename',
      5000,
    );
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Watcher accepted file alias/);

    source.meta.title = 'Watcher accepted unnamed event';
    fs.writeFileSync(input, JSON.stringify(source));
    observeWatchEvent('change', null);
    await waitForState(
      preview.url,
      (state) => state.status === 'verified' && state.revision === 3,
      'watcher ignored an event without a filename',
      5000,
    );
    const unnamedArtifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(unnamedArtifact, /Watcher accepted unnamed event/);
  } finally {
    await preview.stop();
  }
});

test('preview: watcher accepts case-variant basenames on a case-insensitive filesystem', { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-watch-case-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const inputBasename = 'Diagram.Architecture.JSON';
  const eventBasename = inputBasename.toLowerCase();
  const input = path.join(tmp, inputBasename);
  const eventTarget = path.join(tmp, eventBasename);
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Watched with authored case';
  fs.writeFileSync(input, JSON.stringify(source));

  let inputStat;
  let eventStat;
  try {
    inputStat = fs.statSync(input, { bigint: true });
    eventStat = fs.statSync(eventTarget, { bigint: true });
  } catch {
    t.skip('the test volume is case-sensitive');
    return;
  }
  const preservesCase = path.basename(fs.realpathSync.native(input)) === inputBasename;
  if (!preservesCase || inputStat.dev !== eventStat.dev || inputStat.ino !== eventStat.ino) {
    t.skip('the test volume is not case-preserving and case-insensitive');
    return;
  }

  const watcher = new EventEmitter();
  watcher.close = () => {};
  let observeWatchEvent;
  t.mock.method(fs, 'watch', (target, listener) => {
    assert.equal(target, fs.realpathSync.native(tmp));
    observeWatchEvent = listener;
    return watcher;
  });

  const preview = await startPreview({
    type: 'architecture',
    input,
    output,
    open: false,
    debounceMs: 20,
    pollMs: 60_000,
  });
  try {
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'initial artifact did not verify');
    source.meta.title = 'Watcher accepted case alias';
    fs.writeFileSync(input, JSON.stringify(source));
    observeWatchEvent('change', eventBasename);
    await waitForState(
      preview.url,
      (state) => state.status === 'verified' && state.revision === 2,
      'watcher ignored a case-variant event for the same file',
      5000,
    );
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Watcher accepted case alias/);
  } finally {
    await preview.stop();
  }
});

test('preview: canonical watch target observes edits through a directory alias', { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-watch-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const realDirectory = path.join(tmp, 'real input directory');
  const aliasDirectory = path.join(tmp, 'input-alias');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const realInput = path.join(realDirectory, 'diagram.architecture.json');
  const aliasedInput = path.join(aliasDirectory, 'diagram.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Watched through alias';
  fs.writeFileSync(realInput, JSON.stringify(source));

  const watch = fs.watch.bind(fs);
  let watchedDirectory;
  t.mock.method(fs, 'watch', (target, ...args) => {
    watchedDirectory = target;
    return watch(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture',
    input: aliasedInput,
    output,
    open: false,
    debounceMs: 20,
    pollMs: 60_000,
  });
  try {
    assert.equal(watchedDirectory, fs.realpathSync.native(realDirectory));
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, 'aliased input did not verify');
    source.meta.title = 'Watcher observed canonical target';
    fs.writeFileSync(realInput, JSON.stringify(source));
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 2, 'watcher did not observe the edited canonical target');
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Watcher observed canonical target/);
  } finally {
    await preview.stop();
  }
  await assert.rejects(fetch(preview.url));
});

test('preview: Windows 8.3 short path observes edits through the canonical watcher', { timeout: 30000 }, async (t) => {
  const requiresWindows8dot3 = process.env.ARCHIFY_REQUIRE_WINDOWS_8DOT3 === '1';
  if (process.platform !== 'win32') {
    if (requiresWindows8dot3) {
      assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires a Windows test lane');
    }
    t.skip('Windows-only 8.3 path regression');
    return;
  }

  const controlledRoot = controlledWindowsShortRoot(requiresWindows8dot3);
  const tmp = controlledRoot
    ? fs.mkdtempSync(path.join(controlledRoot.root, 'preview-'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-eight-dot-three-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const shortTmp = controlledRoot
    ? path.win32.join(controlledRoot.shortRoot, path.basename(tmp))
    : null;
  const realDirectory = path.join(tmp, 'directory name requiring short alias');
  fs.mkdirSync(realDirectory);
  let shortDirectory;
  if (shortTmp) {
    const shortName = 'ARCHPR~1';
    const explicitAlias = assignWindowsShortName(realDirectory, shortName);
    shortDirectory = path.win32.join(shortTmp, path.basename(explicitAlias));
  } else {
    shortDirectory = windowsShortPath(realDirectory);
  }
  if (!shortDirectory) {
    t.skip('the Windows volume does not expose a distinct 8.3 short path');
    return;
  }
  assert.equal(
    fs.realpathSync.native(shortDirectory).toLowerCase(),
    fs.realpathSync.native(realDirectory).toLowerCase(),
    'the 8.3 input directory must resolve through the controlled explicit alias',
  );

  const realInput = path.join(realDirectory, 'diagram.architecture.json');
  const shortInput = path.join(shortDirectory, 'diagram.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.title = 'Watched through 8.3 path';
  fs.writeFileSync(realInput, JSON.stringify(source));

  const watch = fs.watch.bind(fs);
  let watchedDirectory;
  t.mock.method(fs, 'watch', (target, ...args) => {
    watchedDirectory = target;
    return watch(target, ...args);
  });

  const preview = await startPreview({
    type: 'architecture',
    input: shortInput,
    output,
    open: false,
    debounceMs: 20,
    pollMs: 60_000,
  });
  try {
    assert.equal(watchedDirectory, fs.realpathSync.native(realDirectory));
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 1, '8.3 input did not verify');
    source.meta.title = 'Watcher observed 8.3 target';
    fs.writeFileSync(realInput, JSON.stringify(source));
    await waitForState(preview.url, (state) => state.status === 'verified' && state.revision === 2, 'watcher did not observe the edited 8.3 target');
    const artifact = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.match(artifact, /Watcher observed 8\.3 target/);
  } finally {
    await preview.stop();
  }
  await assert.rejects(fetch(preview.url));
});

test('preview: native watch-target resolution failure closes startup resources', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-watch-cleanup-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'diagram.architecture.json');
  const output = path.join(tmp, 'diagram.html');
  fs.copyFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), input);

  const createServer = http.createServer.bind(http);
  const realpathNative = fs.realpathSync.native.bind(fs.realpathSync);
  let server;
  t.mock.method(http, 'createServer', (...args) => {
    server = createServer(...args);
    return server;
  });
  t.mock.method(fs.realpathSync, 'native', (...args) => {
    if (server?.listening) {
      throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    }
    return realpathNative(...args);
  });

  await assert.rejects(
    startPreview({ type: 'architecture', input, output, open: false }),
    /Could not watch the input directory: not a directory/,
  );
  assert.equal(server?.listening, false, 'failed startup left the preview server listening');
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-preview-')),
    [],
    'failed startup left its staging directory behind',
  );
});
