import { createHash } from 'node:crypto';
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

async function stateAt(url) {
  const response = await fetch(new URL('/state', url));
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForState(url, predicate, message, timeoutMs = 12000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    latest = await stateAt(url);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`${message}; latest state: ${JSON.stringify(latest)}`);
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
