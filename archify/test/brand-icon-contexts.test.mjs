import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
// Valid blue and red PNGs: a wrong candidate must not fall through after a 404.
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', 'base64');
const inactiveIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const digest = createHash('sha256').update(icon).digest('hex');
const activeLink = '<link rel="icon" href="/active.png">';
const inactiveLink = '<link rel="icon" href="/inactive.png">';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: skillRoot,
      env: { ...process.env, ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function fixture(t, markup, { byteChunks = false } = {}) {
  const data = { markup, requests: [] };
  const server = http.createServer(async (request, response) => {
    data.requests.push(request.url);
    if (request.url === '/studio') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const html = `<head>${data.markup}</head>`;
      if (byteChunks) {
        for (const byte of Buffer.from(html)) {
          if (response.destroyed) return;
          response.write(Buffer.from([byte]));
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      } else {
        response.write(html);
      }
      response.end();
    } else if (['/active.png', '/active.png?a=1&b=2', '/favicon.ico'].includes(request.url)) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
    } else if (request.url === '/inactive.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(inactiveIcon);
    } else {
      response.writeHead(404);
      response.end('no icon');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  data.url = `http://127.0.0.1:${server.address().port}/studio`;
  return data;
}

async function capture(data, paths = ['/active.png']) {
  const result = await run(['brands', 'capture', data.url, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(data.requests, ['/studio', ...paths]);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.brand, { url: data.url, sha256: digest });
  assert.equal(receipt.evidence.status, 'captured');
  return receipt.brand;
}

for (const [name, prefix] of [
  ['comment', `<!-- ${inactiveLink} -->`],
  ['script string', `<script>const example = '${inactiveLink}';</script>`],
  ['style string', `<style>p::after { content: '${inactiveLink}'; }</style>`],
  ['title text', `<title>Example ${inactiveLink}</title>`],
  ['quoted attribute', `<meta name="example" content='${inactiveLink}'>`],
  ['template', `<template>${inactiveLink}</template>`],
  ['nested template', `<template><template>${inactiveLink}</template>${inactiveLink}</template>`],
  ['template with literal closing tags', `<template><script>const end = '</template></head>';</script>${inactiveLink}</template>`],
  ['raw closing-tag prefix', `<script>"</scripture>${inactiveLink}";</script>`],
  ['self-closing script flag', `<script/>"${inactiveLink}";</script>`],
  ['lookalike tag name', '<link-preview rel="icon" href="/inactive.png"></link-preview>'],
  ['lookalike rel attribute', '<link data-rel="icon" href="/inactive.png">'],
]) {
  test(`capture ignores icon declarations in ${name}`, async (t) => {
    await capture(await fixture(t, prefix + activeLink));
  });
}

for (const [name, markup] of [
  ['ordinary icon', activeLink],
  ['quoted greater-than', '<link title="size > zero" rel="icon" href="/active.png">'],
  ['lookalike href attribute', '<link data-href="/inactive.png" HREF="/active.png" REL="icon">'],
  ['attribute value containing declarations', '<link data-example=\'rel="icon" href="/inactive.png"\' rel="icon" href="/active.png">'],
  ['unquoted attributes', '<link data-note=example rel=icon href=/active.png>'],
  ['first duplicate attribute', '<link rel="icon" href="/active.png" HREF="/inactive.png">'],
  ['empty first duplicate attribute', '<link rel="icon" href href="/inactive.png">' + activeLink],
  ['existing size ranking', '<link rel="icon" sizes="16x16" href="/inactive.png"><link rel="icon" sizes="32x32" href="/active.png">'],
]) {
  test(`capture reads complete link attributes: ${name}`, async (t) => {
    await capture(await fixture(t, markup));
  });
}

test('inactive declarations do not consume the five icon candidate slots', async (t) => {
  const removed = Array.from({ length: 5 }, (_, index) => `<link rel="icon" href="/missing-${index}.png">`).join('');
  await capture(await fixture(t, `<!-- ${removed} -->${activeLink}`));
});

test('active declarations retain the five-candidate limit and favicon fallback', async (t) => {
  const paths = Array.from({ length: 5 }, (_, index) => `/missing-${index}.png`);
  const markup = paths.map((href) => `<link rel="icon" href="${href}">`).join('') + activeLink;
  await capture(await fixture(t, markup), [...paths, '/favicon.ico']);
});

for (const [name, markup] of [
  ['unclosed comment', `<!-- ${inactiveLink}`],
  ['unclosed script', `<script>const example = '${inactiveLink}';`],
  ['unclosed template', `<template>${inactiveLink}`],
]) {
  test(`capture uses the favicon fallback for an ${name}`, async (t) => {
    await capture(await fixture(t, markup), ['/favicon.ico']);
  });
}

for (const [name, prefix] of [
  ['comment', `<!-- ${inactiveLink} </head> -->`],
  ['script', `<ScRiPt data-note=">">'${inactiveLink}'</sCrIpT \n>`],
  ['template', `<template>${inactiveLink}</template>`],
]) {
  test(`link attributes and ${name} context survive one-byte response chunks`, { timeout: 20000 }, async (t) => {
    // Keep each response short enough for the real request deadline, including
    // hosts with coarse timer resolution. Do not relax the capture timeout.
    const markup = prefix + '<LiNk title="图 > icon" REL=icon HREF="/active.png?a=1&amp;b=2">';
    await capture(await fixture(t, markup, { byteChunks: true }), ['/active.png?a=1&b=2']);
  });
}

for (const [type, example, collection] of [
  ['architecture', 'web-app.architecture.json', 'components'],
  ['workflow', 'agent-tool-call.workflow.json', 'nodes'],
  ['sequence', 'cache-miss-request.sequence.json', 'participants'],
  ['dataflow', 'product-analytics.dataflow.json', 'nodes'],
  ['lifecycle', 'agent-run.lifecycle.json', 'states'],
]) {
  test(`inactive HTML changes preserve pinned ${type} validation and rendered bytes`, { timeout: 45000 }, async (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-brand-context-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const data = await fixture(t, activeLink);
    const brand = await capture(data);
    const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    diagram[collection][0].brand = brand;
    const input = path.join(temporary, 'diagram.json');
    const output = path.join(temporary, 'diagram.html');
    fs.writeFileSync(input, JSON.stringify(diagram));
    let original;
    for (const prefix of ['', `<!-- ${inactiveLink} --><script>const sample = '${inactiveLink}';</script>`]) {
      data.markup = prefix + activeLink;
      for (const command of ['validate', 'render']) {
        data.requests.length = 0;
        const args = [command, type, input, ...(command === 'render' ? [output] : ['--json'])];
        const result = await run(args);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.deepEqual(data.requests, ['/studio', '/active.png']);
      }
      const html = fs.readFileSync(output, 'utf8');
      assert.ok(html.includes(`data-brand-sha256="${digest}"`));
      assert.ok(html.includes(`data:image/png;base64,${icon.toString('base64')}`));
      assert.ok(!html.includes(inactiveIcon.toString('base64')));
      if (original) assert.equal(html, original, 'inactive source markup must not change the final artifact');
      original = html;
    }
  });
}
