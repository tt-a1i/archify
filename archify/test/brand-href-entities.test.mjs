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
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(icon).digest('hex');
const cases = [
  ['named ampersand', '/mark.png?a=1&amp;b=2', '/mark.png?a=1&b=2'],
  ['uppercase ampersand', '/mark.png?a=1&AMP;b=2', '/mark.png?a=1&b=2'],
  ['decimal ampersand', '/mark.png?a=1&#38;b=2', '/mark.png?a=1&b=2'],
  ['hexadecimal ampersand', '/mark.png?a=1&#x26;b=2', '/mark.png?a=1&b=2'],
  ['basic named references', '/mark.png?q=&quot;&apos;&lt;&gt;', '/mark.png?q="\'<>'],
  ['percent escapes', '/mark.png?q=%26amp%3B%2F&amp;v=%2526', '/mark.png?q=%26amp%3B%2F&v=%2526'],
  ['one decoding pass', '/mark.png?a=1&amp;amp;b=2', '/mark.png?a=1&amp;b=2'],
  ['literal query ampersands', '/mark.png?a=1&b=2&token=plain', '/mark.png?a=1&b=2&token=plain'],
  ['ambiguous unterminated names', '/mark.png?a=1&amp=2&ampx=3&AMP=4', '/mark.png?a=1&amp=2&ampx=3&AMP=4'],
  ['Unicode numeric references', '/mark.png?q=&#x1F680;&#128512;', '/mark.png?q=🚀😀'],
  ['invalid numeric code points', '/mark.png?q=&#0;&#xD800;&#1114112;', '/mark.png?q=���'],
  ['unterminated numeric reference', '/mark.png?a=1&#38b=2', '/mark.png?a=1&b=2'],
  ['legacy numeric C1 mapping', '/mark.png?q=&#128;', '/mark.png?q=€'],
  ['attribute named-reference boundaries', '/mark.png?q=&amp!&apos!&bogus;&AmP;', '/mark.png?q=&!&apos!&bogus;&AmP;'],
];

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

async function fixture(t, href, decoded, chunks) {
  const requests = [];
  let expected;
  const server = http.createServer(async (request, response) => {
    requests.push(request.url);
    if (request.url === '/studio') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (chunks) {
        for (const chunk of chunks) {
          if (response.destroyed) return;
          response.write(chunk);
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        response.end();
      } else {
        response.end(`<html><title>Entity fixture</title><link rel="icon" href="${href}"></html>`);
      }
    } else if (expected && request.url === expected.pathname + expected.search) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
    } else {
      // A wrong query and the fallback must never accidentally yield the right digest.
      response.writeHead(404);
      response.end('no icon at this URL');
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
  const url = `http://127.0.0.1:${server.address().port}/studio`;
  if (decoded) expected = new URL(decoded, url);
  return { url, requests, expected };
}

async function capture(data) {
  const result = await run(['brands', 'capture', data.url, '--json']);
  assert.deepEqual(data.requests, ['/studio', data.expected.pathname + data.expected.search], 'request the decoded href exactly once');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.brand, { url: data.url, sha256: digest });
  assert.equal(receipt.evidence.status, 'captured');
  assert.equal(receipt.evidence.sha256, digest);
  return receipt.brand;
}

for (const [name, href, decoded] of cases) {
  test(`brands capture resolves ${name} in icon href`, { timeout: 20000 }, async (t) => {
    await capture(await fixture(t, href, decoded));
  });
}

const diagramTypes = [
  ['architecture', 'web-app.architecture.json', 'components'],
  ['workflow', 'agent-tool-call.workflow.json', 'nodes'],
  ['sequence', 'cache-miss-request.sequence.json', 'participants'],
  ['dataflow', 'product-analytics.dataflow.json', 'nodes'],
  ['lifecycle', 'agent-run.lifecycle.json', 'states'],
];
for (const [type, example, collection] of diagramTypes) {
  test(`captured entity URL is fetched identically for pinned ${type} validation and rendering`, { timeout: 45000 }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-brand-href-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const data = await fixture(t, null, '/mark.png?v=1&size=32', [
      '<head><!-- </head> --><script>const tag = "</head>";</script>',
      '<link rel="icon" href="/mark.png?v=1&am',
      'p;size=32"></he', 'ad><body>',
    ]);
    const brand = await capture(data);
    const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    diagram[collection][0].brand = brand;
    const input = path.join(root, 'diagram.json');
    const output = path.join(root, 'diagram.html');
    fs.writeFileSync(input, JSON.stringify(diagram));
    for (const command of ['validate', 'render']) {
      data.requests.length = 0;
      const args = [command, type, input, ...(command === 'render' ? [output] : ['--json'])];
      const result = await run(args);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(data.requests, ['/studio', data.expected.pathname + data.expected.search]);
    }
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-brand-status="captured"/);
    assert.ok(html.includes(`data-brand-sha256="${digest}"`));
    assert.ok(html.includes(`data:image/png;base64,${icon.toString('base64')}`));
  });
}

for (const [name, prefix] of [
  ['comment', '<!-- example </head> -->'],
  ['script', '<script>const tag = "</head>"; if (1 < 2) {}</script>'],
  ['style', '<style>p::after { content: "</head>"; }</style>'],
  ['title', '<title>Literal </head> example</title>'],
  ['quoted attribute', '<meta name="example" content="prefix > </head>">'],
  ['single quoted attribute', "<meta name='example' content='prefix > </head>'>"],
  ['raw end tag prefix', '<script>"</scripture></head>";</script>'],
  ['self-closing script flag', '<script/>"</head>";</script>'],
  ['mixed case and spacing', '<ScRiPt data-example=">">"</head>";</sCrIpT \n>'],
]) {
  test(`capture ignores a head ending inside ${name} across response chunks`, async (t) => {
    const html = `<head>${prefix}<link rel='icon' href='/mark.png?a=1&amp;b=2'></HEAD \n>`;
    // Split every token (including the entity) and append a body above the cap:
    // success requires both context-aware scanning and early cancellation.
    const data = await fixture(t, null, '/mark.png?a=1&b=2', [...html, 'x'.repeat(300 * 1024)]);
    await capture(data);
  });
}

test('capture decodes an unquoted href split across chunks', async (t) => {
  await capture(await fixture(t, null, '/mark.png?a=1&b=2', [
    '<head><link rel=icon href=/mark.png?a=1&am', 'p;b=2></head>',
  ]));
});

test('entity-decoded non-HTTP icon URLs are not fetched', { timeout: 20000 }, async (t) => {
  const data = await fixture(t, 'jav&#97;script:alert(1)');
  const result = await run(['brands', 'capture', data.url, '--json']);
  assert.notEqual(result.status, 0);
  assert.deepEqual(data.requests, ['/studio', '/favicon.ico']);
});
