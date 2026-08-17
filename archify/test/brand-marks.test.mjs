import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BRAND_MARKS } from '../renderers/shared/generated-brand-marks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-brand-marks-'));
const cases = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  lifecycle: ['agent-run.lifecycle.json', 'states'],
};

function writeFixture(type, name, brand, customize) {
  const [example, collection] = cases[type];
  const value = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  value[collection][0].brand = brand;
  customize?.(value, value[collection][0]);
  const file = path.join(tmp, `${name}.${type}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function renderSync(type, input, name, env = {}) {
  const output = path.join(tmp, `${name}.html`);
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${type}/render-${type}.mjs`),
    input,
    output,
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { result, output, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function renderAsync(type, input, name, env = {}) {
  const output = path.join(tmp, `${name}.html`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(skillRoot, `renderers/${type}/render-${type}.mjs`),
      input,
      output,
    ], {
      cwd: skillRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({
      status,
      stdout,
      stderr,
      output,
      html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    }));
  });
}

function nodeBlock(html, id) {
  const startToken = `<g id="node-${id}"`;
  const start = html.indexOf(startToken);
  if (start === -1) return '';
  const candidates = [
    html.indexOf('\n        <g id="node-', start + startToken.length),
    html.indexOf('\n        <!-- Connection labels', start + startToken.length),
    html.indexOf('\n        <!-- Transition labels', start + startToken.length),
    html.indexOf('\n        <!-- Message labels', start + startToken.length),
  ].filter((value) => value !== -1);
  return html.slice(start, candidates.length ? Math.min(...candidates) : html.length);
}

