import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archify-atlas-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = path.join(root, "examples/sequence-cache-miss-request.html");
  const html = fs.readFileSync(child, "utf8"),
    node = html.match(/data-node-id="([^"]+)"/)[1];
  const manifest = {
    schema_version: 1,
    title: "Reading </script> safely",
    overview: "overview",
    diagrams: [
      { id: "overview", title: "Overview", file: child },
      { id: "detail", title: "Detail", file: child },
    ],
    links: [{ node, details: ["detail"] }],
  };
  const input = path.join(dir, "atlas.json"),
    output = path.join(dir, "atlas.html");
  const run = (out = output) => {
    fs.writeFileSync(input, JSON.stringify(manifest));
    const r = spawnSync(
      process.execPath,
      [path.join(root, "bin/archify.mjs"), "atlas", input, out, "--json"],
      { encoding: "utf8" },
    );
    return { ...r, receipt: JSON.parse(r.stdout) };
  };
  return { manifest, input, output, run, child };
}
test("atlas packages exact checked child bytes and binds a portable receipt", (t) => {
  const { run, output, input, child } = setup(t),
    r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const bytes = fs.readFileSync(output),
    html = bytes.toString(),
    payload = JSON.parse(
      html.match(
        /<script id="atlas-data" type="application\/json">([\s\S]*?)<\/script>/,
      )[1],
    );
  assert.equal(payload.diagrams[0].html, fs.readFileSync(child, "utf8"));
  assert.equal(payload.title, "Reading </script> safely");
  assert.equal(r.receipt.artifact.sha256, sha(bytes));
  assert.equal(r.receipt.specification.sha256, sha(fs.readFileSync(input)));
  assert.equal(r.receipt.browser_evidence, "pending");
});
test("invalid explicit references preserve the last good atlas", (t) => {
  const { run, output, manifest } = setup(t);
  assert.equal(run().status, 0);
  const before = fs.readFileSync(output);
  for (const mutate of [
    () => (manifest.links[0].node = "missing"),
    () => {
      manifest.links[0].node = "still_missing";
      manifest.diagrams[1].id = "overview";
    },
  ]) {
    mutate();
    const r = run();
    assert.equal(r.status, 1);
    assert.equal(r.receipt.status, "fail");
    assert.ok(r.receipt.diagnostics[0].supportedFixes.length);
    assert.deepEqual(fs.readFileSync(output), before);
  }
});
test("atlas refuses to overwrite a source or manifest", (t) => {
  const { run, input, child } = setup(t);
  const before = fs.readFileSync(child);
  assert.equal(run(input).status, 1);
  assert.equal(run(child).status, 1);
  assert.deepEqual(fs.readFileSync(child), before);
});
