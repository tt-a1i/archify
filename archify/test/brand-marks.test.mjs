import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BRAND_MARKS } from '../renderers/shared/generated-brand-marks.mjs';
import { isPrivateBrandAddress, prepareDiagramBrandMarks } from '../renderers/shared/brand-marks.mjs';
import {
  THIRD_PARTY_NOTICE_DISCLOSURE_COUNT,
  validateThirdPartyNotices,
} from '../../scripts/third-party-notices-contract.mjs';

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

test('third-party notices cover every recorded individual mark license', () => {
  const notices = fs.readFileSync(path.join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const licensedMarks = BRAND_MARKS.filter((mark) => mark.provenance?.license);

  assert.equal(THIRD_PARTY_NOTICE_DISCLOSURE_COUNT, 34, 'notice contract changed without review');
  assert.deepEqual(validateThirdPartyNotices(notices), { ok: true, missing: [] });
  assert.equal(licensedMarks.length, 8, 'pinned Simple Icons license inventory changed');
  for (const mark of licensedMarks) {
    assert.match(notices, new RegExp(`\\| ${mark.title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\|`));
    assert.ok(notices.includes(mark.provenance.source), `${mark.id} source must be disclosed`);
    assert.ok(notices.includes(mark.provenance.license.type), `${mark.id} license must be disclosed`);
  }
  assert.match(notices, /OpenAI brand guidelines/);
  assert.match(notices, /does not state or imply endorsement by OpenAI/);
  assert.match(notices, /does not imply sponsorship, endorsement, partnership/);
  assert.match(notices, /commercial, promotional, or redistributive use/);
  assert.match(notices, /does not grant rights\s+that Archify does not hold/);
});

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

function runCliAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
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
    child.on('close', (status) => resolve({ status, stdout, stderr }));
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

test('a branded node fails before its semantic sigil, label, and brand badge can overlap', () => {
  const input = writeFixture('workflow', 'narrow-brand-rail', 'openai', (_diagram, node) => {
    node.label = 'A';
    delete node.sublabel;
    node.width = 32;
  });
  const { result, html } = renderSync('workflow', input, 'narrow-brand-rail');

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /brand top rail/i);
  assert.equal(html, '');
});

