// Renders a diagram with the JSON Schema layer removed.
//
// The renderers' hand-written layout validators are defense in depth: every
// supported entry point runs `validateSchema()` first, so an authored width or
// height that would trip a size guard is rejected before `validateWorkflow()`,
// `validateDataflow()`, `validateLifecycle()` or `validateArchitecture()` ever
// runs. Asserting the schema diagnostic proves nothing about those guards — the
// guard can be deleted and the schema case still passes.
//
// This helper builds a throwaway copy of the renderers and swaps
// `generated-validators.mjs` for accept-everything stand-ins. The schema layer
// is the only thing removed, so whatever the renderer reports afterwards is its
// own layout check. Ship code is untouched: there is no production bypass.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');

const PERMISSIVE_VALIDATORS = `// Test stand-in for the generated ajv validators; accepts every document.
const accept = () => true;
export const architecture = accept;
export const workflow = accept;
export const sequence = accept;
export const dataflow = accept;
export const lifecycle = accept;
`;

let sandbox = null;

// The renderers resolve their skill root as <rendererDir>/../.., and from there
// read only assets/template.html, so those two trees are the whole sandbox.
function sandboxRoot() {
  if (sandbox) return sandbox;
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-schema-free-'));
  for (const dir of ['renderers', 'assets']) {
    fs.cpSync(path.join(skillRoot, dir), path.join(sandbox, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(sandbox, 'renderers/shared/generated-validators.mjs'), PERMISSIVE_VALIDATORS);
  process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));
  return sandbox;
}

// Returns { code, stderr }. Never throws on non-zero exit.
export function renderWithoutSchema(mode, doc) {
  const root = sandboxRoot();
  const stem = `${mode}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const input = path.join(root, `${stem}.json`);
  const outPath = path.join(root, `${stem}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [path.join(root, `renderers/${mode}/render-${mode}.mjs`), input, outPath],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', outPath };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), outPath };
  }
}