test('generated catalog exposes a substantial, unique, provenance-backed preset library', () => {
  assert.equal(BRAND_MARKS.length, 107);
  assert.equal(new Set(BRAND_MARKS.map((mark) => mark.id)).size, BRAND_MARKS.length);
  for (const mark of BRAND_MARKS) {
    assert.match(mark.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(mark.title);
    assert.ok(mark.category);
    assert.match(mark.hex, /^[0-9A-F]{6}$/i);
    assert.match(mark.path, /^[Mm]/);
    assert.ok(mark.provenance?.source);
  }
});

test('brand discovery resolves model names, aliases, domains, and Chinese channel aliases', () => {
  for (const [query, expected] of [
    ['GPT', 'openai'],
    ['Gemini', 'google-gemini'],
    ['github.com', 'github'],
    ['微信', 'wechat'],
  ]) {
    const result = spawnSync(process.execPath, [cli, 'brands', query, '--json'], {
      cwd: skillRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.ok(receipt.marks.some((mark) => mark.id === expected), query);
  }
});

test('all five renderers keep the semantic sigil and add one export-safe brand badge', () => {
  for (const type of Object.keys(cases)) {
    const input = writeFixture(type, `preset-${type}`, 'openai', (_diagram, node) => {
      if (type === 'lifecycle') node.step = node.step || '01';
    });
    const { result, html } = renderSync(type, input, `preset-${type}`);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(html, /data-node-brand="OpenAI"/i, type);
    assert.match(html, /data-brand-mark="openai"[^>]+data-brand-status="preset"/i, type);
    assert.match(html, /class="semantic-sigil /, type);
    assert.match(html, /<title>[^<]*OpenAI<\/title>/i, type);

    const [, collection] = cases[type];
    const diagram = JSON.parse(fs.readFileSync(input, 'utf8'));
    const block = nodeBlock(html, diagram[collection][0].id);
    const frame = block.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="[^"]+" class="c-mask"\/>/);
    const semantic = block.match(/data-semantic-sigil[^>]+translate\(([-\d.]+) ([-\d.]+)\)/);
    const brand = block.match(/data-brand-mark="openai"[^>]+translate\(([-\d.]+) ([-\d.]+)\)">\s*<rect width="([-\d.]+)" height="([-\d.]+)" rx="([-\d.]+)" class="brand-mark-badge"\/>/);
    assert.ok(frame && semantic && brand, `${type}: expected node frame, semantic sigil, and brand badge`);

    const [frameX, frameY, frameWidth] = frame.slice(1, 4).map(Number);
    const [, semanticY] = semantic.slice(1, 3).map(Number);
    const [brandX, brandY, brandWidth, brandHeight, brandRadius] = brand.slice(1, 6).map(Number);
    assert.equal(brandWidth, 16, `${type}: brand badge width`);
    assert.equal(brandHeight, 16, `${type}: brand badge height`);
    assert.equal(brandRadius, 4, `${type}: brand badge radius`);
    assert.equal(brandY - frameY, 6, `${type}: brand badge top inset`);
    assert.equal(frameX + frameWidth - (brandX + brandWidth), 6, `${type}: brand badge right inset`);
    assert.equal(brandY, semanticY, `${type}: brand and semantic marks share a top rail`);
  }
});

test('branded lifecycle states move the semantic stamp left and keep the brand at upper right', () => {
  const input = writeFixture('lifecycle', 'lifecycle-placement', 'openai', (_diagram, node) => {
    node.step = '01';
  });
  const { result, html } = renderSync('lifecycle', input, 'lifecycle-placement');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const id = JSON.parse(fs.readFileSync(input, 'utf8')).states[0].id;
  const block = nodeBlock(html, id);
  const semanticX = Number(block.match(/data-semantic-sigil[^>]+translate\(([-\d.]+)/)?.[1]);
  const brandX = Number(block.match(/data-brand-mark[^>]+translate\(([-\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(semanticX) && Number.isFinite(brandX) && semanticX < brandX, block);
  assert.match(block, /data-detail="fine"[^>]+>01<\/text>/);
});

test('known-brand URLs use the bundled vector instead of the network', () => {
  const input = writeFixture('architecture', 'known-domain', 'https://github.com/tt-a1i/archify');
  const { result, html } = renderSync('architecture', input, 'known-domain');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(html, /data-brand-mark="github"[^>]+data-brand-status="preset"/);
  assert.doesNotMatch(html, /data-brand-status="captured"/);
});

test('unknown public-style links capture one site icon and embed it into the standalone HTML', async () => {
  let pageHits = 0;
  let iconHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.svg') {
      iconHits += 1;
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#7c3aed"/><path d="M6 17 12 5l6 12Z" fill="white"/></svg>');
      return;
    }
    pageHits += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Example Studio</title><link rel="icon" type="image/svg+xml" href="/mark.svg"><h1>Example Studio</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const input = writeFixture('architecture', 'captured-link', `http://127.0.0.1:${address.port}/studio`);
  const rendered = await renderAsync('architecture', input, 'captured-link', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  assert.equal(pageHits, 1);
  assert.equal(iconHits, 1);
  assert.match(rendered.html, /data-brand-status="captured"/);
  assert.match(rendered.html, /data:image\/svg\+xml;base64,/);
  assert.match(rendered.html, /data-brand-sha256="[a-f0-9]{64}"/);
  assert.ok(!rendered.html.includes('http://127.0.0.1') || rendered.html.includes('data-node-brand-source='));
});

test('remote SVG marks with active or external content degrade without embedding that SVG', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/unsafe.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://example.com/leak.css")</style><image href=https://example.com/leak.png /><rect width="24" height="24"/></svg>');
      return;
    }
    if (request.url === '/favicon.ico') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Unsafe mark</title><link rel="icon" type="image/svg+xml" href="/unsafe.svg">');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const input = writeFixture('architecture', 'unsafe-svg', `http://127.0.0.1:${address.port}/studio`);
  const rendered = await renderAsync('architecture', input, 'unsafe-svg', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const id = JSON.parse(fs.readFileSync(input, 'utf8')).components[0].id;
  const block = nodeBlock(rendered.html, id);
  assert.match(block, /data-brand-status="unavailable"/);
  assert.match(block, /class="brand-mark-fallback"/);
  assert.doesNotMatch(block, /leak\.(?:css|png)|data:image\/svg\+xml/);
});

test('unsafe or unavailable link capture degrades to a generic mark without failing the diagram', () => {
  const input = writeFixture('architecture', 'blocked-link', 'http://127.0.0.1/brand');
  const { result, html } = renderSync('architecture', input, 'blocked-link');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const id = JSON.parse(fs.readFileSync(input, 'utf8')).components[0].id;
  const block = nodeBlock(html, id);
  assert.match(block, /data-brand-status="unavailable"/);
  assert.match(block, /class="brand-mark-fallback"/);
  assert.doesNotMatch(block, /data:image\//);
});

test('unknown preset names fail with a repairable public CLI diagnostic', () => {
  const input = writeFixture('architecture', 'unknown-preset', 'open-aii');
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'brand/unknown'));
  assert.ok(receipt.diagnostics.some((entry) => entry.supportedFixes.some((fix) => fix.includes('archify brands'))));
});

test('viewer exposes brand identity to Passport and Finder while keeping source beacons clear', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
  assert.match(template, /id="focus-brand" data-passport="brand" hidden/);
  assert.match(template, /node\.getAttribute\('data-node-brand'\)/);
  assert.match(template, /brandOffset = node\.hasAttribute\('data-node-brand'\) \? 24 : 0/);
  assert.match(template, /sourceSearch \+ ' ' \+ text\)\.toLowerCase\(\) \+ ' ' \+ brand\.toLowerCase\(\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
