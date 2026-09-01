import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runApiInventory } from '../bin/api-inventory.mjs';

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
  // The atomic write must not leave its temp file behind on success.
  assert.deepEqual(
    fs.readdirSync(root).filter((f) => f.includes('.api-inventory-')),
    [],
    'success must clean up the temp file',
  );
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

// Every mapping feature the review asked for: full class/method path and verb
// composition, non-path attributes ignored, commented and string-embedded
// mappings invisible.
function compositionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-compose-'));
  fs.writeFileSync(path.join(root, 'VersionedController.java'), `package demo;

import org.springframework.web.bind.annotation.*;

/**
 * Versioned user API
 * @GetMapping("/in-javadoc") must not be scanned
 */
@RestController
@RequestMapping(value = {"/v1", "/v2"}, method = RequestMethod.GET)
public class VersionedController {

    @GetMapping("/live")
    public String live() { return "ok"; }

    @RequestMapping(value = "/users", method = { RequestMethod.GET, RequestMethod.POST })
    public String users() { return "ok"; }

    // @DeleteMapping("/commented-out")
    /* @PutMapping("/blocked-comment") */
    @GetMapping(path = "/report", produces = "application/json")
    public String report() { return "ok"; }

    @PostMapping("/blocked") // POST filtered out by the class-level GET restriction
    public String blocked() { return "ok"; }
}
`);
  fs.writeFileSync(path.join(root, 'AdminController.java'), `package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AdminController {

    @PostMapping(consumes = "application/json")
    public String create() { return "ok"; }

    @DeleteMapping(produces = "application/json", params = "id")
    public String remove() { return "ok"; }

    @GetMapping({"/a", "/b"})
    public String multi() { return "@PatchMapping(\\"/fake\\")"; }

    @RequestMapping(method = { RequestMethod.POST }) // no path
    public String action() { return "ok"; }

    @GetMapping("/a" /* trailing comment inside args */)
    public String trailing() { return "ok"; }
}
`);
  return root;
}

test('api-inventory composes class and method mappings and ignores comments, strings, and non-path attributes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-compose-out-'));
  const repo = compositionFixture();
  const artifact = deliverExample(root);

  const result = run(['api-inventory', repo, artifact, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);

  const endpoints = inventoryPayload(fs.readFileSync(artifact, 'utf8'));
  const lines = endpoints.map((e) => `${e.v} ${e.p}`).sort();
  assert.deepEqual(lines, [
    'DELETE /api',
    'GET /api/a',
    'GET /api/a', // trailing-comment variant resolves to the same path
    'GET /api/b',
    'GET /v1/live',
    'GET /v1/report',
    'GET /v1/users',
    'GET /v2/live',
    'GET /v2/report',
    'GET /v2/users',
    'POST /api',
    'POST /api', // @PostMapping(consumes=...) and the pathless @RequestMapping(method=POST)
  ].sort());
  // The class-level mapping itself is never a handler.
  assert.ok(!lines.some((l) => l.endsWith('/v1/v1') || l.endsWith('/v2/v2')), 'class mapping must not be emitted as an endpoint');
  // consumes/produces/params values must not leak into paths.
  assert.ok(!lines.some((l) => l.includes('application/json')), 'non-path attributes must not become path segments');
  assert.ok(!lines.some((l) => l.includes('id')), 'params attribute must not become a path segment');
  // Commented and string-embedded mappings are invisible.
  assert.ok(!lines.some((l) => l.includes('/commented-out') || l.includes('/blocked-comment') || l.includes('/in-javadoc') || l.includes('/fake')), 'commented/string mappings must be ignored');
  // POST /users is filtered by the class-level GET restriction; POST /blocked has an empty verb intersection.
  assert.equal(lines.filter((l) => l.startsWith('POST') && l.includes('/users')).length, 0, 'class-level verb restriction must filter method verbs');
  assert.ok(!lines.some((l) => l.includes('/blocked')), 'empty verb intersection must not be mapped');
  // Javadoc summary still comes from the real comment, not the masked one.
  const versioned = endpoints.find((e) => e.c === 'VersionedController');
  assert.equal(versioned.d, 'Versioned user API');
});

test('api-inventory survives a partial write failure without truncating the artifact', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-enospc-'));
  const repo = springFixture();
  const artifact = deliverExample(root);
  const before = fs.readFileSync(artifact);

  const realWriteFileSync = fs.writeFileSync;
  let directWrite = false;
  fs.writeFileSync = (file, data, options) => {
    if (path.resolve(String(file)) === path.resolve(artifact)) {
      directWrite = true; // the artifact itself must only be replaced by rename
      throw new Error('artifact written directly; write is not atomic');
    }
    // Simulate ENOSPC after 64 bytes: a truncated temp file is left on disk.
    const fd = fs.openSync(file, 'w');
    fs.writeSync(fd, Buffer.from(data).subarray(0, 64));
    fs.closeSync(fd);
    const error = new Error('ENOSPC: no space left on device, write 64');
    error.code = 'ENOSPC';
    throw error;
  };
  try {
    const result = await runApiInventory({ repoRoot: repo, artifactPath: artifact });
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.ok, false);
    assert.equal(result.receipt.diagnostics[0].code, 'api-inventory/artifact-write-failed');
    assert.equal(result.receipt.diagnostics[0].evidence.systemCode, 'ENOSPC');
    // The receipt still describes the untouched original artifact.
    assert.equal(result.receipt.artifact.sha256, sha256(artifact));
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
  assert.equal(directWrite, false, 'must write a temp file and rename, never truncate the artifact in place');
  assert.deepEqual(fs.readFileSync(artifact), before, 'artifact bytes must be unchanged after a partial write failure');
  assert.deepEqual(
    fs.readdirSync(root).filter((f) => f.includes('.api-inventory-')),
    [],
    'failed injection must clean up its temp file',
  );
});

test('api-inventory reports usage and unreadable-artifact failures through the diagnostics contract', () => {
  // Unknown option with --json: machine-readable receipt on stdout, not prose on stderr.
  const typo = run(['api-inventory', 'a', 'b', '--typo', '--json']);
  assert.equal(typo.status, 1);
  const typoReceipt = JSON.parse(typo.stdout);
  assert.equal(typoReceipt.ok, false);
  assert.equal(typoReceipt.diagnostics[0].code, 'api-inventory/usage');
  assert.ok(typoReceipt.diagnostics[0].supportedFixes.length >= 1);
  assert.ok(typoReceipt.diagnostics[0].subject.option === '--typo');

  // Wrong positional count with --json.
  const missing = run(['api-inventory', 'only-one', '--json']);
  assert.equal(missing.status, 1);
  const missingReceipt = JSON.parse(missing.stdout);
  assert.equal(missingReceipt.ok, false);
  assert.equal(missingReceipt.diagnostics[0].code, 'api-inventory/usage');

  // A directory passed as the artifact fails with a diagnostic, not a raw OS error string.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-api-dir-'));
  const repo = springFixture();
  const result = run(['api-inventory', repo, root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'api-inventory/artifact-unreadable');
  assert.equal(receipt.diagnostics[0].evidence.systemCode, 'EISDIR');

  // Without --json the usage error stays on stderr as prose.
  const prose = run(['api-inventory', 'a', 'b', '--typo']);
  assert.equal(prose.status, 1);
  assert.equal(prose.stdout, '');
  assert.ok(prose.stderr.includes('Unknown api-inventory option'));
});
