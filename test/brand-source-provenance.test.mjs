import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeBrandSourceUrl } from '../archify/renderers/shared/brand-marks.mjs';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(icon).digest('hex');
const cases = [
  ['architecture', 'web-app.architecture.json', 'components'],
  ['workflow', 'agent-tool-call.workflow.json', 'nodes'],
  ['sequence', 'cache-miss-request.sequence.json', 'participants'],
  ['dataflow', 'product-analytics.dataflow.json', 'nodes'],
  ['lifecycle', 'agent-run.lifecycle.json', 'states'],
];

test('public brand links strip request data while preserving HTTP(S) origin and encoded paths', () => {
  for (const [input, expected] of [
    ['https://synthetic-user:synthetic-password@EXAMPLE.com:443/brand%2Fmark?session=synthetic#part', 'https://example.com/brand%2Fmark'],
    ['http://example.com:8080/a%20b?revision=synthetic#part', 'http://example.com:8080/a%20b'],
    ['https://[2001:db8::1]:8443/logo.png?size=16#part', 'https://[2001:db8::1]:8443/logo.png'],
    ['https://example.com/brand', 'https://example.com/brand'],
    ['https://example.com', 'https://example.com/'],
    ['javascript:synthetic', null],
    ['/relative', null],
  ]) {
    assert.equal(normalizeBrandSourceUrl(input), expected);
  }
  const request = new URL('https://example.com/mark?revision=synthetic#part');
  const original = request.href;
  assert.equal(normalizeBrandSourceUrl(request), 'https://example.com/mark');
  assert.equal(request.href, original, 'normalization must not mutate the request URL');
});

function run(directory, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: directory, timeout: 15000,
      env: { ...process.env, ARCHIFY_BRAND_ALLOW_PRIVATE: '1', ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-brand-source-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/mark.png?revision=synthetic-image'
      || request.url === '/icon.png?signature=synthetic-icon&size=16') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(icon);
    } else if (request.url === '/redirect?session=synthetic-session') {
      response.writeHead(302, { location: '/landing?version=synthetic-page' });
      response.end();
    } else if (request.url === '/landing?version=synthetic-page') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<head><link rel="icon" href="/icon.png?signature=synthetic-icon&amp;size=16"></head>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { directory, requests, origin: `http://127.0.0.1:${server.address().port}` };
}

for (const [type, example, collection] of cases) {
  for (const mode of ['image', 'redirected page']) {
    test(`${type} shares clean brand provenance while fetching the pinned ${mode} unchanged`, { timeout: 30000 }, async t => {
      const { directory, requests, origin } = await fixture(t);
      const requestPath = mode === 'image'
        ? '/mark.png?revision=synthetic-image'
        : '/redirect?session=synthetic-session';
      const url = `${origin}${requestPath}#synthetic-fragment`;
      const publicSource = `${origin}${mode === 'image' ? '/mark.png' : '/redirect'}`;
      const expectedRequests = mode === 'image' ? [requestPath] : [
        requestPath, '/landing?version=synthetic-page', '/icon.png?signature=synthetic-icon&size=16',
      ];
      const capture = await run(directory, ['brands', 'capture', url, '--json']);
      assert.equal(capture.status, 0, capture.stderr);
      const receipt = JSON.parse(capture.stdout);
      assert.deepEqual(receipt.brand, { url, sha256: digest }, 'retain the full URL in the authored pin');
      assert.deepEqual(requests, expectedRequests);
      assert.equal(receipt.evidence.source, publicSource);

      const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
      diagram[collection][0].brand = receipt.brand;
      diagram.meta.output = 'diagram.html';
      fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(diagram));
      for (const command of ['validate', 'render']) {
        requests.length = 0;
        const result = await run(directory, [command, type, 'input.json', ...(command === 'validate' ? ['--json'] : ['diagram.html'])]);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.deepEqual(requests, expectedRequests, `${command} must preserve query-dependent downloads and redirects`);
      }
      const html = fs.readFileSync(path.join(directory, 'diagram.html'), 'utf8');
      assert.ok(html.includes(`data-node-brand-source="${publicSource}"`));
      assert.ok(html.includes(`data-brand-source="${publicSource}"`));
      assert.ok(html.includes(`data-brand-sha256="${digest}"`));
      assert.ok(html.includes(`data:image/png;base64,${icon.toString('base64')}`));
      assert.doesNotMatch(html, /synthetic-(?:image|session|page|icon|fragment)/);
    });
  }
}

test('normalizing public provenance does not accept credentials or a changed digest', async t => {
  const { directory, requests, origin } = await fixture(t);
  const withCredentials = origin.replace('http://', 'http://synthetic-user:synthetic-password@');
  const capture = await run(directory, ['brands', 'capture', `${withCredentials}/mark.png?revision=synthetic-image`, '--json']);
  assert.notEqual(capture.status, 0);
  assert.match(capture.stderr, /credentials/);
  assert.deepEqual(requests, [], 'credentials must still fail before a request');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  diagram.components[0].brand = { url: `${origin}/mark.png?revision=synthetic-image#synthetic-fragment`, sha256: '0'.repeat(64) };
  diagram.meta.output = 'diagram.html';
  fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(diagram));
  const result = await run(directory, ['validate', 'architecture', 'input.json', '--json']);
  assert.notEqual(result.status, 0);
  assert.ok(JSON.parse(result.stdout).diagnostics.some(entry => entry.code === 'brand/digest-mismatch'));
  assert.equal(fs.existsSync(path.join(directory, 'diagram.html')), false);
});