test('every renderer enforces the same collision-free brand top rail', () => {
  for (const type of ['architecture', 'sequence', 'dataflow', 'lifecycle']) {
    const input = writeFixture(type, `narrow-brand-rail-${type}`, 'openai', (_diagram, node) => {
      node.label = type === 'sequence' ? 'ABCDEFGHI' : 'A';
      delete node.sublabel;
      delete node.tag;
      if (type === 'architecture') node.size = [32, 60];
      if (type === 'dataflow' || type === 'lifecycle') node.width = 48;
    });
    const { result, html } = renderSync(type, input, `narrow-brand-rail-${type}`);
    assert.equal(result.status, 1, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, /brand top rail/i, type);
    assert.equal(html, '', type);
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

test('unknown URL strings fail closed until an exact captured digest is authored', () => {
  const input = writeFixture('architecture', 'unpinned-link', 'https://brand.example.invalid/');
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'brand/unpinned-url'));
  assert.ok(receipt.diagnostics.some((entry) => entry.supportedFixes.some((fix) => fix.includes('brands capture'))));
});

test('capture command returns a digest-pinned brand object that renders reproducibly', async () => {
  let pageHits = 0;
  let iconHits = 0;
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.png') {
      iconHits += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
      return;
    }
    pageHits += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Example Studio</title><link rel="icon" type="image/png" href="/mark.png"><h1>Example Studio</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/studio`;
    const capture = await runCliAsync(['brands', 'capture', url, '--json'], { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(capture.status, 0, capture.stderr || capture.stdout);
    const receipt = JSON.parse(capture.stdout);
    assert.equal(receipt.ok, true);
    assert.deepEqual(receipt.brand, {
      url,
      sha256: createHash('sha256').update(icon).digest('hex'),
    });

    const input = writeFixture('architecture', 'captured-link', receipt.brand);
    const rendered = await renderAsync('architecture', input, 'captured-link', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
    assert.equal(pageHits, 2);
    assert.equal(iconHits, 2);
    assert.match(rendered.html, /data-brand-status="captured"/);
    assert.match(rendered.html, /data:image\/png;base64,/);
    assert.match(rendered.html, new RegExp(`data-brand-sha256="${receipt.brand.sha256}"`));
    assert.ok(!rendered.html.includes('http://127.0.0.1') || rendered.html.includes('data-node-brand-source='));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a pinned brand fails closed when the remote icon digest changes', async () => {
  const firstIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const changedIcon = Buffer.from(firstIcon);
  changedIcon[45] ^= 1;
  let iconHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.png') {
      iconHits += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(iconHits === 1 ? firstIcon : changedIcon);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Changing site</title><link rel="icon" type="image/png" href="/mark.png">');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    const capture = await runCliAsync(['brands', 'capture', url, '--json'], { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(capture.status, 0, capture.stderr || capture.stdout);
    const brand = JSON.parse(capture.stdout).brand;
    const input = writeFixture('architecture', 'changed-digest', brand);
    const result = await runCliAsync(['validate', 'architecture', input, '--json'], { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.diagnostics.filter((entry) => entry.code === 'brand/digest-mismatch').length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a pinned brand keeps identical artifact metadata when the remote page title changes', async () => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let pageHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
      return;
    }
    pageHits += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Title ${pageHits}</title><link rel="icon" type="image/png" href="/mark.png">`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    const capture = await runCliAsync(['brands', 'capture', url, '--json'], { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(capture.status, 0, capture.stderr || capture.stdout);
    const input = writeFixture('architecture', 'stable-title', JSON.parse(capture.stdout).brand);
    const first = await renderAsync('architecture', input, 'stable-title-first', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    const second = await renderAsync('architecture', input, 'stable-title-second', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(first.html, second.html);
    assert.match(first.html, /data-brand-title="127\.0\.0\.1"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('each prepare call rechecks pinned remote bytes instead of trusting a process-wide cache', async () => {
  const firstIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const changedIcon = Buffer.from(firstIcon);
  changedIcon[45] ^= 1;
  let iconHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.png') {
      iconHits += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(iconHits === 1 ? firstIcon : changedIcon);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Changing site</title><link rel="icon" type="image/png" href="/mark.png">');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const priorAllowPrivate = process.env.ARCHIFY_BRAND_ALLOW_PRIVATE;
  process.env.ARCHIFY_BRAND_ALLOW_PRIVATE = '1';
  try {
    const address = server.address();
    const diagram = {
      components: [{
        id: 'remote',
        label: 'Remote',
        brand: {
          url: `http://127.0.0.1:${address.port}/`,
          sha256: createHash('sha256').update(firstIcon).digest('hex'),
        },
      }],
    };
    await prepareDiagramBrandMarks('architecture', diagram);
    await assert.rejects(
      prepareDiagramBrandMarks('architecture', diagram),
      /brand digest changed/i,
    );
    assert.equal(iconHits, 2);
  } finally {
    if (priorAllowPrivate === undefined) delete process.env.ARCHIFY_BRAND_ALLOW_PRIVATE;
    else process.env.ARCHIFY_BRAND_ALLOW_PRIVATE = priorAllowPrivate;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('capture blocks IPv4-mapped IPv6 loopback and metadata destinations before connecting', async () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::192.168.1.1]/',
    'http://[64:ff9b::c0a8:101]/',
    'http://[2002:c0a8:0101::]/',
    'http://[ff02::1]/',
    'http://192.0.2.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/',
  ]) {
    const capture = await runCliAsync(['brands', 'capture', url, '--json']);
    assert.notEqual(capture.status, 0, `${url}: ${capture.stderr || capture.stdout}`);
    assert.match(capture.stderr, /private brand links are not fetched/i, url);
  }
});

test('address classification blocks exact reserved ranges without rejecting adjacent public IPv4 space', () => {
  for (const address of ['192.0.2.1', '192.88.99.1', '198.51.100.1', '203.0.113.1']) {
    assert.equal(isPrivateBrandAddress(address), true, address);
  }
  for (const address of ['192.2.1.1', '192.88.98.1', '198.51.99.1', '203.0.112.1']) {
    assert.equal(isPrivateBrandAddress(address), false, address);
  }
});

test('capture requires the standard port for the selected web protocol', async () => {
  for (const url of [
    'http://brand.example.invalid:443/',
    'https://brand.example.invalid:80/',
    'https://github.com:80/',
  ]) {
    const capture = await runCliAsync(['brands', 'capture', url, '--json']);
    assert.notEqual(capture.status, 0, capture.stdout);
    assert.match(capture.stderr, /standard web port/i, url);
  }
});

test('capture rejects credentials even when the URL domain matches a bundled preset', async () => {
  const capture = await runCliAsync(['brands', 'capture', 'https://user:secret@github.com/', '--json']);
  assert.notEqual(capture.status, 0, capture.stdout);
  assert.match(capture.stderr, /cannot contain credentials/i);
});

test('rendering many pinned brands limits concurrent remote capture work', async () => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(icon).digest('hex');
  let active = 0;
  let maximumActive = 0;
  const server = http.createServer((request, response) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    setTimeout(() => {
      if (request.url.endsWith('.png')) {
        response.writeHead(200, { 'content-type': 'image/png' });
        active -= 1;
        response.end(icon);
      } else {
        const suffix = request.url.replace(/^\/site-/, '');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        active -= 1;
        response.end(`<!doctype html><title>Site ${suffix}</title><link rel="icon" type="image/png" href="/mark-${suffix}.png">`);
      }
    }, 40);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const input = writeFixture('architecture', 'bounded-capture', 'openai', (diagram) => {
      diagram.components.forEach((node, index) => {
        node.brand = {
          url: `http://127.0.0.1:${address.port}/site-${index}`,
          sha256,
        };
      });
    });
    const rendered = await renderAsync('architecture', input, 'bounded-capture', { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
    assert.ok(maximumActive <= 3, `expected at most 3 concurrent requests, observed ${maximumActive}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rendering many pinned brands shares one diagram capture deadline', async () => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(icon).digest('hex');
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
    }, 80);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const input = writeFixture('architecture', 'diagram-deadline', 'openai', (diagram) => {
      diagram.components.forEach((node, index) => {
        node.brand = {
          url: `http://127.0.0.1:${address.port}/mark-${index}.png`,
          sha256,
        };
      });
    });
    const rendered = await renderAsync('architecture', input, 'diagram-deadline', {
      ARCHIFY_BRAND_ALLOW_PRIVATE: '1',
      ARCHIFY_BRAND_CAPTURE_TIMEOUT_MS: '100',
    });
    assert.notEqual(rendered.status, 0, rendered.stdout);
    assert.match(rendered.stderr, /abort|timed? ?out|timeout/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('capture applies one total deadline across the page and icon requests', async () => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const server = http.createServer((request, response) => {
    setTimeout(() => {
      if (request.url === '/mark.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(icon);
      } else {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Slow site</title><link rel="icon" type="image/png" href="/mark.png">');
      }
    }, 100);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await runCliAsync(
      ['brands', 'capture', `http://127.0.0.1:${address.port}/`, '--json'],
      {
        ARCHIFY_BRAND_ALLOW_PRIVATE: '1',
        ARCHIFY_BRAND_CAPTURE_TIMEOUT_MS: '150',
      },
    );
    assert.notEqual(capture.status, 0, capture.stdout);
    assert.match(capture.stderr, /abort|timed? ?out|timeout/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('capture rejects remote SVG even when the document appears passive', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/mark.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>');
      return;
    }
    if (request.url === '/favicon.ico') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>SVG mark</title><link rel="icon" type="image/svg+xml" href="/mark.svg">');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await runCliAsync(
      ['brands', 'capture', `http://127.0.0.1:${address.port}/studio`, '--json'],
      { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    );
    assert.notEqual(capture.status, 0, capture.stdout);
    assert.match(capture.stderr, /unsupported brand image type image\/svg\+xml/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unsupported SVG declarations cannot crowd out the favicon fallback', async () => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let fallbackHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      fallbackHits += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
      return;
    }
    if (request.url?.endsWith('.svg')) {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Fallback mark</title>${Array.from(
      { length: 6 },
      (_, index) => `<link rel="icon" type="image/svg+xml" href="/mark-${index}.svg">`,
    ).join('')}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await runCliAsync(
      ['brands', 'capture', `http://127.0.0.1:${address.port}/`, '--json'],
      { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    );
    assert.equal(capture.status, 0, capture.stderr || capture.stdout);
    const receipt = JSON.parse(capture.stdout);
    assert.equal(receipt.evidence.contentType, 'image/png');
    assert.equal(fallbackHits, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('capture rejects an image whose bytes do not match its declared media type', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end('<html>not a png</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await runCliAsync(
      ['brands', 'capture', `http://127.0.0.1:${address.port}/mark.png`, '--json'],
      { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    );
    assert.notEqual(capture.status, 0, capture.stdout);
    assert.match(capture.stderr, /do(?:es)? not match image\/png/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('capture rejects a truncated PNG that contains only its signature', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await runCliAsync(
      ['brands', 'capture', `http://127.0.0.1:${address.port}/mark.png`, '--json'],
      { ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    );
    assert.notEqual(capture.status, 0, capture.stdout);
    assert.match(capture.stderr, /do(?:es)? not match image\/png/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
