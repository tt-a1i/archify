import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function springFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-spring-'));
  const apiModule = path.join(root, 'app-api', 'src', 'main', 'java', 'demo');
  const adminModule = path.join(root, 'app-admin', 'src', 'main', 'java', 'demo');
  fs.mkdirSync(apiModule, { recursive: true });
  fs.mkdirSync(adminModule, { recursive: true });
  fs.writeFileSync(path.join(apiModule, 'UserController.java'), `package demo;

import org.springframework.web.bind.annotation.*;

/**
 * User accounts
 */
@RestController
@RequestMapping("/users")
public class UserController {

    /** List users */
    @GetMapping
    public String list() { return "[]"; }

    @PostMapping(value = {"/", "/bulk"})
    public String bulk() { return "ok"; }

    @PutMapping(path = "/{id}")
    public String update(@PathVariable Long id) { return "ok"; }
}
`);
  fs.writeFileSync(path.join(adminModule, 'AdminController.java'), `package demo;

import org.springframework.web.bind.annotation.*;

@RestController
public class AdminController {

    @RequestMapping(value = "/health", method = { RequestMethod.GET })
    public String health() { return "ok"; }
}
`);
  return root;
}

function deliverExample(outputDir) {
  const output = path.join(outputDir, 'artifact.html');
  const result = run([
    'deliver', 'architecture',
    path.join(skillRoot, 'examples', 'web-app.architecture.json'),
    output,
    '--quality', 'showcase',
  ]);
  assert.equal(result.status, 0, `deliver failed:\n${result.stdout}\n${result.stderr}`);
  return output;
}

function inventoryPayload(html) {
  const match = html.match(/<script type="application\/json" id="api-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'api-data payload missing');
  return JSON.parse(match[1]);
}

test('api-inventory injects a collapsed inventory into a delivered artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-inject-'));
  const repo = springFixture();
  const artifact = deliverExample(root);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'injected');
  assert.equal(receipt.framework, 'spring-mvc');
  assert.equal(receipt.scan.controllers, 2);
  assert.equal(receipt.scan.endpoints, 5);
  assert.deepEqual(receipt.scan.modules, { 'app-api': 4, 'app-admin': 1 });

  const html = fs.readFileSync(artifact, 'utf8');
  assert.ok(html.includes('id="api-inventory"'), 'inventory section missing');
  assert.ok(html.includes('class="api-fab"'), 'floating toggle missing');
  assert.ok(/<section class="api-section" id="api-inventory" hidden/.test(html), 'inventory must render collapsed');
  assert.ok(html.includes('id="api-data"'));
  // The inventory must not add a card to the Info Cards row: an extra card can
  // wrap to a second row on narrow reader layouts and break containment.
  assert.equal((html.match(/<div class="card">/g) || []).length, 3, 'injection must not add info cards');

  const endpoints = inventoryPayload(html);
  const paths = endpoints.map((e) => `${e.v} ${e.p}`).sort();
  assert.deepEqual(paths, [
    'GET /health',
    'GET /users',
    'POST /users',
    'POST /users/bulk',
    'PUT /users/{id}',
  ].sort());
  const userController = endpoints.find((e) => e.p === '/users');
  assert.equal(userController.d, 'User accounts');
  assert.equal(userController.m, 'app-api');
  const health = endpoints.find((e) => e.p === '/health');
  assert.equal(health.m, 'app-admin');

  // The injected inventory reports the new artifact bytes.
  assert.equal(receipt.artifact.sha256, sha256(artifact));
  assert.ok(receipt.artifact.bytes > 0);
});

test('api-inventory is idempotent and leaves an injected artifact untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-rerun-'));
  const repo = springFixture();
  const artifact = deliverExample(root);
  assert.equal(run(['api-inventory', repo, artifact, '--json']).status, 0);
  const before = sha256(artifact);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'already-injected');
  assert.equal(receipt.artifact.sha256, before);
  assert.equal(receipt.diagnostics[0].code, 'api-inventory/already-injected');
  assert.equal(sha256(artifact), before);
});

test('api-inventory reports unsupported frameworks without touching the artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-express-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-express-repo-'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"dependencies":{"express":"^4.18.0"}}');
  const artifact = deliverExample(root);
  const before = sha256(artifact);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'unsupported-framework');
  assert.equal(receipt.diagnostics[0].code, 'api-inventory/unsupported-framework');
  assert.equal(sha256(artifact), before);
});

test('api-inventory reports no-controllers for a plain repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-empty-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-empty-repo-'));
  const artifact = deliverExample(root);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'no-controllers');
  assert.equal(receipt.diagnostics[0].code, 'api-inventory/no-controllers');
});

test('api-inventory fails loudly on non-Archify HTML and preserves the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-plain-'));
  const repo = springFixture();
  const artifact = path.join(root, 'plain.html');
  fs.writeFileSync(artifact, '<html><body>hello</body></html>');
  const before = sha256(artifact);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 1, 'must exit non-zero');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'api-inventory/not-an-archify-artifact');
  assert.equal(sha256(artifact), before);
});

test('api-inventory rejects missing paths and unknown options', () => {
  assert.equal(run(['api-inventory', 'only-one', '--json']).status, 1);
  assert.equal(run(['api-inventory', 'a', 'b', '--nonsense']).status, 1);
});
