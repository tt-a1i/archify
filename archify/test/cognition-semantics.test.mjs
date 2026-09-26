import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cognition-specific semantic regressions (review blockers on PR #150):
// the first-class routing fields (node.confidence, edge.role, node.card_hit)
// must drive the rendered artifact — two materially different routing
// decisions must never produce the same diagram.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cognition-semantics-'));
const examplePath = path.join(skillRoot, 'examples', 'knowledge-route.cognition.json');

function renderDoc(doc, name) {
  const input = path.join(tmp, `${name}.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/cognition/render-cognition.mjs'),
    input,
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function renderExample() {
  const output = path.join(tmp, 'example.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/cognition/render-cognition.mjs'),
    examplePath,
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function loadExample() {
  return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
}

test('node.confidence drives the artifact: opacity scales and the value is annotated', () => {
  const base = svg(renderExample());
  // Non-unity confidences are annotated so the number stays readable.
  assert.match(base, /data-detail="confidence"[^>]*>conf 0\.88</);
  assert.match(base, /data-detail="confidence"[^>]*>conf 0\.05</);
  // Fill opacity is derived from confidence (0.55 + 0.45 * confidence).
  assert.match(base, /fill-opacity="0\.95/); // 0.88 -> 0.946
  assert.match(base, /fill-opacity="0\.57/); // 0.05 -> 0.5725

  // Behavioral: mutating confidence alone must change the artifact bytes.
  const doc = loadExample();
  const card = doc.nodes.find((n) => n.id === 'triangleCard');
  card.confidence = 0.01;
  const mutated = svg(renderDoc(doc, 'low-confidence'));
  assert.match(mutated, /data-detail="confidence"[^>]*>conf 0\.01</);
  assert.doesNotMatch(mutated, /data-detail="confidence"[^>]*>conf 0\.88</);
  assert.notEqual(mutated, base);
});

test('edge.role drives the artifact: reject is demoted, main stays solid', () => {
  const base = svg(renderExample());
  // The example covers all four roles.
  assert.match(base, /stroke-dasharray="6 3" stroke-opacity="0\.9"/); // branch
  assert.match(base, /stroke-dasharray="2 3" stroke-opacity="0\.6"/); // defer
  assert.match(base, /stroke-dasharray="5 3" stroke-opacity="0\.45"/); // reject

  // Behavioral: flipping one edge's role alone must change its styling.
  const doc = loadExample();
  doc.edges.find((e) => e.id === 'e1').role = 'reject';
  const mutated = svg(renderDoc(doc, 'e1-reject'));
  assert.notEqual(mutated, base);
});

test('card_hit renders exactly one deterministic-hit badge per hit node', () => {
  const doc = loadExample();
  const hitNodes = doc.nodes.filter((n) => n.card_hit === true);
  assert.equal(hitNodes.length, 1, 'fixture precondition: exactly one hit node');
  const markup = svg(renderExample());
  const badge = /<circle cx="\d+(?:\.\d+)?" cy="\d+(?:\.\d+)?" r="4" class="c-database"/g;
  const badges = markup.match(badge) || [];
  assert.equal(
    badges.length,
    hitNodes.length,
    'one badge circle per card_hit node — no duplicates',
  );
});

test('cognition is registered in the preview runtime and verifies end to end', { timeout: 30000 }, async () => {
  const output = path.join(tmp, 'preview.html');
  // Windows child.kill() terminates immediately, bypassing the signal handler.
  const signalRelay = process.platform === 'win32'
    ? ['--import', 'data:text/javascript,process.once("message", () => { process.disconnect(); process.emit("SIGTERM"); });']
    : [];
  const child = spawn(process.execPath, [
    ...signalRelay,
    path.join(skillRoot, 'bin/archify.mjs'),
    'preview', 'cognition', examplePath, output, '--no-open',
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', ...(process.platform === 'win32' ? ['ipc'] : [])],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let previewUrl;
  const started = Date.now();
  while (!previewUrl && Date.now() - started < 8000) {
    previewUrl = stdout.match(/preview (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    if (!previewUrl) await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(previewUrl, `preview URL missing; stdout=${stdout}; stderr=${stderr}`);

  let state;
  while (Date.now() - started < 15000) {
    state = await fetch(new URL('/state', previewUrl)).then((response) => response.json());
    if (state.status === 'verified') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(state?.status, 'verified', `preview did not verify; stdout=${stdout}; stderr=${stderr}`);
  assert.equal(state.revision, 1);
  assert.equal(fs.existsSync(output), true);

  if (process.platform === 'win32') child.send('stop');
  else child.kill('SIGTERM');
  const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(exit, { code: 0, signal: null });
});
